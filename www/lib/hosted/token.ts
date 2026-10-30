import { type JWTVerifyGetKey, jwtVerify } from "jose"

/** Only MCP access tokens issued for this exact resource are accepted, never Vercel API/ID tokens. */
export async function verifyHostedToken(token: string, key: JWTVerifyGetKey, issuer: string, resource: string) {
  const { payload } = await jwtVerify(token, key, {
    issuer,
    audience: resource,
    algorithms: ["RS256"],
    requiredClaims: ["sub", "exp", "iat"],
    maxTokenAge: "5m"
  })
  if (!payload.sub || typeof payload.scope !== "string" || !payload.scope.split(" ").includes("d3k:workspace"))
    throw new Error("Missing workspace authorization")
  if (payload.cnf) throw new Error("Sender-constrained tokens require a supported proof")
  return payload.sub
}
