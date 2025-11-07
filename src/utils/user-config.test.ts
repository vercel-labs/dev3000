import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import path from "path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { getUserConfigPath, loadUserConfig } from "./user-config.js"

describe("user config", () => {
  let originalXdg: string | undefined
  let originalHome: string | undefined
  let tempDir: string

  beforeEach(() => {
    originalXdg = process.env.XDG_CONFIG_HOME
    originalHome = process.env.HOME
    tempDir = mkdtempSync(path.join(tmpdir(), "d3k-config-"))
  })

  afterEach(() => {
    if (originalXdg === undefined) {
      delete process.env.XDG_CONFIG_HOME
    } else {
      process.env.XDG_CONFIG_HOME = originalXdg
    }

    if (originalHome === undefined) {
      delete process.env.HOME
    } else {
      process.env.HOME = originalHome
    }

    rmSync(tempDir, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it("uses XDG_CONFIG_HOME when set", () => {
    process.env.XDG_CONFIG_HOME = tempDir
    const expectedPath = path.join(tempDir, "dev3000", "config.json")
    expect(getUserConfigPath()).toBe(expectedPath)
  })

  it("falls back to ~/.config when XDG_CONFIG_HOME is not set", () => {
    delete process.env.XDG_CONFIG_HOME
    const fakeHome = path.join(tempDir, "home")
    mkdirSync(fakeHome, { recursive: true })
    process.env.HOME = fakeHome

    const expectedPath = path.join(fakeHome, ".config", "dev3000", "config.json")
    expect(getUserConfigPath()).toBe(expectedPath)
  })

  it("reads disableMcpConfigs from config.json", () => {
    process.env.XDG_CONFIG_HOME = tempDir
    const configDir = path.join(tempDir, "dev3000")
    mkdirSync(configDir, { recursive: true })
    writeFileSync(path.join(configDir, "config.json"), JSON.stringify({ disableMcpConfigs: ["claude", "cursor"] }))

    expect(loadUserConfig()).toEqual({ disableMcpConfigs: "claude cursor" })
  })
})
