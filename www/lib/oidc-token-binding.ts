export interface OidcTokenBinding {
  projectId?: string
  teamId?: string
}

export function decodeJwtPayload(token: string | undefined): Record<string, unknown> | null {
  if (!token) return null
  const [, payload] = token.split(".")
  if (!payload) return null

  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>
  } catch {
    return null
  }
}

export function getOidcSandboxBinding(token: string | undefined): OidcTokenBinding {
  const payload = decodeJwtPayload(token)
  const projectId = typeof payload?.project_id === "string" ? payload.project_id.trim() || undefined : undefined
  const teamId = typeof payload?.owner_id === "string" ? payload.owner_id.trim() || undefined : undefined
  return { projectId, teamId }
}

export function describeOidcClaimsForLog(token: string | undefined): Record<string, unknown> | null {
  const payload = decodeJwtPayload(token)
  if (!payload) return null

  return {
    iss: payload.iss,
    aud: payload.aud,
    sub: payload.sub,
    ownerId: payload.owner_id,
    projectId: payload.project_id,
    owner: payload.owner,
    project: payload.project,
    environment: payload.environment,
    deployment: payload.deployment,
    exp: payload.exp,
    iat: payload.iat
  }
}

export function isOidcTokenBoundToProject(token: string | undefined, expected: OidcTokenBinding): token is string {
  const trimmed = token?.trim()
  if (!trimmed) return false

  const binding = getOidcSandboxBinding(trimmed)
  if (!binding.projectId && !binding.teamId) {
    return false
  }
  if (expected.projectId && binding.projectId !== expected.projectId) {
    return false
  }
  if (expected.teamId && binding.teamId !== expected.teamId) {
    return false
  }

  return true
}
