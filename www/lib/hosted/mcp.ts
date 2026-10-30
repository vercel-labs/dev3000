import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import { createRemoteJWKSet } from "jose"
import { z } from "zod"
import { hostedAuth, requireOwner } from "./auth"
import { callCloudSession, startCloudSession } from "./sandbox"
import { verifyHostedToken } from "./token"

const text = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }] })
let keySet: ReturnType<typeof createRemoteJWKSet> | undefined

export async function hostedMcp(request: Request): Promise<Response> {
  let config: ReturnType<typeof hostedAuth>["config"]
  try {
    config = hostedAuth().config
  } catch {
    return Response.json({ error: "Hosted MCP is not configured yet" }, { status: 503 })
  }
  if (new URL(request.url).origin !== config.origin)
    return Response.json({ error: "Use the configured MCP origin" }, { status: 403 })
  const origin = request.headers.get("origin")
  if (
    origin &&
    ![config.origin, "https://chatgpt.com", "https://chat.openai.com", "https://claude.ai"].includes(origin)
  )
    return Response.json({ error: "Origin is not allowed" }, { status: 403 })
  let owner: string
  try {
    const authorization = request.headers.get("authorization") || ""
    if (!authorization.startsWith("Bearer ") || authorization.length > 16384) throw new Error("Missing token")
    keySet ??= createRemoteJWKSet(new URL(`${config.issuer}/jwks`))
    owner = await verifyHostedToken(authorization.slice(7), keySet, config.issuer, config.resource)
    await requireOwner(owner)
  } catch {
    return Response.json(
      { error: "Authentication required" },
      {
        status: 401,
        headers: {
          "WWW-Authenticate": `Bearer resource_metadata="${config.origin}/.well-known/oauth-protected-resource/mcp", scope="d3k:workspace"`,
          "Cache-Control": "no-store"
        }
      }
    )
  }
  const server = new McpServer(
    { name: "d3k-hosted", version: "1.0.0" },
    {
      instructions: `d3k is hosted: the repo, app env, dev server and automated Chrome are in Vercel Sandbox. No laptop is required. Call sandbox_sessions first, then sandbox_start with an enabled project (${config.projects.map((p) => p.slug).join(", ")}) or a saved resume ID. Start returns before readiness; poll sandbox_status until ready, then present preview.url as a clickable private link. The user opens it on their phone or desktop. You control a SEPARATE sandbox Chrome; never claim to see the user's phone state. Always include the session ID in subsequent calls; do not reuse another chat's session without the user's direction. Use sandbox_exec/read_file/write_file for remote code, sandbox_runtime for logs, sandbox_browser for agent-browser commands against the already connected Chrome. Read remote AGENTS.md before edits. Batch remote commands. Do not clone code locally or ask the user to run a local companion. If the dev runtime stops, sandbox_recover starts it again in the same workspace; poll status. A command timeout does not establish whether its mutation completed: inspect state before retrying. No GitHub publishing credential is configured in this pilot; do not request or copy a broad credential into the VM. Keep preview links out of public logs and PRs. After mobile device testing reset sandbox_browser args ["set","viewport","0","0","0"]. Stop compute with sandbox_stop when the user is done; remote files are preserved. Session lifetime is one hour.`
    }
  )
  const register = (name: string, description: string, inputSchema: z.ZodRawShape, readOnlyHint = false) => {
    server.registerTool(
      name,
      { description, inputSchema, annotations: { readOnlyHint, openWorldHint: true } },
      async (args) => {
        try {
          if (name === "sandbox_start") return text(await startCloudSession(owner, args))
          const result = await callCloudSession(owner, name, args)
          return result && typeof result === "object" && "content" in result ? result : text(result)
        } catch (error) {
          return {
            ...text({ error: error instanceof Error ? error.message : "Sandbox request failed" }),
            isError: true
          }
        }
      }
    )
  }
  const session = z.string().uuid()
  const args = z.array(z.string()).min(1).max(64)
  register("sandbox_sessions", "List your saved hosted sessions. Each chat should select its own session.", {}, true)
  register(
    "sandbox_start",
    "Create an enabled project sandbox, or resume saved files. Poll sandbox_status until ready.",
    { project: z.string().optional(), resume: session.optional() }
  )
  register("sandbox_status", "Read startup phase and the private phone preview link once ready.", { session }, true)
  register("sandbox_stop", "Stop this sandbox's compute, preserving its remote filesystem for resume.", { session })
  register(
    "sandbox_recover",
    "Restart a stopped dev runtime in the same sandbox without reinstalling or cloning. Poll status.",
    { session }
  )
  register("sandbox_exec", "Execute a shell command in this remote project. Commands have a 60 second deadline.", {
    session,
    command: z.string().min(1).max(65536)
  })
  register(
    "sandbox_read_file",
    "Read a UTF-8 file relative to the remote project root.",
    { session, path: z.string().min(1) },
    true
  )
  register("sandbox_write_file", "Write a UTF-8 file relative to the remote project root; read existing files first.", {
    session,
    path: z.string().min(1),
    content: z.string().max(1024 * 1024)
  })
  register(
    "sandbox_runtime",
    "Read shared dev server/browser status, events, logs or errors. Do not start another runtime.",
    { session, args },
    true
  )
  register(
    "sandbox_browser",
    "Use agent-browser interaction commands in the existing sandbox Chrome. Connection is managed by d3k.",
    { session, args }
  )
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
    maxRequestBodySize: 1024 * 1024
  })
  await server.connect(transport)
  try {
    const response = await transport.handleRequest(request)
    response.headers.set("Cache-Control", "no-store")
    return response
  } finally {
    await server.close()
  }
}
