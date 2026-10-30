import { generateKeyPair, SignJWT } from "jose"
import { beforeAll, describe, expect, it } from "vitest"
import { verifyHostedToken } from "./token"

const issuer = "https://d3k.example/api/mcp-auth"
const resource = "https://d3k.example/mcp"
let keys: Awaited<ReturnType<typeof generateKeyPair>>
beforeAll(async () => {
  keys = await generateKeyPair("RS256")
})

async function sign(overrides: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000)
  return new SignJWT({
    sub: "owner",
    iss: issuer,
    aud: resource,
    iat: now,
    exp: now + 300,
    scope: "d3k:workspace",
    ...overrides
  })
    .setProtectedHeader({ alg: "RS256" })
    .sign(keys.privateKey)
}

describe("hosted MCP resource boundary", () => {
  it("accepts a current workspace token for this issuer and exact resource", async () => {
    expect(await verifyHostedToken(await sign(), async () => keys.publicKey, issuer, resource)).toBe("owner")
  })
  it.each([
    { aud: "vercel-api" },
    { aud: "https://other.example/mcp" },
    { iss: "https://vercel.com" },
    { scope: "openid" },
    { sub: undefined },
    { exp: 1 },
    { iat: 1 },
    { cnf: { jkt: "proof-required" } }
  ])("rejects wrong audience, identity-only, expired, or unsupported bound tokens: %j", async (overrides) => {
    await expect(
      verifyHostedToken(await sign(overrides), async () => keys.publicKey, issuer, resource)
    ).rejects.toThrow()
  })
  it("rejects a token signed by another server", async () => {
    const other = await generateKeyPair("RS256")
    await expect(verifyHostedToken(await sign(), async () => other.publicKey, issuer, resource)).rejects.toThrow()
  })
})
