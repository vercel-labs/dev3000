import { randomUUID } from "node:crypto"

export type EventSource = "server" | "browser" | "runtime"
export type EventLevel = "debug" | "info" | "warn" | "error"
export interface TimelineEvent {
  seq: number
  timestamp: string
  source: EventSource
  level: EventLevel
  kind: string
  message: string
  data?: Record<string, unknown>
}
export interface EventQuery {
  after?: number
  limit?: number
  source?: EventSource
  level?: EventLevel
  sessionId?: string
}

/** A byte- and count-bounded timeline. Cursors advance only through examined events. */
export class Timeline {
  readonly sessionId = randomUUID()
  private entries: { event: TimelineEvent; bytes: number }[] = []
  private bytes = 0
  private sequence = 0

  constructor(
    private readonly maxEvents = 5000,
    private readonly maxBytes = 8 * 1024 * 1024
  ) {
    if (maxEvents < 1 || maxBytes < 1024) throw new Error("Invalid timeline capacity")
  }

  append(input: Omit<TimelineEvent, "seq" | "timestamp">): TimelineEvent {
    const event: TimelineEvent = { ...input, seq: ++this.sequence, timestamp: new Date().toISOString() }
    // Bound individual events as well as the overall buffer.
    event.message = event.message.slice(0, 8192)
    if (Buffer.byteLength(JSON.stringify(event)) > Math.min(32768, this.maxBytes)) {
      event.data = { truncated: true }
      event.message = event.message.slice(0, Math.min(512, this.maxBytes / 8))
    }
    const bytes = Buffer.byteLength(JSON.stringify(event))
    this.entries.push({ event, bytes })
    this.bytes += bytes
    while (this.entries.length > this.maxEvents || this.bytes > this.maxBytes) {
      const removed = this.entries.shift()
      if (removed) this.bytes -= removed.bytes
    }
    return event
  }

  read(query: EventQuery = {}) {
    const after = query.after ?? 0
    const limit = query.limit ?? 100
    if (!Number.isSafeInteger(after) || after < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
      throw new Error("after must be a nonnegative integer; limit must be 1–500")
    }
    const oldest = this.entries[0]?.event.seq ?? this.sequence + 1
    const reset = Boolean(query.sessionId && query.sessionId !== this.sessionId)
    const start = reset ? 0 : after
    if (!reset && start > this.sequence) throw new Error("Cursor is ahead of this session; supply sessionId")
    const events: TimelineEvent[] = []
    let cursor = start
    for (const { event } of this.entries) {
      if (event.seq <= start) continue
      cursor = event.seq
      if ((!query.source || event.source === query.source) && (!query.level || event.level === query.level)) {
        events.push(event)
        if (events.length === limit) break
      }
    }
    return {
      sessionId: this.sessionId,
      events,
      cursor,
      latest: this.sequence,
      oldest,
      reset,
      dropped: Math.max(0, oldest - start - 1),
      hasMore: cursor < this.sequence
    }
  }
}
