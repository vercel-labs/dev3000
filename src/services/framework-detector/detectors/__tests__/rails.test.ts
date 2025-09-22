/**
 * Tests for RailsDetector
 */

import * as fs from "fs"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { RailsDetector } from "../rails.js"

// Mock fs
vi.mock("fs", async () => {
  const actual = await vi.importActual<typeof fs>("fs")
  return {
    ...actual,
    existsSync: vi.fn()
  }
})

describe("RailsDetector", () => {
  let detector: RailsDetector

  beforeEach(() => {
    vi.clearAllMocks()
    detector = new RailsDetector()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe("canDetect", () => {
    test("detects Rails project with Gemfile and config/application.rb", async () => {
      const existsSyncMock = fs.existsSync as vi.MockedFunction<typeof fs.existsSync>
      existsSyncMock.mockImplementation(
        (path) => path === "Gemfile" || path === "config/application.rb"
      )

      const canDetect = await detector.canDetect()

      expect(canDetect).toBe(true)
      expect(existsSyncMock).toHaveBeenCalledWith("Gemfile")
      expect(existsSyncMock).toHaveBeenCalledWith("config/application.rb")
    })

    test("returns false when only Gemfile exists", async () => {
      const existsSyncMock = fs.existsSync as vi.MockedFunction<typeof fs.existsSync>
      existsSyncMock.mockImplementation((path) => path === "Gemfile")

      const canDetect = await detector.canDetect()

      expect(canDetect).toBe(false)
    })

    test("returns false when only config/application.rb exists", async () => {
      const existsSyncMock = fs.existsSync as vi.MockedFunction<typeof fs.existsSync>
      existsSyncMock.mockImplementation((path) => path === "config/application.rb")

      const canDetect = await detector.canDetect()

      expect(canDetect).toBe(false)
    })

    test("returns false when neither file exists", async () => {
      const existsSyncMock = fs.existsSync as vi.MockedFunction<typeof fs.existsSync>
      existsSyncMock.mockReturnValue(false)

      const canDetect = await detector.canDetect()

      expect(canDetect).toBe(false)
    })
  })

  describe("getConfig", () => {
    test("returns bin/dev for Rails with Procfile.dev", () => {
      const existsSyncMock = fs.existsSync as vi.MockedFunction<typeof fs.existsSync>
      existsSyncMock.mockImplementation((path) => path === "Procfile.dev")

      const config = detector.getConfig()

      expect(config.baseCommand).toBe("")
      expect(config.defaultScript).toBe("bin/dev")
    })

    test("returns bundle exec rails for standard Rails setup", () => {
      const existsSyncMock = fs.existsSync as vi.MockedFunction<typeof fs.existsSync>
      existsSyncMock.mockReturnValue(false)

      const config = detector.getConfig()

      expect(config.baseCommand).toBe("bundle exec rails")
      expect(config.defaultScript).toBe("server")
    })

    test("outputs debug messages when enabled", () => {
      const consoleSpy = vi.spyOn(console, "log")
      const existsSyncMock = fs.existsSync as vi.MockedFunction<typeof fs.existsSync>
      existsSyncMock.mockImplementation((path) => path === "Procfile.dev")

      detector.getConfig(true)

      expect(consoleSpy).toHaveBeenCalledWith(
        "[RAILS DEBUG] Found Procfile.dev - using bin/dev directly for process management"
      )

      consoleSpy.mockRestore()
    })

    test("outputs standard Rails debug message when no Procfile.dev", () => {
      const consoleSpy = vi.spyOn(console, "log")
      const existsSyncMock = fs.existsSync as vi.MockedFunction<typeof fs.existsSync>
      existsSyncMock.mockReturnValue(false)

      detector.getConfig(true)

      expect(consoleSpy).toHaveBeenCalledWith(
        "[RAILS DEBUG] Standard Rails setup - using bundle exec rails"
      )

      consoleSpy.mockRestore()
    })
  })

  describe("getDefaultPort", () => {
    test("returns 3000", () => {
      expect(detector.getDefaultPort()).toBe("3000")
    })
  })

  describe("getType", () => {
    test("returns rails", () => {
      expect(detector.getType()).toBe("rails")
    })
  })

  describe("getDebugMessage", () => {
    test("returns correct debug message", () => {
      expect(detector.getDebugMessage()).toBe("Rails project detected (found Gemfile and config/application.rb)")
    })
  })
})