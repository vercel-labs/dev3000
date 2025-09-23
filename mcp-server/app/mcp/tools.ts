import { existsSync, readdirSync, readFileSync, statSync } from "fs"
import { homedir } from "os"
import { join } from "path"
import { WebSocket } from "ws"

// Types
export interface Session {
  projectName: string
  startTime: string
  logFilePath: string
  sessionFile: string
  lastModified: Date
}

export interface FixMyAppParams {
  projectName?: string
  focusArea?: string
  mode?: "snapshot" | "bisect" | "monitor"
  waitForUserInteraction?: boolean
  timeRangeMinutes?: number
  includeTimestampInstructions?: boolean
}

export interface ExecuteBrowserActionParams {
  action: string
  params?: Record<string, unknown>
}

// Helper functions
export function findActiveSessions(): Session[] {
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

export function getLogPath(projectName?: string): string | null {
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

// Main tool implementations
export async function fixMyApp({
  projectName,
  focusArea = "all",
  mode = "snapshot",
  waitForUserInteraction = false,
  timeRangeMinutes = 10,
  includeTimestampInstructions = true
}: FixMyAppParams): Promise<{ content: Array<{ type: string; text: string }> }> {
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

    const sessionList = sessions
      .map((s) => `• ${s.projectName} (started ${new Date(s.startTime).toLocaleString()})`)
      .join("\n")

    return {
      content: [
        {
          type: "text",
          text: `🔍 Multiple dev3000 sessions detected. Please specify which project to fix:\n${sessionList}\n\n💡 Use: projectName: "your-project-name" parameter`
        }
      ]
    }
  }

  const results: string[] = []

  // Mode-specific handling
  if (mode === "bisect" && waitForUserInteraction) {
    const startTime = new Date().toISOString()
    results.push("🕐 **TIMESTAMP BISECT MODE ACTIVATED**")
    results.push(`📍 Start Time: ${startTime}`)
    results.push("")
    results.push("🎯 **NOW INTERACT WITH YOUR APP TO REPRODUCE THE ISSUE!**")
    results.push("• Click buttons, navigate, submit forms, etc.")
    results.push("• Reproduce the exact error scenario")
    results.push("• When done, run this tool again WITHOUT waitForUserInteraction")
    results.push("")
    results.push("💡 I'll analyze everything that happens between these timestamps!")

    return {
      content: [{ type: "text", text: results.join("\n") }]
    }
  }

  try {
    const content = readFileSync(logPath, "utf-8")
    const logLines = content.trim().split("\n").filter(Boolean)

    if (logLines.length === 0) {
      results.push("📋 Log file is empty. Make sure your app is running and generating logs.")
      return {
        content: [{ type: "text", text: results.join("\n") }]
      }
    }

    results.push(`🔍 **FIX MY APP ANALYSIS** - Mode: ${mode.toUpperCase()}`)
    results.push(`📁 Log file: ${logPath}`)
    results.push(`📊 Total log entries: ${logLines.length}`)
    results.push("")

    // Time-based filtering
    const now = new Date()
    const cutoffTime = new Date(now.getTime() - timeRangeMinutes * 60 * 1000)

    // Comprehensive error patterns
    const errorPatterns = [
      /ERROR/i,
      /FAIL/i,
      /Exception/i,
      /CRITICAL/i,
      /FATAL/i,
      /crashed/i,
      /undefined/i,
      /null reference/i,
      /cannot read/i,
      /cannot find/i,
      /not found/i,
      /timeout/i,
      /refused/i,
      /denied/i,
      /unauthorized/i,
      /404/,
      /500/,
      /503/,
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
        (line) => line.includes("Failed to compile") || line.includes("Type error") || line.includes("Build failed")
      ),
      networkErrors: allErrors.filter(
        (line) => line.includes("NETWORK") || line.includes("404") || line.includes("500") || line.includes("timeout")
      ),
      warnings: allErrors.filter((line) => /WARN|WARNING|deprecated/i.test(line) && !/ERROR|Exception|FAIL/i.test(line))
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
      results.push("• Screenshots captured on EVERY page navigation")
      results.push("• Screenshots captured on EVERY error/exception")
      results.push("• Screenshots captured on manual triggers")
      results.push("• All screenshots timestamped and linked to events!")
    }

    // Extract screenshot information (replaces get_recent_screenshots)
    const screenshotLines = logLines.filter(
      (line) => line.includes("[SCREENSHOT]") || line.includes("Screenshot captured")
    )
    if (screenshotLines.length > 0) {
      results.push("")
      results.push(`📸 **SCREENSHOTS CAPTURED** (${screenshotLines.length} total):`)
      screenshotLines.slice(-5).forEach((line) => {
        const match = line.match(/Screenshot captured: (.+)$/)
        if (match) {
          results.push(`• ${match[1]}`)
        }
      })
    }

    // Performance insights (if no errors but looking at performance)
    if (totalErrors === 0 && focusArea === "all") {
      const performanceLines = logLines.filter((line) => line.includes("took") && line.includes("ms"))
      if (performanceLines.length > 0) {
        results.push("")
        results.push("⚡ **PERFORMANCE INSIGHTS:**")
        performanceLines.slice(-5).forEach((line) => {
          results.push(`• ${line}`)
        })
      }
    }

    return {
      content: [{ type: "text", text: results.join("\n") }]
    }
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: `Error analyzing logs: ${error instanceof Error ? error.message : String(error)}`
        }
      ]
    }
  }
}

