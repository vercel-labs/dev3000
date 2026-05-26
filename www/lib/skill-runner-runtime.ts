import {
  HOSTED_SKILL_RUNNER_TEAM_IDS,
  HOSTED_SKILL_RUNNER_TEAM_SLUGS,
  SKILL_RUNNER_WORKER_PROJECT_NAME
} from "@/lib/skill-runner-config"

const HOSTED_SKILL_RUNNER_TEAM_ID_SET = new Set<string>(HOSTED_SKILL_RUNNER_TEAM_IDS)
const HOSTED_SKILL_RUNNER_TEAM_SLUG_SET = new Set<string>(HOSTED_SKILL_RUNNER_TEAM_SLUGS)

function decodeJwtPayload(token: string | undefined): Record<string, unknown> | null {
  const [, payload] = token?.split(".") || []
  if (!payload) return null

  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>
  } catch {
    return null
  }
}

export function isHostedSkillRunnerTeamId(teamId: string | null | undefined): boolean {
  const trimmed = teamId?.trim()
  return Boolean(trimmed && HOSTED_SKILL_RUNNER_TEAM_ID_SET.has(trimmed))
}

function isHostedSkillRunnerTeamSlug(teamSlug: string | null | undefined): boolean {
  const trimmed = teamSlug?.trim()
  return Boolean(trimmed && HOSTED_SKILL_RUNNER_TEAM_SLUG_SET.has(trimmed))
}

function getCurrentVercelOwnerIdentifier(): string | undefined {
  const systemTeamId = process.env.VERCEL_ORG_ID?.trim() || process.env.VERCEL_TEAM_ID?.trim()
  if (systemTeamId) return systemTeamId

  // Vercel's OIDC owner claim can be the team slug rather than the team id.
  // User/team settings still only enable hosted mode by team id.
  const oidcOwner = decodeJwtPayload(process.env.VERCEL_OIDC_TOKEN)?.owner
  return typeof oidcOwner === "string" && oidcOwner.trim() ? oidcOwner.trim() : undefined
}

export function isSelfHostedSkillRunnerRuntime(): boolean {
  const ownerIdentifier = getCurrentVercelOwnerIdentifier()
  if (!ownerIdentifier) return process.env.VERCEL === "1" && isSkillRunnerWorkerProjectRuntime()
  return !(isHostedSkillRunnerTeamId(ownerIdentifier) || isHostedSkillRunnerTeamSlug(ownerIdentifier))
}

function isSkillRunnerWorkerProjectRuntime(): boolean {
  return [process.env.VERCEL_PROJECT_PRODUCTION_URL, process.env.VERCEL_URL, process.env.NEXT_PUBLIC_VERCEL_URL].some(
    (value) => {
      const host = normalizeHost(value)
      return Boolean(host?.split(".")[0]?.startsWith(SKILL_RUNNER_WORKER_PROJECT_NAME))
    }
  )
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
