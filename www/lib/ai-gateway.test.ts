import { afterEach, describe, expect, it } from "vitest"

import { getAiGatewayAuthSource, getAiGatewayAuthToken } from "./ai-gateway"

const originalAiGatewayApiKey = process.env.AI_GATEWAY_API_KEY
const originalVercelOidcToken = process.env.VERCEL_OIDC_TOKEN

afterEach(() => {
  process.env.AI_GATEWAY_API_KEY = originalAiGatewayApiKey
  process.env.VERCEL_OIDC_TOKEN = originalVercelOidcToken
})

describe("AI Gateway auth selection", () => {
  it("prefers explicit tokens", () => {
    process.env.AI_GATEWAY_API_KEY = "api-key-token"
    process.env.VERCEL_OIDC_TOKEN = "oidc-token"

    expect(getAiGatewayAuthToken("explicit-token")).toBe("explicit-token")
    expect(getAiGatewayAuthSource("explicit-token")).toBe("explicit")
  })

  it("prefers Vercel OIDC over static API keys", () => {
    process.env.AI_GATEWAY_API_KEY = "api-key-token"
    process.env.VERCEL_OIDC_TOKEN = "oidc-token"

    expect(getAiGatewayAuthToken()).toBe("oidc-token")
    expect(getAiGatewayAuthSource()).toBe("oidc")
  })
})
