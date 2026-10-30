import { describe, expect, it, vi } from "vitest"
import { sandboxRecovery } from "./sandbox-recovery.js"

describe("sandbox recovery", () => {
  it("runs one explicit recovery at a time and status polling never restarts it", async () => {
    let finish: (value: unknown) => void = () => {}
    const recover = vi.fn(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const call = sandboxRecovery(recover, new AbortController().signal)
    const read = async (action: string) => JSON.parse((await call({ action })).content[0].text)
    expect((await read("status")).phase).toBe("idle")
    expect(recover).not.toHaveBeenCalled()
    expect((await read("start")).phase).toBe("recovering")
    expect((await read("start")).phase).toBe("recovering")
    expect(recover).toHaveBeenCalledTimes(1)
    finish({ restarted: true, evidenceGap: true })
    await vi.waitFor(async () => expect((await read("status")).phase).toBe("recovered"))
    expect((await read("status")).result.evidenceGap).toBe(true)
    expect(recover).toHaveBeenCalledTimes(1)
  })

  it("reports errors without automatic retries and rejects calls after shutdown", async () => {
    const controller = new AbortController()
    const recover = vi.fn(async () => {
      throw new Error("App no longer starts")
    })
    const call = sandboxRecovery(recover, controller.signal)
    await call({ action: "start" })
    await vi.waitFor(async () => expect((await call({ action: "status" })).isError).toBe(true))
    expect(JSON.parse((await call({ action: "status" })).content[0].text).error).toBe("App no longer starts")
    expect(recover).toHaveBeenCalledTimes(1)
    await expect(call({ action: "retry" })).rejects.toThrow("start or status")
    controller.abort()
    await expect(call({ action: "start" })).rejects.toThrow("Session ended")
    expect(recover).toHaveBeenCalledTimes(1)
  })
})
