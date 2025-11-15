import { cookies } from "next/headers"

interface UserInfo {
  id: string
  email: string
  name: string
  username: string
}

interface RefreshTokenResponse {
  access_token: string
  token_type: string
  id_token: string
  expires_in: number
  scope: string
  refresh_token: string
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
  let accessToken = await getValidAccessToken()

  if (!accessToken) {
    return null
  }

  // For Vercel OAuth, we need to fetch user info from the API
  try {
    const response = await fetch("https://api.vercel.com/v2/user", {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    })

    // If token expired, try to refresh and retry once
    if (response.status === 401) {
      console.log("Access token expired, attempting refresh...")
      accessToken = await refreshAccessToken()

      if (!accessToken) {
        return null
      }

      // Retry with new token
      const retryResponse = await fetch("https://api.vercel.com/v2/user", {
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      })

      if (!retryResponse.ok) {
        console.error("Failed to fetch user info after refresh:", retryResponse.status)
        return null
      }

      const data = await retryResponse.json()
      return {
        id: data.user?.uid || data.user?.id || "",
        email: data.user?.email || "",
        name: data.user?.name || "",
        username: data.user?.username || ""
      }
    }

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
 * Refresh the access token using the refresh token
 * Returns the new access token or null if refresh failed
 *
 * IMPORTANT: This function can only be called from Server Actions or Route Handlers
 * where cookie modification is allowed. Do not call from Server Components.
 */
async function refreshAccessToken(): Promise<string | null> {
  const cookieStore = await cookies()
  const refreshToken = cookieStore.get("refresh_token")?.value

  if (!refreshToken) {
    return null
  }

  try {
    const params = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: process.env.NEXT_PUBLIC_CLIENT_ID as string,
      client_secret: process.env.CLIENT_SECRET as string,
      refresh_token: refreshToken
    })

    const response = await fetch("https://vercel.com/api/login/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: params.toString()
    })

    if (!response.ok) {
      console.error("Failed to refresh token:", response.status)
      return null
    }

    const tokenData: RefreshTokenResponse = await response.json()

    // Update cookies with new tokens
    // Note: This will throw an error if called outside Server Action/Route Handler context
    cookieStore.set("access_token", tokenData.access_token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: tokenData.expires_in
    })

    cookieStore.set("refresh_token", tokenData.refresh_token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 30 // 30 days
    })

    return tokenData.access_token
  } catch (error) {
    console.error("Error refreshing token:", error)
    return null
  }
}

/**
 * Get a valid access token, refreshing if necessary
 * Returns null if no token available and refresh fails
 */
export async function getValidAccessToken(): Promise<string | null> {
  const cookieStore = await cookies()
  const accessToken = cookieStore.get("access_token")?.value

  // Return the access token if it exists
  // Don't attempt to refresh here because this function may be called from Server Components
  // where cookie modification is not allowed. Refresh should only happen in API routes
  // when a 401 is detected.
  return accessToken || null
}
