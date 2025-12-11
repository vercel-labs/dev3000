import { cookies } from "next/headers"

/**
 * Get the current access token from cookies
 * This allows the client to retrieve the token for cross-origin API calls
 */
export async function GET() {
  const cookieStore = await cookies()
  const accessToken = cookieStore.get("access_token")?.value

  if (!accessToken) {
    return Response.json({ error: "Not authenticated" }, { status: 401 })
  }

  return Response.json({ accessToken })
}
