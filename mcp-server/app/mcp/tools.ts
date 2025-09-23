import { existsSync, readdirSync, readFileSync, statSync } from "fs"
import { homedir } from "os"
import { join } from "path"
import { WebSocket } from "ws"

// Tool descriptions
export const TOOL_DESCRIPTIONS = {
  fix_my_app:
    "🔧 **THE ULTIMATE FIND→FIX→VERIFY MACHINE!** This tool doesn't just find bugs - it FIXES them! Pure dev3000 magic that identifies issues, provides exact fixes, and verifies everything works! 🪄\n\n🔥 **INSTANT FIXING SUPERPOWERS:**\n• Detects ALL error types: server crashes, browser errors, build failures, API issues, performance problems\n• Shows EXACT user interactions that triggered each error (clicks, navigation, etc.)\n• Provides EXACT fix code with file locations and line numbers\n• Guides you through implementing fixes step-by-step\n• Verifies fixes by replaying the same interactions that caused the error!\n\n📍 **INTERACTION-BASED VERIFICATION:**\n• Every error includes the user interactions that led to it\n• Use execute_browser_action to replay these exact interactions\n• Verify your fix works by confirming the error doesn't reoccur\n• Example: Error shows '[INTERACTION] Click at (450,300)' → After fix, use execute_browser_action(action='click', params={x:450, y:300}) to verify\n\n⚡ **3 ACTION MODES:**\n• FIX NOW: 'What's broken RIGHT NOW?' → Find and fix immediately\n• FIX REGRESSION: 'What broke during testing?' → Compare before/after and fix\n• FIX CONTINUOUSLY: 'Fix issues as they appear' → Monitor and fix proactively\n\n🎪 **THE FIX-IT WORKFLOW:**\n1️⃣ I FIND all issues with their triggering interactions\n2️⃣ I provide EXACT FIXES with code snippets\n3️⃣ You implement the fixes\n4️⃣ We REPLAY the interactions to VERIFY everything works\n\n💡 **PERFECT FOR:** 'fix my app' or 'debug my app' requests, error resolution, code repairs, making broken apps work again. This tool doesn't just identify problems - it SOLVES them with precise reproduction steps!",

  execute_browser_action:
    "🌐 **BROWSER INTERACTION TOOL** - Execute actions in the browser to verify fixes and reproduce issues. Use this after implementing fixes to ensure they work correctly."
}

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
}: FixMyAppParams): Promise<{ content: Array<{ type: "text"; text: string }> }> {
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
      /retry/i,
      /RUNTIME\.ERROR/,
      /hydration.*mismatch/i,
      /Uncaught/i,
      /throwOnHydrationMismatch/i
    ]

    // Filter logs by time range (replaces get_logs_between_timestamps)
    const timeFilteredLines = logLines.filter((line) => {
      // Try ISO format first (e.g., 2025-09-23T22:03:55.068Z)
      const isoMatch = line.match(/\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\]/)
      if (isoMatch) {
        const logTime = new Date(isoMatch[1])
        return logTime >= cutoffTime
      }

      // Try time-only format (e.g., 15:04:03.987)
      const timeMatch = line.match(/\[(\d{2}):(\d{2}):(\d{2})\.(\d{3})\]/)
      if (timeMatch) {
        // For time-only format, assume it's from today
        const now = new Date()
        const logTime = new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate(),
          parseInt(timeMatch[1], 10),
          parseInt(timeMatch[2], 10),
          parseInt(timeMatch[3], 10),
          parseInt(timeMatch[4], 10)
        )

        // If the time is in the future (e.g., log shows 15:04 but now is 14:00),
        // assume it was from yesterday
        if (logTime > now) {
          logTime.setDate(logTime.getDate() - 1)
        }

        return logTime >= cutoffTime
      }

      // If no timestamp found, include the line (better to show more than miss errors)
      return true
    })

    // Extract ALL error types (replaces multiple error detection tools)
    const allErrors = timeFilteredLines.filter((line) => {
      return errorPatterns.some((pattern) => pattern.test(line))
    })

    // Extract react-scan performance data
    const reactScanLines = timeFilteredLines.filter(
      (line) => line.includes("react-scan") || line.includes("ReactScan") || line.includes("React render")
    )

    // Parse react-scan performance metrics
    const reactScanMetrics = {
      unnecessaryRenders: reactScanLines.filter(
        (line) => line.includes("unnecessary") || line.includes("re-render") || line.includes("wasted")
      ),
      slowComponents: reactScanLines.filter(
        (line) => line.includes("slow") || line.includes("performance") || /\d+ms/.test(line)
      ),
      totalRenders: reactScanLines.filter((line) => line.includes("render")).length
    }

    // Categorize errors for better analysis
    const categorizedErrors = {
      serverErrors: allErrors.filter(
        (line) => line.includes("[SERVER]") && (line.includes("ERROR") || line.includes("Exception"))
      ),
      browserErrors: allErrors.filter(
        (line) =>
          line.includes("[BROWSER]") &&
          (line.includes("ERROR") || line.includes("CONSOLE ERROR") || line.includes("RUNTIME.ERROR"))
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

    // Also check for any errors in the entire log file (not just time filtered)
    const allLogErrors = logLines.filter((line) => {
      return errorPatterns.some((pattern) => pattern.test(line))
    })
    const recentErrorsOutsideTimeRange = allLogErrors.length > totalErrors

    // Helper function to find preceding interaction events for any error
    const findInteractionsBeforeError = (errorLine: string, allLines: string[]): string[] => {
      const errorIndex = allLines.indexOf(errorLine)
      if (errorIndex === -1) return []

      const interactions: string[] = []
      // Look back up to 20 lines or 5 interactions
      for (let i = errorIndex - 1; i >= Math.max(0, errorIndex - 20) && interactions.length < 5; i--) {
        if (
          allLines[i].includes("[INTERACTION]") ||
          allLines[i].includes("[NAVIGATION]") ||
          allLines[i].includes("[PAGE]")
        ) {
          interactions.unshift(allLines[i])
        }
      }
      return interactions
    }

    if (totalErrors === 0 && !recentErrorsOutsideTimeRange) {
      results.push(`✅ **SYSTEM HEALTHY** - No errors found in last ${timeRangeMinutes} minutes`)
      results.push("🎯 App appears to be running smoothly!")

      if (includeTimestampInstructions && mode !== "monitor") {
        results.push("")
        results.push("💡 **PROACTIVE MONITORING TIPS:**")
        results.push("• Use mode='bisect' with waitForUserInteraction=true before testing new features")
        results.push("• Use mode='monitor' for continuous background monitoring")
        results.push("• Increase timeRangeMinutes to analyze longer periods")
      }
    } else if (totalErrors === 0 && recentErrorsOutsideTimeRange) {
      results.push(
        `⚠️ **NO ERRORS IN LAST ${timeRangeMinutes} MINUTES** - But found ${allLogErrors.length} errors in the full log`
      )
      results.push("")
      results.push("📋 **RECENT ERRORS (outside time range):**")
      // Show last 5 errors from the full log with their interactions
      allLogErrors.slice(-5).forEach((error) => {
        const interactions = findInteractionsBeforeError(error, logLines)
        if (interactions.length > 0) {
          results.push("  📍 Preceding interactions:")
          for (const interaction of interactions) {
            results.push(`    ${interaction}`)
          }
        }
        results.push(`  ❌ ${error}`)
        results.push("")
      })
      results.push("💡 **TIP:** Increase timeRangeMinutes parameter to analyze these errors")
      results.push("💡 **TIP:** Or use timeRangeMinutes=60 to check the last hour")
    } else {
      results.push(
        `🚨 **${totalErrors} ISSUES DETECTED** (${criticalErrors} critical, ${categorizedErrors.warnings.length} warnings)`
      )
      results.push("")

      // Show categorized errors with their preceding interactions
      if (categorizedErrors.serverErrors.length > 0) {
        results.push("🔥 **SERVER ERRORS:**")
        categorizedErrors.serverErrors.slice(-5).forEach((error) => {
          const interactions = findInteractionsBeforeError(error, logLines)
          if (interactions.length > 0) {
            results.push("  📍 Preceding interactions:")
            for (const interaction of interactions) {
              results.push(`    ${interaction}`)
            }
          }
          results.push(`  ❌ ${error}`)
          results.push("")
        })
      }

      if (categorizedErrors.browserErrors.length > 0) {
        results.push("🌐 **BROWSER/CONSOLE ERRORS:**")
        categorizedErrors.browserErrors.slice(-5).forEach((error) => {
          const interactions = findInteractionsBeforeError(error, logLines)
          if (interactions.length > 0) {
            results.push("  📍 Preceding interactions:")
            for (const interaction of interactions) {
              results.push(`    ${interaction}`)
            }
          }
          results.push(`  ❌ ${error}`)
          results.push("")
        })
      }

      if (categorizedErrors.buildErrors.length > 0) {
        results.push("🔨 **BUILD/COMPILATION ERRORS:**")
        categorizedErrors.buildErrors.slice(-5).forEach((error) => {
          const interactions = findInteractionsBeforeError(error, logLines)
          if (interactions.length > 0) {
            results.push("  📍 Preceding interactions:")
            for (const interaction of interactions) {
              results.push(`    ${interaction}`)
            }
          }
          results.push(`  ❌ ${error}`)
          results.push("")
        })
      }

      if (categorizedErrors.networkErrors.length > 0) {
        results.push("🌐 **NETWORK/API ERRORS:**")
        categorizedErrors.networkErrors.slice(-5).forEach((error) => {
          const interactions = findInteractionsBeforeError(error, logLines)
          if (interactions.length > 0) {
            results.push("  📍 Preceding interactions:")
            for (const interaction of interactions) {
              results.push(`    ${interaction}`)
            }
          }
          results.push(`  ❌ ${error}`)
          results.push("")
        })
      }

      if (categorizedErrors.warnings.length > 0 && focusArea === "all") {
        results.push(`⚠️ **WARNINGS** (${categorizedErrors.warnings.length} found, showing recent):`)
        results.push(categorizedErrors.warnings.slice(-3).join("\n"))
        results.push("")
      }

      // Show the magical dev3000 fix workflow
      results.push("🪄 **ULTIMATE DEV3000 FIX-IT MAGIC READY:**")
      results.push("🎯 **I don't just find errors - I FIX them instantly!**")
      results.push("")
      results.push("📍 **INTERACTION-BASED VERIFICATION WORKFLOW:**")
      results.push("• Each error shows the EXACT user interactions that triggered it")
      results.push("• Use these interactions to reproduce the error with execute_browser_action")
      results.push("• After fixing, replay the SAME interactions to verify the fix works")
      results.push("• Example: If error shows [INTERACTION] Click at (x:450, y:300), use:")
      results.push("  execute_browser_action(action='click', params={x:450, y:300})")
      results.push("")
      results.push("🔧 **FIX WORKFLOW:**")
      results.push("1. Analyze error patterns and preceding interactions")
      results.push("2. Provide exact fix code with file locations")
      results.push("3. Guide you through implementing the fixes")
      results.push("4. Use execute_browser_action to replay the interactions")
      results.push("5. Verify the error no longer occurs!")
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

    // React-scan performance data (if available)
    if (reactScanMetrics.totalRenders > 0 || focusArea === "performance" || focusArea === "all") {
      if (reactScanMetrics.unnecessaryRenders.length > 0 || reactScanMetrics.slowComponents.length > 0) {
        results.push("")
        results.push("⚛️ **REACT PERFORMANCE ANALYSIS (react-scan):**")

        if (reactScanMetrics.unnecessaryRenders.length > 0) {
          results.push(`🔄 **Unnecessary Re-renders Detected (${reactScanMetrics.unnecessaryRenders.length}):**`)
          reactScanMetrics.unnecessaryRenders.slice(-5).forEach((line) => {
            results.push(`• ${line}`)
          })
          results.push("")
        }

        if (reactScanMetrics.slowComponents.length > 0) {
          results.push(`🐌 **Slow Components Found (${reactScanMetrics.slowComponents.length}):**`)
          reactScanMetrics.slowComponents.slice(-5).forEach((line) => {
            results.push(`• ${line}`)
          })
          results.push("")
        }

        results.push("💡 **REACT OPTIMIZATION TIPS:**")
        results.push("• Use React.memo() for components with expensive renders")
        results.push("• Use useMemo/useCallback to prevent unnecessary re-renders")
        results.push("• Check for unstable prop references (objects/arrays created in render)")
        results.push("• Consider using React DevTools Profiler for deeper analysis")
      }
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
}: ExecuteBrowserActionParams): Promise<{ content: Array<{ type: "text"; text: string }> }> {
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
                  if (typeof params.x !== "number" || typeof params.y !== "number") {
                    throw new Error("Click action requires x and y coordinates as numbers")
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
                  if (typeof params.url !== "string") {
                    throw new Error("Navigate action requires url parameter as string")
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
                  if (typeof params.expression !== "string") {
                    throw new Error("Evaluate action requires expression parameter as string")
                  }
                  const expression = params.expression
                  // Whitelist safe expressions only
                  const safeExpressions = [
                    /^document\.title$/,
                    /^window\.location\.href$/,
                    /^document\.querySelector\(['"][^'"]*['"]\)\.textContent$/,
                    /^document\.body\.scrollHeight$/,
                    /^window\.scrollY$/,
                    /^window\.scrollX$/
                  ]

                  if (!safeExpressions.some((regex) => regex.test(expression))) {
                    throw new Error("Expression not in whitelist. Only safe read-only expressions allowed.")
                  }

                  cdpResult = await sendCDPCommand(ws, messageId++, "Runtime.evaluate", {
                    expression: expression,
                    returnByValue: true
                  })
                  break
                }

                case "scroll": {
                  const scrollX = typeof params.deltaX === "number" ? params.deltaX : 0
                  const scrollY = typeof params.deltaY === "number" ? params.deltaY : 0
                  cdpResult = await sendCDPCommand(ws, messageId++, "Input.dispatchMouseEvent", {
                    type: "mouseWheel",
                    x: typeof params.x === "number" ? params.x : 500,
                    y: typeof params.y === "number" ? params.y : 500,
                    deltaX: scrollX,
                    deltaY: scrollY
                  })
                  break
                }

                case "type":
                  if (typeof params.text !== "string") {
                    throw new Error("Type action requires text parameter as string")
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
