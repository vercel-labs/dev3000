export async function GET(request: Request) {
  // Read request data so Cache Components never prerenders an authentication result.
  if (!request.url) return new Response(null, { status: 400 })
  return new Response("Return to your MCP client to finish connecting d3k.", {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" }
  })
}
