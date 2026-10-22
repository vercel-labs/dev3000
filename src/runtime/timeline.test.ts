import { describe, expect, it } from "vitest"
import { Timeline } from "./timeline.js"

const event = (message: string, source: "server" | "browser" = "server") => ({
  source,
  level: "info" as const,
  kind: "log",
  message
})

describe("in-memory evidence timeline", () => {
  it("paginates interleaved sources without skipping events", () => {
    const timeline = new Timeline()
    timeline.append(event("server starts"))
    timeline.append(event("request", "browser"))
    timeline.append(event("server responds"))
    const first = timeline.read({ limit: 2 })
    expect(first.events.map((e) => e.seq)).toEqual([1, 2])
    expect(first.hasMore).toBe(true)
    const next = timeline.read({ after: first.cursor, sessionId: first.sessionId })
    expect(next.events.map((e) => e.message)).toEqual(["server responds"])
    expect(next.hasMore).toBe(false)
  })

  it("advances filtered cursors through examined events and reports gaps", () => {
    const timeline = new Timeline(3)
    for (let i = 0; i < 5; i++) timeline.append(event(String(i), i === 3 ? "browser" : "server"))
    const result = timeline.read({ source: "browser" })
    expect(result.events.map((e) => e.seq)).toEqual([4])
    expect(result.cursor).toBe(5)
    expect(result.dropped).toBe(2)
    expect(result.oldest).toBe(3)
    expect(timeline.read({ after: result.cursor }).events).toEqual([])
  })

  it("detects a new session even when the previous cursor is larger", () => {
    const old = new Timeline()
    const next = new Timeline()
    next.append(event("new session"))
    const result = next.read({ sessionId: old.sessionId, after: 100 })
    expect(result.reset).toBe(true)
    expect(result.events[0].message).toBe("new session")
    expect(result.cursor).toBe(1)
    expect(() => next.read({ after: 100 })).toThrow("Cursor is ahead")
  })

  it("bounds oversized payloads and total retained bytes", () => {
    const timeline = new Timeline(100, 2048)
    timeline.append({ ...event("a".repeat(50000)), data: { payload: "b".repeat(50000) } })
    expect(timeline.read().events[0].data).toEqual({ truncated: true })
    for (let i = 0; i < 100; i++) timeline.append(event("a".repeat(400)))
    const result = timeline.read()
    expect(result.events.length).toBeLessThan(5)
    expect(result.dropped).toBeGreaterThan(0)
  })

  it("rejects invalid cursors and unbounded reads", () => {
    const timeline = new Timeline()
    for (const query of [{ after: -1 }, { after: NaN }, { limit: 0 }, { limit: 501 }, { limit: 1.5 }]) {
      expect(() => timeline.read(query)).toThrow()
    }
  })
})
