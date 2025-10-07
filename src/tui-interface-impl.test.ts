import { readFileSync } from "fs"
import { dirname, join } from "path"
import { fileURLToPath } from "url"
import { describe, expect, it } from "vitest"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

describe("TUI ASCII Logo", () => {
  it("should maintain the correct d3k logo format", () => {
    const tuiFilePath = join(__dirname, "tui-interface-impl.tsx")
    const fileContent = readFileSync(tuiFilePath, "utf-8")

    // Expected logo lines as defined in FULL_LOGO constant
    const expectedLogoLines = ['"   ▐▌▄▄▄▄ █  ▄ "', '"   ▐▌   █ █▄▀  "', '"▗▞▀▜▌▀▀▀█ █ ▀▄ "', '"▝▚▄▟▌▄▄▄█ █  █ "']

    // Check that FULL_LOGO constant exists and contains the expected lines
    expect(fileContent).toContain("const FULL_LOGO = [")
    expectedLogoLines.forEach((line) => {
      expect(fileContent).toContain(line)
    })

    // Also check compact logo
    expect(fileContent).toContain('const COMPACT_LOGO = "d3k"')

    // Check that the logo is rendered with map
    expect(fileContent).toContain("FULL_LOGO.map((line) =>")
  })

  it("should have consistent spacing in the logo", () => {
    const tuiFilePath = join(__dirname, "tui-interface-impl.tsx")
    const fileContent = readFileSync(tuiFilePath, "utf-8")

    // Extract the FULL_LOGO array definition
    const logoArrayMatch = fileContent.match(/const FULL_LOGO = \[\s*([\s\S]*?)\s*\]/)
    expect(logoArrayMatch).toBeTruthy()

    // Parse the logo lines from the array
    const logoLines = logoArrayMatch?.[1]
      .split(",")
      .map((line) => line.trim())
      .filter((line) => line.startsWith('"') && line.endsWith('"'))
      .map((line) => line.slice(1, -1)) // Remove quotes

    expect(logoLines).toBeTruthy()
    expect(logoLines?.length).toBe(4)

    // Verify the visual representation
    expect(logoLines[0]).toBe("   ▐▌▄▄▄▄ █  ▄ ")
    expect(logoLines[1]).toBe("   ▐▌   █ █▄▀  ")
    expect(logoLines[2]).toBe("▗▞▀▜▌▀▀▀█ █ ▀▄ ")
    expect(logoLines[3]).toBe("▝▚▄▟▌▄▄▄█ █  █ ")
  })

  it("should handle log formatting with minimal padding", () => {
    // This test ensures that we use minimal padding to maximize horizontal space
    const tuiFilePath = join(__dirname, "tui-interface-impl.tsx")
    const fileContent = readFileSync(tuiFilePath, "utf-8")

    // Check that we use minimal padding
    expect(fileContent).toContain('const sourceSpacing = ""')
    expect(fileContent).toContain('const typeSpacing = ""')

    // Verify the regex pattern that could allow various source names
    const logParseRegex = /\^\\\[\(.*\?\)\\\] \\\[\(.*\?\)\\\]/
    expect(fileContent).toMatch(logParseRegex)
  })
})
