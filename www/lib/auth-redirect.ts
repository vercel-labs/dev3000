import type { Route } from "next"

const DEFAULT_AUTH_REDIRECT = "/dev-agents"

interface AuthRedirectOptions {
  prompt?: "consent"
}

export function sanitizeAuthRedirectPath(nextPath: string | null | undefined): string {
  if (!nextPath || !nextPath.startsWith("/") || nextPath.startsWith("//")) {
    return DEFAULT_AUTH_REDIRECT
  }

  return nextPath
}

export function getAuthorizePath(nextPath?: string, options: AuthRedirectOptions = {}): Route {
  const params = new URLSearchParams({
    next: sanitizeAuthRedirectPath(nextPath)
  })

  if (options.prompt === "consent") {
    params.set("prompt", "consent")
  }

  return `/api/auth/authorize?${params.toString()}` as Route
}

export function getSignInPath(nextPath?: string, options: AuthRedirectOptions = {}): Route {
  const params = new URLSearchParams({
    next: sanitizeAuthRedirectPath(nextPath)
  })

  if (options.prompt === "consent") {
    params.set("prompt", "consent")
  }

  return `/signin?${params.toString()}` as Route
}
