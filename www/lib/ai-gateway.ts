import { createGateway } from "ai"

const VERCEL_AI_GATEWAY_BASE_URL = "https://ai-gateway.vercel.sh/v1/ai"

export type AiGatewayAuthSource = "explicit" | "api-key" | "oidc" | "missing"
export type WorkflowGatewayAuthSource =
  | AiGatewayAuthSource
  | "worker-runtime-oidc"
  | "worker-oidc-helper"
  | "worker-project-oidc-refresh"
  | "worker-platform-header-oidc"
  | "control-plane-runtime-oidc"
  | "control-plane-ai-gateway-api-key"

export function getAiGatewayAuthToken(explicitToken?: string | null): string | null {
  const token = explicitToken?.trim() || process.env.VERCEL_OIDC_TOKEN?.trim() || process.env.AI_GATEWAY_API_KEY?.trim()
  return token || null
}

export function getAiGatewayAuthSource(explicitToken?: string | null): AiGatewayAuthSource {
  if (explicitToken?.trim()) return "explicit"
  if (process.env.VERCEL_OIDC_TOKEN?.trim()) return "oidc"
  if (process.env.AI_GATEWAY_API_KEY?.trim()) return "api-key"
  return "missing"
}

export function requireAiGatewayAuthToken(explicitToken?: string | null): string {
  const token = getAiGatewayAuthToken(explicitToken)
  if (!token) {
    throw new Error("AI Gateway auth is required. Set AI_GATEWAY_API_KEY or rely on VERCEL_OIDC_TOKEN.")
  }
  return token
}

export function isOidcAiGatewayAuthSource(source?: string | null): boolean {
  return (
    source === "oidc" ||
    source === "worker-runtime-oidc" ||
    source === "worker-oidc-helper" ||
    source === "worker-project-oidc-refresh" ||
    source === "worker-platform-header-oidc" ||
    source === "control-plane-runtime-oidc"
  )
}

export function getEffectiveAiGatewayAuthSource(
  explicitToken?: string | null,
  source?: string | null
): WorkflowGatewayAuthSource {
  if (source?.trim()) {
    return source.trim() as WorkflowGatewayAuthSource
  }
  return getAiGatewayAuthSource(explicitToken)
}

export function createVercelGateway(explicitToken?: string | null, source?: string | null) {
  const token = requireAiGatewayAuthToken(explicitToken)
  const effectiveSource = getEffectiveAiGatewayAuthSource(explicitToken, source)

  return createGateway({
    apiKey: token,
    baseURL: VERCEL_AI_GATEWAY_BASE_URL,
    headers: isOidcAiGatewayAuthSource(effectiveSource) ? { "ai-gateway-auth-method": "oidc" } : undefined
  })
}
