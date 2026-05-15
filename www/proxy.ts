import type { NextRequest } from "next/server"
import { NextResponse } from "next/server"
import {
  HOSTED_SKILL_RUNNER_TEAM_IDS,
  HOSTED_SKILL_RUNNER_TEAM_SLUGS,
  SKILL_RUNNER_WORKER_PROJECT_NAME
} from "@/lib/skill-runner-config"

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

  if (isSelfHostedSkillRunnerRuntime(request) && !isAllowedSelfHostedSkillRunnerRequest(request)) {
    return new NextResponse("Not Found", {
      status: 404,
      headers: {
        "Cache-Control": "no-store, max-age=0"
      }
    })
  }

  const flagOverridesResponse = getFlagOverridesResponse(request)
  if (flagOverridesResponse) return flagOverridesResponse

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

  if (isPageRequest(request)) {
    const refreshUrl = new URL("/api/auth/refresh", request.url)
    refreshUrl.searchParams.set("next", `${request.nextUrl.pathname}${request.nextUrl.search}`)
    return NextResponse.redirect(refreshUrl)
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
    path: "/",
    maxAge: newTokens.expires_in
  })
  response.cookies.set("refresh_token", newTokens.refresh_token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30 // 30 days
  })
  return response
}

function getFlagOverridesResponse(request: NextRequest): NextResponse | null {
  const overrideToken =
    request.nextUrl.searchParams.get("__vercel_flags") || request.nextUrl.searchParams.get("vercelFlagOverrides")

  if (!overrideToken) return null

  const redirectUrl = request.nextUrl.clone()
  redirectUrl.searchParams.delete("__vercel_flags")
  redirectUrl.searchParams.delete("vercelFlagOverrides")

  const response = NextResponse.redirect(redirectUrl)
  response.cookies.set("vercel-flag-overrides", overrideToken, {
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365
  })
  return response
}

function isSelfHostedSkillRunnerRuntime(request: NextRequest): boolean {
  const ownerIdentifier = getCurrentVercelOwnerIdentifier()
  if (!ownerIdentifier) return process.env.VERCEL === "1" && isSkillRunnerWorkerProjectRuntime(request)

  return (
    !HOSTED_SKILL_RUNNER_TEAM_IDS.includes(ownerIdentifier as (typeof HOSTED_SKILL_RUNNER_TEAM_IDS)[number]) &&
    !HOSTED_SKILL_RUNNER_TEAM_SLUGS.includes(ownerIdentifier as (typeof HOSTED_SKILL_RUNNER_TEAM_SLUGS)[number])
  )
}

function getCurrentVercelOwnerIdentifier(): string | undefined {
  const systemTeamId = process.env.VERCEL_ORG_ID?.trim() || process.env.VERCEL_TEAM_ID?.trim()
  if (systemTeamId) return systemTeamId

  const oidcOwner = decodeJwtPayload(process.env.VERCEL_OIDC_TOKEN)?.owner
  return typeof oidcOwner === "string" && oidcOwner.trim() ? oidcOwner.trim() : undefined
}

function decodeJwtPayload(token: string | undefined): Record<string, unknown> | null {
  const [, payload] = token?.split(".") || []
  if (!payload) return null

  const decoded = decodeBase64Url(payload)
  if (!decoded) return null

  try {
    return JSON.parse(decoded) as Record<string, unknown>
  } catch {
    return null
  }
}

function decodeBase64Url(value: string): string | null {
  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/")
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=")
    return atob(padded)
  } catch {
    return null
  }
}

function isSkillRunnerWorkerProjectRuntime(request: NextRequest): boolean {
  return [
    request.nextUrl.host,
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
    process.env.VERCEL_URL,
    process.env.NEXT_PUBLIC_VERCEL_URL
  ].some((value) => {
    const host = normalizeHost(value)
    return Boolean(host?.split(".")[0]?.startsWith(SKILL_RUNNER_WORKER_PROJECT_NAME))
  })
}

function normalizeHost(value: string | undefined): string | null {
  const trimmed = value?.trim()
  if (!trimmed) return null

  try {
    return new URL(trimmed.startsWith("http") ? trimmed : `https://${trimmed}`).host
  } catch {
    return trimmed.split("/")[0] || null
  }
}

function isAllowedSelfHostedSkillRunnerRequest(request: NextRequest): boolean {
  const pathname = request.nextUrl.pathname

  if (pathname === "/api/skill-runner-worker/version") {
    return request.method === "GET" || request.method === "HEAD"
  }

  if (pathname === "/api/cloud/start-fix") {
    return request.method === "POST" || request.method === "OPTIONS"
  }

  if (pathname.startsWith("/api/cloud/fix-workflow")) {
    return true
  }

  if (pathname.startsWith("/.well-known/workflow/")) {
    return request.method === "GET" || request.method === "HEAD"
  }

  return false
}

async function attemptRefresh(refreshToken: string): Promise<RefreshTokenResponse | null> {
  try {
    const params = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: process.env.NEXT_PUBLIC_CLIENT_ID as string,
      client_secret: process.env.CLIENT_SECRET as string,
      refresh_token: refreshToken
    })

    const response = await fetch("https://api.vercel.com/login/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: params.toString()
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => "")
      console.error("[Proxy] Failed to refresh token:", response.status, errorText.slice(0, 500))
      return null
    }

    const tokenData: RefreshTokenResponse = await response.json()
    return tokenData
  } catch (error) {
    console.error("[Proxy] Error refreshing token:", error)
    return null
  }
}

function isPageRequest(request: NextRequest): boolean {
  if (request.method !== "GET") return false

  const pathname = request.nextUrl.pathname
  if (pathname.startsWith("/api/")) return false

  const accept = request.headers.get("accept") || ""
  return (
    accept.includes("text/html") ||
    accept.includes("text/x-component") ||
    request.headers.get("rsc") === "1" ||
    request.headers.has("next-router-state-tree")
  )
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
