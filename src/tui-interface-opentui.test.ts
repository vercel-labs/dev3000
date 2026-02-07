import { readFileSync } from "fs"
import { dirname, join } from "path"
import { fileURLToPath } from "url"
import { describe, expect, it } from "vitest"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

describe("OpenTUI TUI Implementation", () => {
  it("should export the required interface", () => {
    const tuiFilePath = join(__dirname, "tui-interface-opentui.ts")
    const fileContent = readFileSync(tuiFilePath, "utf-8")

    // Check required exports
    expect(fileContent).toContain("export type UpdateInfo")
    expect(fileContent).toContain("export interface TUIOptions")
    expect(fileContent).toContain("export async function runTUI")
  })

  it("should maintain the d3k logo format", () => {
    const tuiFilePath = join(__dirname, "tui-interface-opentui.ts")
    const fileContent = readFileSync(tuiFilePath, "utf-8")

    // Check that FULL_LOGO constant exists
    expect(fileContent).toContain("const FULL_LOGO = [")

    // Check compact logo
    expect(fileContent).toContain('const COMPACT_LOGO = "d3k"')
  })

  it("should use OpenTUI components", () => {
    const tuiFilePath = join(__dirname, "tui-interface-opentui.ts")
    const fileContent = readFileSync(tuiFilePath, "utf-8")

    // Check OpenTUI imports
    expect(fileContent).toContain("@opentui/core")
    expect(fileContent).toContain("createCliRenderer")
    expect(fileContent).toContain("ScrollBoxRenderable")
    expect(fileContent).toContain("BoxRenderable")
    expect(fileContent).toContain("TextRenderable")
  })

  it("should have mouse scrolling enabled", () => {
    const tuiFilePath = join(__dirname, "tui-interface-opentui.ts")
    const fileContent = readFileSync(tuiFilePath, "utf-8")

    // Check mouse is enabled in config
    expect(fileContent).toContain("useMouse: true")

    // Check scroll acceleration is configured
    expect(fileContent).toContain("scrollAcceleration")
    expect(fileContent).toContain("stickyScroll: true")
  })

  it("should handle keyboard scrolling", () => {
    const tuiFilePath = join(__dirname, "tui-interface-opentui.ts")
    const fileContent = readFileSync(tuiFilePath, "utf-8")

    // Check keyboard handlers for scrolling
    expect(fileContent).toContain('key.name === "up"')
    expect(fileContent).toContain('key.name === "down"')
    expect(fileContent).toContain('key.name === "pageup"')
    expect(fileContent).toContain('key.name === "pagedown"')
    expect(fileContent).toContain("scrollBy")
  })

  it("should support mouse selection inside the logs pane", () => {
    const tuiFilePath = join(__dirname, "tui-interface-opentui.ts")
    const fileContent = readFileSync(tuiFilePath, "utf-8")

    // Ensure logs selection fallback exists for scroll box hit testing
    expect(fileContent).toContain("findLogLineAt")
    expect(fileContent).toContain("startSelection")
    expect(fileContent).toContain("logsContainer.add(logLine)")
  })

  it("should return the expected interface from runTUI", () => {
    const tuiFilePath = join(__dirname, "tui-interface-opentui.ts")
    const fileContent = readFileSync(tuiFilePath, "utf-8")

    // Check returned interface matches contract
    expect(fileContent).toContain("app: { unmount:")
    expect(fileContent).toContain("updateStatus:")
    expect(fileContent).toContain("updateAppPort:")
    expect(fileContent).toContain("updateUpdateInfo:")
    expect(fileContent).toContain("updateUseHttps:")
  })
})
