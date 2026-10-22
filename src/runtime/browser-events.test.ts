import { describe, expect, it } from "vitest"
import { recordBrowserEvent } from "./browser-events.js"
import { Timeline } from "./timeline.js"

describe("CDP evidence", () => {
  it("correlates network events without retaining credentials or bodies", () => {
    const timeline = new Timeline()
    recordBrowserEvent(timeline, {
      method: "Network.requestWillBeSent",
      timestamp: 1,
      params: {
        requestId: "r1",
        request: {
          method: "POST",
          url: "https://user:password@app.localhost/path?token=secret#auth",
          headers: { authorization: "Bearer secret" },
          postData: "private body"
        }
      }
    })
    recordBrowserEvent(timeline, {
      method: "Network.responseReceived",
      timestamp: 2,
      params: { requestId: "r1", response: { url: "https://app.localhost/path?token=secret", status: 500 } }
    })
    const result = timeline.read()
    expect(result.events.map((e) => e.data?.requestId)).toEqual(["r1", "r1"])
    expect(result.events[1].level).toBe("error")
    const serialized = JSON.stringify(result)
    for (const secret of ["password", "secret", "private body", "authorization"])
      expect(serialized).not.toContain(secret)
  })

  it("retains exception and console context with falsy arguments", () => {
    const timeline = new Timeline()
    recordBrowserEvent(timeline, {
      method: "Runtime.consoleAPICalled",
      timestamp: 1,
      params: {
        type: "error",
        args: [{ value: 0 }, { value: false }],
        stackTrace: { callFrames: [{ functionName: "save" }] }
      }
    })
    recordBrowserEvent(timeline, {
      method: "Runtime.exceptionThrown",
      timestamp: 2,
      params: { exceptionDetails: { text: "Uncaught", exception: { description: "Error: broken" }, url: "app.js" } }
    })
    expect(timeline.read().events.map((e) => [e.message, e.level])).toEqual([
      ["0 false", "error"],
      ["Error: broken", "error"]
    ])
    expect(timeline.read().events[0].data?.stack).toBeDefined()
  })
})
