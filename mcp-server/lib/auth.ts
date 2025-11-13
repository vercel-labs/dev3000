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
  const cookieStore = await cookies()
  const accessToken = cookieStore.get("access_token")?.value

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

    if (!response.ok) {
      console.error("Failed to fetch user info:", response.status)
      return null
    }

    const data = await response.json()

    return {
      id: data.user.uid,
      email: data.user.email,
      name: data.user.name,
      username: data.user.username
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
