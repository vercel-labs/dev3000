import { cookies } from "next/headers"
import { NextResponse } from "next/server"

async function revokeAndClearAuth(): Promise<number> {
  const cookieStore = await cookies()
  const accessToken = cookieStore.get("access_token")?.value
  let status = 200

  if (accessToken) {
    const credentials = `${process.env.NEXT_PUBLIC_CLIENT_ID}:${process.env.CLIENT_SECRET}`

    try {
      const response = await fetch("https://vercel.com/api/login/oauth/token/revoke", {
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

  cookieStore.set("access_token", "", { maxAge: 0 })
  cookieStore.set("refresh_token", "", { maxAge: 0 })
  cookieStore.set("oauth_state", "", { maxAge: 0 })
  cookieStore.set("oauth_nonce", "", { maxAge: 0 })
  cookieStore.set("oauth_code_verifier", "", { maxAge: 0 })
  cookieStore.set("oauth_return_to", "", { maxAge: 0 })

  return status
}

export async function POST() {
  const status = await revokeAndClearAuth()

  return Response.json({}, { status })
}

export async function GET(request: Request) {
  await revokeAndClearAuth()
  return NextResponse.redirect(new URL("/signin", request.url))
}
