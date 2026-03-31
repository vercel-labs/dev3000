import { describe, expect, it } from "vitest"
import { type CDPTargetInfo, selectCDPTarget } from "./cdp-monitor"

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
