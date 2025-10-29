import { execSync } from "node:child_process"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import type { Tool } from "@modelcontextprotocol/sdk/types.js"
import { createMcpHandler } from "mcp-handler"
import { z } from "zod"
import { getMCPClientManager } from "./client-manager"
import {
  crawlApp,
  executeBrowserAction,
  findComponentSource,
  fixMyApp,
  restartDevServer,
  TOOL_DESCRIPTIONS
} from "./tools"

// Detect available package runner (bunx only, per request)
const getPackageRunner = (): { command: string; args: string[] } | null => {
  try {
    execSync("bunx --version", { stdio: "ignore" })
    return { command: "bunx", args: [] }
  } catch {
    console.error(
      "[MCP Orchestrator] bunx not found. Please install Bun (https://bun.sh/) so we can spawn downstream MCP servers."
    )
    return null
  }
}

// Initialize MCP client manager for orchestration
// This will spawn and connect to chrome-devtools and next-devtools-mcp as stdio processes
const initializeOrchestration = async () => {
  const clientManager = getMCPClientManager()

  // Helper to get config from session files in ~/.d3k/
  const getConfigFromSessions = () => {
    const config: Parameters<typeof clientManager.initialize>[0] = {}
    const sessionDir = join(homedir(), ".d3k")

    try {
      // Read all *.json session files
      if (!existsSync(sessionDir)) return config

      const sessionFiles = readdirSync(sessionDir).filter((f: string) => f.endsWith(".json"))

      // Use the most recent session with CDP URL
      for (const file of sessionFiles) {
        try {
          const sessionPath = join(sessionDir, file)
          const sessionData = JSON.parse(readFileSync(sessionPath, "utf-8"))

          // Configure chrome-devtools MCP if CDP URL is available
          if (sessionData.cdpUrl && !config.chromeDevtools) {
            const cdpUrl = sessionData.cdpUrl.replace("ws://", "http://") // Convert ws:// to http:// for browser URL
            const runner = getPackageRunner()

            if (runner) {
              config.chromeDevtools = {
                command: runner.command,
                args: [...runner.args, "chrome-devtools-mcp@latest", "--browserUrl", cdpUrl],
                enabled: true
              }
            } else {
              console.warn("[MCP Orchestrator] Cannot configure chrome-devtools MCP: no package runner available")
            }
          }

          // Break early if we have chrome-devtools - only need one session for CDP URL
          if (config.chromeDevtools) break
        } catch {
          // Skip invalid session files
        }
      }
    } catch (error) {
      console.warn("[MCP Orchestrator] Failed to read session files:", error)
    }

    // Configure framework-specific MCPs based on detected framework
    // Read framework from session data
    if (!config.nextjsDev && !config.svelteDev) {
      const runner = getPackageRunner()

      // Try to find framework from any session file
      let framework: string | null = null
      try {
        const sessionFiles = readdirSync(sessionDir).filter((f: string) => f.endsWith(".json"))
        for (const file of sessionFiles) {
          try {
            const sessionPath = join(sessionDir, file)
            const sessionData = JSON.parse(readFileSync(sessionPath, "utf-8"))
            if (sessionData.framework) {
              framework = sessionData.framework
              break
            }
          } catch {
            // Skip invalid session files
          }
        }
      } catch {
        // Ignore errors reading framework
      }

      if (runner) {
        // Configure framework-specific MCP based on detected framework
        if (framework === "nextjs") {
          config.nextjsDev = {
            command: runner.command,
            args: [...runner.args, "next-devtools-mcp@latest"],
            enabled: true
          }
          console.log("[MCP Orchestrator] Detected Next.js framework, configuring next-devtools-mcp")
        } else if (framework === "svelte") {
          config.svelteDev = {
            command: runner.command,
            args: [...runner.args, "@sveltejs/mcp-server-svelte"],
            enabled: true
          }
          console.log("[MCP Orchestrator] Detected Svelte framework, configuring @sveltejs/mcp-server-svelte")
        }
        // For "other" or null framework, don't configure any framework-specific MCP
      } else {
        console.warn("[MCP Orchestrator] Cannot configure framework MCP: no package runner available")
      }
    }

    return config
  }

  const waitForInitialConfig = async (
    timeoutMs: number = 10000,
    pollIntervalMs: number = 250
  ): Promise<{ config: Parameters<typeof clientManager.initialize>[0]; waited: boolean }> => {
    const startTime = Date.now()
    let waited = false
    let config = getConfigFromSessions()

    while (Object.keys(config).length === 0 && Date.now() - startTime < timeoutMs) {
      if (!waited) {
        console.log("[MCP Orchestrator] Waiting for session info before connecting downstream MCPs...")
        waited = true
      }

      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
      config = getConfigFromSessions()
    }

    return { config, waited }
  }

  try {
    // Initial attempt to connect
    const { config, waited } = await waitForInitialConfig()
    if (Object.keys(config).length > 0) {
      await clientManager.initialize(config)
      console.log(`[MCP Orchestrator] Initialized with ${Object.keys(config).join(", ")}`)
    } else {
      if (waited) {
        console.log("[MCP Orchestrator] No downstream MCPs detected after waiting for session info (will retry)")
      } else {
        console.log("[MCP Orchestrator] No downstream MCPs found yet (will retry)")
      }
    }

    // Since MCP server starts before Chrome, periodically retry connection
    // This allows late-binding to chrome-devtools MCP after Chrome launches
    let retryCount = 0
    const maxRetries = 10
    const retryInterval = setInterval(async () => {
      retryCount++

      const newConfig = getConfigFromSessions()
      const hasChromeDevtools = !!newConfig.chromeDevtools
      const hasNextjs = !!newConfig.nextjsDev
      const hasSvelte = !!newConfig.svelteDev
      const alreadyConnectedChrome = clientManager.isConnected("chrome-devtools")
      const alreadyConnectedNextjs = clientManager.isConnected("nextjs-dev")
      const alreadyConnectedSvelte = clientManager.isConnected("svelte-dev")

      // Check if we have new MCPs to connect to
      const needsChrome = hasChromeDevtools && !alreadyConnectedChrome
      const needsNextjs = hasNextjs && !alreadyConnectedNextjs
      const needsSvelte = hasSvelte && !alreadyConnectedSvelte

      if (needsChrome || needsNextjs || needsSvelte) {
        const toConnect = [
          needsChrome && "chrome-devtools",
          needsNextjs && "nextjs-dev",
          needsSvelte && "svelte-dev"
        ].filter(Boolean)
        console.log(`[MCP Orchestrator] Retry ${retryCount}: Attempting to connect to ${toConnect.join(", ")}`)
        try {
          await clientManager.initialize(newConfig)
          console.log("[MCP Orchestrator] Successfully connected to downstream MCPs")
        } catch (error) {
          console.warn(`[MCP Orchestrator] Retry ${retryCount} failed:`, error)
        }
      }

      // Stop retrying after max attempts or when all potential MCPs are connected
      const allFrameworkMcpsConnected =
        (hasNextjs ? alreadyConnectedNextjs : true) && (hasSvelte ? alreadyConnectedSvelte : true)
      if (retryCount >= maxRetries || (alreadyConnectedChrome && allFrameworkMcpsConnected)) {
        clearInterval(retryInterval)
        const connected = clientManager.getConnectedMCPs()
        console.log(`[MCP Orchestrator] Stopped retry loop (connected: ${connected.join(", ") || "none"})`)
      }
    }, 2000) // Retry every 2 seconds
  } catch (error) {
    console.warn("[MCP Orchestrator] Failed to initialize downstream MCPs:", error)
  }
}

