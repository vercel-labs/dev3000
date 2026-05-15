import { encryptOverrides } from "flags"
import { NextResponse } from "next/server"

const DEV_AGENTS_ENABLED_FLAG = "dev-agents-enabled"
const FLAG_OVERRIDES_COOKIE = "vercel-flag-overrides"
const FLAG_OVERRIDE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30

export async function GET(request: Request) {
  const requestUrl = new URL(request.url)
  const nextPath = getSafeNextPath(requestUrl.searchParams.get("next")) || "/dev-agents"
  const token = await encryptOverrides({ [DEV_AGENTS_ENABLED_FLAG]: true }, undefined, "30d")

  const response = NextResponse.redirect(new URL(nextPath, requestUrl.origin))
  response.cookies.set(FLAG_OVERRIDES_COOKIE, token, {
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: FLAG_OVERRIDE_MAX_AGE_SECONDS
  })
  return response
}

function getSafeNextPath(value: string | null): string | null {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return null
  return value
}
