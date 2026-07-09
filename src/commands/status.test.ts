import { describe, expect, it } from "vitest"
import { getD3kStatus } from "./status"

describe("getD3kStatus", () => {
  it("reports an inactive project", () => {
    expect(getD3kStatus(null)).toEqual({ running: false, ready: false })
  })

  it("returns agent-friendly runtime details", () => {
    const status = getD3kStatus({
      projectName: "example",
      pid: 123,
      appPort: "3000",
      publicUrl: null,
      cdpUrl: "ws://localhost:9222/devtools/browser/test",
      logFilePath: "/tmp/d3k.log",
      serverCommand: "bun run dev",
      serverPid: 456,
      portless: true,
      ready: true,
      startTime: "2026-07-08T00:00:00.000Z",
      sessionFile: "/tmp/session.json",
      lastModified: new Date("2026-07-08T00:00:00.000Z")
    })

    expect(status).toMatchObject({
      running: true,
      ready: true,
      appUrl: "http://localhost:3000",
      browserConnected: true,
      pid: 123,
      serverPid: 456,
      routing: "portless"
    })
  })

  it("prefers the stable public app URL", () => {
    const status = getD3kStatus({
      projectName: "example",
      pid: 123,
      appPort: "3000",
      publicUrl: "http://example.localhost:1355",
      sessionFile: "/tmp/session.json",
      lastModified: new Date()
    })

    expect(status.appUrl).toBe("http://example.localhost:1355")
    expect(status.browserConnected).toBe(false)
  })
})
