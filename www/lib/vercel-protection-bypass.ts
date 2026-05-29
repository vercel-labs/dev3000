export interface VercelProtectionBypassResponse {
  protectionBypass?: Record<string, { scope?: string; createdAt?: number }> | string
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

  const automationBypasses = Object.entries(data.protectionBypass).filter(
    ([, value]) => value?.scope === "automation-bypass"
  )

  automationBypasses.sort(([, a], [, b]) => (b.createdAt || 0) - (a.createdAt || 0))

  return automationBypasses[0]?.[0]
}
