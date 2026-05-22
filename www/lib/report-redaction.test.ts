import { describe, expect, it } from "vitest"

import { redactSensitiveReportText } from "./report-redaction"

describe("redactSensitiveReportText", () => {
  it("redacts Vercel and model provider token assignments", () => {
    const redacted = redactSensitiveReportText(
      "VERCEL_TOKEN=secret-123\nAI_GATEWAY_API_KEY:gw_secret\nOPENAI_API_KEY='openai-secret'"
    )

    expect(redacted).toContain("VERCEL_TOKEN=[redacted]")
    expect(redacted).toContain("AI_GATEWAY_API_KEY=[redacted]")
    expect(redacted).toContain("OPENAI_API_KEY=[redacted]")
    expect(redacted).not.toContain("secret-123")
    expect(redacted).not.toContain("gw_secret")
    expect(redacted).not.toContain("openai-secret")
  })
})
