import { describe, expect, it } from "vitest"
import { buildPersistedDeepSecFindingsMarkdown } from "./deepsec-partial-report"

describe("buildPersistedDeepSecFindingsMarkdown", () => {
  it("renders persisted findings with coverage counts in severity order", () => {
    const markdown = buildPersistedDeepSecFindingsMarkdown({
      fileCount: 3,
      findingCount: 2,
      projectIds: ["www"],
      statusCounts: {
        analyzed: 2,
        pending: 1
      },
      findings: [
        {
          confidence: "medium",
          description: "A medium issue",
          filePath: "app/page.tsx",
          lineNumbers: [42],
          recommendation: "Add validation",
          severity: "MEDIUM",
          title: "Validate route input",
          vulnSlug: "route-input"
        },
        {
          confidence: "high",
          description: "A critical issue",
          filePath: "app/api/token/route.ts",
          lineNumbers: [7, 8],
          recommendation: "Remove the token leak",
          severity: "CRITICAL",
          title: "Token leak",
          vulnSlug: "secret-exposure"
        }
      ]
    })

    expect(markdown).toContain("Persisted findings: 2")
    expect(markdown).toContain("- analyzed: 2")
    expect(markdown).toContain("- pending: 1")
    expect(markdown.indexOf("CRITICAL: Token leak")).toBeLessThan(markdown.indexOf("MEDIUM: Validate route input"))
    expect(markdown).toContain("File: app/api/token/route.ts:7,8")
    expect(markdown).toContain("Recommendation:")
  })

  it("still renders a useful snapshot when no finding details are available", () => {
    const markdown = buildPersistedDeepSecFindingsMarkdown({
      fileCount: 1,
      findingCount: 0,
      findings: [],
      projectIds: ["www"],
      statusCounts: {
        error: 1
      }
    })

    expect(markdown).toContain("No persisted finding details were available")
    expect(markdown).toContain("- error: 1")
  })
})
