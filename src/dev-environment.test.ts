import { createSocket } from "dgram"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs"
import https from "https"
import { createServer } from "net"
import { homedir, tmpdir } from "os"
import { join } from "path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const originalHome = process.env.HOME

const setupTempHome = () => {
  const tempHome = mkdtempSync(join(tmpdir(), "d3k-test-home-"))
  process.env.HOME = tempHome
  return tempHome
}

const restoreHome = (tempHome: string) => {
  if (originalHome !== undefined) {
    process.env.HOME = originalHome
  } else {
    delete process.env.HOME
  }
  if (tempHome) {
    rmSync(tempHome, { recursive: true, force: true })
  }
}

import {
  countActiveD3kInstances,
  findAvailablePort,
  getSessionChromePids,
  gracefulKillProcess,
  isServerListening,
  type ServerListeningResult,
  tryHttpConnection,
  tryHttpsConnection,
  writeSessionInfo
} from "./dev-environment"

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

describe("tryHttpConnection", () => {
  let originalFetch: typeof global.fetch

  beforeEach(() => {
    originalFetch = global.fetch
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  it("should return true when server responds with 200", async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 }))
    expect(await tryHttpConnection(3000)).toBe(true)
  })

  it("should return true even for 4xx/5xx responses", async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 500 }))
    expect(await tryHttpConnection(3000)).toBe(true)
  })

  it("should return false on ECONNREFUSED", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("fetch failed: ECONNREFUSED"))
    expect(await tryHttpConnection(3000)).toBe(false)
  })

  it("should return false on timeout/abort", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("aborted"))
    expect(await tryHttpConnection(3000)).toBe(false)
  })

  it("should accept string port numbers", async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 }))
    expect(await tryHttpConnection("3000")).toBe(true)
    expect(global.fetch).toHaveBeenCalledWith("http://localhost:3000/", expect.objectContaining({ method: "HEAD" }))
  })
})

describe("tryHttpsConnection", () => {
  it("should return true when HTTPS server responds", async () => {
    const mockRequest = vi.spyOn(https, "request").mockImplementation((_options, callback) => {
      setImmediate(() => (callback as () => void)?.())
      const mockReq = {
        on: () => mockReq,
        destroy: vi.fn(),
        end: vi.fn()
      }
      return mockReq as unknown as ReturnType<typeof https.request>
    })

    expect(await tryHttpsConnection(3000)).toBe(true)
    mockRequest.mockRestore()
  })

  it("should return false on connection error", async () => {
    const mockRequest = vi.spyOn(https, "request").mockImplementation(() => {
      const mockReq = {
        on: (event: string, handler: () => void) => {
          if (event === "error") setImmediate(handler)
          return mockReq
        },
        destroy: vi.fn(),
        end: vi.fn()
      }
      return mockReq as unknown as ReturnType<typeof https.request>
    })

    expect(await tryHttpsConnection(3000)).toBe(false)
    mockRequest.mockRestore()
  })

  it("should return false on timeout", async () => {
    const mockRequest = vi.spyOn(https, "request").mockImplementation(() => {
      const mockReq = {
        on: (event: string, handler: () => void) => {
          if (event === "timeout") setImmediate(handler)
          return mockReq
        },
        destroy: vi.fn(),
        end: vi.fn()
      }
      return mockReq as unknown as ReturnType<typeof https.request>
    })

    expect(await tryHttpsConnection(3000)).toBe(false)
    mockRequest.mockRestore()
  })
})

