import { EventEmitter } from "node:events"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ home: "", spawn: vi.fn() }))
vi.mock("node:os", async (original) => ({ ...(await original<typeof import("node:os")>()), homedir: () => mocks.home }))
vi.mock("node:child_process", () => ({ spawn: mocks.spawn }))
vi.mock("../utils/agent-browser.js", () => ({ getAgentBrowserBinaryPath: () => "/bundled/agent-browser" }))

import { sandboxChromePath } from "./chrome-isolation.js"

const binary = (version: string) =>
  join(
    mocks.home,
    ".agent-browser",
    "browsers",
    `chrome-${version}`,
    "Google Chrome for Testing.app",
    "Contents",
    "MacOS",
    "Google Chrome for Testing"
  )
function install(version = "156.0.1") {
  const path = binary(version)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, "")
  return path
}

describe.skipIf(process.platform !== "darwin")("sandbox Chrome provisioning", () => {
  beforeEach(() => {
    mocks.home = mkdtempSync(join(tmpdir(), "d3k-chrome-install-"))
    mocks.spawn.mockReset()
  })
  afterEach(() => rmSync(mocks.home, { recursive: true, force: true }))

  it("reuses the newest installed browser without invoking the installer", async () => {
    install("155.0.1")
    const newest = install("156.0.1")
    expect(await sandboxChromePath(vi.fn())).toBe(newest)
    expect(mocks.spawn).not.toHaveBeenCalled()
  })

  it("installs through the bundled helper once and reuses the resulting browser", async () => {
    mocks.spawn.mockImplementation(() => {
      const child = new EventEmitter()
      queueMicrotask(() => {
        install()
        child.emit("exit", 0)
      })
      return child
    })
    const log = vi.fn()
    expect(await sandboxChromePath(log)).toBe(binary("156.0.1"))
    expect(log).toHaveBeenCalledWith(expect.stringContaining("first run"))
    expect(mocks.spawn).toHaveBeenCalledWith("/bundled/agent-browser", ["install"], { stdio: "inherit", shell: false })
    await sandboxChromePath(log)
    expect(mocks.spawn).toHaveBeenCalledTimes(1)
  })

  it.each(["failed", "missing", "spawn-error"])("fails closed when provisioning is %s", async (failure) => {
    mocks.spawn.mockImplementation(() => {
      const child = new EventEmitter()
      queueMicrotask(() => {
        if (failure === "spawn-error") child.emit("error", new Error("unavailable"))
        else child.emit("exit", failure === "failed" ? 1 : 0)
      })
      return child
    })
    await expect(sandboxChromePath(vi.fn())).rejects.toThrow(/Chrome for Testing/)
  })
})
