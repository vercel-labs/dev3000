import { existsSync, readFileSync } from "fs"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { getPortlessName, getProjectDir, getProjectDisplayName, getProjectName } from "./project-name"

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

  it("should keep the path hash when the package.json name is long", () => {
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue(JSON.stringify({ name: "@acme-corp/marketing-website-frontend-application" }))

    const result1 = getProjectName("/home/user/worktrees/main/apps/web")
    const result2 = getProjectName("/home/user/worktrees/feature/apps/web")

    expect(result1).toMatch(/^acme-corp-marketing-website-frontend-applic-[a-f0-9]{6}$/)
    expect(result1.length).toBeLessThanOrEqual(50)
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

describe("getProjectDir", () => {
  const originalDataDir = process.env.D3K_DATA_DIR

  beforeEach(() => {
    vi.clearAllMocks()
    if (originalDataDir === undefined) {
      delete process.env.D3K_DATA_DIR
    } else {
      process.env.D3K_DATA_DIR = originalDataDir
    }
  })

  afterEach(() => {
    if (originalDataDir === undefined) {
      delete process.env.D3K_DATA_DIR
    } else {
      process.env.D3K_DATA_DIR = originalDataDir
    }
  })

  it("should use D3K_DATA_DIR when provided", () => {
    process.env.D3K_DATA_DIR = "/tmp/custom-d3k-data"

    expect(getProjectDir("/home/user/projects/app")).toBe("/tmp/custom-d3k-data")
  })
})

describe("getPortlessName", () => {
  const mockExistsSync = existsSync as unknown as ReturnType<typeof vi.fn>
  const mockReadFileSync = readFileSync as unknown as ReturnType<typeof vi.fn>
  const originalDataDir = process.env.D3K_DATA_DIR

  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.D3K_DATA_DIR
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue(JSON.stringify({ name: "my-app" }))
  })

  afterEach(() => {
    if (originalDataDir === undefined) delete process.env.D3K_DATA_DIR
    else process.env.D3K_DATA_DIR = originalDataDir
  })

  it("uses the readable name when the hostname is free", () => {
    expect(getPortlessName("/home/user/my-app")).toBe("my-app")
    expect(getPortlessName("/home/user/my-app", () => false)).toBe("my-app")
  })

  it("falls back to the path-hashed name only when the readable hostname is held", () => {
    const held = new Set(["my-app"])
    const name = getPortlessName("/home/user/my-app-worktree", (candidate) => held.has(candidate))
    expect(name).toBe(getProjectName("/home/user/my-app-worktree"))
    expect(name).toMatch(/^my-app-[a-f0-9]{6}$/)
  })

  it("keeps the data directory keyed by the hashed name regardless of hostname", () => {
    expect(getPortlessName("/home/user/my-app")).toBe("my-app")
    expect(getProjectDir("/home/user/my-app")).toMatch(/\/\.d3k\/my-app-[a-f0-9]{6}$/)
  })
})
