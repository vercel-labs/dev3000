import { describe, expect, it, vi } from "vitest"
import { createDesktopWorkspace, desktopInstructions, desktopTools } from "./desktop-mcp.js"
import type { SandboxLifecycle, SandboxOptions } from "./sandbox.js"
import * as sessions from "./sandbox-sessions.js"

const record: sessions.SandboxSession = {
  version: 1,
  id: "724f0a38-6d1f-4777-8d7d-9438d0fd3bd1",
  project: "prj_test",
  projectName: "test",
  team: "team_test",
  sandbox: "test-vm",
  hostname: "test",
  appUrl: "https://test.d3k.localhost",
  workdir: "/vercel/test",
  timeout: "60",
  fx: true,
  gateway: true,
  harness: "fx",
  harnessLocation: "sandbox",
  ownsSandbox: true,
  createdAt: "2026-10-29T00:00:00Z",
  lastUsedAt: "2026-10-29T00:00:00Z"
}
const portless = () => ({ canonical: true, serviceInstalled: true, setupRequired: false })
const read = async (workspace: ReturnType<typeof createDesktopWorkspace>, name = "sandbox_status", args = {}) =>
  JSON.parse((await workspace.call(name, args)).content[0].text)

describe("desktop sandbox lifecycle", () => {
  it("selects headless Chrome for phone link mode and keeps preview credentials out of saved session metadata", async () => {
    let hooks: SandboxLifecycle | undefined
    let finish: () => void = () => {}
    const launch = vi.fn(async (_options: SandboxOptions, lifecycle: SandboxLifecycle = {}) => {
      hooks = lifecycle
      await new Promise<void>((resolve) => {
        finish = resolve
      })
    })
    const workspace = createDesktopWorkspace({ launch, list: () => [record], portless })
    try {
      await workspace.call("sandbox_start", { project: "team/test", browser: "link" })
      expect(launch).toHaveBeenCalledWith(
        expect.objectContaining({ headless: true, preview: true }),
        expect.any(Object)
      )
      expect(launch.mock.calls[0][0]).not.toHaveProperty("browser")
      const preview = { url: "https://preview.test/.d3k/preview#secret", expiresAt: "2026-10-29T01:00:00Z" }
      hooks?.onReady?.({ session: record, preview, call: async () => ({ content: [] }) })
      expect((await read(workspace)).preview).toEqual(preview)
      expect((await read(workspace)).session).not.toHaveProperty("preview")
      expect((await read(workspace, "sandbox_stop")).preview).toBeUndefined()
      finish()
    } finally {
      finish()
      await workspace.close()
    }
  })

  it("returns progress immediately, routes only after readiness, and waits for cleanup before another launch", async () => {
    let lifecycle: SandboxLifecycle | undefined
    let finish: () => void = () => {}
    const remoteCall = vi.fn(async () => ({ content: [{ type: "text" as const, text: "remote" }] }))
    const launch = vi.fn(async (_options: SandboxOptions, hooks: SandboxLifecycle = {}) => {
      lifecycle = hooks
      hooks.log?.("Installing dependencies")
      await new Promise<void>((resolve) => {
        finish = resolve
      })
      hooks.onClosing?.()
    })
    const workspace = createDesktopWorkspace({ launch, list: () => [record], portless })
    try {
      expect((await read(workspace, "sandbox_start", { project: "team/test" })).phase).toBe("starting")
      expect(launch.mock.calls[0][0]).toMatchObject({
        project: "test",
        scope: "team",
        fx: false,
        shell: false,
        gateway: false
      })
      expect((await read(workspace)).progress).toContain("Installing dependencies")
      await expect(workspace.call("sandbox_read_file", { path: "page.tsx" })).rejects.toThrow("No ready")
      await expect(workspace.call("sandbox_start", { project: "other" })).rejects.toThrow("already owns")
      lifecycle?.onReady?.({ session: record, call: remoteCall })
      expect((await read(workspace)).phase).toBe("ready")
      expect((await read(workspace, "sandbox_sessions")).sessions[0].id).toBe(record.id)
      await workspace.call("sandbox_read_file", { path: "page.tsx" })
      expect(remoteCall).toHaveBeenCalledWith("sandbox_read_file", { path: "page.tsx" })
      expect((await read(workspace, "sandbox_stop")).phase).toBe("stopping")
      expect(lifecycle?.signal?.aborted).toBe(true)
      await expect(workspace.call("sandbox_exec", { command: "pwd" })).rejects.toThrow("No ready")
      await expect(workspace.call("sandbox_start", { project: "other" })).rejects.toThrow("already owns")
      finish()
      await workspace.close()
      expect((await read(workspace)).phase).toBe("stopped")
      expect((await read(workspace)).session.id).toBe(record.id)
    } finally {
      finish()
      await workspace.close()
    }
  })

  it("overrides saved terminal/Gateway preferences on resume and reports startup failures", async () => {
    const saved = vi.spyOn(sessions, "readSandboxSession").mockReturnValue(record)
    const launch = vi.fn(async () => {
      throw new Error("Vercel login required")
    })
    const workspace = createDesktopWorkspace({ launch, list: () => [record], portless })
    try {
      await workspace.call("sandbox_start", { resume: record.id, timeout: 90 })
      await workspace.close()
      expect(launch.mock.calls[0]).toBeDefined()
      expect(launch).toHaveBeenCalledWith(
        expect.objectContaining({
          attach: record.sandbox,
          timeout: "90",
          fx: false,
          gateway: false,
          shell: false,
          harness: undefined
        }),
        expect.any(Object)
      )
      // close() is cancellation, so a concurrent startup failure should not be reported as user failure.
      expect((await read(workspace)).phase).toBe("stopped")
      const failed = createDesktopWorkspace({ launch, list: () => [], portless })
      await failed.call("sandbox_start", { project: "team/test" })
      await vi.waitFor(async () => expect((await read(failed)).phase).toBe("failed"))
      expect((await read(failed)).error).toBe("Vercel login required")
      await failed.close()
    } finally {
      saved.mockRestore()
      await workspace.close()
    }
  })

  it("fails prerequisites/invalid flags before provisioning and ignores late readiness after disconnect", async () => {
    const launch = vi.fn(async (_options: SandboxOptions, hooks: SandboxLifecycle = {}) => {
      await new Promise<void>((resolve) =>
        hooks.signal?.addEventListener(
          "abort",
          () => {
            hooks.onReady?.({ session: record, call: async () => ({ content: [] }) })
            resolve()
          },
          { once: true }
        )
      )
    })
    const unprepared = createDesktopWorkspace({
      launch,
      list: () => [],
      portless: () => ({ ...portless(), setupRequired: true })
    })
    await expect(unprepared.call("sandbox_start", { project: "team/test" })).rejects.toThrow("Portless")
    expect(launch).not.toHaveBeenCalled()
    const workspace = createDesktopWorkspace({ launch, list: () => [], portless })
    for (const args of [
      { project: "test", harness: "fx" },
      { project: "test", timeout: "60" },
      { resume: true },
      { project: "test", headless: "true" },
      { project: "test", browser: "mobile" },
      { project: "test", browser: "link", headless: false }
    ])
      await expect(workspace.call("sandbox_start", args)).rejects.toThrow()
    await workspace.call("sandbox_start", { project: "test" })
    await workspace.close()
    expect((await read(workspace)).phase).toBe("stopped")
    expect((await read(workspace)).session).toBeUndefined()
    expect(desktopTools).toHaveLength(11)
    expect(desktopInstructions).toContain("Never clone")
  })
})
