/**
 * Tests for FrameworkDetectorService
 */

import { execSync } from "child_process"
import * as fs from "fs"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { FrameworkDetectorService } from "../index.js"

// Mock fs
vi.mock("fs", async () => {
  const actual = await vi.importActual<typeof fs>("fs")
  return {
    ...actual,
    existsSync: vi.fn()
  }
})

// Mock package-manager-detector
vi.mock("package-manager-detector", () => ({
  detect: vi.fn()
}))

// Mock child_process
vi.mock("child_process", () => ({
  execSync: vi.fn()
}))

describe("FrameworkDetectorService", () => {
  let service: FrameworkDetectorService

  beforeEach(() => {
    vi.clearAllMocks()
    service = new FrameworkDetectorService()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe("detect", () => {
    test("detects Python project first when requirements.txt exists", async () => {
      const existsSyncMock = fs.existsSync as vi.MockedFunction<typeof fs.existsSync>
      existsSyncMock.mockImplementation((path) => path === "requirements.txt")

      const execSyncMock = execSync as vi.MockedFunction<typeof execSync>
      execSyncMock.mockImplementation((cmd) => {
        if (cmd === "python3 --version") return Buffer.from("Python 3.9.0")
        throw new Error("Command not found")
      })

      const config = await service.detect()

      expect(config.type).toBe("python")
      expect(config.defaultPort).toBe("8000")
      expect(config.baseCommand).toBe("python3")
    })

    test("detects Rails project when both Gemfile and config/application.rb exist", async () => {
      const existsSyncMock = fs.existsSync as vi.MockedFunction<typeof fs.existsSync>
      existsSyncMock.mockImplementation((path) => path === "Gemfile" || path === "config/application.rb")

      const config = await service.detect()

      expect(config.type).toBe("rails")
      expect(config.defaultPort).toBe("3000")
      expect(config.baseCommand).toBe("bundle exec rails")
    })

    test("falls back to Node.js when no specific framework detected", async () => {
      const existsSyncMock = fs.existsSync as vi.MockedFunction<typeof fs.existsSync>
      existsSyncMock.mockReturnValue(false)

      const { detect } = await import("package-manager-detector")
      const detectMock = detect as vi.MockedFunction<typeof detect>
      detectMock.mockResolvedValue({ agent: "npm", name: "npm" })

      const config = await service.detect()

      expect(config.type).toBe("node")
      expect(config.defaultPort).toBe("3000")
      expect(config.baseCommand).toBe("npm run")
    })

    test("outputs debug messages when debug enabled", async () => {
      const consoleSpy = vi.spyOn(console, "log")
      const existsSyncMock = fs.existsSync as vi.MockedFunction<typeof fs.existsSync>
      existsSyncMock.mockImplementation((path) => path === "pyproject.toml")

      const execSyncMock = execSync as vi.MockedFunction<typeof execSync>
      execSyncMock.mockImplementation(() => {
        throw new Error("No Python found")
      })

      await service.detect({ debug: true })

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("[PROJECT DEBUG] Python project detected"))

      consoleSpy.mockRestore()
    })

    test("detector order ensures specific frameworks detected before fallback", async () => {
      // Setup: Both Python and Node indicators exist
      const existsSyncMock = fs.existsSync as vi.MockedFunction<typeof fs.existsSync>
      existsSyncMock.mockImplementation((path) => {
        return path === "requirements.txt" || path === "package.json"
      })

      const execSyncMock = execSync as vi.MockedFunction<typeof execSync>
      execSyncMock.mockImplementation((cmd) => {
        if (cmd === "python3 --version") return Buffer.from("Python 3.9.0")
        throw new Error("Command not found")
      })

      const config = await service.detect()

      // Python should be detected first, not Node
      expect(config.type).toBe("python")
    })
  })
})
