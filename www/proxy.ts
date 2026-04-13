import type { NextRequest } from "next/server"
import { NextResponse } from "next/server"

interface RefreshTokenResponse {
  access_token: string
  token_type: string
  id_token: string
  expires_in: number
  scope: string
  refresh_token: string
}

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname

  // Auth endpoints need direct access to the raw OAuth cookies without refresh interception.
  if (pathname.startsWith("/api/auth")) {
    return NextResponse.next()
  }

  const accessToken = request.cookies.get("access_token")?.value
  const refreshToken = request.cookies.get("refresh_token")?.value

  // If no refresh token, nothing to do — let pages handle auth redirects
  if (!refreshToken) {
    return NextResponse.next()
  }

  // If access token cookie still exists, it's valid (cookie maxAge = expires_in)
  if (accessToken) {
    return NextResponse.next()
  }

  // Access token expired but we have a refresh token — attempt silent refresh
  const newTokens = await attemptRefresh(refreshToken)

  if (!newTokens) {
    return NextResponse.next()
  }

  const response = NextResponse.next()
  response.cookies.set("access_token", newTokens.access_token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: newTokens.expires_in
  })
  response.cookies.set("refresh_token", newTokens.refresh_token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 30 // 30 days
  })
  return response
}

async function attemptRefresh(refreshToken: string): Promise<RefreshTokenResponse | null> {
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
      console.error("[Middleware] Failed to refresh token:", response.status)
      return null
    }

    const tokenData: RefreshTokenResponse = await response.json()
    return tokenData
  } catch (error) {
    console.error("[Middleware] Error refreshing token:", error)
    return null
  }
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    "/((?!_next/static|_next/image|favicon.ico).*)"
  ]
}
