import { createGateway } from "ai"

const VERCEL_AI_GATEWAY_BASE_URL = "https://ai-gateway.vercel.sh/v1/ai"

export function getAiGatewayAuthToken(): string | null {
  const token = process.env.AI_GATEWAY_API_KEY?.trim() || process.env.VERCEL_OIDC_TOKEN?.trim()
  return token || null
}

export function getAiGatewayAuthSource(): "api-key" | "oidc" | "missing" {
  if (process.env.AI_GATEWAY_API_KEY?.trim()) return "api-key"
  if (process.env.VERCEL_OIDC_TOKEN?.trim()) return "oidc"
  return "missing"
}

export function requireAiGatewayAuthToken(): string {
  const token = getAiGatewayAuthToken()
  if (!token) {
    throw new Error("AI Gateway auth is required. Set AI_GATEWAY_API_KEY or rely on VERCEL_OIDC_TOKEN.")
  }
  return token
}

export function createVercelGateway() {
  return createGateway({
    apiKey: requireAiGatewayAuthToken(),
    baseURL: VERCEL_AI_GATEWAY_BASE_URL
  })
}
