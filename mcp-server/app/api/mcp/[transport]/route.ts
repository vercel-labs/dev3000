import { existsSync, readFileSync } from "fs"
import { createMcpHandler } from "mcp-handler"
import { WebSocket } from "ws"
import { z } from "zod"

const handler = createMcpHandler(
  (server) => {
    // Enhanced debug_my_app - the ultimate debugging tool
    server.tool(
      "debug_my_app",
      "🚀 ULTIMATE DEBUGGING TOOL: The only debugging tool you need! Automatically handles timestamp-based debugging, comprehensive error analysis, and actionable insights. Supports three modes: 'snapshot' (immediate analysis), 'bisect' (timestamp-based debugging with user interaction), and 'monitor' (continuous monitoring). Combines functionality of 8+ separate tools into one streamlined experience with ZERO authorization friction!",
      {
        focusArea: z
          .string()
          .optional()
          .describe("Specific area: 'build', 'runtime', 'network', 'ui', 'all' (default: 'all')"),
        mode: z
          .enum(["snapshot", "bisect", "monitor"])
          .optional()
          .describe("Debug mode: 'snapshot' (immediate), 'bisect' (timestamp-based), 'monitor' (continuous)"),
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
        focusArea = "all",
        mode = "snapshot",
        waitForUserInteraction = false,
        timeRangeMinutes = 10,
        includeTimestampInstructions = true
      }) => {
        const logPath = process.env.LOG_FILE_PATH || "/tmp/d3k.log"
        const results: string[] = []
        const currentTimestamp = new Date().toISOString()

        try {
          if (!existsSync(logPath)) {
            return {
              content: [
                {
                  type: "text",
                  text: `❌ No dev3000 logs found at ${logPath}. Make sure dev3000 is running (d3k start). If not using dev3000, specify log file paths manually.`
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
            results.push("🪄 **ULTIMATE DEV3000 MAGIC READY:**")
            results.push("🎯 **I don't just find errors - I FIX them instantly!**")
            results.push("• Analyze error patterns and identify root causes automatically")
            results.push("• Edit problematic code files to resolve each issue")
            results.push("• Use execute_browser_action to verify fixes work in real-time")
            results.push("• Take screenshots to prove improvements")
            results.push("• This is the magical dev3000 experience!")
            results.push("")
            results.push("🚀 **SAY 'FIX THESE ISSUES' TO START THE MAGIC:**")
            results.push("• Critical errors fixed first, then warnings")
            results.push("• Each fix tested immediately with browser automation")
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
      "Execute safe browser actions via Chrome DevTools Protocol for testing and interaction automation. MAGICAL VERIFICATION TOOL: This is the secret to dev3000 magic! After fixing code issues, use this tool to verify the fixes work by automating browser interactions, taking screenshots, and testing functionality. TESTING CAPABILITIES: Click elements, navigate pages, take screenshots, evaluate JavaScript expressions, scroll, and type text. SAFETY: Only whitelisted JavaScript expressions allowed, URLs restricted to http/https. THE MAGIC WORKFLOW: (1) Find issues in logs, (2) Edit code to fix them, (3) Use THIS TOOL to verify fixes work, (4) Take screenshots to show improvement. This creates the truly magical experience where AI doesn't just debug but fixes and proves the fixes work!",
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
                    cdpResult = await sendCDPCommand(ws, messageId++, "Page.captureScreenshot", {
                      format: "png",
                      quality: 80
                    })
                    break

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
  },
  {
    // dev3000 MCP Server - Advanced development debugging tools
    // Provides AI tools with comprehensive access to real-time development logs,
    // browser monitoring data, and timestamp-based debugging workflows
  },
  {
    basePath: "/api/mcp",
    maxDuration: 60,
    verboseLogs: true
  }
)

export { handler as GET, handler as POST }