export async function executeBrowserAction({
  action,
  params = {}
}: ExecuteBrowserActionParams): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    // First, find active session to get CDP URL
    const sessions = findActiveSessions()
    if (sessions.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: "❌ No active dev3000 sessions found. Make sure dev3000 is running with a browser!"
          }
        ]
      }
    }

    // Get the most recent session's CDP URL (stored in session data)
    const sessionData = JSON.parse(readFileSync(sessions[0].sessionFile, "utf-8"))
    const cdpUrl = sessionData.cdpUrl

    if (!cdpUrl) {
      return {
        content: [
          {
            type: "text",
            text: "❌ No Chrome DevTools Protocol URL found. Make sure dev3000 is running with browser monitoring enabled (not --servers-only mode)."
          }
        ]
      }
    }

    // Connect to Chrome DevTools Protocol
    const result = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const ws = new WebSocket(cdpUrl)

      ws.on("open", async () => {
        try {
          // Get the first page target
          ws.send(JSON.stringify({ id: 1, method: "Target.getTargets", params: {} }))

          let targetId: string | null = null
          let _sessionId: string | null = null
          let messageId = 2

          ws.on("message", async (data) => {
            const message = JSON.parse(data.toString())

            // Handle getting targets
            if (message.id === 1) {
              const pageTarget = message.result.targetInfos.find((t: Record<string, unknown>) => t.type === "page")
              if (!pageTarget) {
                ws.close()
                reject(new Error("No page targets found"))
                return
              }

              targetId = pageTarget.targetId

              // Attach to the target
              ws.send(
                JSON.stringify({
                  id: messageId++,
                  method: "Target.attachToTarget",
                  params: { targetId, flatten: true }
                })
              )
              return
            }

            // Handle session creation
            if (message.method === "Target.attachedToTarget") {
              _sessionId = message.params.sessionId

              // Now execute the requested action
              let cdpResult: Record<string, unknown>

              switch (action) {
                case "click": {
                  if (!params.x || !params.y) {
                    throw new Error("Click action requires x and y coordinates")
                  }
                  cdpResult = await sendCDPCommand(ws, messageId++, "Input.dispatchMouseEvent", {
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
                  break
                }

                case "navigate":
                  if (!params.url) {
                    throw new Error("Navigate action requires url parameter")
                  }
                  cdpResult = await sendCDPCommand(ws, messageId++, "Page.navigate", { url: params.url })
                  break

                case "screenshot":
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
        } catch (error) {
          ws.close()
          reject(error)
        }
      })

      ws.on("error", reject)
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
