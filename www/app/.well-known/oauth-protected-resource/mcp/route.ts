export async function GET(request: Request) {
  const origin = process.env.D3K_HOSTED_ORIGIN
  if (!origin || new URL(request.url).origin !== origin)
    return Response.json({ error: "Hosted MCP is unavailable on this origin" }, { status: 503 })
  return Response.json(
    {
      resource: `${origin}/mcp`,
      authorization_servers: [`${origin}/api/mcp-auth`],
      scopes_supported: ["d3k:workspace"],
      bearer_methods_supported: ["header"]
    },
    { headers: { "Cache-Control": "no-store" } }
  )
}
