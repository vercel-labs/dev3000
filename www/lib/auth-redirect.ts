import type { Route } from "next"

const DEFAULT_AUTH_REDIRECT = "/dev-agents"

export function sanitizeAuthRedirectPath(nextPath: string | null | undefined): string {
  if (!nextPath || !nextPath.startsWith("/") || nextPath.startsWith("//")) {
    return DEFAULT_AUTH_REDIRECT
  }

  return nextPath
}

export function getAuthorizePath(nextPath?: string): Route {
  const params = new URLSearchParams({
    next: sanitizeAuthRedirectPath(nextPath)
  })

  return `/api/auth/authorize?${params.toString()}` as Route
}

export function getSignInPath(nextPath?: string): Route {
  const params = new URLSearchParams({
    next: sanitizeAuthRedirectPath(nextPath)
  })

  return `/signin?${params.toString()}` as Route
}
