/**
 * Tests for PythonDetector
 */

import { execSync } from "child_process"
import * as fs from "fs"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { PythonDetector } from "../python.js"

// Mock fs
vi.mock("fs", async () => {
  const actual = await vi.importActual<typeof fs>("fs")
  return {
    ...actual,
    existsSync: vi.fn()
  }
})

// Mock child_process
vi.mock("child_process", () => ({
  execSync: vi.fn()
}))

describe("PythonDetector", () => {
  let detector: PythonDetector

  beforeEach(() => {
    vi.clearAllMocks()
    detector = new PythonDetector()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe("canDetect", () => {
    test("detects Python project with requirements.txt", async () => {
      const existsSyncMock = fs.existsSync as vi.MockedFunction<typeof fs.existsSync>
      existsSyncMock.mockImplementation((path) => path === "requirements.txt")

      const canDetect = await detector.canDetect()

      expect(canDetect).toBe(true)
      expect(existsSyncMock).toHaveBeenCalledWith("requirements.txt")
    })

    test("detects Python project with pyproject.toml", async () => {
      const existsSyncMock = fs.existsSync as vi.MockedFunction<typeof fs.existsSync>
      existsSyncMock.mockImplementation((path) => path === "pyproject.toml")

      const canDetect = await detector.canDetect()

      expect(canDetect).toBe(true)
      expect(existsSyncMock).toHaveBeenCalledWith("pyproject.toml")
    })

    test("returns false when no Python files found", async () => {
      const existsSyncMock = fs.existsSync as vi.MockedFunction<typeof fs.existsSync>
      existsSyncMock.mockReturnValue(false)

      const canDetect = await detector.canDetect()

      expect(canDetect).toBe(false)
    })
  })

  describe("getConfig", () => {
    test("uses python from virtual environment when VIRTUAL_ENV is set", () => {
      const originalEnv = process.env.VIRTUAL_ENV
      process.env.VIRTUAL_ENV = "/path/to/venv"

      const config = detector.getConfig()

      expect(config.baseCommand).toBe("python")
      expect(config.defaultScript).toBe("main.py")

      // Cleanup
      if (originalEnv === undefined) {
        delete process.env.VIRTUAL_ENV
      } else {
        process.env.VIRTUAL_ENV = originalEnv
      }
    })

    test("prefers python3 when available", () => {
      const execSyncMock = execSync as vi.MockedFunction<typeof execSync>
      execSyncMock.mockImplementation((cmd) => {
        if (cmd === "python3 --version") return Buffer.from("Python 3.9.0")
        throw new Error("Command not found")
      })

      const config = detector.getConfig()

      expect(config.baseCommand).toBe("python3")
      expect(execSyncMock).toHaveBeenCalledWith("python3 --version", { stdio: "ignore" })
    })

    test("falls back to python when python3 not available", () => {
      const execSyncMock = execSync as vi.MockedFunction<typeof execSync>
      execSyncMock.mockImplementation((cmd) => {
        if (cmd === "python3 --version") throw new Error("python3 not found")
        if (cmd === "python --version") return Buffer.from("Python 2.7.18")
        throw new Error("Command not found")
      })

      const config = detector.getConfig()

      expect(config.baseCommand).toBe("python")
    })

    test("returns python even when neither python3 nor python found", () => {
      const execSyncMock = execSync as vi.MockedFunction<typeof execSync>
      execSyncMock.mockImplementation(() => {
        throw new Error("Command not found")
      })

      const config = detector.getConfig()

      expect(config.baseCommand).toBe("python")
    })

    test("outputs debug messages when enabled", () => {
      const consoleSpy = vi.spyOn(console, "log")
      const execSyncMock = execSync as vi.MockedFunction<typeof execSync>
      execSyncMock.mockImplementation((cmd) => {
        if (cmd === "python3 --version") return Buffer.from("Python 3.9.0")
        throw new Error("Command not found")
      })

      detector.getConfig(true)

      expect(consoleSpy).toHaveBeenCalledWith("[PYTHON DEBUG] python3 is available, using python3")

      consoleSpy.mockRestore()
    })
  })

  describe("getDefaultPort", () => {
    test("returns 8000", () => {
      expect(detector.getDefaultPort()).toBe("8000")
    })
  })

  describe("getType", () => {
    test("returns python", () => {
      expect(detector.getType()).toBe("python")
    })
  })

  describe("getDebugMessage", () => {
    test("returns correct debug message", () => {
      expect(detector.getDebugMessage()).toBe("Python project detected (found requirements.txt or pyproject.toml)")
    })
  })
})