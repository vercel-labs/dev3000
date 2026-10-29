import type { Sandbox } from "@vercel/sandbox"
import { describe, expect, it, vi } from "vitest"
import { prepareSandboxFx } from "./sandbox-agent.js"

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
})
