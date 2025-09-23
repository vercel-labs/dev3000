import { existsSync, readdirSync, readFileSync, statSync } from "fs"
import { createMcpHandler } from "mcp-handler"
import { homedir } from "os"
import { join } from "path"
import { WebSocket } from "ws"
import { z } from "zod"

// Helper to find active dev3000 sessions
function findActiveSessions() {
  const sessionDir = join(homedir(), ".d3k")
  if (!existsSync(sessionDir)) {
    return []
  }

  try {
    const files = readdirSync(sessionDir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => {
        const filePath = join(sessionDir, f)
        const content = JSON.parse(readFileSync(filePath, "utf-8"))
        const stat = statSync(filePath)
        return {
          ...content,
          sessionFile: filePath,
          lastModified: stat.mtime
        }
      })
      .filter((session) => {
        // Only show sessions from the last 24 hours
        const age = Date.now() - new Date(session.startTime).getTime()
        return age < 24 * 60 * 60 * 1000
      })
      .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime())

    return files
  } catch (_error) {
    return []
  }
}

// Helper to get log path - either from env or session
function getLogPath(projectName?: string): string | null {
  // If explicit project name provided, look it up
  if (projectName) {
    const sessions = findActiveSessions()
    const session = sessions.find((s) => s.projectName === projectName)
    if (session && existsSync(session.logFilePath)) {
      return session.logFilePath
    }
  }

  // Fall back to environment variable
  const envPath = process.env.LOG_FILE_PATH
  if (envPath && existsSync(envPath)) {
    return envPath
  }

  // If no project specified and no env var, show available sessions
  return null
}

