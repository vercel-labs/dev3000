import type { Sandbox } from "@vercel/sandbox"
import { describe, expect, it, vi } from "vitest"
import { closeSandboxResources } from "./sandbox-cleanup.js"

function fixture() {
  const sandbox = {
    name: "test-sandbox",
    runCommand: vi.fn(async (_args: unknown) => ({ exitCode: 0 })),
    stop: vi.fn(async () => {}),
    update: vi.fn(async () => {})
  }
  const options = {
    sandbox: sandbox as unknown as Sandbox,
    ownsSandbox: true,
    fxContextInstalled: true,
    remoteStarted: true,
    remoteWorkdir: "/vercel/app",
    log: vi.fn()
  }
  return { sandbox, options }
}

describe("sandbox shutdown", () => {
  it("starts local and remote cleanup concurrently and stops owned compute without a redundant runtime-stop command", async () => {
    const { sandbox, options } = fixture()
    let finishBrowser: () => void = () => {}
    let finishRemote: (value: { exitCode: number }) => void = () => {}
    const browser = new Promise<void>((resolve) => {
      finishBrowser = resolve
    })
    const remote = new Promise<{ exitCode: number }>((resolve) => {
      finishRemote = resolve
    })
    sandbox.runCommand.mockImplementation(() => remote)
    const closeProxy = vi.fn(async () => {})
    const closeBrowser = vi.fn(() => browser)
    const closed = closeSandboxResources({ ...options, closeProxy, closeBrowser })
    expect(closeProxy).toHaveBeenCalledOnce()
    expect(closeBrowser).toHaveBeenCalledOnce()
    expect(sandbox.runCommand).toHaveBeenCalledTimes(2)
    expect(sandbox.stop).not.toHaveBeenCalled()
    finishRemote({ exitCode: 0 })
    await vi.waitFor(() => expect(sandbox.stop).toHaveBeenCalledOnce())
    expect(sandbox.runCommand.mock.calls.some(([args]) => (args as { args: string[] }).args.includes("stop"))).toBe(
      false
    )
    finishBrowser()
    await closed
  })

  it("keeps attached compute running, stops its runtime, and restores its original ports", async () => {
    const { sandbox, options } = fixture()
    await closeSandboxResources({ ...options, ownsSandbox: false, originalPorts: [8080] })
    expect(sandbox.stop).not.toHaveBeenCalled()
    expect(sandbox.runCommand).toHaveBeenCalledWith(
      expect.objectContaining({ cmd: "node", cwd: "/vercel/app", args: expect.arrayContaining(["stop"]) })
    )
    expect(sandbox.update).toHaveBeenCalledWith(
      { ports: [8080] },
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    )
  })

  it("still stops compute when local or remote cleanup fails", async () => {
    const { sandbox, options } = fixture()
    sandbox.runCommand.mockRejectedValue(new Error("remote unavailable"))
    await closeSandboxResources({
      ...options,
      closeProxy: async () => {
        throw new Error("proxy unavailable")
      }
    })
    expect(sandbox.stop).toHaveBeenCalledOnce()
    expect(options.log).toHaveBeenCalledWith("Could not remove the sandbox fx browser context")
  })

  it("reports a failed compute stop and still finishes local cleanup", async () => {
    const { sandbox, options } = fixture()
    sandbox.stop.mockRejectedValue(new Error("stop failed"))
    const closeBrowser = vi.fn(async () => {})
    await closeSandboxResources({ ...options, closeBrowser })
    expect(closeBrowser).toHaveBeenCalledOnce()
    expect(options.log).toHaveBeenCalledWith("Could not stop sandbox test-sandbox; stop it with vercel sandbox stop")
  })
})
