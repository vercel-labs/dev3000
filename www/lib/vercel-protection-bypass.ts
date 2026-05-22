export interface VercelProtectionBypassResponse {
  protectionBypass?: Record<string, { scope?: string }> | string
  secret?: string
}

export function extractAutomationProtectionBypassToken(data: VercelProtectionBypassResponse): string | undefined {
  if (typeof data.secret === "string" && data.secret.trim()) {
    return data.secret.trim()
  }

  if (typeof data.protectionBypass === "string" && data.protectionBypass.trim()) {
    return data.protectionBypass.trim()
  }

  if (!data.protectionBypass || typeof data.protectionBypass !== "object") {
    return undefined
  }

  return Object.entries(data.protectionBypass).find(([, value]) => value?.scope === "automation-bypass")?.[0]
}
