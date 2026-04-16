import { track } from "@vercel/analytics/server"
import { saveTelemetryEvent } from "@/lib/telemetry-storage"
import type { WorkflowRunMirrorTarget } from "@/lib/workflow-storage"

export type TelemetryEventType =
  | "skill_runner_install_attempted"
  | "skill_runner_install_completed"
  | "skill_runner_install_failed"
  | "skill_runner_validated"
  | "skill_run_started"
  | "skill_run_completed"
  | "skill_run_failed"

export type FailureCategory =
  | "worker_unreachable"
  | "worker_5xx"
  | "ai_provider_error"
  | "sandbox_crash"
  | "eval_false"
  | "timeout"
  | "user_cancelled"
  | "blob_setup_missing"
  | "vercel_api_error"
  | "deployment_failed"
  | "env_missing"
  | "auth_expired"
  | "unknown"

export interface TelemetryEvent {
  eventId: string
  eventType: TelemetryEventType
  timestamp: string
  userId: string
  userName: string
  userHandle: string
  teamId: string
  teamName: string
  teamSlug: string
  teamIsPersonal: boolean
  executionMode: "hosted" | "self-hosted"
  runId?: string
  skillRunnerId?: string
  skillName?: string
  skillCanonicalPath?: string
  costUsd?: number
  durationMs?: number
  successEvalResult?: boolean | null
  workerProjectId?: string
  workerBaseUrl?: string
  failureCategory?: FailureCategory
  deploymentSha?: string
}

type BuildEventInput = Omit<TelemetryEvent, "eventId" | "timestamp" | "deploymentSha"> &
  Partial<Pick<TelemetryEvent, "eventId" | "timestamp" | "deploymentSha">>

export function buildTelemetryEvent(input: BuildEventInput): TelemetryEvent {
  return {
    eventId: input.eventId || crypto.randomUUID(),
    timestamp: input.timestamp || new Date().toISOString(),
    deploymentSha: input.deploymentSha || process.env.VERCEL_GIT_COMMIT_SHA || undefined,
    ...input
  }
}

export interface UserIdentity {
  id: string
  name: string
  username: string
}

export interface TeamIdentity {
  id: string
  slug: string
  name: string
  isPersonal: boolean
}

export function buildIdentityProps(user: UserIdentity, team: TeamIdentity, executionMode: "hosted" | "self-hosted") {
  return {
    userId: user.id,
    userName: user.name,
    userHandle: user.username,
    teamId: team.id,
    teamName: team.name,
    teamSlug: team.slug,
    teamIsPersonal: team.isPersonal,
    executionMode
  }
}

function toAnalyticsProps(event: TelemetryEvent): Record<string, string | number | boolean | null> {
  const props: Record<string, string | number | boolean | null> = {
    eventId: event.eventId,
    userId: event.userId,
    userHandle: event.userHandle,
    teamSlug: event.teamSlug,
    teamIsPersonal: event.teamIsPersonal,
    executionMode: event.executionMode
  }
  if (event.runId) props.runId = event.runId
  if (event.skillRunnerId) props.skillRunnerId = event.skillRunnerId
  if (event.skillCanonicalPath) props.skillCanonicalPath = event.skillCanonicalPath
  if (typeof event.costUsd === "number") props.costUsd = event.costUsd
  if (typeof event.durationMs === "number") props.durationMs = event.durationMs
  if (event.successEvalResult !== undefined) {
    props.successEvalResult = event.successEvalResult === null ? "null" : event.successEvalResult
  }
  if (event.failureCategory) props.failureCategory = event.failureCategory
  if (event.deploymentSha) props.deploymentSha = event.deploymentSha
  return props
}

export async function emitTelemetryEvent(event: TelemetryEvent): Promise<void> {
  await Promise.allSettled([
    track(event.eventType, toAnalyticsProps(event)).catch(() => {}),
    saveTelemetryEvent(event).catch(() => {})
  ])
}

function normalizeMirrorApiBaseUrl(value: string | undefined | null): string | null {
  const trimmed = value?.trim()
  if (!trimmed) return null
  try {
    return new URL(trimmed).origin
  } catch {
    return null
  }
}

export async function relayTelemetryEventToControlPlane(
  event: TelemetryEvent,
  mirrorTarget: WorkflowRunMirrorTarget
): Promise<void> {
  const apiBaseUrl = normalizeMirrorApiBaseUrl(mirrorTarget.apiBaseUrl)
  const accessToken = mirrorTarget.accessToken?.trim()
  const internalSecret = mirrorTarget.internalSecret?.trim()

  if (!apiBaseUrl || (!accessToken && !internalSecret)) {
    return
  }

  const headers: HeadersInit = {
    "content-type": "application/json",
    "x-dev3000-workflow-mirror": "1"
  }
  if (internalSecret) {
    headers["x-dev3000-workflow-mirror-secret"] = internalSecret
  } else if (accessToken) {
    headers.authorization = `Bearer ${accessToken}`
  }

  try {
    await fetch(new URL("/api/internal/telemetry-events", apiBaseUrl), {
      method: "POST",
      headers,
      body: JSON.stringify({ events: [event] }),
      cache: "no-store"
    })
  } catch {
    // Fire-and-forget; telemetry must never block a workflow run.
  }
}

export function classifyFailure(
  message: string | undefined | null,
  successEvalResult: boolean | null | undefined
): FailureCategory {
  if (successEvalResult === false) return "eval_false"

  const text = (message || "").toString()
  if (!text) return "unknown"

  if (/ECONNREFUSED|ENOTFOUND|EAI_AGAIN|fetch failed/i.test(text)) return "worker_unreachable"
  if (/non-JSON response|HTTP\s*5\d\d|5\d\d\s/i.test(text)) return "worker_5xx"
  if (/BLOB_READ_WRITE_TOKEN|Vercel Blob: No token found/i.test(text)) return "blob_setup_missing"
  if (/rate limit|AI\s*Gateway|ai[_-]?provider|Anthropic|OpenAI/i.test(text)) return "ai_provider_error"
  if (/timed out|deadline|TIMEOUT/i.test(text)) return "timeout"
  if (/cancel|abort/i.test(text)) return "user_cancelled"
  if (/sandbox.*(crash|killed|exit)/i.test(text)) return "sandbox_crash"
  if (/deployment.*fail|failed deployment/i.test(text)) return "deployment_failed"
  if (/missing.*env|required.*env|env.*missing/i.test(text)) return "env_missing"
  if (/auth.*(expired|invalid)|token.*expired|401|403/i.test(text)) return "auth_expired"
  if (/vercel api|api\.vercel\.com/i.test(text)) return "vercel_api_error"
  return "unknown"
}
