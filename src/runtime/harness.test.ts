import { describe, expect, it } from "vitest"
import { harnessInvocation, harnessSkill, parseHarness } from "./harness.js"
import { resolveSandboxOptions } from "./sandbox-command.js"

describe("fixed harness selection", () => {
  it.each(["fx", "codex", "claude"])("accepts supported harness %s", (value) => {
    expect(parseHarness(value)).toBe(value)
  })
  it.each(["fx; touch /tmp/proof", "sh", "/bin/sh", "codex --yolo", "$(id)", "Claude", ""])(
    "rejects shell commands and unknown harness %j",
    (value) => {
      expect(() => parseHarness(value)).toThrow("Choose a harness")
    }
  )
  it("passes skill instructions as one argument, even with shell metacharacters in paths", () => {
    const path = "/tmp/skill $(id); space/SKILL.md"
    const invocation = harnessInvocation("codex", path, "/tmp/context")
    expect(invocation.binary).toBe("codex")
    expect(invocation.args).toHaveLength(1)
    expect(invocation.args[0]).toContain(path)
    expect(invocation.args[0]).toContain("do not start another runtime")
  })
  it("uses fx's supported context-directory flag instead of an unsupported prompt argument", () => {
    expect(harnessInvocation("fx", "/tmp/context/.fx/skills/d3k/SKILL.md", "/tmp/context")).toEqual({
      binary: "fx",
      args: ["--add-dir", "/tmp/context"]
    })
    expect(harnessSkill()).toContain("Await the user's instructions")
  })
  it("validates programmatic sandbox selections as well as CLI selections", () => {
    expect(() => resolveSandboxOptions({ project: "project", harness: "sh" as "fx" })).toThrow("Choose a harness")
    expect(() => resolveSandboxOptions({ project: "project", harness: "fx", shell: false })).toThrow("--no-shell")
  })
})
