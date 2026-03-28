import { cookies } from "next/headers"

interface UserInfo {
  id: string
  email: string
  name: string
  username: string
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

  // Fetch user info from the Vercel API using the access token
  // Token refresh is handled by proxy.ts before requests reach Server Components
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
