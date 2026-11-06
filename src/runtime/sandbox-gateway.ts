type Run = (binary: string, args: string[], options?: { input?: string }) => Promise<string>

/** The CLI authenticates locally. Only this purpose/project-restricted key goes into the VM. */
export async function createSandboxGateway(
  run: Run,
  options: { projectId: string; teamId: string; sessionId: string; minutes: number; budget?: number }
) {
  if (options.budget !== undefined && (!Number.isFinite(options.budget) || options.budget < 1))
    throw new Error("Gateway budget must be at least 1 USD")
  const expiresAt = Date.now() + options.minutes * 60000
  const result = JSON.parse(
    await run(
      "vercel",
      ["api", "/v1/api-keys", "--method", "POST", "--scope", options.teamId, "--input", "-", "--raw"],
      {
        input: JSON.stringify({
          purpose: "ai-gateway",
          projectId: options.projectId,
          name: `d3k ${options.sessionId}`,
          expiresAt,
          ...(options.budget === undefined
            ? {}
            : { aiGatewayQuota: { limitAmount: options.budget, refreshPeriod: "none", includeByokInQuota: true } })
        })
      }
    )
  ) as {
    apiKeyString?: string
    apiKey?: { id?: string; purpose?: string; projectId?: string; teamId?: string; expiresAt?: number }
  }
  const id = result.apiKey?.id
  const revoke = async () => {
    if (!id) return
    await run("vercel", ["ai-gateway", "api-keys", "revoke", id, "--scope", options.teamId, "--yes"])
  }
  if (
    !id ||
    !result.apiKeyString ||
    result.apiKey?.purpose !== "ai-gateway" ||
    result.apiKey.projectId !== options.projectId ||
    result.apiKey.teamId !== options.teamId ||
    result.apiKey.expiresAt !== expiresAt
  ) {
    await revoke()
    throw new Error("Vercel did not return a project-scoped, expiring Gateway key")
  }
  return { id, key: result.apiKeyString, expiresAt }
}
