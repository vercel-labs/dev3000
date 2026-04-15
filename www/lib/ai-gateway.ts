import { createGateway } from "ai"

const VERCEL_AI_GATEWAY_BASE_URL = "https://ai-gateway.vercel.sh/v1/ai"

export type AiGatewayAuthSource = "explicit" | "api-key" | "oidc" | "missing"

export function getAiGatewayAuthToken(explicitToken?: string | null): string | null {
  const token = explicitToken?.trim() || process.env.AI_GATEWAY_API_KEY?.trim() || process.env.VERCEL_OIDC_TOKEN?.trim()
  return token || null
}

export function getAiGatewayAuthSource(explicitToken?: string | null): AiGatewayAuthSource {
  if (explicitToken?.trim()) return "explicit"
  if (process.env.AI_GATEWAY_API_KEY?.trim()) return "api-key"
  if (process.env.VERCEL_OIDC_TOKEN?.trim()) return "oidc"
  return "missing"
}

export function requireAiGatewayAuthToken(explicitToken?: string | null): string {
  const token = getAiGatewayAuthToken(explicitToken)
  if (!token) {
    throw new Error("AI Gateway auth is required. Set AI_GATEWAY_API_KEY or rely on VERCEL_OIDC_TOKEN.")
  }
  return token
}

export function createVercelGateway(explicitToken?: string | null) {
  return createGateway({
    apiKey: requireAiGatewayAuthToken(explicitToken),
    baseURL: VERCEL_AI_GATEWAY_BASE_URL
  })
}
