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

  it("prefers the newest automation bypass token when project settings contain several", () => {
    expect(
      extractAutomationProtectionBypassToken({
        protectionBypass: {
          "old-automation-secret": { scope: "automation-bypass", createdAt: 100 },
          "sso-secret": { scope: "sso", createdAt: 300 },
          "new-automation-secret": { scope: "automation-bypass", createdAt: 200 }
        }
      })
    ).toBe("new-automation-secret")
  })
})
