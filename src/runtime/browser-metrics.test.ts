import { once } from "node:events"
import { runInNewContext } from "node:vm"
import { describe, expect, it, vi } from "vitest"
import { WebSocketServer } from "ws"
import {
  captureBrowserMetrics,
  installMetricsObserver,
  metricsObserverScript,
  summarizeBrowserMetrics
} from "./browser-metrics.js"

const url = "https://example.com/"
const snapshot = {
  url,
  capturedAt: "2026-10-30T00:00:00Z",
  navigation: { startTime: 0, requestStart: 120, responseStart: 200, responseEnd: 240, loadEventEnd: 0 },
  paint: [{ name: "first-contentful-paint", startTime: 260 }],
  resourceCount: 0,
  resources: [],
  observation: null
}
const success = (data: unknown) => JSON.stringify({ success: true, data })

describe("browser metrics summary", () => {
  it("distinguishes navigation TTFB from server wait and missing observations from zero", () => {
    const result = summarizeBrowserMetrics(snapshot, { inp: null })
    expect(result.navigation).toMatchObject({ ttfbMs: 200, serverWaitMs: 80, downloadMs: 40, loadMs: null })
    expect(result.paint.fcpMs).toBe(260)
    expect(result.webVitals).toEqual({ lcp: null, cls: null, inp: null })
    expect(result.longTasks).toBeNull()
    expect(result.measurement.observation).toBe("snapshot-only")
  })
  it("summarizes retained resources without leaking query values or assuming cache state", () => {
    const result = summarizeBrowserMetrics(
      {
        ...snapshot,
        url: `${url}?token=secret`,
        resourceCount: 30,
        resources: [
          {
            name: `${url}script.js?token=secret`,
            initiatorType: "script",
            duration: 31,
            transferSize: 0,
            encodedBodySize: 0,
            decodedBodySize: 0
          }
        ]
      },
      {}
    )
    expect(result.resources).toMatchObject({
      retainedEntries: 30,
      summarizedEntries: 1,
      truncated: true,
      byInitiator: { script: 1 },
      transferBytes: 0
    })
    expect(JSON.stringify(result)).not.toContain("secret")
    expect(result.notes.join(" ")).toContain("Timing-Allow-Origin")
  })
})

describe("navigation observers", () => {
  it("uses CLS session windows, excludes recent input, aggregates long tasks, and disposes", () => {
    const callbacks = new Map<string, (list: { getEntries: () => unknown[] }) => void>()
    const disconnect = vi.fn()
    const context: Record<string, unknown> = {
      performance: { now: () => 0 },
      PerformanceObserver: class {
        static supportedEntryTypes = ["layout-shift", "largest-contentful-paint", "longtask"]
        constructor(private callback: (list: { getEntries: () => unknown[] }) => void) {}
        observe({ type }: { type: string }) {
          callbacks.set(type, this.callback)
        }
        disconnect = disconnect
      }
    }
    runInNewContext(metricsObserverScript("metrics"), context)
    callbacks.get("layout-shift")?.({
      getEntries: () => [
        { startTime: 100, value: 0.1 },
        { startTime: 500, value: 0.2 },
        { startTime: 600, value: 8, hadRecentInput: true },
        { startTime: 1600, value: 0.25 },
        ...[2000, 2800, 3600, 4400, 5200, 6000, 6800].map((startTime) => ({ startTime, value: 0.01 }))
      ]
    })
    callbacks.get("longtask")?.({ getEntries: () => [{ duration: 60 }, { duration: 90 }] })
    callbacks.get("largest-contentful-paint")?.({
      getEntries: () => [{ startTime: 400, element: { tagName: "IMG" }, url }]
    })
    const state = context.metrics as { cls: number; dispose: () => void }
    expect(state.cls).toBeCloseTo(0.31)
    const result = summarizeBrowserMetrics({ ...snapshot, observation: state }, {})
    expect(result.webVitals.lcp?.valueMs).toBe(400)
    expect(result.longTasks).toEqual({ count: 2, totalMs: 150, maxMs: 90 })
    expect(result.measurement.observation).toBe("from-navigation")
    state.dispose()
    expect(disconnect).toHaveBeenCalledTimes(3)
    expect(context.metrics).toBeUndefined()
  })
})

