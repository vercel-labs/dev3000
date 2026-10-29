import { spawnSync } from "node:child_process"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const run = (...args: string[]) => spawnSync("bun", [resolve("src/runtime/cli.ts"), ...args], { encoding: "utf8" })
describe("unified CLI contracts", () => {
  it.each([
    "--no-agent",
    "--browser-tool",
    "--with-agent",
    "--auto-skills",
    "--log-file",
    "--no-portless",
    "--plugin-react-scan"
  ])("rejects retired flag %s", (flag) => {
    const result = run(flag)
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain("unknown option")
  })
  it.each(["fx;id", "sh", "/bin/sh", "codex --yolo"])(
    "rejects arbitrary harness selection %j before provisioning",
    (name) => {
      for (const args of [
        ["start", "--harness", name],
        ["--project", "team/project", "--harness", name]
      ]) {
        const result = run(...args)
        expect(result.status).not.toBe(0)
        expect(result.stderr).toContain("Choose a harness")
      }
    }
  )
  it("rejects local browser options in sandbox mode before provisioning", () => {
    const result = run("--project", "team/project", "--profile-dir", "/tmp/profile")
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain("unknown option")
  })
  it("keeps browser arguments out of Commander option parsing", () => {
    const result = run("browser", "snapshot", "-i")
    expect(result.stderr).not.toContain("unknown option")
    expect(result.stderr).toContain("No active skill runtime")
  })
  it("rejects conflicting local startup options before launching anything", () => {
    const result = run("start", "--servers-only", "--profile-dir", "/tmp/profile")
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain("cannot be combined")
  })
  it.each(["0", "NaN", "1.5"])("validates deadlines before launching anything: %s", (value) => {
    const result = run("start", "--startup-timeout", value)
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain("positive integer")
  })
})
