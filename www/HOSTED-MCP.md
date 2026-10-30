# Hosted MCP pilot

Deploy the existing `www/` Vercel project. Its build packages the CLI source as
`hosted-runtime/dev3000.tgz`, then bundles that archive with the `/mcp` function.
No persistent agent or browser process runs inside a Vercel Function: those run
in Sandbox. Postgres stores OAuth state and workspace discovery metadata.

## Operator configuration

Configure these in the hosting project's Production environment:

| Variable                            | Value                                                                             |
| ----------------------------------- | --------------------------------------------------------------------------------- |
| `D3K_HOSTED_ORIGIN`                 | Canonical HTTPS origin, without a trailing slash                                  |
| `D3K_HOSTED_AUTH_SECRET`            | Random secret with at least 32 characters                                         |
| `D3K_HOSTED_DATABASE_URL`           | Dedicated Postgres connection URL                                                 |
| `D3K_HOSTED_CLIENT_ID`              | Sign in with Vercel app client ID                                                 |
| `D3K_HOSTED_CLIENT_SECRET`          | That app's client secret                                                          |
| `D3K_HOSTED_ALLOWED_VERCEL_USER_ID` | Exact owner `sub` from Vercel                                                     |
| `D3K_HOSTED_VERCEL_TOKEN`           | Dedicated management credential scoped to the enabled target project              |
| `D3K_HOSTED_PROJECTS`               | JSON array: `[{"slug":"team/project","teamId":"team_...","projectId":"prj_..."}]` |

Use secret environment variables for the auth secret, client secret, management
credential, and database URL. Keep production credentials separate from previews.
Missing configuration disables the endpoint with HTTP 503. Do not reuse a broad
laptop credential or put these values into a sandbox, Git, chat, or logs.

The Vercel sign-in app needs the `openid` scope and this exact callback URL:
`<D3K_HOSTED_ORIGIN>/api/mcp-auth/callback/vercel`. Use its default client-secret
authentication. Resource permissions are not required for sign-in; the separate
management credential provides project and Sandbox access. Credential expiration
or revocation requires operator renewal; the service cannot mint a replacement.

Run `bun scripts/hosted-mcp-migrate.ts` with the above environment configured before
enabling the endpoint. This is an operator command, never a public HTTP route.
The database must be dedicated to this pilot. Do not run migrations against an
existing application's database.

## Connect and verify

Register `<D3K_HOSTED_ORIGIN>/mcp` in a client that supports authenticated remote
Streamable HTTP MCP. The server exposes RFC 9728 resource metadata and OAuth
authorization-server discovery at the paths advertised in its 401 response.
The client registers dynamically, uses PKCE, and opens the Vercel sign-in flow.
The hosted broker verifies the upstream identity, requests consent, and issues
short-lived MCP tokens for this exact resource. Client availability, including
phone app support, depends on the client and account; verify rather than assuming
desktop connector support implies native mobile support.

Ask the assistant to start an enabled project. It should call `sandbox_sessions`,
then `sandbox_start`, poll `sandbox_status` until `ready`, and show `preview.url`
as a clickable private link. Test remote read/edit, browser snapshot, preview
authorization, recovery, stop, and resume. A preview secret travels in the URL
fragment and is exchanged for a Secure, HttpOnly cookie. Anyone holding that link
can view the app until its deadline, independently of project-specific app auth.

For a disposable cloud smoke test, first build and pack the CLI archive, then run:

```sh
bun run build
mkdir -p www/hosted-runtime
bun pm pack --filename www/hosted-runtime/dev3000.tgz --quiet
bun scripts/hosted-mcp-smoke.ts my-team/my-project
```

This creates a fresh Sandbox using the operator's local Vercel login, tests cloud
Chrome and private preview access, exercises recovery and saved-file resume, and
stops the test VM. It does not test real OAuth sign-in or client compatibility.
It must never attach to an existing user's workspace.
