import { existsSync, readdirSync, readFileSync } from "fs"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { findSkill, getSkill, getSkillDirectories, getSkillsInfo, listAvailableSkills, type SkillResult } from "./index"

vi.mock("fs", () => ({
  existsSync: vi.fn(),
  readdirSync: vi.fn(),
  readFileSync: vi.fn()
}))

describe("skills module", () => {
  const mockExistsSync = existsSync as unknown as ReturnType<typeof vi.fn>
  const mockReaddirSync = readdirSync as unknown as ReturnType<typeof vi.fn>
  const mockReadFileSync = readFileSync as unknown as ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe("getSkillDirectories", () => {
    it("should return directories that exist", () => {
      mockExistsSync.mockImplementation((path: string) => path.includes(".agents/skills"))
      const dirs = getSkillDirectories("/test/project")
      expect(dirs.length).toBeGreaterThan(0)
    })

    it("should include project-local .agents/skills directory", () => {
      mockExistsSync.mockReturnValue(true)
      const dirs = getSkillDirectories("/test/project")
      expect(dirs.some((d) => d.includes(".agents/skills"))).toBe(true)
    })
  })

  describe("findSkill", () => {
    it("should find a skill in the first matching directory", () => {
      mockExistsSync.mockImplementation((path: string) => {
        return path.includes(".agents/skills") || path.includes("test-skill/SKILL.md")
      })

      const result = findSkill("test-skill", "/test/project")
      expect(result).toBeTruthy()
      expect(result).toContain("test-skill/SKILL.md")
    })

    it("should return null if skill not found", () => {
      mockExistsSync.mockReturnValue(false)
      const result = findSkill("nonexistent-skill", "/test/project")
      expect(result).toBeNull()
    })
  })

  describe("getSkill", () => {
    it("should return skill content when found", () => {
      const skillContent = `---
description: Test skill description
---

# Test Skill

This is test content.`

      mockExistsSync.mockImplementation((path: string) => {
        return path.includes(".agents/skills") || path.includes("test-skill/SKILL.md")
      })
      mockReadFileSync.mockReturnValue(skillContent)

      const result: SkillResult = getSkill("test-skill", "/test/project")
      expect(result.found).toBe(true)
      expect(result.name).toBe("test-skill")
      expect(result.content).toBe(skillContent)
    })

    it("should return error when skill not found", () => {
      mockExistsSync.mockReturnValue(false)
      mockReaddirSync.mockReturnValue([])

      const result: SkillResult = getSkill("nonexistent", "/test/project")
      expect(result.found).toBe(false)
      expect(result.error).toContain("not found")
    })

    it("should handle read errors gracefully", () => {
      mockExistsSync.mockImplementation((path: string) => {
        return path.includes(".agents/skills") || path.includes("error-skill/SKILL.md")
      })
      mockReadFileSync.mockImplementation(() => {
        throw new Error("Permission denied")
      })
      mockReaddirSync.mockReturnValue([])

      const result: SkillResult = getSkill("error-skill", "/test/project")
      expect(result.found).toBe(false)
      expect(result.error).toContain("Failed to read skill")
    })
  })

  describe("listAvailableSkills", () => {
    it("should list skills from directories", () => {
      mockExistsSync.mockReturnValue(true)
      mockReaddirSync.mockImplementation(() => [
        { name: "skill-a", isDirectory: () => true },
        { name: "skill-b", isDirectory: () => true },
        { name: "not-a-skill.txt", isDirectory: () => false }
      ])

      const skills = listAvailableSkills("/test/project")
      expect(skills).toContain("skill-a")
      expect(skills).toContain("skill-b")
      expect(skills).not.toContain("not-a-skill.txt")
    })

    it("should deduplicate skills across directories", () => {
      mockExistsSync.mockReturnValue(true)
      mockReaddirSync.mockImplementation(() => [{ name: "same-skill", isDirectory: () => true }])

      const skills = listAvailableSkills("/test/project")
      expect(skills.filter((s) => s === "same-skill").length).toBe(1)
    })

    it("should return sorted list", () => {
      mockExistsSync.mockReturnValue(true)
      mockReaddirSync.mockImplementation(() => [
        { name: "zebra", isDirectory: () => true },
        { name: "alpha", isDirectory: () => true },
        { name: "beta", isDirectory: () => true }
      ])

      const skills = listAvailableSkills("/test/project")
      expect(skills).toEqual(["alpha", "beta", "zebra"])
    })

    it("should handle directory read errors gracefully", () => {
      mockExistsSync.mockReturnValue(true)
      mockReaddirSync.mockImplementation(() => {
        throw new Error("Permission denied")
      })

      const skills = listAvailableSkills("/test/project")
      expect(skills).toEqual([])
    })
  })

  describe("getSkillsInfo", () => {
    it("should return detailed skill info with descriptions", () => {
      const skillContent = `---
description: A helpful skill for testing
---

# Test Skill`

      mockExistsSync.mockReturnValue(true)
      mockReaddirSync.mockImplementation(() => [{ name: "test-skill", isDirectory: () => true }])
      mockReadFileSync.mockReturnValue(skillContent)

      const skills = getSkillsInfo("/test/project")
      expect(skills.length).toBeGreaterThan(0)
      expect(skills[0].name).toBe("test-skill")
      expect(skills[0].description).toBe("A helpful skill for testing")
    })

    it("should extract description from first paragraph if no frontmatter", () => {
      const skillContent = `# Test Skill

This is the first paragraph that should be used as description.

More content here.`

      mockExistsSync.mockReturnValue(true)
      mockReaddirSync.mockImplementation(() => [{ name: "test-skill", isDirectory: () => true }])
      mockReadFileSync.mockReturnValue(skillContent)

      const skills = getSkillsInfo("/test/project")
      expect(skills[0].description).toContain("This is the first paragraph")
    })
  })
})
