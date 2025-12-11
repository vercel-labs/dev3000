import { cookies } from "next/headers"
import type { NextRequest } from "next/server"

interface TokenData {
  access_token: string
  token_type: string
  id_token: string
  expires_in: number
  scope: string
  refresh_token: string
}

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url)
    const code = url.searchParams.get("code")
    const state = url.searchParams.get("state")
    const error = url.searchParams.get("error")
    const errorDescription = url.searchParams.get("error_description")

    // Handle OAuth errors from the provider
    if (error) {
      const errorUrl = new URL("/auth/error", request.url)
      errorUrl.searchParams.set("error", error)
      if (errorDescription) {
        errorUrl.searchParams.set("error_description", errorDescription)
      }
      return Response.redirect(errorUrl)
    }

    if (!code) {
      throw new Error("Authorization code is required")
    }

    const storedState = request.cookies.get("oauth_state")?.value
    const storedNonce = request.cookies.get("oauth_nonce")?.value
    const codeVerifier = request.cookies.get("oauth_code_verifier")?.value

    if (!validate(state, storedState)) {
      throw new Error("State mismatch")
    }

    const tokenData = await exchangeCodeForToken(code, codeVerifier, request.nextUrl.origin)
    const decodedNonce = decodeNonce(tokenData.id_token)

    if (!validate(decodedNonce, storedNonce)) {
      throw new Error("Nonce mismatch")
    }

    await setAuthCookies(tokenData)

    const cookieStore = await cookies()

    // Clear the state, nonce, and oauth_code_verifier cookies
    cookieStore.set("oauth_state", "", { maxAge: 0 })
    cookieStore.set("oauth_nonce", "", { maxAge: 0 })
    cookieStore.set("oauth_code_verifier", "", { maxAge: 0 })

    return Response.redirect(new URL("/workflows", request.url))
  } catch (error) {
    console.error("OAuth callback error:", error)
    return Response.redirect(new URL("/auth/error", request.url))
  }
}

function validate(value: string | null, storedValue: string | undefined): boolean {
  if (!value || !storedValue) {
    return false
  }
  return value === storedValue
}

function decodeNonce(idToken: string): string {
  const payload = idToken.split(".")[1]
  const decodedPayload = Buffer.from(payload, "base64").toString("utf-8")
  const nonceMatch = decodedPayload.match(/"nonce":"([^"]+)"/)
  return nonceMatch ? nonceMatch[1] : ""
}

async function exchangeCodeForToken(
  code: string,
  code_verifier: string | undefined,
  requestOrigin: string
): Promise<TokenData> {
  const params = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: process.env.NEXT_PUBLIC_CLIENT_ID as string,
    client_secret: process.env.CLIENT_SECRET as string,
    code: code,
    code_verifier: code_verifier || "",
    redirect_uri: `${requestOrigin}/api/auth/callback`
  })

  const response = await fetch("https://vercel.com/api/login/oauth/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: params.toString()
  })

  if (!response.ok) {
    const errorData = await response.json()
    throw new Error(`Failed to exchange code for token: ${JSON.stringify(errorData)}`)
  }

  const tokenData = await response.json()
  console.log("Token exchange response - scope:", tokenData.scope)
  return tokenData
}

async function setAuthCookies(tokenData: TokenData) {
  const cookieStore = await cookies()

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
}
