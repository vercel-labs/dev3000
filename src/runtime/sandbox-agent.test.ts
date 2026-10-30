import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Sandbox } from "@vercel/sandbox"
import { describe, expect, it, vi } from "vitest"
import {
  configureSandboxFxGateway,
  prepareSandboxFx,
  SANDBOX_AGENT_DIRECTORY,
  sandboxFxLauncher
} from "./sandbox-agent.js"

describe("sandbox fx setup", () => {
  it("installs only the harness without provisioning credentials without uploading any new secrets", async () => {
    const runCommand = vi
      .fn()
      .mockResolvedValueOnce({ exitCode: 0, stdout: async () => "/usr/bin/fx\n" })
      .mockResolvedValue({ exitCode: 0 })
    const writeFiles = vi.fn()
    const sandbox = { runCommand, writeFiles } as unknown as Sandbox
    expect(await prepareSandboxFx(sandbox)).toBe("/usr/bin/fx")
    expect(writeFiles).not.toHaveBeenCalled()
    expect(runCommand.mock.calls.at(-1)?.[0]).toEqual({
      cmd: "ln",
      args: ["-sf", "/usr/bin/fx", "/tmp/d3k-tools/bin/fx"]
    })
  })

  it("keeps Gateway credentials out of executable text and command arguments", async () => {
    const runCommand = vi.fn().mockResolvedValue({ exitCode: 0 })
    const writeFiles = vi.fn()
    await configureSandboxFxGateway({ runCommand, writeFiles } as unknown as Sandbox, "/usr/bin/fx", {
      key: "test-secret",
      expiresAt: Date.now() + 60000
    })
    expect(JSON.stringify(runCommand.mock.calls)).not.toContain("test-secret")
    const files = writeFiles.mock.calls[0]?.[0]
    expect(files[0].mode).toBe(0o600)
    expect(files[1].content.toString()).not.toContain("test-secret")
    expect(files[1].mode).toBe(0o700)
    expect(runCommand.mock.calls[1]?.[0].cmd).toBe("rm")
  })

  it("passes arguments and session auth to fx, strips management tokens, and rejects an expired session", () => {
    const directory = mkdtempSync(join(tmpdir(), "d3k-fx-test-"))
    try {
      const capture = join(directory, "capture.json")
      const binary = join(directory, "fake-fx")
      writeFileSync(
        binary,
        `#!/usr/bin/env node\nrequire('node:fs').writeFileSync(${JSON.stringify(capture)}, JSON.stringify({args: process.argv.slice(2), key: process.env.AI_GATEWAY_API_KEY, provider: process.env.FX_PROVIDER, oidc: process.env.VERCEL_OIDC_TOKEN, token: process.env.VERCEL_TOKEN, auth: process.env.VERCEL_AUTH_TOKEN}));`,
        { mode: 0o700 }
      )
      const launcher = join(directory, "fx.cjs")
      const credentials = join(directory, "gateway.json")
      writeFileSync(launcher, sandboxFxLauncher(binary).replace(`${SANDBOX_AGENT_DIRECTORY}/gateway.json`, credentials))
      writeFileSync(credentials, JSON.stringify({ key: "session-key", expiresAt: Date.now() + 60000 }))
      const run = () =>
        spawnSync(process.execPath, [launcher, "ask", "literal ; $(text)"], {
          env: {
            ...process.env,
            VERCEL_OIDC_TOKEN: "management",
            VERCEL_TOKEN: "management",
            VERCEL_AUTH_TOKEN: "management"
          },
          encoding: "utf8"
        })
      expect(run().status).toBe(0)
      expect(JSON.parse(readFileSync(capture, "utf8"))).toEqual({
        args: ["ask", "literal ; $(text)"],
        key: "session-key",
        provider: "gateway"
      })
      writeFileSync(credentials, JSON.stringify({ key: "session-key", expiresAt: 0 }))
      const expired = run()
      expect(expired.status).toBe(1)
      expect(expired.stderr).toContain("expired")
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
