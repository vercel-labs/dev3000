import { existsSync, readdirSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { connection, NextResponse } from "next/server"
import { getMCPClientManager } from "@/app/mcp/client-manager"

// MIGRATED: Removed 'export const revalidate = 0' (incompatible with Cache Components)
// With Cache Components enabled, API Routes are dynamic by default.
// We use connection() to explicitly mark this route as dynamic and ensure
// it executes on every request without any caching.

export async function GET(request: Request) {
  // Mark this route as dynamic to prevent any caching
  // This ensures fresh data on every request
  await connection()

  const clientManager = getMCPClientManager()
  // Optional consistency wait: /api/orchestrator?waitMs=1500
  try {
    const url = new URL(request.url)
    const waitParam = url.searchParams.get("waitMs")
    const waitMs = waitParam ? Math.max(0, Math.min(5000, parseInt(waitParam, 10))) : 0
    if (waitMs > 0) {
      await clientManager.waitForInitialTools(waitMs)
    }
  } catch {
    // ignore parsing/wait errors – return the best-effort snapshot below
  }
  let connectedMCPs = clientManager.getConnectedMCPs()
  const allTools = clientManager.getAllTools()

  // Fallback path: In Next.js, /mcp and /api routes can run in separate
  // workers, so global singletons may not be shared. If we see no connections
  // here, derive state by querying our own /mcp endpoint for tools.
  let fallbackByMcp: Map<string, string[]> | null = null
  if (connectedMCPs.length === 0) {
    try {
      const baseUrl = new URL(request.url)
      baseUrl.pathname = "/mcp"
      baseUrl.search = ""

      // Read a single SSE message from /mcp tools/list and infer MCP names
      // Ensure MCP is initialized first, then list tools
      await initializeMCP(baseUrl.toString(), 1000)
      const tools = await fetchToolsViaMCP(baseUrl.toString(), 1500)
      if (tools && tools.length > 0) {
        const byMcp = new Map<string, string[]>()
        for (const t of tools) {
          const mcp = t.proxiedFrom || inferMcpFromToolName(t.name)
          if (!byMcp.has(mcp)) byMcp.set(mcp, [])
          const arr = byMcp.get(mcp)
          if (arr) arr.push(t.name)
        }
        connectedMCPs = Array.from(byMcp.keys())
        fallbackByMcp = byMcp
      }
    } catch (e) {
      console.warn("[Orchestrator API] Fallback /mcp tools/list check failed:", e)
    }
  }

  // Read session files to get project info
  const candidateDirs = new Set<string>()
  candidateDirs.add(join(homedir(), ".d3k"))
  candidateDirs.add(join("/root", ".d3k"))
  if (process.env.D3K_SESSION_DIR) {
    candidateDirs.add(process.env.D3K_SESSION_DIR)
  }
  const projects: Array<{ name: string; cdpUrl?: string; appPort?: number }> = []

  try {
    let inspected = 0
    for (const sessionDir of candidateDirs) {
      if (!existsSync(sessionDir)) continue

      const sessionFiles = readdirSync(sessionDir).filter((f) => f.endsWith(".json"))
      inspected += sessionFiles.length

      for (const file of sessionFiles) {
        try {
          const sessionPath = join(sessionDir, file)
          const sessionData = JSON.parse(readFileSync(sessionPath, "utf-8"))
          const projectName = file.replace(".json", "")

          projects.push({
            name: projectName,
            cdpUrl: sessionData.cdpUrl,
            appPort: sessionData.appPort
          })
        } catch (error) {
          console.warn(`[Orchestrator API] Failed to parse session ${file}:`, error)
        }
      }
    }

    if (projects.length === 0) {
      console.log(
        `[MCP Orchestrator API] No session files found (inspected ${inspected} entries) in ${Array.from(candidateDirs).join(", ")}`
      )
    }
  } catch (error) {
    console.error("[Orchestrator API] Failed to read session files:", error)
  }

  const mcpDetails = connectedMCPs.map((mcpName) => {
    const toolNames = fallbackByMcp
      ? fallbackByMcp.get(mcpName) || []
      : allTools.filter((t) => t.mcpName === mcpName).map((t) => t.tool.name)

    // Determine which projects this MCP is connected to
    const connectedProjects = projects.filter((p) => {
      if (mcpName === "chrome-devtools") return p.cdpUrl
      if (mcpName === "nextjs-dev") return p.appPort
      return false
    })

    return {
      name: mcpName,
      connected: true,
      toolCount: toolNames.length,
      tools: toolNames,
      projects: connectedProjects.map((p) => p.name)
    }
  })

  return NextResponse.json(
    {
      orchestratorEnabled: true,
      connectedMCPs: connectedMCPs,
      totalConnections: connectedMCPs.length,
      mcpDetails,
      totalProjects: projects.length,
      projects: projects.map((p) => p.name),
      message:
        connectedMCPs.length > 0
          ? `Connected to ${connectedMCPs.length} downstream MCP${connectedMCPs.length > 1 ? "s" : ""} across ${projects.length} project${projects.length !== 1 ? "s" : ""}`
          : "No downstream MCPs connected (waiting for dev3000 to start Chrome/dev server)"
    },
    { headers: { "Cache-Control": "no-store" } }
  )
}

// Infer MCP name from proxied tool name pattern like "chrome-devtools_click"
function inferMcpFromToolName(name: string): string {
  const idx = name.indexOf("_")
  return idx > 0 ? name.slice(0, idx) : "unknown"
}

// Minimal SSE reader that posts MCP JSON-RPC to /mcp and returns first tools list
type MCPListedTool = { name: string; annotations?: { proxiedFrom?: string } }
async function fetchToolsViaMCP(
  endpoint: string,
  timeoutMs = 1200
): Promise<Array<{ name: string; proxiedFrom?: string }> | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const resp = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // mcp-handler requires accepting both JSON and SSE
        Accept: "application/json,text/event-stream"
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
      signal: controller.signal,
      cache: "no-store"
    })

    if (!resp.ok || !resp.body) {
      return null
    }

    const reader = resp.body.getReader()
    const decoder = new TextDecoder()
    let buf = ""

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })

      // Look for first SSE "data:" line containing JSON
      const lines = buf.split(/\r?\n/)
      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const payload = line.slice(6).trim()
          try {
            const obj = JSON.parse(payload)
            const tools: MCPListedTool[] | undefined = obj?.result?.tools
            if (Array.isArray(tools)) {
              // Cancel remaining stream
              try {
                await reader.cancel()
              } catch {
                /* ignore */
              }
              clearTimeout(timer)
              // Extract proxiedFrom annotation when available
              return tools.map((t: MCPListedTool) => ({
                name: String(t.name),
                proxiedFrom: t.annotations?.proxiedFrom
              }))
            }
          } catch {
            // keep reading until we get a parsable JSON line
          }
        }
      }

      // Prevent unbounded buffer growth; keep only the last 8KB
      if (buf.length > 8192) buf = buf.slice(-8192)
    }
  } catch (_e) {
    // swallow – this is a best-effort fallback
  } finally {
    clearTimeout(timer)
  }
  return null
}

// Initialize MCP connection over HTTP transport to ensure tools are registered
async function initializeMCP(endpoint: string, timeoutMs = 1000): Promise<boolean> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const resp = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json,text/event-stream"
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "1.1",
          capabilities: { tools: {}, resources: {}, prompts: {}, logs: {} },
          clientInfo: { name: "orchestrator-self-check", version: "1.0.0" }
        }
      }),
      signal: controller.signal,
      cache: "no-store"
    })
    if (!resp.ok || !resp.body) return false
    const reader = resp.body.getReader()
    const { done } = await reader.read()
    try {
      await reader.cancel()
    } catch {}
    clearTimeout(timer)
    return !done // we received some data event
  } catch {
    // ignore
  } finally {
    clearTimeout(timer)
  }
  return false
}
