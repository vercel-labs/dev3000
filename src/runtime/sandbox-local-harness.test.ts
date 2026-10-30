import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Sandbox } from "@vercel/sandbox"
import { describe, expect, it, vi } from "vitest"
import { launchLocalSandboxHarness, prepareLocalSandboxHarness } from "./sandbox-local-harness.js"

describe("fx sandbox conversation continuation", () => {
  it("reuses the workspace and passes -c while refreshing the broker and clearing its credential", async () => {
    const root = mkdtempSync(join(tmpdir(), "d3k-fx-continue-"))
    const directory = join(root, "control")
    const capture = join(root, "invocations.jsonl")
    const script = `#!/usr/bin/env node
import {readFileSync,appendFileSync} from 'node:fs';
const connection=JSON.parse(readFileSync('connection.json','utf8'));
const response=await fetch(connection.url,{method:'POST',headers:{Authorization:'Bearer '+connection.token},body:JSON.stringify({name:'sandbox_runtime',arguments:{args:['status']}})});
if(!response.ok)throw new Error('Broker connection failed');
appendFileSync(process.env.D3K_TEST_CAPTURE,JSON.stringify({args:process.argv.slice(2),cwd:process.cwd(),connection,status:await response.json()})+'\\n');
`
    writeFileSync(join(root, "fx"), script, { mode: 0o700 })
    vi.stubEnv("PATH", `${root}:${process.env.PATH}`)
    vi.stubEnv("D3K_TEST_CAPTURE", capture)
    const sandbox = {
      runCommand: vi.fn(async () => ({ exitCode: 0, stdout: async () => '{"ready":true}', stderr: async () => "" }))
    }
    const options = {
      harness: "fx" as const,
      directory,
      sandbox: sandbox as unknown as Sandbox,
      workdir: "/vercel/app",
      appUrl: "https://test.d3k.localhost",
      signal: new AbortController().signal,
      chromePort: 12345,
      sessionId: "test-session"
    }
    try {
      await launchLocalSandboxHarness(options)
      expect(existsSync(join(directory, "connection.json"))).toBe(false)
      await launchLocalSandboxHarness({ ...options, resume: true })
      expect(existsSync(join(directory, "connection.json"))).toBe(false)
      expect(existsSync(join(directory, ".mcp.json"))).toBe(false)
      const calls = readFileSync(capture, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line))
      expect(calls).toHaveLength(2)
      expect(calls[0].args).toEqual([])
      expect(calls[1].args).toEqual(["-c"])
      expect(calls[1].cwd).toBe(calls[0].cwd)
      expect(calls[1].connection.token).not.toBe(calls[0].connection.token)
      expect(JSON.parse(calls[1].status.content[0].text).stdout).toBe('{"ready":true}')
      const instructions = readFileSync(join(directory, "AGENTS.md"), "utf8")
      expect(instructions).toContain("Connection details are refreshed")
      expect(instructions).not.toContain(calls[0].connection.token)
      expect(instructions).not.toContain(calls[1].connection.token)
    } finally {
      vi.unstubAllEnvs()
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("does not add fx's continuation flag to other local harnesses", () => {
    const directory = mkdtempSync(join(tmpdir(), "d3k-harness-flags-"))
    try {
      for (const harness of ["codex", "claude"] as const) {
        const args = [
          harness,
          directory,
          { url: "http://127.0.0.1:1", token: "test-token" },
          "/vercel/app",
          "https://app.test"
        ] as const
        expect(prepareLocalSandboxHarness(...args, true)).toEqual(prepareLocalSandboxHarness(...args, false))
      }
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
