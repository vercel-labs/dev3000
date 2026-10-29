import type { TimelineEvent } from "./timeline.js"

export interface EventPage {
  sessionId: string
  events: TimelineEvent[]
  cursor: number
  latest: number
  oldest: number
  reset: boolean
  dropped: number
  hasMore: boolean
}

/** Select recent events while preserving chronological context and evidence-gap metadata. */
export function selectEventView(
  page: EventPage,
  options: { count: number; source?: string; errors?: boolean; context?: boolean }
): EventPage {
  if (!Number.isSafeInteger(options.count) || options.count < 1 || options.count > 500)
    throw new Error("count must be 1–500")
  const matches = page.events
    .filter(
      (event) => (!options.source || event.source === options.source) && (!options.errors || event.level === "error")
    )
    .slice(-options.count)
  const selected = new Set(matches.map((event) => event.seq))
  if (options.context) {
    for (const match of matches) {
      const index = page.events.findIndex((event) => event.seq === match.seq)
      for (const event of page.events.slice(Math.max(0, index - 5), index)) selected.add(event.seq)
    }
  }
  return { ...page, events: page.events.filter((event) => selected.has(event.seq)) }
}

/** Read at most the retained buffer, fenced at the status cursor so active traffic cannot cause endless paging. */
export async function readRecentEvents(query: (path: string) => Promise<unknown>): Promise<EventPage> {
  const status = (await query("/status")) as { sessionId: string; cursor: number }
  let cursor = Math.max(0, status.cursor - 5000)
  let combined: EventPage | undefined
  for (let index = 0; index < 10; index++) {
    const page = (await query(
      `/events?after=${cursor}&limit=500&sessionId=${encodeURIComponent(status.sessionId)}`
    )) as EventPage
    if (page.reset) throw new Error("Runtime restarted while reading events; retry against the new session")
    const events = page.events.filter((event) => event.seq <= status.cursor)
    combined = combined
      ? {
          ...combined,
          events: [...combined.events, ...events],
          dropped: combined.dropped + page.dropped,
          cursor: Math.min(page.cursor, status.cursor),
          hasMore: page.cursor < status.cursor
        }
      : {
          ...page,
          events,
          latest: status.cursor,
          cursor: Math.min(page.cursor, status.cursor),
          hasMore: page.cursor < status.cursor
        }
    if (page.cursor >= status.cursor || !page.hasMore) break
    if (page.cursor <= cursor) throw new Error("Event cursor did not advance")
    cursor = page.cursor
  }
  if (!combined) throw new Error("No event response")
  return combined
}
