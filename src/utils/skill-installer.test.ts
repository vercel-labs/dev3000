import { lstatSync, readdirSync, realpathSync, rmSync } from "fs"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { cleanupAgentSymlinks } from "./skill-installer"

vi.mock("fs", () => ({
  existsSync: vi.fn(() => true),
  lstatSync: vi.fn(),
  readdirSync: vi.fn(),
  realpathSync: vi.fn(),
  rmSync: vi.fn(),
  readFileSync: vi.fn()
}))

describe("cleanupAgentSymlinks", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("removes symlinks that point into the skills directory", () => {
    const mockReaddirSync = readdirSync as unknown as ReturnType<typeof vi.fn>
    const mockLstatSync = lstatSync as unknown as ReturnType<typeof vi.fn>
    const mockRealpathSync = realpathSync as unknown as ReturnType<typeof vi.fn>

    mockReaddirSync.mockReturnValue(["skills", "claude-code", "cursor"])

    mockLstatSync.mockImplementation((path: string) => ({
      isSymbolicLink: () => path.endsWith("claude-code")
    }))

    mockRealpathSync.mockImplementation((path: string) => {
      if (path.endsWith(".agents/skills")) {
        return "/project/.agents/skills"
      }

      if (path.endsWith(".agents/claude-code")) {
        return "/project/.agents/skills"
      }

      return "/project/.agents/cursor"
    })

    cleanupAgentSymlinks("/project/.agents/skills")

    expect(rmSync).toHaveBeenCalledTimes(1)
    expect(rmSync).toHaveBeenCalledWith("/project/.agents/claude-code", {
      recursive: true,
      force: true
    })
  })

  it("keeps symlinks that do not resolve inside skills", () => {
    const mockReaddirSync = readdirSync as unknown as ReturnType<typeof vi.fn>
    const mockLstatSync = lstatSync as unknown as ReturnType<typeof vi.fn>
    const mockRealpathSync = realpathSync as unknown as ReturnType<typeof vi.fn>

    mockReaddirSync.mockReturnValue(["skills", "zed", "warp"])

    mockLstatSync.mockImplementation(() => ({
      isSymbolicLink: () => true
    }))

    mockRealpathSync.mockImplementation((path: string) => {
      if (path.endsWith(".agents/skills")) {
        return "/project/.agents/skills"
      }

      return "/project/.agents/other"
    })

    cleanupAgentSymlinks("/project/.agents/skills")

    expect(rmSync).not.toHaveBeenCalled()
  })
})
