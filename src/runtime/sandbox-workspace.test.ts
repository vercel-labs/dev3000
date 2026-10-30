import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Readable } from "node:stream"
import type { Sandbox } from "@vercel/sandbox"
import { describe, expect, it, vi } from "vitest"
import { workspaceGithubRequest } from "./sandbox-local-harness.js"
import { startWorkspaceBroker, workspaceHandler } from "./sandbox-workspace.js"

describe("local harness remote workspace", () => {
  it("routes edits and commands through the sandbox and rejects escaping file paths", async () => {
    const directory = mkdtempSync(join(tmpdir(), "d3k-workspace-test-"))
    const remote = join(directory, "remote")
    mkdirSync(remote)
    writeFileSync(join(remote, "page.tsx"), "original")
    symlinkSync(directory, join(remote, "outside"))
    const runCommand = vi.fn(async (options: { cmd: string; args: string[]; cwd: string; stdin?: Readable }) => {
      let input: string | undefined
      if (options.stdin) {
        input = ""
        for await (const chunk of options.stdin) input += chunk.toString()
      }
      const child = spawnSync(options.cmd, options.args, { cwd: options.cwd, encoding: "utf8", input })
      return { exitCode: child.status, stdout: async () => child.stdout, stderr: async () => child.stderr }
    })
    try {
      const call = workspaceHandler({ runCommand } as unknown as Sandbox, remote)
      expect((await call("sandbox_write_file", { path: "page.tsx", content: "changed" })).isError).toBeUndefined()
      expect(readFileSync(join(remote, "page.tsx"), "utf8")).toBe("changed")
      const large = "a".repeat(300000)
      expect((await call("sandbox_write_file", { path: "page.tsx", content: large })).isError).toBeUndefined()
      expect(readFileSync(join(remote, "page.tsx"), "utf8")).toBe(large)
      await call("sandbox_write_file", { path: "page.tsx", content: "changed" })
      expect(existsSync(join(directory, "page.tsx"))).toBe(false)
      expect((await call("sandbox_read_file", { path: "page.tsx" })).content[0].text).toContain("changed")
      expect((await call("sandbox_exec", { command: "pwd" })).content[0].text).toContain(remote)
      await expect(call("sandbox_read_file", { path: "../secret" })).rejects.toThrow("relative")
      expect((await call("sandbox_write_file", { path: "outside/secret", content: "no" })).isError).toBe(true)
      expect(existsSync(join(directory, "secret"))).toBe(false)
      await expect(call("sandbox_runtime", { args: ["stop"] })).rejects.toThrow("status")
      await expect(call("local_exec", { command: "pwd" })).rejects.toThrow("Unknown")
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it("requires the session token and rejects browser-origin requests before dispatch", async () => {
    const call = vi.fn(async () => ({ content: [{ type: "text" as const, text: "remote response" }] }))
    const broker = await startWorkspaceBroker(call)
    try {
      expect((await fetch(broker.url, { method: "POST" })).status).toBe(403)
      expect(
        (
          await fetch(broker.url, {
            method: "POST",
            headers: { Authorization: `Bearer ${broker.token}`, Origin: "https://app.example" }
          })
        ).status
      ).toBe(403)
      expect(call).not.toHaveBeenCalled()
      const response = await fetch(broker.url, {
        method: "POST",
        headers: { Authorization: `Bearer ${broker.token}` },
        body: JSON.stringify({ name: "sandbox_exec", arguments: { command: "pwd" } })
      })
      expect(await response.json()).toEqual({ content: [{ type: "text", text: "remote response" }] })
      expect(call).toHaveBeenCalledWith("sandbox_exec", { command: "pwd" })
    } finally {
      await broker.close()
    }
  })

  it("keeps GitHub publishing scoped to the linked repository without accepting force pushes or alternate hosts", () => {
    expect(
      workspaceGithubRequest("owner/project", {
        method: "POST",
        path: "/pulls",
        body: { title: "Test", head: "feature", base: "main" }
      }).args
    ).toContain("repos/owner/project/pulls")
    for (const path of ["/../../other/repo", "https://evil.example/pulls", "/git/refs/%2e%2e", "/actions/secrets"])
      expect(() => workspaceGithubRequest("owner/project", { method: "POST", path })).toThrow("repo-relative")
    expect(() =>
      workspaceGithubRequest("owner/project", {
        method: "PATCH",
        path: "/git/refs/heads/feature",
        body: { force: true }
      })
    ).toThrow("Force pushes")
  })
})
