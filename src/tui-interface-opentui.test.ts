import { readFileSync } from "fs"
import { dirname, join } from "path"
import { fileURLToPath } from "url"
import { describe, expect, it } from "vitest"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// NOTE: Tests that import @opentui/core are skipped because vitest cannot
// handle the .scm tree-sitter grammar files bundled in @opentui/core.
// These tests work at runtime but not in the vitest ESM loader.

describe("OpenTUI TUI Implementation", () => {
  it.skip("should bake selection colors into styled log content", () => {
    const selectionBg = RGBA.fromInts(70, 130, 180)
    const selectionFg = RGBA.fromInts(255, 255, 255)
    const content = t`prefix ${t`body`}`

    const selected = applySelectionToStyledText(content, selectionBg, selectionFg)

    expect(selected.chunks).toHaveLength(content.chunks.length)
    expect(selected.chunks.every((chunk) => chunk.bg === selectionBg)).toBe(true)
    expect(selected.chunks.every((chunk) => chunk.fg === selectionFg)).toBe(true)
  })

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

    // Ensure logs selection is owned by d3k instead of OpenTUI's native text selection.
    expect(fileContent).toContain("findLogLineAt")
    expect(fileContent).toContain("findLogLineAtRow")
    expect(fileContent).toContain("beginLogSelection")
    expect(fileContent).toContain("updateLogSelection")
    expect(fileContent).toContain("getSelectedLogText")
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
