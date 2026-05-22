export interface VercelCliSandboxContext {
  projectId?: string
  teamId?: string
  token?: string
}

function clean(value?: string): string | undefined {
  const trimmed = value?.trim()
  return trimmed || undefined
}

export function normalizeVercelCliSandboxContext(context?: VercelCliSandboxContext | null): VercelCliSandboxContext {
  return {
    projectId: clean(context?.projectId),
    teamId: clean(context?.teamId),
    token: clean(context?.token)
  }
}

export function buildVercelCliSandboxEnv(context?: VercelCliSandboxContext | null): Record<string, string> {
  const normalized = normalizeVercelCliSandboxContext(context)
  const env: Record<string, string> = {}

  if (normalized.token) {
    env.VERCEL_TOKEN = normalized.token
  }
  if (normalized.projectId) {
    env.VERCEL_PROJECT_ID = normalized.projectId
  }
  if (normalized.teamId) {
    env.VERCEL_ORG_ID = normalized.teamId
    env.VERCEL_TEAM_ID = normalized.teamId
  }

  return env
}

export function buildVercelProjectJsonContent(context?: VercelCliSandboxContext | null): string | null {
  const normalized = normalizeVercelCliSandboxContext(context)
  if (!normalized.projectId) {
    return null
  }

  const projectJson: Record<string, string> = {
    projectId: normalized.projectId
  }
  if (normalized.teamId) {
    projectJson.orgId = normalized.teamId
  }

  return `${JSON.stringify(projectJson, null, 2)}\n`
}
