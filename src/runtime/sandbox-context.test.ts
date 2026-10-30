import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { harnessStartupContext } from "./harness.js"
import { sandboxFxContextScript } from "./sandbox-context.js"

describe("sandbox fx startup context", () => {
  function fixture() {
    const home = mkdtempSync(join(tmpdir(), "d3k-fx-context-"))
    const directory = join(home, ".fx")
    mkdirSync(directory)
    const file = join(directory, "AGENTS.md")
    const run = (mode: string, note = "") =>
      spawnSync(process.execPath, ["-e", sandboxFxContextScript, mode, note], {
        env: { ...process.env, HOME: home },
        encoding: "utf8"
      })
    return { home, file, run, cleanup: () => rmSync(home, { recursive: true, force: true }) }
  }

  it("places browser guidance in fx's automatically loaded instructions and preserves existing edits", () => {
    const { file, run, cleanup } = fixture()
    try {
      const original = "User's existing rules, without a trailing newline"
      writeFileSync(file, original)
      const note = harnessStartupContext({ workdir: "/vercel/my project", appUrl: "https://app.d3k.localhost" })
      expect(run("install", note).status).toBe(0)
      expect(run("install", note).status).toBe(0)
      const installed = readFileSync(file, "utf8")
      expect(installed.startsWith(original)).toBe(true)
      expect(installed.split("d3k-browser-context:start")).toHaveLength(2)
      expect(installed).toContain("/tmp/d3k-tools/node_modules/.bin/d3k-runtime browser snapshot -i")
      expect(installed).toContain("/vercel/my project")
      expect(installed).toContain("/tmp/d3k-tools/node_modules/.bin/d3k-runtime events --session <id> --after <cursor>")
      expect(installed).toContain("`reset: true`")
      expect(installed).not.toContain("## Prepare")
      expect(installed).not.toContain("## Vercel Sandbox")
      // A user's later edits must survive cleanup; restoring a stale backup would lose them.
      writeFileSync(file, `${installed}\nNew user instructions\n`)
      expect(run("remove").status).toBe(0)
      expect(readFileSync(file, "utf8")).toBe(`${original}\nNew user instructions\n`)
    } finally {
      cleanup()
    }
  })

  it("removes a context-only instruction file on shutdown", () => {
    const { file, run, cleanup } = fixture()
    try {
      expect(run("install", "Browser connection").status).toBe(0)
      expect(run("remove").status).toBe(0)
      expect(existsSync(file)).toBe(false)
      expect(run("remove").status).toBe(0)
    } finally {
      cleanup()
    }
  })

  it("leaves linked instructions untouched instead of editing their target", () => {
    const { home, file, run, cleanup } = fixture()
    try {
      const target = join(home, "shared.md")
      writeFileSync(target, "Shared user instructions")
      symlinkSync(target, file)
      expect(run("install", "Browser connection").status).toBe(1)
      expect(readFileSync(target, "utf8")).toBe("Shared user instructions")
    } finally {
      cleanup()
    }
  })
})