describe("metrics browser workflow", () => {
  it("opens a tab, installs before navigation, and always cleans up after failure", async () => {
    const calls: string[] = []
    const cleanup = vi.fn(async () => {
      calls.push("cleanup")
    })
    const invoke = vi.fn(async (args: string[]) => {
      calls.push(args[0])
      if (args[0] === "tab") return success({})
      if (args[0] === "vitals") return success({ url })
      throw new Error("page detached")
    })
    const install = vi.fn(async () => {
      calls.push("install")
      return cleanup
    })
    await expect(captureBrowserMetrics([url, "--new-tab"], invoke, install)).rejects.toThrow("page detached")
    expect(calls).toEqual(["tab", "install", "vitals", "eval", "cleanup"])
  })
  it("reads an existing page without navigating and rejects mismatched pages", async () => {
    const install = vi.fn()
    const invoke = vi.fn(async (args: string[]) =>
      args[0] === "vitals" ? success({ url }) : success({ result: JSON.stringify(snapshot) })
    )
    const result = await captureBrowserMetrics([], invoke, install)
    expect(result.url).toBe(url)
    expect(install).not.toHaveBeenCalled()
    expect(invoke.mock.calls[0][0]).toEqual(["vitals", "--json"])
    await expect(
      captureBrowserMetrics(
        [],
        async (args) =>
          args[0] === "vitals" ? success({ url: "https://other.test" }) : success({ result: JSON.stringify(snapshot) }),
        install
      )
    ).rejects.toThrow("Active tab changed")
  })
  it.each([["--new-tab"], ["file:///tmp/a"], ["https://user:password@example.com"], [url, "--unknown"]])(
    "rejects invalid arguments without touching the browser: %j",
    async (...args) => {
      const invoke = vi.fn()
      await expect(captureBrowserMetrics(args, invoke)).rejects.toThrow()
      expect(invoke).not.toHaveBeenCalled()
    }
  )
})

describe("managed CDP observer installation", () => {
  it("enables Page before installing, targets the active tab, and removes scripts on cleanup", async () => {
    const server = new WebSocketServer({ port: 0, host: "127.0.0.1" })
    await once(server, "listening")
    const address = server.address() as { port: number }
    const messages: Array<{ method: string; params: Record<string, unknown>; sessionId?: string }> = []
    server.on("connection", (socket) =>
      socket.on("message", (raw) => {
        const message = JSON.parse(raw.toString())
        messages.push(message)
        socket.send(
          JSON.stringify({
            id: message.id,
            result:
              message.method === "Target.attachToTarget"
                ? { sessionId: "observer-session" }
                : message.method === "Page.addScriptToEvaluateOnNewDocument"
                  ? { identifier: "script-id" }
                  : {}
          })
        )
      })
    )
    try {
      const cleanup = await installMetricsObserver(
        async (args) =>
          args[0] === "get"
            ? success({ cdpUrl: `ws://127.0.0.1:${address.port}` })
            : success({
                tabs: [
                  { targetId: "inactive", active: false },
                  { targetId: "selected", active: true }
                ]
              }),
        "testMetrics"
      )
      await cleanup()
      expect(messages.map((message) => message.method)).toEqual([
        "Target.attachToTarget",
        "Page.enable",
        "Page.addScriptToEvaluateOnNewDocument",
        "Page.removeScriptToEvaluateOnNewDocument",
        "Runtime.evaluate"
      ])
      expect(messages[0].params).toEqual({ targetId: "selected", flatten: true })
      expect(messages.slice(1).every((message) => message.sessionId === "observer-session")).toBe(true)
      expect(messages[3].params).toEqual({ identifier: "script-id" })
      expect(messages[4].params.expression).toContain("dispose()")
    } finally {
      for (const socket of server.clients) socket.terminate()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
})
