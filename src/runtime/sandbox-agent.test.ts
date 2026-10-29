import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { fxWrapper } from "./sandbox-agent.js"

const temporary: string[] = []
afterEach(() => {
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true })
})

describe("sandbox fx launcher", () => {
  function fixture(expiresAt = Date.now() + 60000) {
    const path = mkdtempSync(join(tmpdir(), "d3k-fx-test-"))
    temporary.push(path)
    const credential = join(path, "gateway.json")
    const wrapper = join(path, "fx.mjs")
    const binary = join(path, "original-fx")
    writeFileSync(credential, JSON.stringify({ key: "test-session-key", expiresAt }), { mode: 0o600 })
    writeFileSync(
      binary,
      `#!/usr/bin/env node
console.log(JSON.stringify({provider: process.env.FX_PROVIDER, key: process.env.AI_GATEWAY_API_KEY,
oidc: process.env.VERCEL_OIDC_TOKEN, args: process.argv.slice(2)}))`,
      { mode: 0o755 }
    )
    writeFileSync(wrapper, fxWrapper(binary, credential))
    return { credential, wrapper }
  }

  it("passes only the session's Gateway identity to fx and preserves literal arguments", () => {
    const { wrapper } = fixture()
    const result = spawnSync(process.execPath, [wrapper, "ask", "literal $(no-shell)"], {
      encoding: "utf8",
      env: { ...process.env, FX_PROVIDER: "codex", AI_GATEWAY_API_KEY: "other-team", VERCEL_OIDC_TOKEN: "management" }
    })
    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({
      provider: "gateway",
      key: "test-session-key",
      args: ["ask", "literal $(no-shell)"]
    })
  })

  it("refuses expired and removed keys instead of falling back to another account", () => {
    const { wrapper, credential } = fixture(Date.now() - 1000)
    const expired = spawnSync(process.execPath, [wrapper, "status"], { encoding: "utf8" })
    expect(expired.status).toBe(1)
    expect(expired.stderr).toContain("expired")
    expect(expired.stdout).toBe("")
    rmSync(credential)
    const removed = spawnSync(process.execPath, [wrapper, "status"], { encoding: "utf8" })
    expect(removed.status).toBe(1)
    expect(removed.stderr).toContain("No active d3k Gateway session")
  })
})
