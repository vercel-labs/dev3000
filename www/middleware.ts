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

export async function middleware(request: NextRequest) {
  const accessToken = request.cookies.get("access_token")?.value
  const refreshToken = request.cookies.get("refresh_token")?.value

  // Only check auth on protected routes
  const protectedPaths = ["/workflows"]
  const isProtectedPath = protectedPaths.some((path) => request.nextUrl.pathname.startsWith(path))

  if (!isProtectedPath) {
    return NextResponse.next()
  }

  // If no tokens at all, let the page handle redirect
  if (!accessToken && !refreshToken) {
    return NextResponse.next()
  }

  // If we have a refresh token but no access token, try to refresh immediately
  if (!accessToken && refreshToken) {
    console.log("[Middleware] No access token but have refresh token, attempting refresh...")
    const newAccessToken = await attemptRefresh(refreshToken)

    if (newAccessToken) {
      // Create response and set new cookies
      const response = NextResponse.next()
      response.cookies.set("access_token", newAccessToken.access_token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: newAccessToken.expires_in
      })
      response.cookies.set("refresh_token", newAccessToken.refresh_token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 60 * 60 * 24 * 30 // 30 days
      })
      console.log("[Middleware] Token refreshed successfully")
      return response
    } else {
      console.log("[Middleware] Token refresh failed")
      return NextResponse.next()
    }
  }

  // If we have an access token, verify it's still valid
  if (accessToken) {
    try {
      const apiResponse = await fetch("https://api.vercel.com/v2/user", {
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      })

      // Token is valid, continue
      if (apiResponse.ok) {
        return NextResponse.next()
      }

      // Token expired (401), try to refresh
      if (apiResponse.status === 401 && refreshToken) {
        console.log("[Middleware] Access token expired, attempting refresh...")
        const newAccessToken = await attemptRefresh(refreshToken)

        if (newAccessToken) {
          // Create response and set new cookies
          const response = NextResponse.next()
          response.cookies.set("access_token", newAccessToken.access_token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "lax",
            maxAge: newAccessToken.expires_in
          })
          response.cookies.set("refresh_token", newAccessToken.refresh_token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "lax",
            maxAge: 60 * 60 * 24 * 30 // 30 days
          })
          console.log("[Middleware] Token refreshed successfully")
          return response
        } else {
          console.log("[Middleware] Token refresh failed")
        }
      }
    } catch (error) {
      console.error("[Middleware] Error checking token:", error)
    }
  }

  // If we get here, token refresh failed or no valid tokens
  // Let the page component handle the redirect
  return NextResponse.next()
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
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - signin (auth page)
     * - auth (auth callbacks)
     */
    "/((?!api|_next/static|_next/image|favicon|signin|auth).*)"
  ]
}
