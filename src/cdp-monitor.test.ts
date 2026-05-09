import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { describe, expect, it, vi } from "vitest"
import {
  CDPMonitor,
  type CDPTargetInfo,
  CHROME_CRASH_RESTORE_SUPPRESSION_FLAGS,
  getLoadingHtmlCandidates,
  resetChromeCrashRestoreState,
  selectCDPTarget
} from "./cdp-monitor"

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
    const monitor = new CDPMonitor("/tmp/d3k-profile", "/tmp/d3k-screenshots", () => {})
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
