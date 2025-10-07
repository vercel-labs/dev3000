import { readFileSync } from "fs"
import { createMcpHandler } from "mcp-handler"
import { z } from "zod"
import {
  createIntegratedWorkflow,
  discoverAvailableMcps,
  executeBrowserAction,
  fixMyApp,
  TOOL_DESCRIPTIONS
} from "./tools"

const handler = createMcpHandler(
  (server) => {
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
          .describe("Return structured data for Claude orchestration instead of formatted text")
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

    // Integrated workflow orchestration tool
    server.tool(
      "create_integrated_workflow",
      TOOL_DESCRIPTIONS.create_integrated_workflow,
      {
        availableMcps: z
          .array(z.string())
          .optional()
          .describe(
            "Array of available MCPs (e.g., ['nextjs-dev', 'chrome-devtools']). If not provided, will auto-discover."
          ),
        focusArea: z.string().optional().describe("Debugging focus area: 'build', 'runtime', 'network', 'ui', 'all'"),
        errorContext: z.string().optional().describe("Known error context to help create targeted workflow")
      },
      async (params) => {
        return createIntegratedWorkflow(params)
      }
    )

    // MCP discovery tool
    server.tool(
      "discover_available_mcps",
      TOOL_DESCRIPTIONS.discover_available_mcps,
      {
        projectName: z.string().optional().describe("Project name to associate with discovery logging")
      },
      async (params) => {
        const discoveredMcps = await discoverAvailableMcps(params.projectName)
        return {
          content: [
            {
              type: "text",
              text: `🔍 **MCP DISCOVERY RESULTS**\n\nDiscovered MCPs: ${discoveredMcps.length > 0 ? discoveredMcps.join(", ") : "none"}\n\n${discoveredMcps.length > 0 ? `✅ Found ${discoveredMcps.length} compatible MCP(s)! These can now be used with create_integrated_workflow for enhanced debugging.` : "⚠️ No MCPs detected. Make sure other MCP servers are running and try again."}\n\n💡 All discovery attempts have been logged to your dev3000 log file with [D3K] tags.`
            }
          ]
        }
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

    // CDP URL discovery tool for chrome-devtools MCP coordination
    server.tool(
      "get_shared_cdp_url",
      "🔗 **CDP URL SHARING** - Get the CDP WebSocket URL for dev3000's existing Chrome instance. Use this to connect chrome-devtools MCP to dev3000's browser instead of launching a new one.",
      {
        projectName: z.string().optional().describe("Project name to get CDP URL for (if multiple dev3000 instances)")
      },
      async (params) => {
        const { findActiveSessions } = await import("./tools")
        const sessions = findActiveSessions()

        if (sessions.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: "❌ No active dev3000 sessions found. Make sure dev3000 is running with browser monitoring."
              }
            ]
          }
        }

        const targetSession = params.projectName
          ? sessions.find((s) => s.projectName === params.projectName)
          : sessions[0]

        if (!targetSession) {
          return {
            content: [
              {
                type: "text",
                text: `❌ No dev3000 session found for project: ${params.projectName}. Available projects: ${sessions.map((s) => s.projectName).join(", ")}`
              }
            ]
          }
        }

        try {
          const sessionData = JSON.parse(readFileSync(targetSession.sessionFile, "utf-8"))
          const cdpUrl = sessionData.cdpUrl

          if (cdpUrl) {
            return {
              content: [
                {
                  type: "text",
                  text: `🔗 **SHARED CDP URL FOUND**\n\nProject: ${targetSession.projectName}\nCDP URL: ${cdpUrl}\n\n💡 **Usage**: Configure chrome-devtools MCP to connect to this URL instead of launching its own browser instance.\n\n🎯 **Coordination**: Both dev3000 and chrome-devtools will now use the same Chrome instance for seamless automation.`
                }
              ]
            }
          } else {
            return {
              content: [
                {
                  type: "text",
                  text: `⚠️ **CDP URL NOT READY**\n\nProject: ${targetSession.projectName}\nStatus: Browser may still be initializing\n\n💡 Try again in a few seconds once dev3000's browser is fully started.`
                }
              ]
            }
          }
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `❌ Error reading session data: ${error instanceof Error ? error.message : String(error)}`
              }
            ]
          }
        }
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
