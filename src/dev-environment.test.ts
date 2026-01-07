import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  gracefulKillProcess,
  isServerListening,
  ORPHANED_PROCESS_CLEANUP_PATTERNS,
  type ServerListeningResult
} from "./dev-environment"

describe("ORPHANED_PROCESS_CLEANUP_PATTERNS", () => {
  it("should not include patterns that would kill other d3k instances' Chrome browsers", () => {
    // This test prevents regression of the bug where starting a second d3k instance
    // would kill the first instance's Chrome browser because the cleanup patterns
    // were too broad and matched all d3k Chrome profiles instead of just orphaned ones.
    //
    // The pattern ".d3k/chrome-profiles" must NEVER be in this list because it would
    // match Chrome instances from ANY running d3k instance, not just orphaned ones.
    // Each d3k instance handles its own specific profile cleanup separately.

    const dangerousPatterns = [
      ".d3k/chrome-profiles", // Would kill ALL d3k Chrome instances
      "chrome-profiles", // Too broad, could match other d3k instances
      "d3k" // Way too broad
    ]

    for (const dangerous of dangerousPatterns) {
      const hasMatch = ORPHANED_PROCESS_CLEANUP_PATTERNS.some((pattern) => pattern.includes(dangerous))
      expect(hasMatch, `Pattern "${dangerous}" should not be in cleanup patterns`).toBe(false)
    }
  })

  it("should only contain MCP-specific patterns for orphan cleanup", () => {
    // Ensure we only have patterns that are specific to MCP/Playwright processes
    // which are truly orphaned and not part of running d3k instances
    expect(ORPHANED_PROCESS_CLEANUP_PATTERNS).toContain("ms-playwright/mcp-chrome")
    expect(ORPHANED_PROCESS_CLEANUP_PATTERNS).toContain("mcp-server-playwright")
    expect(ORPHANED_PROCESS_CLEANUP_PATTERNS.length).toBe(2)
  })
})

describe("gracefulKillProcess", () => {
  // This test suite ensures that process termination follows the correct sequence:
  // 1. SIGTERM first (allows graceful shutdown, e.g., Next.js removing .next/dev/lock)
  // 2. Wait for grace period
  // 3. SIGKILL only if process is still running
  //
  // This prevents the bug where .next/dev/lock was left behind because we were
  // immediately using SIGKILL without giving Next.js a chance to clean up.

  it("should send SIGTERM first for graceful shutdown", async () => {
    const signals: Array<{ pid: number; signal: NodeJS.Signals | number }> = []
    const killFn = vi.fn((pid: number, signal: NodeJS.Signals | number) => {
      signals.push({ pid, signal })
      // Simulate process dying after SIGTERM (signal 0 check will fail)
      if (signal === 0) {
        throw new Error("ESRCH") // Process not found
      }
    })
    const delayFn = vi.fn(() => Promise.resolve())

    const result = await gracefulKillProcess({
      pid: 12345,
      killFn,
      delayFn,
      gracePeriodMs: 100
    })

    // Should have sent SIGTERM to process group first
    expect(signals[0]).toEqual({ pid: -12345, signal: "SIGTERM" })

    // Should have waited for grace period
    expect(delayFn).toHaveBeenCalledWith(100)

    // Should have checked if process is still running
    expect(signals[1]).toEqual({ pid: 12345, signal: 0 })

    // Result should indicate graceful termination
    expect(result.terminated).toBe(true)
    expect(result.graceful).toBe(true)
    expect(result.forcedKill).toBe(false)
  })

  it("should fall back to SIGKILL if process survives SIGTERM", async () => {
    const signals: Array<{ pid: number; signal: NodeJS.Signals | number }> = []
    let sigkillSent = false

    const killFn = vi.fn((pid: number, signal: NodeJS.Signals | number) => {
      signals.push({ pid, signal })
      // Process survives SIGTERM, signal 0 succeeds (process exists)
      // But dies after SIGKILL
      if (signal === 0 && !sigkillSent) {
        return // Process still exists
      }
      if (signal === "SIGKILL") {
        sigkillSent = true
      }
    })
    const delayFn = vi.fn(() => Promise.resolve())

    const result = await gracefulKillProcess({
      pid: 12345,
      killFn,
      delayFn
    })

    // Should have sent SIGTERM first
    expect(signals[0]).toEqual({ pid: -12345, signal: "SIGTERM" })

    // Should have checked if process exists
    expect(signals.some((s) => s.signal === 0)).toBe(true)

    // Should have sent SIGKILL after process survived
    expect(signals.some((s) => s.signal === "SIGKILL")).toBe(true)

    // Result should indicate forced termination
    expect(result.terminated).toBe(true)
    expect(result.graceful).toBe(false)
    expect(result.forcedKill).toBe(true)
  })

  it("should try direct PID if process group kill fails", async () => {
    const signals: Array<{ pid: number; signal: NodeJS.Signals | number }> = []

    const killFn = vi.fn((pid: number, signal: NodeJS.Signals | number) => {
      signals.push({ pid, signal })
      // Process group (negative PID) fails, direct PID works
      if (pid < 0 && signal === "SIGTERM") {
        throw new Error("ESRCH") // No such process group
      }
      // Process dies gracefully
      if (signal === 0) {
        throw new Error("ESRCH")
      }
    })
    const delayFn = vi.fn(() => Promise.resolve())

    const result = await gracefulKillProcess({
      pid: 12345,
      killFn,
      delayFn
    })

    // Should have tried process group first
    expect(signals[0]).toEqual({ pid: -12345, signal: "SIGTERM" })

    // Should have fallen back to direct PID
    expect(signals[1]).toEqual({ pid: 12345, signal: "SIGTERM" })

    expect(result.terminated).toBe(true)
    expect(result.graceful).toBe(true)
  })

  it("should return not terminated if process is already dead", async () => {
    const killFn = vi.fn(() => {
      throw new Error("ESRCH") // Process not found
    })
    const delayFn = vi.fn(() => Promise.resolve())

    const result = await gracefulKillProcess({
      pid: 12345,
      killFn,
      delayFn
    })

    // Both process group and direct kill failed, process was already dead
    expect(result.terminated).toBe(false)
    expect(result.graceful).toBe(false)
    expect(result.forcedKill).toBe(false)

    // Should not have waited since process was already dead
    expect(delayFn).not.toHaveBeenCalled()
  })

  it("should use default 500ms grace period", async () => {
    const killFn = vi.fn((_pid: number, signal: NodeJS.Signals | number) => {
      if (signal === 0) throw new Error("ESRCH")
    })
    const delayFn = vi.fn(() => Promise.resolve())

    await gracefulKillProcess({
      pid: 12345,
      killFn,
      delayFn
    })

    expect(delayFn).toHaveBeenCalledWith(500)
  })

  it("should call debugLog with appropriate messages", async () => {
    const debugMessages: string[] = []
    const killFn = vi.fn((_pid: number, signal: NodeJS.Signals | number) => {
      if (signal === 0) throw new Error("ESRCH")
    })
    const delayFn = vi.fn(() => Promise.resolve())
    const debugLog = vi.fn((msg: string) => debugMessages.push(msg))

    await gracefulKillProcess({
      pid: 12345,
      killFn,
      delayFn,
      debugLog
    })

    expect(debugMessages.some((m) => m.includes("SIGTERM"))).toBe(true)
    expect(debugMessages.some((m) => m.includes("gracefully"))).toBe(true)
  })
})

