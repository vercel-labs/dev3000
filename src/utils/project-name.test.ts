import { existsSync, readFileSync } from "fs"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { getProjectDisplayName, getProjectName } from "./project-name"

// Mock fs module
vi.mock("fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn()
}))

describe("getProjectName", () => {
  const mockExistsSync = existsSync as unknown as ReturnType<typeof vi.fn>
  const mockReadFileSync = readFileSync as unknown as ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("should use package.json name with path hash when available", () => {
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue(JSON.stringify({ name: "my-awesome-project" }))

    const result = getProjectName("/home/user/projects/frontend")
    // Should include path hash for uniqueness across different directories
    expect(result).toMatch(/^my-awesome-project-[a-f0-9]{6}$/)
  })

  it("should sanitize package.json name with special characters", () => {
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue(JSON.stringify({ name: "@company/my.project!" }))

    const result = getProjectName("/home/user/projects/frontend")
    expect(result).toMatch(/^company-my-project-[a-f0-9]{6}$/)
  })

  it("should generate different names for different directories with same package.json name", () => {
    // This test ensures multiple d3k instances in different directories
    // don't share Chrome profiles and kill each other's browser windows
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue(JSON.stringify({ name: "my-app" }))

    const result1 = getProjectName("/home/user/project-a")
    const result2 = getProjectName("/home/user/project-b")

    // Both should have the same base name but different hashes
    expect(result1).toMatch(/^my-app-[a-f0-9]{6}$/)
    expect(result2).toMatch(/^my-app-[a-f0-9]{6}$/)
    expect(result1).not.toBe(result2)
  })

  it("should use pyproject.toml name for Python projects", () => {
    mockExistsSync.mockImplementation((path) => path.includes("pyproject.toml"))
    mockReadFileSync.mockReturnValue('[project]\nname = "django-app"\nversion = "1.0.0"')

    const result = getProjectName("/home/user/projects/python-app")
    expect(result).toMatch(/^django-app-[a-f0-9]{6}$/)
  })

  it("should use Rails app name from application.rb", () => {
    mockExistsSync.mockImplementation((path) => path.includes("config/application.rb"))
    mockReadFileSync.mockReturnValue("module MyRailsApp\n  class Application < Rails::Application\n  end\nend")

    const result = getProjectName("/home/user/projects/rails-app")
    expect(result).toMatch(/^myrailsapp-[a-f0-9]{6}$/)
  })

  it("should add parent directory for generic names", () => {
    mockExistsSync.mockReturnValue(false)

    const result = getProjectName("/home/user/projects/www")
    expect(result).toMatch(/^projects-www-[a-f0-9]{6}$/)
  })

  it("should use directory name with hash for non-generic names", () => {
    mockExistsSync.mockReturnValue(false)

    const result = getProjectName("/home/user/projects/my-unique-app")
    expect(result).toMatch(/^my-unique-app-[a-f0-9]{6}$/)
  })

  it("should handle package.json parse errors gracefully", () => {
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue("invalid json")

    const result = getProjectName("/home/user/projects/app")
    expect(result).toMatch(/^projects-app-[a-f0-9]{6}$/)
  })
})

describe("getProjectDisplayName", () => {
  const mockExistsSync = existsSync as unknown as ReturnType<typeof vi.fn>
  const mockReadFileSync = readFileSync as unknown as ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("should remove hash suffix for display", () => {
    mockExistsSync.mockReturnValue(false)

    const cwd = "/home/user/projects/my-app"
    const fullName = getProjectName(cwd)
    const displayName = getProjectDisplayName(cwd)

    expect(fullName).toMatch(/^my-app-[a-f0-9]{6}$/)
    expect(displayName).toBe("my-app")
  })

  it("should remove hash suffix from package.json name for display", () => {
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue(JSON.stringify({ name: "my-project" }))

    const cwd = "/home/user/projects/frontend"
    const fullName = getProjectName(cwd)
    const displayName = getProjectDisplayName(cwd)

    // Full name should have hash
    expect(fullName).toMatch(/^my-project-[a-f0-9]{6}$/)
    // Display name should have hash removed
    expect(displayName).toBe("my-project")
  })
})
