import { isAdminUser } from "@/lib/admin"
import { getCurrentUser } from "@/lib/auth"
import type { TelemetryEventType } from "@/lib/telemetry"
import { listTelemetryEvents } from "@/lib/telemetry-storage"

export const maxDuration = 60

const DEFAULT_LIMIT = 500
const MAX_LIMIT = 2000
const MAX_SINCE_DAYS = 365

function parseSinceParam(value: string | null): Date | undefined {
  if (!value) return undefined
  const days = Number.parseInt(value, 10)
  if (Number.isFinite(days) && days > 0) {
    const clamped = Math.min(days, MAX_SINCE_DAYS)
    return new Date(Date.now() - clamped * 24 * 60 * 60 * 1000)
  }
  const parsed = Date.parse(value)
  if (Number.isFinite(parsed)) return new Date(parsed)
  return undefined
}

export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!isAdminUser(user)) {
    return Response.json({ success: false, error: "Unauthorized" }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const since = parseSinceParam(searchParams.get("since"))
  const limitParam = Number.parseInt(searchParams.get("limit") || "", 10)
  const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), MAX_LIMIT) : DEFAULT_LIMIT
  const eventType = searchParams.get("eventType") as TelemetryEventType | null
  const teamSlug = searchParams.get("teamSlug")
  const userId = searchParams.get("userId")

  const events = await listTelemetryEvents({ since, limit })

  const filtered = events.filter((event) => {
    if (eventType && event.eventType !== eventType) return false
    if (teamSlug && event.teamSlug !== teamSlug) return false
    if (userId && event.userId !== userId) return false
    return true
  })

  return Response.json({ success: true, events: filtered })
}
