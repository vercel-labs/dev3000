import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { describe, expect, it, vi } from "vitest"
import {
  CDPMonitor,
  type CDPTargetInfo,
  CHROME_CRASH_RESTORE_SUPPRESSION_FLAGS,
  getChromeSandboxFlags,
  getLoadingHtmlCandidates,
  resetChromeCrashRestoreState,
  selectCDPTarget
} from "./cdp-monitor"

describe("Chrome sandbox policy", () => {
  it("keeps sandboxing enabled unless explicitly opted out", () => {
    for (const value of [undefined, "", "0", "false", "true"]) {
      expect(getChromeSandboxFlags({ D3K_CHROME_NO_SANDBOX: value })).toEqual([])
    }
    expect(getChromeSandboxFlags({ D3K_CHROME_NO_SANDBOX: "1" })).toEqual(["--no-sandbox", "--disable-setuid-sandbox"])
  })
})

describe("selectCDPTarget", () => {
  it("prefers the current app target when Chrome exposes multiple pages", () => {
    const targets: CDPTargetInfo[] = [
      {
        type: "page",
        url: "http://localhost:3000/",
        webSocketDebuggerUrl: "ws://localhost:9222/devtools/page/old"
      },
      {
        type: "page",
        url: "http://localhost:3001/",
        webSocketDebuggerUrl: "ws://localhost:9222/devtools/page/current"
      }
    ]

    const target = selectCDPTarget(targets, { appServerPort: "3001", initialAppUrl: "http://localhost:3001/" })
    expect(target.webSocketDebuggerUrl).toBe("ws://localhost:9222/devtools/page/current")
  })

  it("accepts the d3k loading page during startup", () => {
    const targets: CDPTargetInfo[] = [
      {
        type: "page",
        url: "file:///var/folders/test/dev3000-loading-abcd/loading.html",
        webSocketDebuggerUrl: "ws://localhost:9222/devtools/page/loading"
      }
    ]

    const target = selectCDPTarget(targets, { appServerPort: "3001", initialAppUrl: "http://localhost:3001/" })
    expect(target.webSocketDebuggerUrl).toBe("ws://localhost:9222/devtools/page/loading")
  })

  it("fails fast when every visible target belongs to another app", () => {
    const targets: CDPTargetInfo[] = [
      {
        type: "page",
        url: "http://localhost:3000/",
        webSocketDebuggerUrl: "ws://localhost:9222/devtools/page/other"
      }
    ]

    expect(() =>
      selectCDPTarget(targets, {
        appServerPort: "3001",
        initialAppUrl: "http://localhost:3001/"
      })
    ).toThrow(/CDP target mismatch/)
  })
})

describe("getLoadingHtmlCandidates", () => {
  it("includes the installed package src/loading.html next to the compiled binary", () => {
    const candidates = getLoadingHtmlCandidates(
      "/snapshot/dev3000/dist",
      "/Users/test/.bun/install/global/node_modules/@d3k/darwin-arm64/bin/dev3000"
    )

    expect(candidates).toContain("/Users/test/.bun/install/global/node_modules/@d3k/darwin-arm64/src/loading.html")
  })
})

describe("Chrome restore prompt suppression", () => {
  it("passes both legacy and current crash restore suppression flags", () => {
    expect(CHROME_CRASH_RESTORE_SUPPRESSION_FLAGS).toContain("--disable-session-crashed-bubble")
    expect(CHROME_CRASH_RESTORE_SUPPRESSION_FLAGS).toContain("--hide-crash-restore-bubble")
  })

  it("resets stale crashed exit markers in the d3k Chrome profile", () => {
    const profileDir = mkdtempSync(join(tmpdir(), "d3k-profile-"))
    try {
      const defaultDir = join(profileDir, "Default")
      mkdirSync(defaultDir, { recursive: true })
      writeFileSync(
        join(defaultDir, "Preferences"),
        JSON.stringify({
          profile: {
            exit_type: "Crashed",
            exited_cleanly: false
          }
        })
      )
      writeFileSync(
        join(profileDir, "Local State"),
        JSON.stringify({
          exit_type: "Crashed",
          exited_cleanly: false,
          profile: {
            exit_type: "Crashed",
            exited_cleanly: false
          }
        })
      )

      expect(resetChromeCrashRestoreState(profileDir)).toBe(2)

      const preferences = JSON.parse(readFileSync(join(defaultDir, "Preferences"), "utf-8"))
      expect(preferences.profile.exit_type).toBe("Normal")
      expect(preferences.profile.exited_cleanly).toBe(true)

      const localState = JSON.parse(readFileSync(join(profileDir, "Local State"), "utf-8"))
      expect(localState.exit_type).toBe("Normal")
      expect(localState.exited_cleanly).toBe(true)
      expect(localState.profile.exit_type).toBe("Normal")
      expect(localState.profile.exited_cleanly).toBe(true)
    } finally {
      rmSync(profileDir, { recursive: true, force: true })
    }
  })

  it("sends Browser.close even when connected directly to a page target", async () => {
    const monitor = new CDPMonitor("/tmp/d3k-profile", () => {})
    const sendCDPCommand = vi.fn(async () => ({}))
    const waitForBrowserExit = vi.fn(async () => true)
    const killInstanceChromeProcesses = vi.fn()
    const wsClose = vi.fn()

    Object.assign(monitor as unknown as Record<string, unknown>, {
      connection: {
        ws: { close: wsClose },
        sessionId: null,
        nextId: 1
      },
      sendCDPCommand,
      waitForBrowserExit,
      killInstanceChromeProcesses
    })

    await monitor.shutdown()

    expect(sendCDPCommand).toHaveBeenCalledWith("Browser.close", {}, 3000)
    expect(waitForBrowserExit).toHaveBeenCalledWith(5000)
    expect(wsClose).toHaveBeenCalled()
    expect(killInstanceChromeProcesses).not.toHaveBeenCalled()
  })
})