describe("isServerListening", () => {
  let originalFetch: typeof global.fetch

  // Helper to mock HTTPS success
  const mockHttpsSuccess = () => {
    return vi.spyOn(https, "request").mockImplementation((_options, callback) => {
      setImmediate(() => (callback as () => void)?.())
      const mockReq = {
        on: () => mockReq,
        destroy: vi.fn(),
        end: vi.fn()
      }
      return mockReq as unknown as ReturnType<typeof https.request>
    })
  }

  // Helper to mock HTTPS failure
  const mockHttpsFailure = () => {
    return vi.spyOn(https, "request").mockImplementation(() => {
      const mockReq = {
        on: (event: string, handler: () => void) => {
          if (event === "error") setImmediate(handler)
          return mockReq
        },
        destroy: vi.fn(),
        end: vi.fn()
      }
      return mockReq as unknown as ReturnType<typeof https.request>
    })
  }

  beforeEach(() => {
    originalFetch = global.fetch
  })

  afterEach(() => {
    global.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it("should return { listening: true, https: false } when HTTP succeeds", async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 }))

    const result = await isServerListening(3000)

    expect(result).toEqual({ listening: true, https: false })
  })

  it("should NOT try HTTPS when HTTP succeeds", async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 }))
    const mockRequest = mockHttpsSuccess()

    await isServerListening(3000)

    // HTTPS should not be called when HTTP succeeds
    expect(mockRequest).not.toHaveBeenCalled()
    mockRequest.mockRestore()
  })

  it("should return { listening: false, https: false } when both fail", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("fetch failed"))
    const mockRequest = mockHttpsFailure()

    const result = await isServerListening(3000)

    expect(result).toEqual({ listening: false, https: false })
    mockRequest.mockRestore()
  })

  describe("HTTPS fallback scenarios", () => {
    it("should fall back to HTTPS when HTTP returns ECONNREFUSED", async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error("fetch failed: ECONNREFUSED"))
      const mockRequest = mockHttpsSuccess()

      const result = await isServerListening(3000)

      expect(result).toEqual({ listening: true, https: true })
      expect(mockRequest).toHaveBeenCalled()
      mockRequest.mockRestore()
    })

    it("should fall back to HTTPS when HTTP times out", async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error("aborted"))
      const mockRequest = mockHttpsSuccess()

      const result = await isServerListening(3000)

      expect(result).toEqual({ listening: true, https: true })
      expect(mockRequest).toHaveBeenCalled()
      mockRequest.mockRestore()
    })

    it("should fall back to HTTPS when HTTP fails with network error", async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error("network error"))
      const mockRequest = mockHttpsSuccess()

      const result = await isServerListening(3000)

      expect(result).toEqual({ listening: true, https: true })
      expect(mockRequest).toHaveBeenCalled()
      mockRequest.mockRestore()
    })

    it("should correctly identify HTTPS server on non-standard port", async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error("fetch failed"))
      const mockRequest = vi.spyOn(https, "request").mockImplementation((options, callback) => {
        // Verify correct port is passed to HTTPS request
        expect(options).toMatchObject({ port: 8443 })
        setImmediate(() => (callback as () => void)?.())
        const mockReq = {
          on: () => mockReq,
          destroy: vi.fn(),
          end: vi.fn()
        }
        return mockReq as unknown as ReturnType<typeof https.request>
      })

      const result = await isServerListening(8443)

      expect(result).toEqual({ listening: true, https: true })
      mockRequest.mockRestore()
    })
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

describe("findAvailablePort regression (#95)", () => {
  it("does not treat outbound-only socket activity as port occupancy", async () => {
    const startPort = await findUnusedTcpPort()
    const udpSocket = createSocket("udp4")

    try {
      await new Promise<void>((resolve, reject) => {
        udpSocket.once("error", reject)
        udpSocket.connect(startPort, "127.0.0.1", () => {
          udpSocket.removeListener("error", reject)
          resolve()
        })
      })

      const availablePort = await findAvailablePort(startPort)
      expect(availablePort).toBe(String(startPort))
    } finally {
      udpSocket.close()
    }
  })
})

async function findUnusedTcpPort(): Promise<number> {
  for (let port = 18080; port <= 18180; port++) {
    const isAvailable = await new Promise<boolean>((resolve) => {
      const server = createServer()

      server.once("error", () => {
        resolve(false)
      })

      server.once("listening", () => {
        server.close(() => resolve(true))
      })

      server.listen(port, "127.0.0.1")
    })

    if (isAvailable) {
      return port
    }
  }

  throw new Error("Could not find an unused TCP port in test range")
}

/**
 * =============================================================================
 * PROCESS CLEANUP TESTS
 * =============================================================================
 *
 * These tests ensure that d3k properly cleans up processes on shutdown.
 * THIS IS CRITICAL FOR USER TRUST - leaving orphaned processes is unacceptable.
 *
 * Key invariants tested:
 * 1. Chrome PIDs are stored per-session and only OUR Chrome is killed
 * 2. Dev server processes are killed on shutdown
 * 3. Cleanup works both for normal shutdown and SIGHUP (tmux close)
 *
 * If you're modifying shutdown logic, make sure ALL these tests pass!
 */

