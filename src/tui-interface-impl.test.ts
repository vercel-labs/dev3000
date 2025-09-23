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

    // Expected logo lines without any JSX expressions or extra formatting
    const expectedLogoLines = [
      '<Text color="#A18CE5" bold>   ▐▌▄▄▄▄ █  ▄ </Text>',
      '<Text color="#A18CE5" bold>   ▐▌   █ █▄▀  </Text>',
      '<Text color="#A18CE5" bold>▗▞▀▜▌▀▀▀█ █ ▀▄ </Text>',
      '<Text color="#A18CE5" bold>▝▚▄▟▌▄▄▄█ █  █ </Text>'
    ]

    // Check that each line exists in the file
    expectedLogoLines.forEach((line) => {
      expect(fileContent).toContain(line)
    })

    // Extract the logo section from the file
    const logoMatch = fileContent.match(/(<Text color="#A18CE5" bold>.*?<\/Text>\s*){4}/s)
    expect(logoMatch).toBeTruthy()

    const logoSection = logoMatch?.[0]

    // Ensure no JSX expressions like {" "} are present
    expect(logoSection).not.toMatch(/\{\s*["'].*?["']\s*\}/)

    // Ensure the visual structure is correct by checking character alignment
    const logoTextOnly = logoSection
      .split("\n")
      .map((line) => {
        const match = line.match(/<Text[^>]*>([^<]*)<\/Text>/)
        return match ? match[1] : ""
      })
      .filter((line) => line.length > 0)

    expect(logoTextOnly).toHaveLength(4)

    // Check that the 'd' character alignment is correct (lowercase d on left)
    expect(logoTextOnly[2]).toMatch(/^▗/) // Third line starts with ▗
    expect(logoTextOnly[3]).toMatch(/^▝/) // Fourth line starts with ▝
  })

  it("should have consistent spacing in the logo", () => {
    const tuiFilePath = join(__dirname, "tui-interface-impl.tsx")
    const fileContent = readFileSync(tuiFilePath, "utf-8")

    // Extract just the text content of each logo line
    const logoLines = fileContent.match(/<Text color="#A18CE5" bold>([^<]+)<\/Text>/g)
    expect(logoLines).toBeTruthy()
    expect(logoLines?.length).toBeGreaterThanOrEqual(4)

    const logoTexts = logoLines?.slice(0, 4).map((line) => {
      const match = line.match(/<Text[^>]*>([^<]*)<\/Text>/)
      return match ? match[1] : ""
    })

    // Verify the visual representation
    expect(logoTexts[0]).toBe("   ▐▌▄▄▄▄ █  ▄ ")
    expect(logoTexts[1]).toBe("   ▐▌   █ █▄▀  ")
    expect(logoTexts[2]).toBe("▗▞▀▜▌▀▀▀█ █ ▀▄ ")
    expect(logoTexts[3]).toBe("▝▚▄▟▌▄▄▄█ █  █ ")
  })

  it("should handle long source names without crashing", () => {
    // This test ensures that the padding calculation doesn't produce negative values
    // when source names are longer than expected
    const tuiFilePath = join(__dirname, "tui-interface-impl.tsx")
    const fileContent = readFileSync(tuiFilePath, "utf-8")

    // Check that Math.max(0, ...) is used to prevent negative repeat values
    expect(fileContent).toContain("Math.max(0, 7 - source.length)")
    expect(fileContent).toContain("Math.max(0, 15 - type.length)")

    // Verify the regex pattern that could allow various source names
    const logParseRegex = /\^\\\[\(.*\?\)\\\] \\\[\(.*\?\)\\\]/
    expect(fileContent).toMatch(logParseRegex)
  })
})
