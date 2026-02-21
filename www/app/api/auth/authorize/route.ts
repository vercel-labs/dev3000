import crypto from "node:crypto"
import { cookies } from "next/headers"
import { type NextRequest, NextResponse } from "next/server"

function generateSecureRandomString(length: number) {
  return crypto
    .randomBytes(Math.ceil(length / 2))
    .toString("hex")
    .substring(0, length)
}

export async function GET(req: NextRequest) {
  const state = generateSecureRandomString(43)
  const nonce = generateSecureRandomString(43)
  const code_verifier = generateSecureRandomString(43)
  const code_challenge = crypto.createHash("sha256").update(code_verifier).digest("base64url")
  const cookieStore = await cookies()

  cookieStore.set("oauth_state", state, {
    maxAge: 10 * 60, // 10 minutes
    secure: true,
    httpOnly: true,
    sameSite: "lax"
  })
  cookieStore.set("oauth_nonce", nonce, {
    maxAge: 10 * 60, // 10 minutes
    secure: true,
    httpOnly: true,
    sameSite: "lax"
  })
  cookieStore.set("oauth_code_verifier", code_verifier, {
    maxAge: 10 * 60, // 10 minutes
    secure: true,
    httpOnly: true,
    sameSite: "lax"
  })

  const queryParams = new URLSearchParams({
    client_id: process.env.NEXT_PUBLIC_CLIENT_ID as string,
    redirect_uri: `${req.nextUrl.origin}/api/auth/callback`,
    state,
    nonce,
    code_challenge,
    code_challenge_method: "S256",
    response_type: "code",
    // Include write-level project/deployment scopes so workflow sandbox setup can read
    // development env vars and other protected project settings.
    scope: "openid email profile offline_access user team project project.write deployment deployment.write",
    prompt: "consent"
  })

  const authorizationUrl = `https://vercel.com/oauth/authorize?${queryParams.toString()}`
  return NextResponse.redirect(authorizationUrl)
}