describe("monitored target ownership", () => {
  it("ignores unrelated destroyed targets and stops only when its page closes", () => {
    const monitor = new CDPMonitor("/tmp/d3k-profile", () => {})
    const onClosed = vi.fn()
    monitor.setOnWindowClosedCallback(onClosed)
    const internal = monitor as unknown as {
      cdpUrl: string
      setupEventHandlers(): void
      handleCDPMessage(message: { method: string; params: Record<string, unknown> }): void
    }
    internal.cdpUrl = "ws://localhost:9222/devtools/page/owned"
    internal.setupEventHandlers()
    internal.handleCDPMessage({ method: "Target.targetDestroyed", params: { targetId: "worker" } })
    expect(onClosed).not.toHaveBeenCalled()
    internal.handleCDPMessage({ method: "Target.targetDestroyed", params: { targetId: "owned" } })
    expect(onClosed).toHaveBeenCalledOnce()
  })
})

describe("external browser recovery", () => {
  it("retries after exhausted recovery, coalesces concurrent reconnects, and respects shutdown", async () => {
    const monitor = new CDPMonitor("/tmp/d3k-profile", () => {})
    let finishConnect: () => void = () => {}
    const connectToCDP = vi
      .fn()
      .mockRejectedValueOnce(new Error("Companion offline"))
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finishConnect = resolve
          })
      )
    const enableCDPDomains = vi.fn(async () => {})
    const setupInteractionTracking = vi.fn(async () => {})
    Object.assign(monitor as unknown as Record<string, unknown>, {
      externalCdpBase: "http://127.0.0.1:1234",
      connectToCDP,
      enableCDPDomains,
      setupInteractionTracking
    })
    await expect(monitor.recoverExternalConnection()).rejects.toThrow("Companion offline")
    const recovery = monitor.recoverExternalConnection()
    await monitor.recoverExternalConnection()
    expect(connectToCDP).toHaveBeenCalledTimes(2)
    finishConnect()
    await recovery
    expect(enableCDPDomains).toHaveBeenCalledOnce()
    expect(setupInteractionTracking).toHaveBeenCalledOnce()
    Object.assign(monitor as unknown as Record<string, unknown>, {
      cdpUrl: "ws://127.0.0.1:1234/devtools/page/recovered",
      connection: { ws: { readyState: 1 } }
    })
    await monitor.recoverExternalConnection()
    expect(connectToCDP).toHaveBeenCalledTimes(2)
    Object.assign(monitor as unknown as Record<string, unknown>, { connection: null })
    monitor.prepareShutdown()
    await monitor.recoverExternalConnection()
    expect(connectToCDP).toHaveBeenCalledTimes(2)
  })
})

describe("browser session termination", () => {
  it("ends recovery when the final window is gone without creating an about:blank target", async () => {
    const fetchMock = vi.fn(async () => new Response("[]", { headers: { "content-type": "application/json" } }))
    vi.stubGlobal("fetch", fetchMock)
    try {
      const monitor = new CDPMonitor("/tmp/d3k-profile", () => {})
      Object.assign(monitor, { externalCdpBase: "http://127.0.0.1:1234" })
      const onClosed = vi.fn()
      monitor.setOnWindowClosedCallback(onClosed)
      await expect(monitor.recoverExternalConnection()).rejects.toThrow("no open targets")
      expect(onClosed).toHaveBeenCalledOnce()
      expect(fetchMock).toHaveBeenCalledOnce()
      expect(fetchMock.mock.calls[0][0]).not.toContain("/json/new")
      await monitor.recoverExternalConnection()
      expect(fetchMock).toHaveBeenCalledOnce()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it("does not resume discovery after shutdown while a discovery request is in flight", async () => {
    let finish: (value: Response) => void = () => {}
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve
        })
    )
    vi.stubGlobal("fetch", fetchMock)
    try {
      const monitor = new CDPMonitor("/tmp/d3k-profile", () => {})
      Object.assign(monitor, { externalCdpBase: "http://127.0.0.1:1234" })
      const recovering = monitor.recoverExternalConnection()
      monitor.prepareShutdown()
      finish(new Response("[]"))
      await expect(recovering).rejects.toThrow("ending")
      expect(fetchMock).toHaveBeenCalledOnce()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
