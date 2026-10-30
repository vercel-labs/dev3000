import { describe, expect, it, vi } from "vitest"
import { watchSandboxRuntime } from "./sandbox-watch.js"

describe("sandbox runtime monitoring", () => {
  it("survives failed requests and only reports a confirmed process exit", async () => {
    const controller = new AbortController()
    const log = vi.fn()
    const onExit = vi.fn()
    const status = vi
      .fn()
      .mockRejectedValueOnce(new Error("long-poll connection closed"))
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ exitCode: null })
      .mockImplementationOnce(async () => {
        expect(onExit).not.toHaveBeenCalled()
        return { exitCode: 0 }
      })
    await watchSandboxRuntime({ status, signal: controller.signal, onExit, log, intervalMs: 1 })
    expect(onExit).toHaveBeenCalledExactlyOnceWith(0)
    expect(log).toHaveBeenCalledTimes(2)
    expect(log.mock.calls[1][0]).toContain("reconnected")
  })

  it("cancels monitoring without interpreting cleanup as a remote failure", async () => {
    const controller = new AbortController()
    const onExit = vi.fn()
    const log = vi.fn()
    await watchSandboxRuntime({
      signal: controller.signal,
      status: async (signal) => {
        controller.abort()
        signal.throwIfAborted()
        return { exitCode: 1 }
      },
      onExit,
      log,
      intervalMs: 1
    })
    expect(onExit).not.toHaveBeenCalled()
    expect(log).not.toHaveBeenCalled()
  })
})
