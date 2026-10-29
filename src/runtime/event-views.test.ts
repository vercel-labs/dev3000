import { describe, expect, it } from "vitest"
import { readRecentEvents, selectEventView } from "./event-views.js"
import { Timeline } from "./timeline.js"

describe("live event views", () => {
  it("keeps chronological error context across sources, rather than only other errors", () => {
    const timeline = new Timeline()
    for (let i = 0; i < 12; i++)
      timeline.append({
        source: i % 2 ? "browser" : "server",
        level: i === 5 || i === 10 ? "error" : "info",
        kind: "test",
        message: String(i)
      })
    const page = timeline.read()
    expect(selectEventView(page, { count: 1, errors: true, context: true }).events.map((e) => e.message)).toEqual([
      "5",
      "6",
      "7",
      "8",
      "9",
      "10"
    ])
    expect(selectEventView(page, { count: 2, source: "server" }).events.map((e) => e.message)).toEqual(["8", "10"])
  })
  it("pages over retained events, preserves dropped counts, and fences out new traffic", async () => {
    const timeline = new Timeline(600)
    for (let i = 0; i < 800; i++) timeline.append({ source: "server", level: "info", kind: "test", message: String(i) })
    const query = async (path: string) => {
      if (path === "/status") return { sessionId: timeline.sessionId, cursor: 800 }
      timeline.append({ source: "server", level: "info", kind: "test", message: "new traffic" })
      const params = new URL(path, "http://runtime").searchParams
      return timeline.read({
        after: Number(params.get("after")),
        limit: Number(params.get("limit")),
        sessionId: params.get("sessionId") || undefined
      })
    }
    const result = await readRecentEvents(query)
    expect(result.events[0].seq).toBe(202)
    expect(result.events.at(-1)?.seq).toBe(800)
    expect(result.dropped).toBe(201)
    expect(result.cursor).toBe(800)
    expect(result.hasMore).toBe(false)
  })
  it("rejects resets instead of merging evidence from different sessions", async () => {
    await expect(
      readRecentEvents(async (path) => (path === "/status" ? { sessionId: "old", cursor: 10 } : { reset: true }))
    ).rejects.toThrow("restarted")
  })
})