const handler = createMcpHandler(
  (server) => {
    // Enhanced fix_my_app - the ultimate error fixing tool
    server.tool(
      "fix_my_app",
      "🔧 **THE ULTIMATE FIND→FIX→VERIFY MACHINE!** This tool doesn't just find bugs - it FIXES them! Pure dev3000 magic that identifies issues, provides exact fixes, and verifies everything works! 🪄\n\n🔥 **INSTANT FIXING SUPERPOWERS:**\n• Detects ALL error types: server crashes, browser errors, build failures, API issues, performance problems\n• Provides EXACT fix code with file locations and line numbers\n• Guides you through implementing fixes step-by-step\n• Verifies fixes actually resolve the issues\n\n⚡ **3 ACTION MODES:**\n• FIX NOW: 'What's broken RIGHT NOW?' → Find and fix immediately\n• FIX REGRESSION: 'What broke during testing?' → Compare before/after and fix\n• FIX CONTINUOUSLY: 'Fix issues as they appear' → Monitor and fix proactively\n\n🎪 **THE FIX-IT WORKFLOW:**\n1️⃣ I FIND all issues instantly\n2️⃣ I provide EXACT FIXES with code snippets\n3️⃣ You implement the fixes\n4️⃣ We VERIFY everything works\n\n💡 **PERFECT FOR:** 'fix my app' or 'debug my app' requests, error resolution, code repairs, making broken apps work again. This tool doesn't just identify problems - it SOLVES them!",
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
          .describe("Show timestamp-based debugging instructions for manual workflow (default: true)")
      },
      async ({
        projectName,
        focusArea = "all",
        mode = "snapshot",
        waitForUserInteraction = false,
        timeRangeMinutes = 10,
        includeTimestampInstructions = true
      }) => {
        const logPath = getLogPath(projectName)
        const results: string[] = []
        const currentTimestamp = new Date().toISOString()

        try {
          // If no log path found, show available sessions
          if (!logPath) {
            const sessions = findActiveSessions()
            if (sessions.length === 0) {
              return {
                content: [
                  {
                    type: "text",
                    text: `❌ No active dev3000 sessions found. Make sure dev3000 is running (d3k start).`
                  }
                ]
              }
            }

            // Show available sessions
            const sessionList = sessions
              .map((s) => `• ${s.projectName} (port ${s.appPort}, started ${new Date(s.startTime).toLocaleString()})`)
              .join("\n")

            return {
              content: [
                {
                  type: "text",
                  text: `Multiple dev3000 sessions found. Please specify which project to debug:\n\n${sessionList}\n\nExample: debug_my_app(projectName: "${sessions[0].projectName}")`
                }
              ]
            }
          }

          if (!existsSync(logPath)) {
            return {
              content: [
                {
                  type: "text",
                  text: `❌ Log file not found at ${logPath}. The dev3000 session may have ended.`
                }
              ]
            }
          }

          const logContent = readFileSync(logPath, "utf-8")
          const logLines = logContent.split("\n").filter((line) => line.trim())

          // Handle different debugging modes
          if (mode === "bisect" && waitForUserInteraction) {
            results.push(`🕐 **BISECT MODE ACTIVATED - TIMESTAMP CAPTURED**`)
            results.push(`📍 Start timestamp: ${currentTimestamp}`)
            results.push("")
            results.push("🎯 **NEXT STEPS FOR TIMESTAMP-BASED DEBUGGING:**")
            results.push("1. ✅ I've captured the current timestamp automatically")
            results.push("2. 🧪 Go test/reproduce the issue in your app now")
            results.push("3. 🔍 When you're done testing, run this tool again with waitForUserInteraction=false")
            results.push("4. 📊 I'll automatically analyze all errors that occurred during your testing")
            results.push("")
            results.push("💡 **This eliminates the need for separate timestamp tools!**")
            results.push("🎪 **The magic happens when you return - I'll have everything ready to fix!**")

            return {
              content: [
                {
                  type: "text",
                  text: results.join("\n")
                }
              ]
            }
          }

          // Determine time range for analysis
          const cutoffTime = new Date(Date.now() - timeRangeMinutes * 60 * 1000)

          // For monitor mode, show longer time range
          if (mode === "monitor") {
            results.push(`🔄 **CONTINUOUS MONITORING MODE** (last ${timeRangeMinutes} minutes)`)
          } else {
            results.push(`🔍 **COMPREHENSIVE DEBUG ANALYSIS** (last ${timeRangeMinutes} minutes)`)
          }

          results.push(`📊 Analysis timestamp: ${currentTimestamp}`)
          results.push("")

          // COMPREHENSIVE ERROR DETECTION - combines all previous tools
          const errorPatterns = [
            /ERROR/i,
            /Exception/i,
            /FATAL/i,
            /CRASH/i,
            /Failed to compile/i,
            /Build failed/i,
            /Type error/i,
            /Syntax error/i,
            /Module not found/i,
            /500/,
            /404/,
            /ECONNREFUSED/i,
            /NETWORK.*failed/i,
            /timeout.*error/i,
            /WARN/i,
            /WARNING/i,
            /deprecated/i,
            /slow/i,
            /retry/i
          ]

          // Filter logs by time range (replaces get_logs_between_timestamps)
          const timeFilteredLines = logLines.filter((line) => {
            const timestampMatch = line.match(/\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\]/)
            if (timestampMatch) {
              const logTime = new Date(timestampMatch[1])
              return logTime >= cutoffTime
            }
            return false
          })

          // Extract ALL error types (replaces multiple error detection tools)
          const allErrors = timeFilteredLines.filter((line) => {
            return errorPatterns.some((pattern) => pattern.test(line))
          })

          // Categorize errors for better analysis
          const categorizedErrors = {
            serverErrors: allErrors.filter(
              (line) => line.includes("[SERVER]") && (line.includes("ERROR") || line.includes("Exception"))
            ),
            browserErrors: allErrors.filter(
              (line) => line.includes("[BROWSER]") && (line.includes("ERROR") || line.includes("CONSOLE ERROR"))
            ),
            buildErrors: allErrors.filter(
              (line) =>
                line.includes("Failed to compile") || line.includes("Type error") || line.includes("Build failed")
            ),
            networkErrors: allErrors.filter(
              (line) =>
                line.includes("NETWORK") || line.includes("404") || line.includes("500") || line.includes("timeout")
            ),
            warnings: allErrors.filter(
              (line) => /WARN|WARNING|deprecated/i.test(line) && !/ERROR|Exception|FAIL/i.test(line)
            )
          }

          const totalErrors = allErrors.length
          const criticalErrors = totalErrors - categorizedErrors.warnings.length

          if (totalErrors === 0) {
            results.push(`✅ **SYSTEM HEALTHY** - No errors found in last ${timeRangeMinutes} minutes`)
            results.push("🎯 App appears to be running smoothly!")

            if (includeTimestampInstructions && mode !== "monitor") {
              results.push("")
              results.push("💡 **PROACTIVE MONITORING TIPS:**")
              results.push("• Use mode='bisect' with waitForUserInteraction=true before testing new features")
              results.push("• Use mode='monitor' for continuous background monitoring")
              results.push("• Increase timeRangeMinutes to analyze longer periods")
            }
          } else {
            results.push(
              `🚨 **${totalErrors} ISSUES DETECTED** (${criticalErrors} critical, ${categorizedErrors.warnings.length} warnings)`
            )
            results.push("")

            // Show categorized errors (replaces individual error tools)
            if (categorizedErrors.serverErrors.length > 0) {
              results.push("🔥 **SERVER ERRORS:**")
              results.push(categorizedErrors.serverErrors.slice(-5).join("\n"))
              results.push("")
            }

            if (categorizedErrors.browserErrors.length > 0) {
              results.push("🌐 **BROWSER/CONSOLE ERRORS:**")
              results.push(categorizedErrors.browserErrors.slice(-5).join("\n"))
              results.push("")
            }

            if (categorizedErrors.buildErrors.length > 0) {
              results.push("🔨 **BUILD/COMPILATION ERRORS:**")
              results.push(categorizedErrors.buildErrors.slice(-5).join("\n"))
              results.push("")
            }

            if (categorizedErrors.networkErrors.length > 0) {
              results.push("🌐 **NETWORK/API ERRORS:**")
              results.push(categorizedErrors.networkErrors.slice(-5).join("\n"))
              results.push("")
            }

            if (categorizedErrors.warnings.length > 0 && focusArea === "all") {
              results.push(`⚠️ **WARNINGS** (${categorizedErrors.warnings.length} found, showing recent):`)
              results.push(categorizedErrors.warnings.slice(-3).join("\n"))
              results.push("")
            }

            // Show the magical dev3000 fix workflow
            results.push("🪄 **ULTIMATE DEV3000 FIX-IT MAGIC READY:**")
            results.push("🎯 **I don't just find errors - I FIX them instantly!**")
            results.push("• Analyze error patterns and provide exact fix code")
            results.push("• Guide you through implementing the fixes")
            results.push("• Use execute_browser_action to verify fixes work")
            results.push("• Dev3000 AUTO-CAPTURES screenshots during all interactions!")
            results.push("• No manual screenshots needed - dev3000 handles it all!")
            results.push("")
            results.push("📸 **AUTO-SCREENSHOT MAGIC:**")
            results.push("• Screenshots captured automatically on errors, page loads, scrolls")
            results.push("• Just reproduce the user actions - screenshots happen magically")
            results.push("• Check logs for [SCREENSHOT] entries with filenames")
            results.push("")
            results.push("🚀 **SAY 'FIX THESE ISSUES' TO START THE MAGIC:**")
            results.push("• Critical errors fixed first, then warnings")
            results.push("• Each fix tested with browser interactions (no manual screenshots!)")
            results.push("• Real-time proof that every issue is resolved")
          }

          // Add usage instructions based on mode
          if (includeTimestampInstructions && mode !== "monitor") {
            results.push("")
            results.push("📚 **ADVANCED DEBUGGING MODES:**")
            results.push("• **Snapshot** (current): Immediate comprehensive analysis")
            results.push("• **Bisect**: Use waitForUserInteraction=true for timestamp-based debugging")
            results.push("• **Monitor**: Continuous monitoring mode for ongoing development")
          }

          // Show recent screenshots if any exist
          const screenshotLines = timeFilteredLines.filter((line) => line.includes("[SCREENSHOT]"))
          if (screenshotLines.length > 0) {
            results.push("")
            results.push("📸 **RECENT AUTO-CAPTURED SCREENSHOTS:**")
            const recentScreenshots = screenshotLines.slice(-5)
            recentScreenshots.forEach((line) => {
              const match = line.match(/\[SCREENSHOT\]\s+([^\s]+\.png)/)
              if (match) {
                results.push(`• ${match[1]}`)
              }
            })
            results.push("💡 Tip: Dev3000 captures these automatically during interactions!")
          }

          results.push("")
          results.push(`📁 Full logs: ${logPath}`)
          results.push(`⚡ Quick access: tail -f ${logPath}`)

          if (mode === "monitor") {
            results.push("")
            results.push("🔄 **MONITORING ACTIVE** - Run this tool again to check for new issues")
          }

          return {
            content: [
              {
                type: "text",
                text: results.join("\n")
              }
            ]
          }
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `❌ Error during debug analysis: ${error instanceof Error ? error.message : String(error)}`
              }
            ]
          }
        }
      }
    )

    // Tool to execute browser actions via CDP
    server.tool(
      "execute_browser_action",
      "🎯 **BROWSER INTERACTION TOOL** - For testing user workflows and reproducing issues!\n\n⚡ **KEY STRATEGY:**\n🚨 **NEVER use 'screenshot' action** - dev3000 automatically captures screenshots on:\n• Page loads and navigation\n• Errors and exceptions\n• After scrolling settles\n• Network idle states\n\n✅ **CORRECT USAGE:**\n1. Use click/navigate/scroll/type to reproduce user actions\n2. Dev3000 will AUTOMATICALLY capture screenshots during these actions\n3. Check logs or use debug_my_app to see the auto-captured screenshots\n\n🔥 **AVAILABLE ACTIONS:**\n• **click** → Click buttons/links (requires x,y coordinates)\n• **navigate** → Go to URLs (requires url)\n• **scroll** → Scroll pages (optional deltaX, deltaY)\n• **type** → Type text in forms (requires text)\n• **evaluate** → Read page state with JS (limited safe expressions only)\n\n❌ **DO NOT USE:**\n• **screenshot** → This is for manual capture which dev3000 handles automatically\n\n💡 **BEST PRACTICE WORKFLOW:**\n1. Use debug_my_app to find issues and see existing screenshots\n2. Make code fixes\n3. Use click/navigate/type to reproduce the original user flow\n4. Dev3000 auto-captures new screenshots during your interactions\n5. Use debug_my_app again to verify fixes worked\n\n🎪 **WHY THIS WORKS BETTER:**\n• Screenshots are captured at optimal times automatically\n• You focus on reproducing user actions, not timing screenshots\n• Dev3000 handles all the screenshot complexity for you\n\n🛡️ **SAFETY:** Only safe operations allowed, whitelisted JavaScript expressions",
      {
        action: z.enum(["click", "navigate", "screenshot", "evaluate", "scroll", "type"]).describe("Action to perform"),
        params: z
          .object({
            x: z.number().optional().describe("X coordinate for click/scroll"),
            y: z.number().optional().describe("Y coordinate for click/scroll"),
            url: z.string().optional().describe("URL for navigation"),
            selector: z.string().optional().describe("CSS selector for element targeting"),
            text: z.string().optional().describe("Text to type"),
            expression: z.string().optional().describe("JavaScript expression to evaluate (safe expressions only)"),
            deltaX: z.number().optional().describe("Horizontal scroll amount"),
            deltaY: z.number().optional().describe("Vertical scroll amount")
          })
          .describe("Parameters for the action")
      },
      async ({ action, params }) => {
        try {
          // Connect to CDP on port 9222
          const targetsResponse = await fetch("http://localhost:9222/json")
          const targets = await targetsResponse.json()

          const pageTarget = targets.find(
            (target: { type: string; webSocketDebuggerUrl: string }) => target.type === "page"
          )
          if (!pageTarget) {
            throw new Error("No browser tab found. Make sure dev3000 is running with CDP monitoring.")
          }

          const wsUrl = pageTarget.webSocketDebuggerUrl

          const result = await new Promise((resolve, reject) => {
            // WebSocket imported at top of file
            const ws = new WebSocket(wsUrl)
            let messageId = 1

            ws.on("open", async () => {
              try {
                let cdpResult: Record<string, unknown>

                switch (action) {
                  case "click":
                    if (!params.x || !params.y) {
                      throw new Error("Click action requires x and y coordinates")
                    }
                    // Send mouse down and up events
                    await sendCDPCommand(ws, messageId++, "Input.dispatchMouseEvent", {
                      type: "mousePressed",
                      x: params.x,
                      y: params.y,
                      button: "left",
                      clickCount: 1
                    })
                    await sendCDPCommand(ws, messageId++, "Input.dispatchMouseEvent", {
                      type: "mouseReleased",
                      x: params.x,
                      y: params.y,
                      button: "left",
                      clickCount: 1
                    })
                    cdpResult = {
                      action: "click",
                      coordinates: { x: params.x, y: params.y }
                    }
                    break

                  case "navigate":
                    if (!params.url) {
                      throw new Error("Navigate action requires url parameter")
                    }
                    // Basic URL validation
                    if (!params.url.startsWith("http://") && !params.url.startsWith("https://")) {
                      throw new Error("Only http:// and https:// URLs are allowed")
                    }
                    cdpResult = await sendCDPCommand(ws, messageId++, "Page.navigate", { url: params.url })
                    break

                  case "screenshot":
                    // Discourage manual screenshots - dev3000 handles this automatically
                    ws.close()
                    resolve({
                      warning: "Screenshot action is not recommended!",
                      advice:
                        "Dev3000 automatically captures screenshots during interactions. Instead of manual screenshots, use click/navigate/scroll/type actions to reproduce user workflows, and dev3000 will capture screenshots at optimal times.",
                      suggestion: "Run fix_my_app to see all auto-captured screenshots from your session."
                    })
                    return

                  case "evaluate": {
                    if (!params.expression) {
                      throw new Error("Evaluate action requires expression parameter")
                    }
                    // Whitelist safe expressions only
                    const safeExpressions = [
                      /^document\.title$/,
                      /^window\.location\.href$/,
                      /^document\.querySelector\(['"][^'"]*['"]\)\.textContent$/,
                      /^document\.body\.scrollHeight$/,
                      /^window\.scrollY$/,
                      /^window\.scrollX$/
                    ]

                    if (!params.expression) {
                      throw new Error("Evaluate action requires expression parameter")
                    }

                    if (!safeExpressions.some((regex) => regex.test(params.expression as string))) {
                      throw new Error("Expression not in whitelist. Only safe read-only expressions allowed.")
                    }

                    cdpResult = await sendCDPCommand(ws, messageId++, "Runtime.evaluate", {
                      expression: params.expression,
                      returnByValue: true
                    })
                    break
                  }

                  case "scroll": {
                    const scrollX = params.deltaX || 0
                    const scrollY = params.deltaY || 0
                    cdpResult = await sendCDPCommand(ws, messageId++, "Input.dispatchMouseEvent", {
                      type: "mouseWheel",
                      x: params.x || 500,
                      y: params.y || 500,
                      deltaX: scrollX,
                      deltaY: scrollY
                    })
                    break
                  }

                  case "type":
                    if (!params.text) {
                      throw new Error("Type action requires text parameter")
                    }
                    // Type each character
                    for (const char of params.text) {
                      await sendCDPCommand(ws, messageId++, "Input.dispatchKeyEvent", {
                        type: "char",
                        text: char
                      })
                    }
                    cdpResult = { action: "type", text: params.text }
                    break

                  default:
                    throw new Error(`Unsupported action: ${action}`)
                }

                ws.close()
                resolve(cdpResult)
              } catch (error) {
                ws.close()
                reject(error)
              }
            })

            ws.on("error", reject)

            // Helper function to send CDP commands
            async function sendCDPCommand(
              ws: WebSocket,
              id: number,
              method: string,
              params: Record<string, unknown>
            ): Promise<Record<string, unknown>> {
              return new Promise((cmdResolve, cmdReject) => {
                const command = { id, method, params }

                const messageHandler = (data: Buffer) => {
                  const message = JSON.parse(data.toString())
                  if (message.id === id) {
                    ws.removeListener("message", messageHandler)
                    if (message.error) {
                      cmdReject(new Error(message.error.message))
                    } else {
                      cmdResolve(message.result)
                    }
                  }
                }

                ws.on("message", messageHandler)
                ws.send(JSON.stringify(command))

                // Command timeout
                setTimeout(() => {
                  ws.removeListener("message", messageHandler)
                  cmdReject(new Error(`CDP command timeout: ${method}`))
                }, 5000)
              })
            }
          })

          return {
            content: [
              {
                type: "text",
                text: `Browser action '${action}' executed successfully. Result: ${JSON.stringify(result, null, 2)}`
              }
            ]
          }
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Browser action failed: ${error instanceof Error ? error.message : String(error)}`
              }
            ]
          }
        }
      }
    )

    // Tool that returns monitoring code for Claude to execute
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
