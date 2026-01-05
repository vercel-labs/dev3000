import { describe, expect, it } from "vitest"
import { ORPHANED_PROCESS_CLEANUP_PATTERNS } from "./dev-environment"

describe("ORPHANED_PROCESS_CLEANUP_PATTERNS", () => {
  it("should not include patterns that would kill other d3k instances' Chrome browsers", () => {
    // This test prevents regression of the bug where starting a second d3k instance
    // would kill the first instance's Chrome browser because the cleanup patterns
    // were too broad and matched all d3k Chrome profiles instead of just orphaned ones.
    //
    // The pattern ".d3k/chrome-profiles" must NEVER be in this list because it would
    // match Chrome instances from ANY running d3k instance, not just orphaned ones.
    // Each d3k instance handles its own specific profile cleanup separately.

    const dangerousPatterns = [
      ".d3k/chrome-profiles", // Would kill ALL d3k Chrome instances
      "chrome-profiles", // Too broad, could match other d3k instances
      "d3k" // Way too broad
    ]

    for (const dangerous of dangerousPatterns) {
      const hasMatch = ORPHANED_PROCESS_CLEANUP_PATTERNS.some((pattern) => pattern.includes(dangerous))
      expect(hasMatch, `Pattern "${dangerous}" should not be in cleanup patterns`).toBe(false)
    }
  })

  it("should only contain MCP-specific patterns for orphan cleanup", () => {
    // Ensure we only have patterns that are specific to MCP/Playwright processes
    // which are truly orphaned and not part of running d3k instances
    expect(ORPHANED_PROCESS_CLEANUP_PATTERNS).toContain("ms-playwright/mcp-chrome")
    expect(ORPHANED_PROCESS_CLEANUP_PATTERNS).toContain("mcp-server-playwright")
    expect(ORPHANED_PROCESS_CLEANUP_PATTERNS.length).toBe(2)
  })
})