// Initialize on module load
const orchestrationReady = initializeOrchestration().catch((error) => {
  console.error("[MCP Orchestrator] Failed to initialize downstream MCPs:", error)
})

// Cleanup on shutdown
process.on("SIGTERM", async () => {
  console.log("[MCP Orchestrator] Received SIGTERM, cleaning up...")
  try {
    await getMCPClientManager().disconnect()
    console.log("[MCP Orchestrator] Cleanup complete")
  } catch (error) {
    console.error("[MCP Orchestrator] Error during cleanup:", error)
  }
  process.exit(0)
})

process.on("SIGINT", async () => {
  console.log("[MCP Orchestrator] Received SIGINT, cleaning up...")
  try {
    await getMCPClientManager().disconnect()
    console.log("[MCP Orchestrator] Cleanup complete")
  } catch (error) {
    console.error("[MCP Orchestrator] Error during cleanup:", error)
  }
  process.exit(0)
})

const handler = createMcpHandler(
  async (server) => {
    const clientManager = getMCPClientManager()

    await orchestrationReady
    await clientManager.waitForInitialTools()

    const registeredProxiedTools = new Map<
      string,
      {
        mcpName: string
        toolName: string
        registered: ReturnType<typeof server.tool>
      }
    >()

    const registerOrUpdateProxiedTool = (mcpName: string, tool: Tool): boolean => {
      const proxiedToolName = `${mcpName}_${tool.name}`
      const existing = registeredProxiedTools.get(proxiedToolName)
      const description = `[${mcpName}] ${tool.description || ""}`
      const annotations = {
        ...(tool.annotations ?? {}),
        proxiedFrom: mcpName,
        originalInputSchema: tool.inputSchema
      }

      if (existing) {
        existing.registered.update({
          description,
          annotations
        })
        return false
      }

      try {
        const proxiedTool = server.tool(proxiedToolName, description, {}, async (params: Record<string, unknown>) => {
          return clientManager.callTool(mcpName, tool.name, params)
        })

        // Allow arbitrary argument objects to pass through to downstream MCPs
        proxiedTool.inputSchema = z.object({}).passthrough()

        proxiedTool.update({
          annotations
        })

        registeredProxiedTools.set(proxiedToolName, {
          mcpName,
          toolName: tool.name,
          registered: proxiedTool
        })

        console.log(`[MCP Orchestrator] Registered proxied tool ${proxiedToolName}`)
        return true
      } catch (error) {
        console.warn(`[MCP Orchestrator] Failed to register proxied tool ${proxiedToolName}:`, error)
        return false
      }
    }

    const removeToolsForMcp = (mcpName: string): number => {
      let removed = 0
      for (const [proxiedToolName, entry] of registeredProxiedTools.entries()) {
        if (entry.mcpName === mcpName) {
          try {
            entry.registered.remove()
            registeredProxiedTools.delete(proxiedToolName)
            removed++
            console.log(`[MCP Orchestrator] Removed proxied tool ${proxiedToolName}`)
          } catch (error) {
            console.warn(`[MCP Orchestrator] Failed to remove proxied tool ${proxiedToolName}:`, error)
          }
        }
      }
      return removed
    }

    // Dynamically register proxied tools from downstream MCPs
    const downstreamTools = clientManager.getAllTools()

    if (downstreamTools.length === 0) {
      console.log("[MCP Orchestrator] No downstream MCP tools available during initial registration")
    } else {
      console.log(`[MCP Orchestrator] Registering ${downstreamTools.length} downstream MCP tools`)
    }

    let initialNewTools = 0
    for (const { mcpName, tool } of downstreamTools) {
      if (registerOrUpdateProxiedTool(mcpName, tool)) {
        initialNewTools++
      }
    }

    if (initialNewTools > 0) {
      server.sendToolListChanged()
    }

    clientManager.onToolsUpdated(({ mcpName, tools }) => {
      if (tools.length === 0) {
        const removed = removeToolsForMcp(mcpName)
        if (removed > 0) {
          server.sendToolListChanged()
        }
        return
      }

      let addedOrUpdated = 0
      for (const tool of tools) {
        if (registerOrUpdateProxiedTool(mcpName, tool)) {
          addedOrUpdated++
        }
      }

      if (addedOrUpdated > 0) {
        server.sendToolListChanged()
      }
    })

    // Dev3000's own tools below:
    // Enhanced fix_my_app - the ultimate error fixing tool
    server.tool(
      "fix_my_app",
      TOOL_DESCRIPTIONS.fix_my_app,
      {
        projectName: z
          .string()
          .optional()
          .describe("Project name to debug (if multiple dev3000 instances are running)"),
        focusArea: z
          .string()
          .optional()
          .describe("Specific area: 'build', 'runtime', 'network', 'ui', 'all' (default: 'all')"),
        mode: z
          .enum(["snapshot", "bisect", "monitor"])
          .optional()
          .describe("Fix mode: 'snapshot' (fix now), 'bisect' (fix regression), 'monitor' (fix continuously)"),
        waitForUserInteraction: z
          .boolean()
          .optional()
          .describe("In bisect mode: capture timestamp, wait for user testing, then analyze (default: false)"),
        timeRangeMinutes: z.number().optional().describe("Minutes to analyze back from now (default: 10)"),
        includeTimestampInstructions: z
          .boolean()
          .optional()
          .describe("Show timestamp-based debugging instructions for manual workflow (default: true)"),
        integrateNextjs: z
          .boolean()
          .optional()
          .describe("Auto-detected based on available MCPs - enables Next.js-specific analysis"),
        integrateChromeDevtools: z
          .boolean()
          .optional()
          .describe("Auto-detected based on available MCPs - enables Chrome DevTools integration"),
        returnRawData: z
          .boolean()
          .optional()
          .describe("Return structured data for Claude orchestration instead of formatted text"),
        createPR: z.boolean().optional().describe("Create a PR for the highest priority issue (default: false)")
      },
      async (params) => {
        return fixMyApp(params)
      }
    )

    // Alias: fix_my_jank -> fix_my_app with performance focus
    server.tool(
      "fix_my_jank",
      "🎯 **JANK & PERFORMANCE FIXER** - Specialized alias for detecting and fixing layout shifts, CLS issues, and performance problems. Automatically focuses on performance analysis and jank detection from passive screencast captures.\n\n💡 This is an alias for fix_my_app with focusArea='performance', perfect for 'fix my jank' or 'why is my page janky' requests!",
      {
        projectName: z
          .string()
          .optional()
          .describe("Project name to debug (if multiple dev3000 instances are running)"),
        timeRangeMinutes: z.number().optional().describe("Minutes to analyze back from now (default: 10)")
      },
      async (params) => {
        // Call fix_my_app with performance focus
        return fixMyApp({
          ...params,
          focusArea: "performance"
        })
      }
    )

    // Browser interaction tool
    server.tool(
      "execute_browser_action",
      TOOL_DESCRIPTIONS.execute_browser_action,
      {
        action: z
          .enum(["click", "navigate", "screenshot", "evaluate", "scroll", "type"])
          .describe("The browser action to perform"),
        params: z
          .record(z.unknown())
          .optional()
          .describe("Parameters for the action (e.g., {x: 100, y: 200} for click, {url: 'https://...'} for navigate)")
      },
      async (params) => {
        return executeBrowserAction(params)
      }
    )

    // Visual diff analysis tool
    server.tool(
      "analyze_visual_diff",
      "🔍 **VISUAL DIFF ANALYZER** - Analyzes two screenshots and provides a verbal description of the visual differences. Perfect for understanding what changed between before/after frames in layout shift detection.\n\n💡 This tool loads both images and describes what elements appeared, moved, or changed that could have caused the layout shift.",
      {
        beforeImageUrl: z.string().describe("URL of the 'before' screenshot"),
        afterImageUrl: z.string().describe("URL of the 'after' screenshot"),
        context: z
          .string()
          .optional()
          .describe("Optional context about what to look for (e.g., 'navigation header shift')")
      },
      async (params) => {
        const { analyzeVisualDiff } = await import("./tools")
        return analyzeVisualDiff(params)
      }
    )

    // Component source finder tool
    server.tool(
      "find_component_source",
      TOOL_DESCRIPTIONS.find_component_source,
      {
        selector: z
          .string()
          .describe("CSS selector for the DOM element (e.g., 'nav', '.header', '#main'). Use lowercase for tag names."),
        projectName: z.string().optional().describe("Project name (if multiple dev3000 instances are running)")
      },
      async (params) => {
        return findComponentSource(params)
      }
    )

    // Dev server restart tool
    server.tool(
      "restart_dev_server",
      TOOL_DESCRIPTIONS.restart_dev_server,
      {
        projectName: z.string().optional().describe("Project name (if multiple dev3000 instances are running)")
      },
      async (params) => {
        return restartDevServer(params)
      }
    )

    // App crawler tool
    server.tool(
      "crawl_app",
      TOOL_DESCRIPTIONS.crawl_app,
      {
        depth: z
          .union([z.number().int().min(1), z.literal("all")])
          .optional()
          .describe(
            "Crawl depth: number (1=homepage only, 2=homepage+next level, etc.) or 'all' for exhaustive (default: 1)"
          ),
        projectName: z.string().optional().describe("Project name (if multiple dev3000 instances are running)")
      },
      async (params) => {
        return crawlApp(params)
      }
    )

    // Tool that returns monitoring code for Claude to execute
    // TODO: Commenting out for now - need to figure out the right approach for proactive monitoring
    /*
    server.tool(
      "start_error_monitoring",
      "🔍 **SIMPLE ERROR MONITORING** - Starts a lightweight background process that watches your app for errors and alerts you in real-time.\n\n⚡ **INSTANT ACTION:**\n• Claude will offer to run the monitoring script right away\n• No manual setup needed - just say yes!\n• Simple 15-line Python script\n• Alerts when errors appear in logs\n\n💡 **WHAT IT DOES:**\n• Watches for ERROR, FAIL, Exception, TypeError, CRASH keywords\n• Shows the error line when detected\n• Prompts you to let Claude debug\n• That's it - simple and effective!\n\n🎯 **PERFECT FOR:**\n• Quick error detection during development\n• Lightweight background monitoring\n• No complex features - just works",
      {
        projectName: z
          .string()
          .optional()
          .describe("Project name to monitor (if multiple dev3000 instances are running)")
      },
      async ({ projectName }) => {
        try {
          const logPath = getLogPath(projectName)
          if (!logPath) {
            const sessions = findActiveSessions()
            if (sessions.length === 0) {
              return {
                content: [
                  {
                    type: "text",
                    text: "❌ No active dev3000 sessions found. Make sure dev3000 is running!"
                  }
                ]
              }
            }

            return {
              content: [
                {
                  type: "text",
                  text: `🔍 Multiple sessions found. Please specify projectName:\n${sessions
                    .map((s) => `• ${s.projectName} (started ${new Date(s.startTime).toLocaleString()})`)
                    .join("\n")}`
                }
              ]
            }
          }

          // Return simple Python monitoring code
          const monitoringCode = `import time

log_file = "${logPath}"
pos = 0

print("🔍 Monitoring:", log_file)
print("Press Ctrl+C to stop\\n")

while True:
    with open(log_file, 'r') as f:
        f.seek(pos)
        new = f.read()
        pos = f.tell()
    
    for line in new.split('\\n'):
        if any(err in line for err in ['ERROR', 'FAIL', 'Exception', 'TypeError', 'CRASH']):
            print(f"\\n🚨 ERROR DETECTED:\\n{line[:200]}\\n")
            print("💡 Tell me: 'fix my app' or 'debug my app' to fix this!\\n")
    
    time.sleep(2)
`

          return {
            content: [
              {
                type: "text",
                text: `I'm ready to monitor your app for errors. I'll watch ${logPath} and alert you when errors occur.

Should I start monitoring now?`
              },
              {
                type: "text",
                text: `\`\`\`python
${monitoringCode}
\`\`\``
              }
            ]
          }
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Error setting up monitoring: ${error instanceof Error ? error.message : String(error)}`
              }
            ]
          }
        }
      }
    )
    */
  },
  {
    // dev3000 MCP Server - Advanced development debugging tools
    // Provides AI tools with comprehensive access to real-time development logs,
    // browser monitoring data, and timestamp-based debugging workflows
  },
  {
    basePath: "/",
    maxDuration: 60,
    verboseLogs: true
  }
)

export { handler as GET, handler as POST }
