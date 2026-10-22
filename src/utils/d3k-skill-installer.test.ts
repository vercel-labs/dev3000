import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "fs"
import { homedir, tmpdir } from "os"
import { dirname, join } from "path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { getBundledD3kSkillPath } from "../skills/index.js"
import { ensureD3kSkill } from "./d3k-skill-installer.js"

vi.mock("os", async (importOriginal) => ({
  ...(await importOriginal<typeof import("os")>()),
  homedir: vi.fn()
}))

vi.mock("../skills/index.js", () => ({ getBundledD3kSkillPath: vi.fn() }))

function writeSkill(file: string, content: string): void {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, content)
}

describe("d3k skill installation", () => {
  let temp: string
  let home: string
  let project: string
  let bundled: string

  beforeEach(() => {
    temp = mkdtempSync(join(tmpdir(), "d3k-skill-installer-"))
    home = join(temp, "home")
    project = join(temp, "project")
    bundled = join(temp, "bundled", "internal-skill.md")
    mkdirSync(project, { recursive: true })
    writeSkill(bundled, "Bundled d3k skill")
    vi.mocked(homedir).mockReturnValue(home)
    vi.mocked(getBundledD3kSkillPath).mockReturnValue(bundled)
    vi.spyOn(process, "cwd").mockReturnValue(project)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    rmSync(temp, { recursive: true, force: true })
  })

  it("uses the global skill without creating a project directory or overwriting user content", () => {
    const globalSkill = join(home, ".agents", "skills", "d3k", "SKILL.md")
    writeSkill(globalSkill, "User-managed global d3k skill")

    ensureD3kSkill()

    expect(existsSync(join(project, ".agents"))).toBe(false)
    expect(readFileSync(globalSkill, "utf-8")).toBe("User-managed global d3k skill")
  })

  it("recognizes Claude's global skill when it links to the shared installation", () => {
    const sharedDir = join(home, ".agents", "skills", "d3k")
    writeSkill(join(sharedDir, "SKILL.md"), "Shared global d3k skill")
    const claudeSkills = join(home, ".claude", "skills")
    mkdirSync(claudeSkills, { recursive: true })
    symlinkSync(sharedDir, join(claudeSkills, "d3k"), "junction")

    ensureD3kSkill("claude-code")

    expect(existsSync(join(project, ".claude"))).toBe(false)
    expect(existsSync(join(project, ".agents"))).toBe(false)
  })

  it.each([
    ["codex", ".agents"],
    ["claude-code", ".claude"]
  ])("still installs and refreshes the project fallback for %s without a global skill", (agent, dir) => {
    const projectSkill = join(project, dir, "skills", "d3k", "SKILL.md")

    ensureD3kSkill(agent)
    expect(readFileSync(projectSkill, "utf-8")).toBe("Bundled d3k skill")

    writeSkill(bundled, "Updated bundled skill")
    ensureD3kSkill(agent)
    expect(readFileSync(projectSkill, "utf-8")).toBe("Updated bundled skill")
  })

  it("does not mistake another agent's global installation for Claude's", () => {
    writeSkill(join(home, ".agents", "skills", "d3k", "SKILL.md"), "Codex global skill")

    ensureD3kSkill("claude-code")

    expect(readFileSync(join(project, ".claude", "skills", "d3k", "SKILL.md"), "utf-8")).toBe("Bundled d3k skill")
  })
})
