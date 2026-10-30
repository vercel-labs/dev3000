import { oauthProvider } from "@better-auth/oauth-provider"
import { betterAuth } from "better-auth"
import { genericOAuth, jwt } from "better-auth/plugins"
import { Pool } from "pg"
import { admittedVercelIdentity, hostedConfig } from "./config"

let instance: ReturnType<typeof createHostedAuth> | undefined

export function createHostedAuth() {
  const config = hostedConfig()
  const databaseUrl = new URL(config.databaseUrl)
  // pg's newer sslmode=require semantics do not verify the server identity.
  if (["require", "prefer", "verify-ca"].includes(databaseUrl.searchParams.get("sslmode") || ""))
    databaseUrl.searchParams.set("sslmode", "verify-full")
  const database = new Pool({ connectionString: databaseUrl.toString(), max: 4, idleTimeoutMillis: 10000 })
  const auth = betterAuth({
    appName: "d3k Sandbox MCP",
    baseURL: config.issuer,
    basePath: "/api/mcp-auth",
    secret: config.secret,
    database,
    trustedOrigins: [config.origin],
    disabledPaths: ["/token"],
    account: { accountLinking: { enabled: false }, encryptOAuthTokens: true },
    user: {
      validateUserInfo: ({ source }) => {
        if (!admittedVercelIdentity(source.oauth?.providerId, source.oauth?.profile?.sub, config.allowedUser))
          return { error: "access_denied", errorDescription: "This hosted pilot is restricted to its owner." }
      }
    },
    rateLimit: { enabled: true, storage: "database", window: 60, max: 60 },
    plugins: [
      jwt({ jwks: { keyPairConfig: { alg: "RS256" } } }),
      genericOAuth({
        config: [
          {
            providerId: "vercel",
            name: "Vercel",
            clientId: config.clientId,
            clientSecret: config.clientSecret,
            discoveryUrl: "https://vercel.com/.well-known/openid-configuration",
            requireIdTokenVerification: true,
            pkce: true,
            scopes: ["openid"],
            mapProfileToUser: (profile) => ({
              name: String(profile.sub),
              email: `${profile.sub}@users.d3k.invalid`,
              emailVerified: false
            })
          }
        ]
      }),
      oauthProvider({
        loginPage: "/mcp/login",
        consentPage: "/mcp/consent",
        scopes: ["openid", "offline_access", "d3k:workspace"],
        grantTypes: ["authorization_code", "refresh_token"],
        allowDynamicClientRegistration: true,
        allowUnauthenticatedClientRegistration: true,
        resources: [{ identifier: config.resource, allowedScopes: ["openid", "offline_access", "d3k:workspace"] }],
        clientRegistrationDefaultResources: [config.resource],
        accessTokenExpiresIn: 300
      })
    ]
  })
  return { auth, database, config }
}

export function hostedAuth() {
  instance ??= createHostedAuth()
  return instance
}

/** Recheck the immutable upstream subject on every request, including after token refresh. */
export async function requireOwner(userId: string) {
  const { database, config } = hostedAuth()
  const account = await database.query('SELECT "accountId" FROM "account" WHERE "userId" = $1 AND "providerId" = $2', [
    userId,
    "vercel"
  ])
  if (!account.rows.some((row) => admittedVercelIdentity("vercel", row.accountId, config.allowedUser)))
    throw new Error("Hosted pilot access denied")
}