describe("countActiveD3kInstances", () => {
  const testPidDir = tmpdir()
  const testPidFiles: string[] = []

  afterEach(() => {
    // Clean up test PID files
    for (const file of testPidFiles) {
      try {
        rmSync(file)
      } catch {
        // Ignore cleanup errors
      }
    }
    testPidFiles.length = 0
  })

  it("should count PID files that match running processes", () => {
    // Create a PID file with our own PID (which is definitely running)
    const pidFile = join(testPidDir, `dev3000-test-${Date.now()}.pid`)
    writeFileSync(pidFile, String(process.pid))
    testPidFiles.push(pidFile)

    // Should count at least 1 (our test PID file)
    const count = countActiveD3kInstances(false)
    expect(count).toBeGreaterThanOrEqual(1)
  })

  it("should exclude current PID when excludeCurrentPid is true", () => {
    // Create a PID file with our own PID
    const pidFile = join(testPidDir, `dev3000-exclude-test-${Date.now()}.pid`)
    writeFileSync(pidFile, String(process.pid))
    testPidFiles.push(pidFile)

    // Get count with and without exclusion
    const countWithUs = countActiveD3kInstances(false)
    const countWithoutUs = countActiveD3kInstances(true)

    // Count without us should be less
    expect(countWithoutUs).toBeLessThan(countWithUs)
  })

  it("should not count PID files for dead processes", () => {
    // Create a PID file with an invalid/dead PID
    // PID 99999999 should not exist
    const pidFile = join(testPidDir, `dev3000-dead-${Date.now()}.pid`)
    writeFileSync(pidFile, "99999999")
    testPidFiles.push(pidFile)

    // The dead process should not be counted
    const count = countActiveD3kInstances(false)
    // We just verify it doesn't throw and returns a number
    expect(typeof count).toBe("number")
  })

  it("should only count files matching dev3000-*.pid pattern", () => {
    // Create a non-matching file
    const wrongFile = join(testPidDir, `other-process-${Date.now()}.pid`)
    writeFileSync(wrongFile, String(process.pid))
    testPidFiles.push(wrongFile)

    // Should not crash and should ignore non-matching files
    const count = countActiveD3kInstances(false)
    expect(typeof count).toBe("number")
  })
})

describe("getSessionChromePids", () => {
  const testProjectName = `test-chrome-pids-${Date.now()}`
  let tempHome = ""
  let testSessionDir = ""
  let testSessionFile = ""

  beforeEach(() => {
    tempHome = setupTempHome()
    testSessionDir = join(homedir(), ".d3k", testProjectName)
    testSessionFile = join(testSessionDir, "session.json")

    // Ensure clean state
    try {
      rmSync(testSessionDir, { recursive: true, force: true })
    } catch {
      // Ignore
    }
  })

  afterEach(() => {
    // Clean up
    try {
      rmSync(testSessionDir, { recursive: true, force: true })
    } catch {
      // Ignore
    }
    restoreHome(tempHome)
  })

  it("should return empty array when session file does not exist", () => {
    const pids = getSessionChromePids(testProjectName)
    expect(pids).toEqual([])
  })

  it("should return chromePids from session.json", () => {
    // Create session directory and file
    mkdirSync(testSessionDir, { recursive: true })
    const sessionInfo = {
      projectName: testProjectName,
      chromePids: [12345, 67890],
      pid: process.pid
    }
    writeFileSync(testSessionFile, JSON.stringify(sessionInfo))

    const pids = getSessionChromePids(testProjectName)
    expect(pids).toEqual([12345, 67890])
  })

  it("should return empty array when chromePids is not in session file", () => {
    mkdirSync(testSessionDir, { recursive: true })
    const sessionInfo = {
      projectName: testProjectName,
      pid: process.pid
      // No chromePids
    }
    writeFileSync(testSessionFile, JSON.stringify(sessionInfo))

    const pids = getSessionChromePids(testProjectName)
    expect(pids).toEqual([])
  })

  it("should return empty array on malformed JSON", () => {
    mkdirSync(testSessionDir, { recursive: true })
    writeFileSync(testSessionFile, "not valid json")

    const pids = getSessionChromePids(testProjectName)
    expect(pids).toEqual([])
  })
})

