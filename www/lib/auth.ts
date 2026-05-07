import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { cookies } from "next/headers"

interface UserInfo {
  id: string
  email: string
  name: string
  username: string
}

interface VercelCliAuth {
  token?: string
  expiresAt?: number
}

function getLocalVercelCliAuthCandidates(): string[] {
  const homeDirectory = os.homedir()
  const xdgDataHome = process.env.XDG_DATA_HOME || path.join(homeDirectory, ".local", "share")
  const candidates = [
    path.join(xdgDataHome, "com.vercel.cli", "auth.json"),
    path.join(homeDirectory, "Library", "Application Support", "com.vercel.cli", "auth.json"),
    path.join(homeDirectory, ".now", "auth.json"),
    path.join(homeDirectory, ".vercel", "auth.json")
  ]

  return Array.from(new Set(candidates))
}

function getLocalVercelCliAccessToken(): string | null {
  if (process.env.NODE_ENV === "production" || process.env.DEV3000_USE_VERCEL_CLI_AUTH !== "1") {
    return null
  }

  const explicitToken = process.env.VERCEL_TOKEN?.trim()
  if (explicitToken) {
    return explicitToken
  }

  for (const candidate of getLocalVercelCliAuthCandidates()) {
    try {
      const parsed = JSON.parse(fs.readFileSync(candidate, "utf8")) as VercelCliAuth
      const token = parsed.token?.trim()
      const expiresAt = typeof parsed.expiresAt === "number" ? parsed.expiresAt : null
      if (token && (!expiresAt || expiresAt > Math.floor(Date.now() / 1000) + 60)) {
        return token
      }
    } catch {
      // Try the next known Vercel CLI auth location.
    }
  }

  return null
}

async function fetchUserFromAccessToken(accessToken: string): Promise<UserInfo | null> {
  try {
    const response = await fetch("https://api.vercel.com/v2/user", {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    })

    if (!response.ok) {
      console.error("Failed to fetch user info:", response.status)
      return null
    }

    const data = await response.json()

    return {
      id: data.user?.uid || data.user?.id || "",
      email: data.user?.email || "",
      name: data.user?.name || "",
      username: data.user?.username || ""
    }
  } catch (error) {
    console.error("Failed to get current user:", error)
    return null
  }
}

/**
 * Decode the JWT ID token to extract user information
 * This is a simple decoder - for production you should verify the signature
 */
function _decodeIdToken(idToken: string): UserInfo | null {
  try {
    const payload = idToken.split(".")[1]
    const decodedPayload = Buffer.from(payload, "base64").toString("utf-8")
    const data = JSON.parse(decodedPayload)

    return {
      id: data.sub || "",
      email: data.email || "",
      name: data.name || "",
      username: data.username || data.email?.split("@")[0] || ""
    }
  } catch (error) {
    console.error("Failed to decode ID token:", error)
    return null
  }
}

/**
 * Get the current user from the session
 * Returns null if not authenticated
 */
export async function getCurrentUser(): Promise<UserInfo | null> {
  const accessToken = await getValidAccessToken()

  if (!accessToken) {
    return null
  }

  return fetchUserFromAccessToken(accessToken)
}

/**
 * Check if the user is authenticated
 */
export async function isAuthenticated(): Promise<boolean> {
  const user = await getCurrentUser()
  return user !== null
}

/**
 * Get a valid access token
 * Returns null if no token available
 *
 * Token refresh is handled by proxy.ts before requests reach Server Components
 */
export async function getValidAccessToken(): Promise<string | null> {
  const cookieStore = await cookies()
  const accessToken = cookieStore.get("access_token")?.value

  // Return the access token if it exists
  // Token refresh is handled by middleware, not here
  return accessToken || null
}

/**
 * Token for Vercel REST APIs. Use the Sign in with Vercel session token by
 * default in every environment so localhost does not hide production auth gaps.
 */
export async function getVercelApiAccessToken(): Promise<string | null> {
  const accessToken = await getValidAccessToken()
  if (!accessToken) {
    return null
  }

  return getLocalVercelCliAccessToken() || accessToken
}

export async function getVercelApiAccessTokenFromRequest(request: Request): Promise<string | null> {
  const authHeader = request.headers.get("authorization")
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice("Bearer ".length)
  }

  return getVercelApiAccessToken()
}

export async function getCurrentUserFromRequest(request: Request): Promise<UserInfo | null> {
  const authHeader = request.headers.get("authorization")
  if (authHeader?.startsWith("Bearer ")) {
    return fetchUserFromAccessToken(authHeader.slice("Bearer ".length))
  }

  return getCurrentUser()
}
