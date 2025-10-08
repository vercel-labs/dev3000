import { existsSync, readdirSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { NextResponse } from "next/server"
import { getMCPClientManager } from "@/app/mcp/client-manager"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  const clientManager = getMCPClientManager()
  const connectedMCPs = clientManager.getConnectedMCPs()
  const allTools = clientManager.getAllTools()

  // Read session files to get project info
  const sessionDir = join(homedir(), ".d3k")
  const projects: Array<{ name: string; cdpUrl?: string; appPort?: number }> = []

  try {
    if (existsSync(sessionDir)) {
      const sessionFiles = readdirSync(sessionDir).filter((f) => f.endsWith(".json"))

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
        } catch {
          // Skip invalid session files
        }
      }
    }
  } catch (error) {
    console.error("[Orchestrator API] Failed to read session files:", error)
  }

  const mcpDetails = connectedMCPs.map((mcpName) => {
    const tools = allTools.filter((t) => t.mcpName === mcpName)

    // Determine which projects this MCP is connected to
    const connectedProjects = projects.filter((p) => {
      if (mcpName === "chrome-devtools") return p.cdpUrl
      if (mcpName === "nextjs-dev") return p.appPort
      return false
    })

    return {
      name: mcpName,
      connected: true,
      toolCount: tools.length,
      tools: tools.map((t) => t.tool.name),
      projects: connectedProjects.map((p) => p.name)
    }
  })

  return NextResponse.json({
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
  })
}
