/**
 * Tests for NodeDetector
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { NodeDetector } from "../node.js"

// Mock package-manager-detector
vi.mock("package-manager-detector", () => ({
  detect: vi.fn()
}))

describe("NodeDetector", () => {
  let detector: NodeDetector

  beforeEach(() => {
    vi.clearAllMocks()
    detector = new NodeDetector()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe("canDetect", () => {
    test("returns true when package manager detected", async () => {
      const { detect } = await import("package-manager-detector")
      const detectMock = detect as vi.MockedFunction<typeof detect>
      detectMock.mockResolvedValue({ agent: "pnpm", name: "pnpm" })

      const canDetect = await detector.canDetect()

      expect(canDetect).toBe(true)
      expect(detectMock).toHaveBeenCalled()
    })

    test("returns true even when no package manager detected (fallback)", async () => {
      const { detect } = await import("package-manager-detector")
      const detectMock = detect as vi.MockedFunction<typeof detect>
      detectMock.mockResolvedValue(null)

      const canDetect = await detector.canDetect()

      expect(canDetect).toBe(true)
    })
  })

  describe("getConfig", () => {
    test("uses detected package manager", async () => {
      const { detect } = await import("package-manager-detector")
      const detectMock = detect as vi.MockedFunction<typeof detect>
      detectMock.mockResolvedValue({ agent: "yarn", name: "yarn" })

      // First call canDetect to populate detectedAgent
      await detector.canDetect()
      const config = await detector.getConfig()

      expect(config.baseCommand).toBe("yarn run")
      expect(config.defaultScript).toBe("dev")
    })

    test("uses pnpm when detected", async () => {
      const { detect } = await import("package-manager-detector")
      const detectMock = detect as vi.MockedFunction<typeof detect>
      detectMock.mockResolvedValue({ agent: "pnpm", name: "pnpm" })

      await detector.canDetect()
      const config = await detector.getConfig()

      expect(config.baseCommand).toBe("pnpm run")
      expect(config.defaultScript).toBe("dev")
    })

    test("falls back to npm when no package manager detected", async () => {
      const { detect } = await import("package-manager-detector")
      const detectMock = detect as vi.MockedFunction<typeof detect>
      detectMock.mockResolvedValue(null)

      const config = await detector.getConfig()

      expect(config.baseCommand).toBe("npm run")
      expect(config.defaultScript).toBe("dev")
    })

    test("re-detects if not previously detected", async () => {
      const { detect } = await import("package-manager-detector")
      const detectMock = detect as vi.MockedFunction<typeof detect>
      detectMock.mockResolvedValue({ agent: "bun", name: "bun" })

      // Call getConfig without calling canDetect first
      const config = await detector.getConfig()

      expect(detectMock).toHaveBeenCalled()
      expect(config.baseCommand).toBe("bun run")
    })
  })

  describe("getDefaultPort", () => {
    test("returns 3000", () => {
      expect(detector.getDefaultPort()).toBe("3000")
    })
  })

  describe("getType", () => {
    test("returns node", () => {
      expect(detector.getType()).toBe("node")
    })
  })

  describe("getDebugMessage", () => {
    test("returns message with detected package manager", async () => {
      const { detect } = await import("package-manager-detector")
      const detectMock = detect as vi.MockedFunction<typeof detect>
      detectMock.mockResolvedValue({ agent: "pnpm", name: "pnpm" })

      await detector.canDetect()
      const message = detector.getDebugMessage()

      expect(message).toBe("Node.js project detected with pnpm package manager")
    })

    test("returns fallback message when no package manager detected", () => {
      const message = detector.getDebugMessage()

      expect(message).toBe("No project files detected, defaulting to Node.js with npm")
    })
  })
})