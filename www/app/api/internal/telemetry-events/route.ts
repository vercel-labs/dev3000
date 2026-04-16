import { track } from "@vercel/analytics/server"
import { getCurrentUserFromRequest } from "@/lib/auth"
import type { FailureCategory, TelemetryEvent, TelemetryEventType } from "@/lib/telemetry"
import { saveTelemetryEvent } from "@/lib/telemetry-storage"
import { getWorkflowMirrorSecret } from "@/lib/workflow-storage"

export const maxDuration = 60

const TELEMETRY_EVENT_TYPES: Set<TelemetryEventType> = new Set([
  "skill_runner_install_attempted",
  "skill_runner_install_completed",
  "skill_runner_install_failed",
  "skill_runner_validated",
  "skill_run_started",
  "skill_run_completed",
  "skill_run_failed"
])

const FAILURE_CATEGORIES: Set<FailureCategory> = new Set([
  "worker_unreachable",
  "worker_5xx",
  "ai_provider_error",
  "sandbox_crash",
  "eval_false",
  "timeout",
  "user_cancelled",
  "blob_setup_missing",
  "vercel_api_error",
  "deployment_failed",
  "env_missing",
  "auth_expired",
  "unknown"
])

function isTelemetryEvent(value: unknown): value is TelemetryEvent {
  if (!value || typeof value !== "object") return false
  const event = value as Partial<TelemetryEvent>
  if (typeof event.eventId !== "string" || !event.eventId) return false
  if (typeof event.eventType !== "string" || !TELEMETRY_EVENT_TYPES.has(event.eventType as TelemetryEventType)) {
    return false
  }
  if (typeof event.timestamp !== "string" || Number.isNaN(Date.parse(event.timestamp))) return false
  if (typeof event.userId !== "string") return false
  if (typeof event.teamId !== "string") return false
  if (typeof event.teamSlug !== "string") return false
  if (event.executionMode !== "hosted" && event.executionMode !== "self-hosted") return false
  if (event.failureCategory && !FAILURE_CATEGORIES.has(event.failureCategory)) return false
  return true
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
  if (event.failureCategory) props.failureCategory = event.failureCategory
  return props
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const events = body && typeof body === "object" ? (body as { events?: unknown }).events : undefined

  if (!Array.isArray(events) || events.length === 0 || events.length > 100) {
    return Response.json({ success: false, error: "Invalid telemetry events payload" }, { status: 400 })
  }

  const configuredMirrorSecret = getWorkflowMirrorSecret()
  const providedMirrorSecret = request.headers.get("x-dev3000-workflow-mirror-secret")?.trim()
  const hasMirrorAuth = Boolean(configuredMirrorSecret && providedMirrorSecret === configuredMirrorSecret)

  let authedUserId: string | null = null
  if (!hasMirrorAuth) {
    const user = await getCurrentUserFromRequest(request)
    if (!user) {
      return Response.json({ success: false, error: "Not authenticated" }, { status: 401 })
    }
    authedUserId = user.id
  }

  const accepted: TelemetryEvent[] = []
  for (const candidate of events) {
    if (!isTelemetryEvent(candidate)) continue
    if (!hasMirrorAuth && candidate.userId !== authedUserId) continue
    accepted.push(candidate)
  }

  if (accepted.length === 0) {
    return Response.json({ success: false, error: "No valid telemetry events in payload" }, { status: 400 })
  }

  let saved = 0
  for (const event of accepted) {
    try {
      await saveTelemetryEvent(event)
      saved += 1
    } catch {
      // Skip duplicates or transient blob errors; don't fail the whole batch.
    }
    track(event.eventType, toAnalyticsProps(event)).catch(() => {})
  }

  return Response.json({ success: true, saved })
}
