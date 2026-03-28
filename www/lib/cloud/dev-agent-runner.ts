export type DevAgentRunner = "v0" | "legacy-sandbox"

function parseBooleanFlag(value: string | undefined): boolean | undefined {
  if (!value) return undefined

  const normalized = value.trim().toLowerCase()
  if (["1", "true", "yes", "on"].includes(normalized)) return true
  if (["0", "false", "no", "off"].includes(normalized)) return false
  return undefined
}

export function isV0DevAgentRunnerEnabled(explicit?: boolean): boolean {
  if (typeof explicit === "boolean") return explicit

  const envFlag =
    parseBooleanFlag(process.env.RECIPE_V0_RUNNER) ??
    parseBooleanFlag(process.env.NEXT_PUBLIC_RECIPE_V0_RUNNER) ??
    parseBooleanFlag(process.env.D3K_RECIPE_V0_RUNNER)

  return envFlag ?? true
}

export function resolveDevAgentRunner(explicit?: boolean): DevAgentRunner {
  return isV0DevAgentRunnerEnabled(explicit) ? "v0" : "legacy-sandbox"
}

export function getV0ApiToken(fallbackToken?: string | null): string | null {
  const token = process.env.V0_API_TOKEN || process.env.V0_API_KEY || fallbackToken
  return typeof token === "string" && token.trim().length > 0 ? token.trim() : null
}