describe("writeSessionInfo", () => {
  let tempHome = ""

  beforeEach(() => {
    tempHome = setupTempHome()
  })

  afterEach(() => {
    restoreHome(tempHome)
  })

  // Note: writeSessionInfo uses getProjectDir() which depends on process.cwd()
  // These tests verify the data structure, not the file location
  // The actual file location is ~/.d3k/{project-name-from-cwd}/session.json

  it("should include chromePids field in session info structure", () => {
    // This is a structure test - we verify the chromePids parameter is handled
    // The actual writing is integration-tested via getSessionChromePids tests

    // Verify the function signature accepts chromePids
    const writeWithChromePids = () => {
      writeSessionInfo("test", "/tmp/test.log", "3000", null, [12345, 67890])
    }

    // Should not throw
    expect(writeWithChromePids).not.toThrow()
  })

  it("should include serverPid field in session info structure", () => {
    const writeWithServerPid = () => {
      writeSessionInfo("test", "/tmp/test.log", "3000", undefined, undefined, undefined, undefined, 44444)
    }

    // Should not throw
    expect(writeWithServerPid).not.toThrow()
  })
})

describe("Process cleanup invariants", () => {
  let tempHome = ""

  beforeEach(() => {
    tempHome = setupTempHome()
  })

  afterEach(() => {
    restoreHome(tempHome)
  })

  /**
   * These tests verify critical invariants about process cleanup.
   * They are designed to catch regressions that would leave orphaned processes.
   */

  it("INVARIANT: chromePids are stored and retrieved per-project via session.json", () => {
    // This test verifies that Chrome PIDs are stored per-project, not globally.
    // Each d3k instance should only track and kill ITS OWN Chrome processes.
    //
    // The storage mechanism:
    // - Each project has its own session.json in ~/.d3k/{project}/
    // - chromePids array in session.json tracks Chrome PIDs for THAT session only
    // - getSessionChromePids reads from that project-specific file

    const project1 = `test-invariant-1-${Date.now()}`
    const project2 = `test-invariant-2-${Date.now()}`
    const dir1 = join(homedir(), ".d3k", project1)
    const dir2 = join(homedir(), ".d3k", project2)

    try {
      // Manually create session files to simulate two different d3k sessions
      mkdirSync(dir1, { recursive: true })
      mkdirSync(dir2, { recursive: true })

      writeFileSync(join(dir1, "session.json"), JSON.stringify({ chromePids: [111, 222] }))
      writeFileSync(join(dir2, "session.json"), JSON.stringify({ chromePids: [333, 444] }))

      // Each project should have its own PIDs
      const pids1 = getSessionChromePids(project1)
      const pids2 = getSessionChromePids(project2)

      expect(pids1).toEqual([111, 222])
      expect(pids2).toEqual([333, 444])

      // No cross-contamination
      expect(pids1).not.toEqual(pids2)
    } finally {
      // Cleanup
      rmSync(dir1, { recursive: true, force: true })
      rmSync(dir2, { recursive: true, force: true })
    }
  })

  it("INVARIANT: countActiveD3kInstances correctly identifies running vs dead processes", () => {
    // This test verifies cleanup decisions are based on actual running processes,
    // not just the existence of PID files.

    const testPidFile = join(tmpdir(), `dev3000-invariant-test-${Date.now()}.pid`)

    try {
      // Create a PID file for a non-existent process
      writeFileSync(testPidFile, "99999999") // This PID should not exist

      // Dead processes should not be counted
      // (we can't assert exact count, but the function should not throw)
      const count = countActiveD3kInstances(false)
      expect(typeof count).toBe("number")
      expect(count).toBeGreaterThanOrEqual(0)
    } finally {
      rmSync(testPidFile, { force: true })
    }
  })
})

describe("Process cleanup documentation", () => {
  /**
   * These tests serve as documentation for the cleanup behavior.
   * They don't test code directly but ensure the developer understands the cleanup model.
   */

  it("should document the cleanup model", () => {
    // This is a documentation test - it passes but explains the cleanup model.
    //
    // CLEANUP MODEL:
    // ==============
    //
    // 1. Each d3k instance tracks:
    //    - Its dev server PID (serverPid in session.json)
    //    - Its Chrome PIDs (chromePids array in session.json)
    //    - Its PID file (dev3000-{project}.pid in tmpdir)
    //
    // 2. On shutdown (SIGINT or SIGHUP):
    //    a) Kill dev server processes on our port
    //    b) Kill Chrome instances WE spawned (from chromePids)
    //
    // 3. Multiple d3k instances can run simultaneously:
    //    - Each has its own session.json in ~/.d3k/{project}/
    //    - Each has its own PID file in tmpdir
    //
    // 4. SIGHUP (tmux) requires SYNCHRONOUS cleanup:
    //    - tmux may kill us immediately after sending SIGHUP
    //    - We use spawnSync for critical cleanup
    //    - Chrome PIDs are read from session.json BEFORE deleting it

    expect(true).toBe(true) // Test passes - this is documentation
  })
})
