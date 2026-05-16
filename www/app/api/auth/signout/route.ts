import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import { getSignInPath } from "@/lib/auth-redirect"

const AUTH_COOKIE_NAMES = [
  "access_token",
  "refresh_token",
  "oauth_state",
  "oauth_nonce",
  "oauth_code_verifier",
  "oauth_return_to"
]

async function revokeAuthToken(): Promise<number> {
  const cookieStore = await cookies()
  const accessToken = cookieStore.get("access_token")?.value
  let status = 200

  if (accessToken) {
    const credentials = `${process.env.NEXT_PUBLIC_CLIENT_ID}:${process.env.CLIENT_SECRET}`

    try {
      const response = await fetch("https://api.vercel.com/login/oauth/token/revoke", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${Buffer.from(credentials).toString("base64")}`
        },
        body: new URLSearchParams({
          token: accessToken
        })
      })

      status = response.status

      if (!response.ok) {
        const errorData = await response.json().catch(() => null)
        console.error("Error revoking token:", errorData)
      }
    } catch (error) {
      console.error("Error revoking token:", error)
      status = 200
    }
  }

  return status
}

function clearAuthCookies(response: NextResponse) {
  for (const cookieName of AUTH_COOKIE_NAMES) {
    response.cookies.set(cookieName, "", {
      path: "/",
      maxAge: 0
    })
  }
}

export async function POST() {
  const status = await revokeAuthToken()
  const response = NextResponse.json({}, { status })
  clearAuthCookies(response)

  return response
}

export async function GET(request: Request) {
  await revokeAuthToken()
  const response = NextResponse.redirect(new URL(getSignInPath(undefined, { prompt: "consent" }), request.url))
  clearAuthCookies(response)

  return response
}
