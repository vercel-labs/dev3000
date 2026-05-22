import { describe, expect, it } from "vitest"
import { extractAutomationProtectionBypassToken } from "./vercel-protection-bypass"

describe("extractAutomationProtectionBypassToken", () => {
  it("supports the legacy secret field", () => {
    expect(extractAutomationProtectionBypassToken({ secret: "legacy-secret" })).toBe("legacy-secret")
  })

  it("supports a direct protectionBypass string", () => {
    expect(extractAutomationProtectionBypassToken({ protectionBypass: "direct-secret" })).toBe("direct-secret")
  })

  it("extracts the automation bypass token from Vercel's protectionBypass map", () => {
    expect(
      extractAutomationProtectionBypassToken({
        protectionBypass: {
          "sso-secret": { scope: "sso" },
          "automation-secret": { scope: "automation-bypass" }
        }
      })
    ).toBe("automation-secret")
  })
})
