import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { runInNewContext } from "node:vm"
import { describe, expect, it, vi } from "vitest"
import { captureBrowserLoading, jankObserverScript, parseCaptureOptions, saveRecording } from "./browser-capture.js"
import { compareCaptures, distribution } from "./browser-compare.js"
import type { ManagedCdp } from "./managed-cdp.js"

describe("capture validation", () => {
  it("requires explicit export and rejects credential URLs, overrides and invalid actions before driving Chrome", () => {
    for (const args of [
      ["file:///etc/passwd", "--output", "/tmp/capture"],
      ["https://user:secret@example.com", "--output", "/tmp/capture"],
      ["https://example.com", "--output", "relative"],
      ["https://example.com", "--output", "/tmp/capture", "--runs", "0"],
      ["https://example.com", "--output", "/tmp/capture", "--actions", '[{"eval":"secret"}]'],
      ["https://example.com", "--output", "/tmp/capture", "--actions", '[{"click":"#one","scroll":20}]'],
      ["https://example.com", "--output", "/tmp/capture", "--cdp", "9222"]
    ])
      expect(() => parseCaptureOptions(args)).toThrow()
    expect(
      parseCaptureOptions([
        "https://example.com",
        "--output",
        "/tmp/new",
        "--actions",
        '[{"click":"#menu"},{"scroll":600},{"waitFor":"#ready"}]'
      ])
    ).toMatchObject({ runs: 3, settleMs: 1000 })
  })

  it("refuses to overwrite an existing baseline without connecting to Chrome", async () => {
    const directory = await mkdtemp(join(tmpdir(), "d3k-capture-test-"))
    const connect = vi.fn()
    try {
      await expect(
        captureBrowserLoading(["https://example.com", "--output", directory], vi.fn(), connect)
      ).rejects.toThrow()
      expect(connect).not.toHaveBeenCalled()
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it("reports unsupported native recording and removes observers without stopping someone else's recording", async () => {
    const directory = await mkdtemp(join(tmpdir(), "d3k-capture-test-"))
    const send = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === "Browser.getVersion") return { product: "Chrome/152" }
      if (method === "Page.addScriptToEvaluateOnNewDocument") return { identifier: "probe" }
      if (method === "Runtime.evaluate")
        return { result: { value: params?.expression === "performance.timeOrigin" ? 1 : true } }
      if (method === "Page.startScreenRecording") throw new Error("Method not found")
      return {}
    })
    const close = vi.fn()
    try {
      await expect(
        captureBrowserLoading(
          ["https://example.com", "--output", join(directory, "new"), "--runs", "1", "--settle-ms", "250"],
          vi.fn(),
          async () => ({ send, close })
        )
      ).rejects.toThrow("Chrome 153+")
      expect(send).toHaveBeenCalledWith("Page.removeScriptToEvaluateOnNewDocument", { identifier: "probe" })
      expect(send.mock.calls.some(([method]) => method === "Page.stopScreenRecording")).toBe(false)
      expect(close).toHaveBeenCalledOnce()
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})

describe("recording export", () => {
  it("decodes chunks, closes the browser stream and preserves existing evidence", async () => {
    const directory = await mkdtemp(join(tmpdir(), "d3k-capture-test-"))
    const path = join(directory, "video.mp4")
    const send = vi.fn(async (method: string) => {
      if (method === "Page.stopScreenRecording") return { stream: "video" }
      if (method === "IO.read")
        return { data: Buffer.from("test-mp4").toString("base64"), base64Encoded: true, eof: true }
      return {}
    })
    const cdp: ManagedCdp = { send, close: vi.fn() }
    try {
      expect(await saveRecording(cdp, path)).toBe(8)
      expect(await readFile(path, "utf8")).toBe("test-mp4")
      expect(send).toHaveBeenLastCalledWith("IO.close", { handle: "video" })
      await writeFile(path, "baseline")
      await expect(saveRecording(cdp, path)).rejects.toThrow()
      expect(await readFile(path, "utf8")).toBe("baseline")
      expect(send).toHaveBeenLastCalledWith("IO.close", { handle: "video" })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it("closes the browser stream even when export fails", async () => {
    const directory = await mkdtemp(join(tmpdir(), "d3k-capture-test-"))
    const send = vi.fn(async (method: string) => {
      if (method === "Page.stopScreenRecording") return { stream: "video" }
      if (method === "IO.read") throw new Error("bridge disconnected")
      return {}
    })
    try {
      await expect(saveRecording({ send, close: vi.fn() }, join(directory, "video.mp4"))).rejects.toThrow(
        "bridge disconnected"
      )
      expect(send).toHaveBeenLastCalledWith("IO.close", { handle: "video" })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})

describe("jank observations", () => {
  it("bounds script attribution, records interaction and frame gaps, and disposes every probe", () => {
    const callbacks = new Map<string, (list: { getEntries: () => object[] }) => void>()
    let tick: (now: number) => void = () => {}
    const disconnect = vi.fn(),
      cancel = vi.fn(),
      remove = vi.fn()
    const context: Record<string, unknown> = {
      requestAnimationFrame: (callback: typeof tick) => {
        tick = callback
        return 1
      },
      cancelAnimationFrame: cancel,
      document: { visibilityState: "visible", addEventListener: vi.fn(), removeEventListener: remove },
      PerformanceObserver: class {
        static supportedEntryTypes = ["long-animation-frame", "event"]
        constructor(private callback: (list: { getEntries: () => object[] }) => void) {}
        observe({ type }: { type: string }) {
          callbacks.set(type, this.callback)
        }
        disconnect = disconnect
      }
    }
    runInNewContext(jankObserverScript("jank"), context)
    tick(0)
    tick(100)
    callbacks.get("long-animation-frame")?.({
      getEntries: () => [
        {
          duration: 350,
          blockingDuration: 300,
          scripts: Array.from({ length: 12 }, (_, i) => ({
            duration: i,
            sourceURL: "https://example.com/script.js",
            sourceFunctionName: "slow"
          }))
        }
      ]
    })
    callbacks.get("event")?.({
      getEntries: () => [
        { duration: 280, interactionId: 1 },
        { duration: 900, interactionId: 0 }
      ]
    })
    const state = context.jank as {
      frames: number
      maxFrameGapMs: number
      maxInteractionMs: number
      longAnimationFrames: { count: number; slowestScripts: { durationMs: number }[] }
      dispose: () => void
    }
    expect(state).toMatchObject({ frames: 2, maxFrameGapMs: 100, maxInteractionMs: 280 })
    expect(state.longAnimationFrames.slowestScripts.map((script) => script.durationMs)).toEqual([11, 10, 9, 8, 7])
    state.dispose()
    expect(context.jank).toBeUndefined()
    expect(disconnect).toHaveBeenCalledTimes(2)
    expect(cancel).toHaveBeenCalledOnce()
    expect(remove).toHaveBeenCalledOnce()
  })
})

function capture(lcp: number | null = 100) {
  const run = {
    video: "run-1.mp4",
    triggerOffsetMs: 150,
    viewport: { width: 1280, height: 720, dpr: 2 },
    metrics: {
      url: "https://example.com/",
      webVitals: { lcp: lcp === null ? null : { valueMs: lcp }, cls: 0 },
      paint: { fcpMs: 80 },
      navigation: { ttfbMs: 30 },
      longTasks: { totalMs: 0 }
    },
    jank: { maxFrameGapMs: 17, maxInteractionMs: null, longAnimationFrames: { totalBlockingMs: 0 } }
  }
  return {
    version: 1,
    browser: "Chrome/157",
    scenario: { url: "https://example.com/" },
    runs: [run, structuredClone(run), structuredClone(run)]
  }
}

describe("performance comparisons", () => {
  it("does not coerce missing measurements to zero and reports ranges without claiming a pass", () => {
    expect(distribution([null, undefined])).toEqual({ observed: 0, median: null, min: null, max: null })
    expect(distribution([90, 10, 20, 40, null])).toEqual({ observed: 4, median: 30, min: 10, max: 90 })
    const result = compareCaptures(capture(), capture(null))
    expect(result.comparable).toBe(true)
    expect(result.metrics[0].medianDelta).toBeNull()
    expect(result).not.toHaveProperty("passed")
  })

  it("flags changed settings and unsafe video paths instead of presenting an equivalent comparison", () => {
    const before = capture(),
      after = capture(250)
    after.browser = "Chrome/158"
    after.runs[0].viewport.width = 900
    after.runs[0].metrics.url = "https://example.com/login"
    expect(compareCaptures(before, after)).toMatchObject({
      comparable: false,
      warnings: [
        "Chrome versions differ",
        "Viewport or device scale changed",
        "Final page URLs differ; check redirects and authentication"
      ]
    })
    after.runs[0].video = "../../secret.mp4"
    expect(() => compareCaptures(before, after)).toThrow("Invalid capture run")
  })
})