describe("isServerListening", () => {
  // These tests verify the HTTPS fallback logic for server detection.
  // When a server runs with --experimental-https (like Next.js), the HTTP
  // check fails but the HTTPS check should succeed.

  let originalFetch: typeof global.fetch

  beforeEach(() => {
    originalFetch = global.fetch
  })

  afterEach(() => {
    global.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it("should return { listening: true, https: false } when HTTP server responds", async () => {
    // Mock fetch to simulate HTTP server responding
    global.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 }))

    const result = await isServerListening(3000)

    expect(result).toEqual({ listening: true, https: false })
    expect(global.fetch).toHaveBeenCalledWith("http://localhost:3000/", expect.objectContaining({ method: "HEAD" }))
  })

  it("should return { listening: true, https: false } even for 4xx/5xx responses", async () => {
    // Any HTTP response means server is listening, even errors
    global.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 500 }))

    const result = await isServerListening(3000)

    expect(result).toEqual({ listening: true, https: false })
  })

  it("should return { listening: false, https: false } when no server is running", async () => {
    // Mock fetch to simulate ECONNREFUSED (no server)
    global.fetch = vi.fn().mockRejectedValue(new Error("fetch failed: ECONNREFUSED"))

    const result = await isServerListening(9999)

    expect(result).toEqual({ listening: false, https: false })
  })

  it("should accept string port numbers", async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 }))

    const result = await isServerListening("3000")

    expect(result).toEqual({ listening: true, https: false })
    expect(global.fetch).toHaveBeenCalledWith("http://localhost:3000/", expect.objectContaining({ method: "HEAD" }))
  })

  it("should return { listening: false, https: false } on timeout", async () => {
    // Mock fetch to simulate timeout via AbortError
    global.fetch = vi.fn().mockRejectedValue(new Error("aborted"))

    const result = await isServerListening(3000)

    expect(result).toEqual({ listening: false, https: false })
  })
})

describe("ServerListeningResult type", () => {
  it("should have the correct shape", () => {
    // Type check: ensure the interface is correctly defined
    const httpResult: ServerListeningResult = { listening: true, https: false }
    const httpsResult: ServerListeningResult = { listening: true, https: true }
    const notListening: ServerListeningResult = { listening: false, https: false }

    expect(httpResult.listening).toBe(true)
    expect(httpResult.https).toBe(false)
    expect(httpsResult.https).toBe(true)
    expect(notListening.listening).toBe(false)
  })
})
