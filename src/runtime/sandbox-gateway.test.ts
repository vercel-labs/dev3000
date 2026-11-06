import { describe, expect, it, vi } from "vitest"
import { createSandboxGateway } from "./sandbox-gateway.js"

const options = { projectId: "prj_test", teamId: "team_test", sessionId: "session", minutes: 30, budget: 5 }

describe("sandbox Gateway credentials", () => {
  it("omits the spending quota by default while retaining project scope and expiration", async () => {
    const run = vi.fn(async (_binary: string, _args: string[], input?: { input?: string }) => {
      const payload = JSON.parse(input?.input || "{}")
      expect(payload).not.toHaveProperty("aiGatewayQuota")
      expect(payload).toMatchObject({ purpose: "ai-gateway", projectId: "prj_test" })
      expect(payload.expiresAt).toBeGreaterThan(Date.now())
      return JSON.stringify({ apiKeyString: "test-secret", apiKey: { ...payload, id: "key-id", teamId: "team_test" } })
    })
    await createSandboxGateway(run, { ...options, budget: undefined })
    expect(run).toHaveBeenCalledOnce()
  })

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid explicit budget %s before creating a key",
    async (budget) => {
      const run = vi.fn()
      await expect(createSandboxGateway(run, { ...options, budget })).rejects.toThrow("budget")
      expect(run).not.toHaveBeenCalled()
    }
  )

  it.each([
    [30, 30],
    [60, 60],
    [120, 120]
  ])("gives a %i-minute sandbox a budgeted key valid for %i minutes", async (minutes, keyMinutes) => {
    const lifetime = keyMinutes * 60000
    const startedAt = Date.now()
    const run = vi.fn(async (_binary: string, args: string[], input?: { input?: string }) => {
      if (args[0] !== "api") return ""
      const payload = JSON.parse(input?.input || "{}")
      expect(payload).toMatchObject({
        purpose: "ai-gateway",
        projectId: "prj_test",
        aiGatewayQuota: { limitAmount: 5, refreshPeriod: "none", includeByokInQuota: true }
      })
      expect(payload.expiresAt).toBeGreaterThanOrEqual(startedAt + lifetime)
      expect(payload.expiresAt).toBeLessThanOrEqual(Date.now() + lifetime)
      return JSON.stringify({ apiKeyString: "test-secret", apiKey: { ...payload, id: "key-id", teamId: "team_test" } })
    })
    const key = await createSandboxGateway(run, { ...options, minutes })
    expect(key.key).toBe("test-secret")
    expect(JSON.stringify(run.mock.calls)).not.toContain("test-secret")
    expect(key.expiresAt).toBeGreaterThanOrEqual(startedAt + lifetime)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it.each(["purpose", "projectId", "teamId", "expiresAt"])(
    "revokes a key with an unexpected %s before exposing it",
    async (field) => {
      const run = vi.fn(async (_binary: string, args: string[], input?: { input?: string }) => {
        if (args[0] !== "api") return ""
        return JSON.stringify({
          apiKeyString: "test-secret",
          apiKey: { ...JSON.parse(input?.input || "{}"), teamId: "team_test", id: "key-id", [field]: "wrong" }
        })
      })
      await expect(createSandboxGateway(run, options)).rejects.toThrow("project-scoped")
      expect(run).toHaveBeenCalledTimes(2)
      expect(run.mock.calls[1]?.[1]).toContain("revoke")
    }
  )
})
