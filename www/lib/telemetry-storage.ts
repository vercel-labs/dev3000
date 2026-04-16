import { list, put } from "@vercel/blob"
import { readBlobJson } from "@/lib/blob-store"
import type { TelemetryEvent } from "@/lib/telemetry"

const TELEMETRY_EVENT_PREFIX = "telemetry/events/"
const DEFAULT_LOOKBACK_DAYS = 30
const MAX_LOOKBACK_DAYS = 365

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

function buildEventPathname(event: TelemetryEvent): string {
  const d = new Date(event.timestamp)
  if (Number.isNaN(d.getTime())) {
    throw new Error("Invalid telemetry event timestamp")
  }
  const year = d.getUTCFullYear()
  const month = pad(d.getUTCMonth() + 1)
  const day = pad(d.getUTCDate())
  const safeType = event.eventType.replace(/[^a-z0-9_-]/gi, "-")
  const safeId = event.eventId.replace(/[^a-z0-9_-]/gi, "-")
  return `${TELEMETRY_EVENT_PREFIX}${year}/${month}/${day}/${d.getTime()}-${safeType}-${safeId}.json`
}

export async function saveTelemetryEvent(event: TelemetryEvent): Promise<void> {
  await put(buildEventPathname(event), JSON.stringify(event), {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: false,
    contentType: "application/json"
  })
}

function buildDayPrefixes(since: Date, until: Date): string[] {
  const prefixes: string[] = []
  const cursor = new Date(Date.UTC(since.getUTCFullYear(), since.getUTCMonth(), since.getUTCDate()))
  const end = new Date(Date.UTC(until.getUTCFullYear(), until.getUTCMonth(), until.getUTCDate()))
  while (cursor.getTime() <= end.getTime()) {
    const year = cursor.getUTCFullYear()
    const month = pad(cursor.getUTCMonth() + 1)
    const day = pad(cursor.getUTCDate())
    prefixes.push(`${TELEMETRY_EVENT_PREFIX}${year}/${month}/${day}/`)
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return prefixes
}

export interface ListTelemetryEventsOptions {
  since?: Date
  until?: Date
  limit?: number
}

export async function listTelemetryEvents(options?: ListTelemetryEventsOptions): Promise<TelemetryEvent[]> {
  const now = options?.until || new Date()
  const defaultSince = new Date(now.getTime() - DEFAULT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000)
  const providedSince = options?.since || defaultSince
  const maxSince = new Date(now.getTime() - MAX_LOOKBACK_DAYS * 24 * 60 * 60 * 1000)
  const since = providedSince.getTime() < maxSince.getTime() ? maxSince : providedSince
  const limit = Math.min(Math.max(options?.limit ?? 500, 1), 5000)

  const prefixes = buildDayPrefixes(since, now)
  const allPathnames: string[] = []

  for (const prefix of prefixes) {
    try {
      let cursor: string | undefined
      do {
        const page = await list({ prefix, cursor, limit: 1000 })
        for (const blob of page.blobs) {
          allPathnames.push(blob.pathname)
        }
        cursor = page.hasMore ? page.cursor : undefined
      } while (cursor)
    } catch {
      // Skip day if listing fails; telemetry must never break the UI.
    }
  }

  allPathnames.sort().reverse()
  const trimmed = allPathnames.slice(0, limit)

  const events = await Promise.all(
    trimmed.map(async (pathname) => {
      try {
        return await readBlobJson<TelemetryEvent>(pathname)
      } catch {
        return null
      }
    })
  )

  return events
    .filter((event): event is TelemetryEvent => event !== null)
    .filter((event) => {
      const ts = Date.parse(event.timestamp)
      return Number.isFinite(ts) && ts >= since.getTime() && ts <= now.getTime()
    })
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
}
