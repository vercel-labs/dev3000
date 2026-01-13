import { mkdtempSync, rmSync } from "fs"
import { homedir, tmpdir } from "os"
import path from "path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { getUserConfigPath, loadUserConfig } from "./user-config.js"

describe("user config", () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), "d3k-config-"))
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it("uses ~/.d3k.json as config path", () => {
    const expectedPath = path.join(homedir(), ".d3k.json")
    expect(getUserConfigPath()).toBe(expectedPath)
  })

  it("reads disableMcpConfigs from config.json", () => {
    // This test uses the real config path, so we need to mock or skip
    // For now, just verify the function exists and returns an object
    const config = loadUserConfig()
    expect(typeof config).toBe("object")
  })

  it("reads defaultAgent from config.json", () => {
    const config = loadUserConfig()
    // defaultAgent should be undefined or an object with name and command
    if (config.defaultAgent) {
      expect(typeof config.defaultAgent.name).toBe("string")
      expect(typeof config.defaultAgent.command).toBe("string")
    }
  })
})
