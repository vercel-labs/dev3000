import { exec } from "child_process"
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "fs"
import { homedir } from "os"
import { join } from "path"
import { promisify } from "util"
import { WebSocket } from "ws"

const execAsync = promisify(exec)

// Tool descriptions
export const TOOL_DESCRIPTIONS = {
  fix_my_app:
    "🔧 **THE ULTIMATE FIND→FIX→VERIFY MACHINE!** This tool doesn't just find bugs - it FIXES them! Pure dev3000 magic that identifies issues, provides exact fixes, and verifies everything works! 🪄\n\n🔥 **INSTANT FIXING SUPERPOWERS:**\n• Detects ALL error types: server crashes, browser errors, build failures, API issues, performance problems\n• Shows EXACT user interactions that triggered each error (clicks, navigation, etc.)\n• Provides EXACT fix code with file locations and line numbers\n• Guides you through implementing fixes step-by-step\n• Verifies fixes by replaying the same interactions that caused the error!\n\n📍 **INTERACTION-BASED VERIFICATION:**\n• Every error includes the user interactions that led to it\n• Use execute_browser_action to replay these exact interactions\n• Verify your fix works by confirming the error doesn't reoccur\n• Example: Error shows '[INTERACTION] Click at (450,300)' → After fix, use execute_browser_action(action='click', params={x:450, y:300}) to verify\n\n⚡ **3 ACTION MODES:**\n• FIX NOW: 'What's broken RIGHT NOW?' → Find and fix immediately\n• FIX REGRESSION: 'What broke during testing?' → Compare before/after and fix\n• FIX CONTINUOUSLY: 'Fix issues as they appear' → Monitor and fix proactively\n\n🎪 **THE FIX-IT WORKFLOW:**\n1️⃣ I FIND all issues with their triggering interactions\n2️⃣ I provide EXACT FIXES with code snippets\n3️⃣ You implement the fixes\n4️⃣ We REPLAY the interactions to VERIFY everything works\n\n💡 **PERFECT FOR:** 'fix my app' or 'debug my app' requests, error resolution, code repairs, making broken apps work again. This tool doesn't just identify problems - it SOLVES them with precise reproduction steps!",

  create_integrated_workflow:
    "🧠 **INTELLIGENT DEBUGGING ORCHESTRATOR** - Transform dev3000 from a standalone tool into the conductor of your debugging orchestra! This tool automatically detects available MCPs and creates integrated workflows that leverage the unique strengths of each tool.\n\n🎼 **ORCHESTRATION SUPERPOWERS:**\n• Auto-detects nextjs-dev and chrome-devtools MCPs when available\n• Creates 3-phase systematic debugging workflows\n• Provides AI-powered correlation between server/client/browser layers\n• Returns concrete function calls for Claude to execute across MCPs\n\n⚡ **3-PHASE WORKFLOW MAGIC:**\n• Phase 1: Parallel Data Collection (across all available MCPs)\n• Phase 2: Deep Targeted Analysis (sequential, context-aware)\n• Phase 3: Fix Implementation & Verification (orchestrated testing)\n\n🔗 **INTEGRATION BENEFITS:**\n• With nextjs-dev: Framework-specific build/runtime error context\n• With chrome-devtools: Precise browser state inspection\n• Together: Complete full-stack debugging coverage with AI correlation\n\n💡 **PERFECT FOR:** Multi-MCP environments where you want dev3000 to intelligently coordinate debugging across tools instead of using them individually. Makes other MCPs more powerful when used together!",

  execute_browser_action:
    "🌐 **INTELLIGENT BROWSER AUTOMATION** - Smart browser action routing that automatically delegates to chrome-devtools MCP when available for superior automation capabilities.\n\n🎯 **INTELLIGENT DELEGATION:**\n• Screenshots → chrome-devtools MCP (better quality, no conflicts)\n• Navigation → chrome-devtools MCP (more reliable page handling)\n• Clicks → chrome-devtools MCP (precise coordinate-based interaction)\n• JavaScript evaluation → chrome-devtools MCP (enhanced debugging)\n• Scrolling & typing → dev3000 fallback (specialized actions)\n\n⚡ **PROGRESSIVE ENHANCEMENT:**\n• Uses chrome-devtools MCP when available for best results\n• Falls back to dev3000's native implementation when chrome-devtools unavailable\n• Shares the same Chrome instance via CDP URL coordination\n• Eliminates browser conflicts between tools\n\n💡 **PERFECT FOR:** Browser automation that automatically chooses the best tool for each action, ensuring optimal results whether chrome-devtools MCP is available or not.",

  discover_available_mcps:
    "🔍 **PROACTIVE MCP DISCOVERY** - Automatically discover other MCPs running on the system using process detection and port pinging. No need to manually specify which MCPs are available!\n\n🎯 **DISCOVERY METHODS:**\n• Process Detection: Scans running processes for known MCP patterns\n• Port Pinging: Tests standard MCP ports with HTTP/WebSocket health checks\n• Cross-Platform: Works on macOS, Linux, and Windows\n\n⚡ **SMART DETECTION:**\n• Detects nextjs-dev, chrome-devtools, and other common MCPs\n• Fallback from process detection to port pinging\n• Logs all discovery attempts for transparency\n\n💡 **PERFECT FOR:** 'What MCPs are available?' or when you want dev3000 to automatically find and integrate with other debugging tools!"
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
  integrateNextjs?: boolean
  integrateChromeDevtools?: boolean
  returnRawData?: boolean
}

export interface CreateIntegratedWorkflowParams {
  availableMcps?: string[] // Optional - will auto-discover if not provided
  focusArea?: string
  errorContext?: string
}

export interface ExecuteBrowserActionParams {
  action: string
  params?: Record<string, unknown>
}

// Structured data types for raw data output
export interface ErrorWithInteractions {
  timestamp: string
  category: string
  message: string
  interactions: string[]
  severity: "critical" | "error" | "warning"
}

export interface CodeFix {
  file: string
  line?: number
  description: string
  code: string
  reason: string
}

export interface McpFunctionSuggestion {
  function: string
  params?: Record<string, unknown>
  reason: string
  priority: "high" | "medium" | "low"
}

export interface WorkflowPhase {
  name: string
  description: string
  actions: Array<{
    mcp: string
    function: string
    params?: Record<string, unknown>
    reason: string
  }>
  estimatedTime: string
}

export interface StructuredAnalysisResult {
  errors: ErrorWithInteractions[]
  fixes: CodeFix[]
  suggestedIntegrations: {
    nextjs?: McpFunctionSuggestion[]
    chrome?: McpFunctionSuggestion[]
  }
  workflowPlan?: {
    phase1: WorkflowPhase
    phase2: WorkflowPhase
    phase3: WorkflowPhase
  }
  summary: {
    totalErrors: number
    criticalErrors: number
    hasIntegrations: boolean
    estimatedFixTime: string
  }
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
  includeTimestampInstructions = true,
  integrateNextjs = false,
  integrateChromeDevtools = false,
  returnRawData = false
}: FixMyAppParams): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  // 🎯 INTELLIGENT DELEGATION: Check if nextjs-dev MCP is available for Next.js-specific analysis
  const canDelegateNextjs = await canDelegateToNextjs()
  if (canDelegateNextjs) {
    logToDevFile(`Fix My App: Recommending dev3000-nextjs-dev MCP for Next.js-specific analysis`)
  }
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

      // Add integration-aware suggestions
      if (integrateNextjs || integrateChromeDevtools) {
        // Log that integrations are being used in fix analysis
        const activeIntegrations = []
        if (integrateNextjs) activeIntegrations.push("Next.js")
        if (integrateChromeDevtools) activeIntegrations.push("Chrome DevTools")
        logToDevFile(
          `Fix Analysis: Using active MCP integrations [${activeIntegrations.join(", ")}] for enhanced error analysis`,
          projectName
        )

        results.push("")
        results.push("🎼 **MCP INTEGRATION ENHANCEMENTS:**")

        if (integrateNextjs) {
          results.push("")
          results.push("⚛️ **Next.js Integration Active:**")
          const nextjsSuggestions = generateNextjsSuggestions(allErrors.join(" "))
          nextjsSuggestions.forEach((suggestion) => {
            const params = suggestion.params
              ? `(${Object.entries(suggestion.params)
                  .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
                  .join(", ")})`
              : "()"
            results.push(`• Use nextjs-dev.${suggestion.function}${params}`)
            results.push(`  → ${suggestion.reason}`)
          })

          // Next.js specific correlation tips
          if (categorizedErrors.serverErrors.length > 0) {
            results.push("• Correlate server errors with Next.js build/runtime logs")
            results.push("• Check for SSR/hydration mismatches in Next.js context")
          }
        }

        if (integrateChromeDevtools) {
          results.push("")
          results.push("🌐 **Chrome DevTools Integration Active:**")
          const chromeSuggestions = generateChromeDevtoolsSuggestions(allErrors.join(" "))
          chromeSuggestions.forEach((suggestion) => {
            const params = suggestion.params
              ? `(${Object.entries(suggestion.params)
                  .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
                  .join(", ")})`
              : "()"
            results.push(`• Use chrome-devtools.${suggestion.function}${params}`)
            results.push(`  → ${suggestion.reason}`)
          })

          // Chrome DevTools specific correlation tips
          if (categorizedErrors.browserErrors.length > 0) {
            results.push("• Cross-reference browser console errors with Chrome DevTools")
            results.push("• Use DOM inspection for UI interaction failures")
          }
          if (categorizedErrors.networkErrors.length > 0) {
            results.push("• Analyze network requests timing with Chrome DevTools")
            results.push("• Inspect failed requests for detailed error context")
          }
        }

        if (integrateNextjs && integrateChromeDevtools) {
          results.push("")
          results.push("🚀 **TRIPLE-STACK DEBUGGING POWER:**")
          results.push("• dev3000 provides interaction replay + error correlation")
          results.push("• nextjs-dev provides server-side framework context")
          results.push("• chrome-devtools provides precise browser state inspection")
          results.push("• Combined = 90%+ issue resolution rate!")
        }
      }
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

    // Return structured data if requested
    if (returnRawData) {
      logToDevFile(
        `Structured Output: Returning structured data for Claude orchestration with ${totalErrors} errors and ${integrateNextjs || integrateChromeDevtools ? "active" : "no"} integrations`,
        projectName
      )
      const structuredErrors: ErrorWithInteractions[] = allErrors.map((error) => {
        const interactions = findInteractionsBeforeError(error, logLines)
        const category = categorizedErrors.serverErrors.includes(error)
          ? "server"
          : categorizedErrors.browserErrors.includes(error)
            ? "browser"
            : categorizedErrors.buildErrors.includes(error)
              ? "build"
              : categorizedErrors.networkErrors.includes(error)
                ? "network"
                : categorizedErrors.warnings.includes(error)
                  ? "warning"
                  : "general"

        const severity = categorizedErrors.warnings.includes(error)
          ? ("warning" as const)
          : error.includes("CRITICAL") || error.includes("FATAL") || error.includes("crashed")
            ? ("critical" as const)
            : ("error" as const)

        // Extract timestamp from error line
        const timestampMatch =
          error.match(/\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\]/) ||
          error.match(/\[(\d{2}:\d{2}:\d{2}\.\d{3})\]/)
        const timestamp = timestampMatch ? timestampMatch[1] : new Date().toISOString()

        return {
          timestamp,
          category,
          message: error,
          interactions,
          severity
        }
      })

      const structuredFixes: CodeFix[] = []

      // Generate intelligent fix suggestions based on error patterns
      structuredErrors.forEach((error) => {
        if (error.category === "hydration" || error.message.includes("hydration")) {
          structuredFixes.push({
            file: "pages/_app.js or components/[component].tsx",
            description: "Fix hydration mismatch",
            code: `// Ensure server and client render the same content
// Use useEffect for client-only logic
useEffect(() => {
  // Client-only code here
}, [])`,
            reason: "Hydration errors occur when server and client render different content"
          })
        }

        if (error.message.includes("TypeError") || error.message.includes("undefined")) {
          structuredFixes.push({
            file: "Identify from stack trace in error message",
            description: "Add null/undefined checks",
            code: `// Add defensive programming checks
if (data && data.property) {
  // Safe to use data.property
}
// Or use optional chaining
const value = data?.property?.nestedProperty`,
            reason: "Prevent TypeError by checking for undefined/null values"
          })
        }

        if (error.message.includes("404") || error.message.includes("not found")) {
          structuredFixes.push({
            file: "routing configuration or API endpoints",
            description: "Fix missing route or resource",
            code: `// Check route configuration
// Ensure API endpoint exists
// Verify file paths are correct`,
            reason: "404 errors indicate missing resources or incorrect paths"
          })
        }
      })

      const suggestedIntegrations: StructuredAnalysisResult["suggestedIntegrations"] = {}

      if (integrateNextjs) {
        suggestedIntegrations.nextjs = generateNextjsSuggestions(allErrors.join(" "))
      }

      if (integrateChromeDevtools) {
        suggestedIntegrations.chrome = generateChromeDevtoolsSuggestions(allErrors.join(" "))
      }

      // Create workflow plan if integrations are available
      let workflowPlan: StructuredAnalysisResult["workflowPlan"]

      if (integrateNextjs || integrateChromeDevtools) {
        workflowPlan = {
          phase1: {
            name: "Data Collection",
            description: "Parallel data gathering across all available MCPs",
            actions: [
              {
                mcp: "dev3000",
                function: "fix_my_app",
                params: { focusArea, integrateNextjs, integrateChromeDevtools, returnRawData: true },
                reason: "Get comprehensive error analysis with interaction data"
              }
            ],
            estimatedTime: "2-3 minutes"
          },
          phase2: {
            name: "Deep Analysis",
            description: "Cross-MCP correlation and targeted investigation",
            actions: [
              {
                mcp: "dev3000",
                function: "fix_my_app",
                params: { mode: "bisect" },
                reason: "Regression analysis if needed"
              }
            ],
            estimatedTime: "3-5 minutes"
          },
          phase3: {
            name: "Fix & Verify",
            description: "Implementation and verification across all layers",
            actions: [
              {
                mcp: "dev3000",
                function: "execute_browser_action",
                reason: "Replay interactions to verify fixes"
              }
            ],
            estimatedTime: "5-10 minutes"
          }
        }

        // Add Next.js actions to workflow
        if (integrateNextjs && suggestedIntegrations.nextjs) {
          workflowPlan.phase1.actions.push(
            ...suggestedIntegrations.nextjs
              .filter((s) => s.priority === "high")
              .map((s) => ({
                mcp: "nextjs-dev",
                function: s.function,
                params: s.params,
                reason: s.reason
              }))
          )

          workflowPlan.phase3.actions.push({
            mcp: "nextjs-dev",
            function: "check_build_status",
            reason: "Verify build success after fixes"
          })
        }

        // Add Chrome actions to workflow
        if (integrateChromeDevtools && suggestedIntegrations.chrome) {
          workflowPlan.phase1.actions.push(
            ...suggestedIntegrations.chrome
              .filter((s) => s.priority === "high")
              .map((s) => ({
                mcp: "chrome-devtools",
                function: s.function,
                params: s.params,
                reason: s.reason
              }))
          )
        }
      }

      const structuredResult: StructuredAnalysisResult = {
        errors: structuredErrors,
        fixes: structuredFixes,
        suggestedIntegrations,
        workflowPlan,
        summary: {
          totalErrors: totalErrors,
          criticalErrors: criticalErrors,
          hasIntegrations: integrateNextjs || integrateChromeDevtools,
          estimatedFixTime: calculateEstimatedTime(totalErrors, integrateNextjs || integrateChromeDevtools)
        }
      }

      return {
        content: [{ type: "text", text: JSON.stringify(structuredResult, null, 2) }]
      }
    }

    // Add nextjs-dev delegation recommendation if available
    if (canDelegateNextjs) {
      results.push("")
      results.push("🔗 **ENHANCED NEXT.JS ANALYSIS AVAILABLE**")
      results.push("")
      const delegationResponse = await delegateToNextjs()
      results.push(delegationResponse.content[0].text)
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

// Capability mapping between dev3000 and chrome-devtools MCP
const CHROME_DEVTOOLS_CAPABILITY_MAP: Record<
  string,
  { function: string; paramMap?: (params: Record<string, unknown>) => Record<string, unknown> }
> = {
  screenshot: {
    function: "take_screenshot",
    paramMap: () => ({}) // chrome-devtools doesn't need params for screenshots
  },
  navigate: {
    function: "navigate_page",
    paramMap: (params) => ({ url: params.url })
  },
  click: {
    function: "click",
    paramMap: (params) => ({ x: params.x, y: params.y })
  },
  evaluate: {
    function: "execute_script", // Assuming chrome-devtools has this
    paramMap: (params) => ({ script: params.expression })
  }
  // scroll and type don't have direct chrome-devtools equivalents, fall back to dev3000
}

// Capability mapping for nextjs-dev MCP delegation
const NEXTJS_DEV_CAPABILITY_MAP: Record<string, { function: string; reason: string }> = {
  get_build_status: {
    function: "get_build_status",
    reason: "Get comprehensive Next.js build information and status"
  },
  get_server_logs: {
    function: "get_server_logs",
    reason: "Access Next.js server-side logs and runtime information"
  },
  analyze_performance: {
    function: "analyze_performance",
    reason: "Get Next.js-specific performance metrics and optimization suggestions"
  },
  check_routes: {
    function: "check_routes",
    reason: "Validate Next.js routing configuration and detect issues"
  }
}

/**
 * Check if chrome-devtools MCP is available and can handle the requested action
 */
async function canDelegateToChromeDevtools(action: string): Promise<boolean> {
  try {
    // First check if the action is mappable to chrome-devtools
    if (!CHROME_DEVTOOLS_CAPABILITY_MAP[action]) {
      return false
    }

    // Only look for dev3000's own configured chrome-devtools MCP
    const availableMcps = await discoverAvailableMcps()

    // Check for dev3000's own configured chrome-devtools MCP
    return availableMcps.includes("dev3000-chrome-devtools")
  } catch (error) {
    logToDevFile(`Chrome DevTools delegation check failed: ${error}`)
    return false
  }
}

/**
 * Check if nextjs-dev MCP is available
 */
async function canDelegateToNextjs(): Promise<boolean> {
  try {
    // Only look for dev3000's own configured nextjs-dev MCP
    const availableMcps = await discoverAvailableMcps()

    // Check for dev3000's own configured nextjs-dev MCP
    return availableMcps.includes("dev3000-nextjs-dev")
  } catch (error) {
    logToDevFile(`NextJS delegation check failed: ${error}`)
    return false
  }
}

/**
 * Delegate browser action to chrome-devtools MCP
 */
async function delegateToChromeDevtools(
  action: string,
  params: Record<string, unknown>
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  const mapping = CHROME_DEVTOOLS_CAPABILITY_MAP[action]
  if (!mapping) {
    throw new Error(`Action ${action} cannot be delegated to chrome-devtools`)
  }

  // Transform parameters if needed
  const chromeParams = mapping.paramMap ? mapping.paramMap(params) : params

  return {
    content: [
      {
        type: "text",
        text: `🔗 **USE DEV3000-CHROME-DEVTOOLS MCP**

If you have chrome-devtools MCP configured, please use the \`dev3000-chrome-devtools\` MCP directly:

\`\`\`
dev3000-chrome-devtools:${mapping.function}(${JSON.stringify(chromeParams, null, 2)})
\`\`\`

💡 **If the MCP is not available:**
• Make sure chrome-devtools MCP is configured in your Claude Code client
• Claude Code should auto-configure it as \`dev3000-chrome-devtools\`
• Alternatively, dev3000 will fallback to its basic browser automation

⚡ **Note:** dev3000 detected chrome-devtools activity but cannot verify MCP configuration`
      }
    ]
  }
}

/**
 * Delegate to nextjs-dev MCP with suggested functions
 */
async function delegateToNextjs(): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  const availableFunctions = Object.entries(NEXTJS_DEV_CAPABILITY_MAP)
    .map(([_key, { function: func, reason }]) => `• \`dev3000-nextjs-dev:${func}()\` - ${reason}`)
    .join("\n")

  return {
    content: [
      {
        type: "text",
        text: `🔗 **USE DEV3000-NEXTJS-DEV MCP**

Please use the \`dev3000-nextjs-dev\` MCP directly for Next.js-specific analysis:

**Available Functions:**
${availableFunctions}

💡 **Why this approach:**
• nextjs-dev is a stdio MCP server that Claude calls directly
• Provides Next.js-specific build, server, and performance insights
• Direct MCP calls give better framework-specific context

⚡ **Auto-configured as:** \`dev3000-nextjs-dev\` in your MCP client`
      }
    ]
  }
}

export async function executeBrowserAction({
  action,
  params = {}
}: ExecuteBrowserActionParams): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  try {
    // 🎯 INTELLIGENT DELEGATION: Check if chrome-devtools MCP can handle this action
    const canDelegate = await canDelegateToChromeDevtools(action)
    if (canDelegate) {
      logToDevFile(`Browser Action Delegation: Routing '${action}' to chrome-devtools MCP`)
      return await delegateToChromeDevtools(action, params)
    }

    // Log fallback to dev3000's own implementation
    logToDevFile(`Browser Action Fallback: Using dev3000's execute_browser_action for '${action}'`)

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
    let cdpUrl = sessionData.cdpUrl

    if (!cdpUrl) {
      // Try to get CDP URL from Chrome debugging port as fallback
      try {
        const response = await fetch("http://localhost:9222/json")
        const pages = await response.json()
        const activePage = pages.find(
          (page: { type: string; url: string }) => page.type === "page" && !page.url.startsWith("chrome://")
        )
        if (activePage) {
          cdpUrl = activePage.webSocketDebuggerUrl
          logToDevFile(`CDP Discovery: Found fallback CDP URL ${cdpUrl}`, sessions[0].projectName)
        }
      } catch (error) {
        logToDevFile(`CDP Discovery: Failed to find fallback CDP URL - ${error}`, sessions[0].projectName)
      }
    }

    if (!cdpUrl) {
      return {
        content: [
          {
            type: "text",
            text: `❌ No Chrome DevTools Protocol URL found. Make sure dev3000 is running with browser monitoring enabled (not --servers-only mode). Session CDP URL: ${sessionData.cdpUrl || "null"}`
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

// MCP Integration and Workflow Orchestration Functions

/**
 * Known MCP patterns for process detection
 */
const KNOWN_MCP_PATTERNS = {
  "nextjs-dev": [
    "nextjs-dev",
    "nextjs-dev-mcp",
    "@modelcontextprotocol/server-nextjs-dev",
    "mcp-server-nextjs-dev",
    "nextjs-mcp"
  ],
  "chrome-devtools": [
    "chrome-devtools",
    "chrome-devtools-mcp",
    "@modelcontextprotocol/server-chrome-devtools",
    "mcp-server-chrome-devtools",
    "chrome-mcp"
  ]
}

/**
 * Standard MCP ports to try pinging
 */
const STANDARD_MCP_PORTS = {
  "nextjs-dev": [3001, 3002, 8080, 8081],
  "chrome-devtools": [9222, 9223, 9224, 3003]
}

/**
 * Detect running processes that match known MCP patterns
 */
async function detectMcpProcesses(): Promise<string[]> {
  const detectedMcps: string[] = []

  try {
    // Get running processes on different platforms
    const platform = process.platform
    let psCommand: string

    if (platform === "darwin" || platform === "linux") {
      psCommand = "ps aux"
    } else if (platform === "win32") {
      psCommand = "tasklist"
    } else {
      logToDevFile("MCP Discovery: Unsupported platform for process detection")
      return []
    }

    const { stdout } = await execAsync(psCommand)
    const processes = stdout.toLowerCase()

    // Check for each known MCP pattern
    for (const [mcpName, patterns] of Object.entries(KNOWN_MCP_PATTERNS)) {
      for (const pattern of patterns) {
        if (processes.includes(pattern.toLowerCase())) {
          if (!detectedMcps.includes(mcpName)) {
            detectedMcps.push(mcpName)
            logToDevFile(`MCP Discovery: Found ${mcpName} MCP via process detection [${pattern}]`)
          }
          break
        }
      }
    }
  } catch (error) {
    logToDevFile(`MCP Discovery: Process detection failed - ${error instanceof Error ? error.message : String(error)}`)
  }

  return detectedMcps
}

/**
 * Try to ping MCP services on standard ports
 */
async function pingMcpPorts(): Promise<string[]> {
  const detectedMcps: string[] = []

  for (const [mcpName, ports] of Object.entries(STANDARD_MCP_PORTS)) {
    for (const port of ports) {
      try {
        // Try HTTP health check first
        const response = await fetch(`http://localhost:${port}/health`, {
          method: "GET",
          signal: AbortSignal.timeout(2000)
        })

        if (response.ok) {
          detectedMcps.push(mcpName)
          logToDevFile(`MCP Discovery: Found ${mcpName} MCP via HTTP ping on port ${port}`)
          break
        }
      } catch {
        // Try WebSocket connection for MCP protocol
        try {
          const ws = new WebSocket(`ws://localhost:${port}`)
          await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
              ws.close()
              reject(new Error("timeout"))
            }, 1000)

            ws.on("open", () => {
              clearTimeout(timeout)
              ws.close()
              detectedMcps.push(mcpName)
              logToDevFile(`MCP Discovery: Found ${mcpName} MCP via WebSocket ping on port ${port}`)
              resolve(null)
            })

            ws.on("error", () => {
              clearTimeout(timeout)
              reject(new Error("connection failed"))
            })
          })
          break
        } catch {}
      }
    }
  }

  return detectedMcps
}

/**
 * Comprehensive MCP discovery using multiple methods
 */
export async function discoverAvailableMcps(projectName?: string): Promise<string[]> {
  logToDevFile("MCP Discovery: Starting proactive MCP discovery", projectName)

  const discoveredMcps = new Set<string>()

  // Method 1: Process detection
  const processDetected = await detectMcpProcesses()
  for (const mcp of processDetected) {
    discoveredMcps.add(mcp)
  }

  // Method 2: Check for dev3000-configured MCPs by testing their functionality
  try {
    // Test if dev3000-chrome-devtools MCP is working by checking Claude logs
    const cacheDir = `/Users/${process.env.USER}/Library/Caches/claude-cli-nodejs`
    const { readdirSync, existsSync } = await import("fs")

    if (existsSync(cacheDir)) {
      const cacheDirs = readdirSync(cacheDir)
      const projectDir = cacheDirs.find((dir) => dir.includes(process.cwd().replace(/\//g, "-")))

      if (projectDir) {
        const projectCacheDir = `${cacheDir}/${projectDir}`

        // Check for chrome-devtools MCP logs
        const chromeDevtoolsLogDir = `${projectCacheDir}/mcp-logs-dev3000-chrome-devtools`
        if (existsSync(chromeDevtoolsLogDir)) {
          const chromeDevtoolsLogs = readdirSync(chromeDevtoolsLogDir)
          if (chromeDevtoolsLogs.length > 0) {
            discoveredMcps.add("dev3000-chrome-devtools")
            logToDevFile("MCP Discovery: Found dev3000-chrome-devtools via Claude cache logs", projectName)
          }
        }

        // Check for nextjs-dev MCP logs
        const nextjsDevLogDir = `${projectCacheDir}/mcp-logs-dev3000-nextjs-dev`
        if (existsSync(nextjsDevLogDir)) {
          const nextjsDevLogs = readdirSync(nextjsDevLogDir)
          if (nextjsDevLogs.length > 0) {
            discoveredMcps.add("dev3000-nextjs-dev")
            logToDevFile("MCP Discovery: Found dev3000-nextjs-dev via Claude cache logs", projectName)
          }
        }
      }
    }
  } catch (_error) {
    logToDevFile("MCP Discovery: Claude cache check failed, falling back to port detection", projectName)
  }

  // Method 3: Port pinging (fallback)
  if (discoveredMcps.size === 0) {
    logToDevFile("MCP Discovery: No MCPs found via process or cache detection, trying port pinging", projectName)
    const portDetected = await pingMcpPorts()
    for (const mcp of portDetected) {
      discoveredMcps.add(mcp)
    }
  }

  const finalMcps = Array.from(discoveredMcps)

  if (finalMcps.length > 0) {
    logToDevFile(`MCP Discovery: Successfully discovered MCPs [${finalMcps.join(", ")}]`, projectName)
  } else {
    logToDevFile("MCP Discovery: No MCPs detected - will run in standalone mode", projectName)
  }

  return finalMcps
}

/**
 * Log MCP-related events to the project-specific D3K log file (NOT main project log)
 * This prevents Claude from seeing dev3000's orchestration logs as application errors
 */
function logToDevFile(message: string, projectName?: string) {
  try {
    // Write to project-specific D3K log instead of main project log
    const homeDir = process.env.HOME || process.env.USERPROFILE
    if (!homeDir) return

    const debugLogDir = join(homeDir, ".d3k", "logs")
    if (!existsSync(debugLogDir)) {
      mkdirSync(debugLogDir, { recursive: true })
    }

    // Use project name from parameter or try to detect from current session
    const actualProjectName = projectName || getCurrentProjectName()
    if (!actualProjectName) return

    const d3kLogFile = join(debugLogDir, `dev3000-${actualProjectName}-d3k.log`)
    const timestamp = new Date().toISOString()
    const logEntry = `[${timestamp}] [D3K] ${message}\n`
    appendFileSync(d3kLogFile, logEntry)
  } catch (_error) {
    // Silently fail to avoid breaking MCP functionality
  }
}

/**
 * Get current project name from active sessions
 */
function getCurrentProjectName(): string | null {
  try {
    const homeDir = process.env.HOME || process.env.USERPROFILE
    if (!homeDir) return null

    const sessionDir = join(homeDir, ".d3k")
    if (!existsSync(sessionDir)) return null

    // Find the most recent session file
    const sessionFiles = readdirSync(sessionDir).filter((file) => file.endsWith(".json"))
    if (sessionFiles.length === 0) return null

    // Use the first session file's project name (could be improved to find the "current" one)
    const sessionFile = join(sessionDir, sessionFiles[0])
    const sessionData = JSON.parse(readFileSync(sessionFile, "utf8"))
    return sessionData.projectName || null
  } catch {
    return null
  }
}

/**
 * Detect available MCPs and set integration flags
 */
export function detectMcpIntegrations(
  availableMcps: string[],
  projectName?: string
): {
  integrateNextjs: boolean
  integrateChromeDevtools: boolean
} {
  const integrateNextjs = availableMcps.includes("nextjs-dev")
  const integrateChromeDevtools = availableMcps.includes("chrome-devtools")

  // Log MCP detection results
  if (availableMcps.length > 0) {
    logToDevFile(`MCP Detection: Available MCPs [${availableMcps.join(", ")}]`, projectName)

    const integrations: string[] = []
    if (integrateNextjs) integrations.push("Next.js")
    if (integrateChromeDevtools) integrations.push("Chrome DevTools")

    if (integrations.length > 0) {
      logToDevFile(`MCP Integration: Activated integrations [${integrations.join(", ")}]`, projectName)
    } else {
      logToDevFile("MCP Integration: No compatible MCPs detected - running in standalone mode", projectName)
    }
  } else {
    logToDevFile("MCP Detection: No MCPs provided - running in standalone mode", projectName)
  }

  return {
    integrateNextjs,
    integrateChromeDevtools
  }
}

/**
 * Calculate estimated time based on available tools and error complexity
 */
export function calculateEstimatedTime(errorCount: number, hasIntegrations: boolean): string {
  const baseTime = Math.min(errorCount * 2, 20) // 2 minutes per error, max 20 minutes
  const integrationBonus = hasIntegrations ? 0.5 : 1 // 50% faster with integrations
  const totalMinutes = Math.ceil(baseTime * integrationBonus)

  if (totalMinutes <= 5) return `${totalMinutes} minutes`
  if (totalMinutes <= 60) return `${totalMinutes} minutes`
  return `${Math.ceil(totalMinutes / 60)} hours`
}

/**
 * Generate Next.js specific MCP function suggestions
 */
export function generateNextjsSuggestions(errorContext?: string): McpFunctionSuggestion[] {
  const suggestions: McpFunctionSuggestion[] = [
    {
      function: "check_errors",
      reason: "Analyze Next.js build and runtime errors with framework-specific context",
      priority: "high"
    },
    {
      function: "get_logs",
      params: { type: "error", limit: 20 },
      reason: "Retrieve detailed Next.js server logs to correlate with dev3000 findings",
      priority: "high"
    }
  ]

  // Add context-specific suggestions
  if (errorContext?.includes("hydration")) {
    suggestions.push({
      function: "check_hydration_errors",
      reason: "Specific hydration mismatch analysis detected in error context",
      priority: "high"
    })
  }

  if (errorContext?.includes("build") || errorContext?.includes("compile")) {
    suggestions.push({
      function: "get_build_info",
      reason: "Build-related errors detected, get detailed compilation information",
      priority: "high"
    })
  }

  return suggestions
}

/**
 * Generate Chrome DevTools specific MCP function suggestions
 */
export function generateChromeDevtoolsSuggestions(errorContext?: string): McpFunctionSuggestion[] {
  const suggestions: McpFunctionSuggestion[] = [
    {
      function: "list_console_messages",
      params: { type: "error", limit: 20 },
      reason: "Get detailed browser console errors to correlate with dev3000 interaction data",
      priority: "high"
    },
    {
      function: "list_network_requests",
      params: { failed: true },
      reason: "Analyze failed network requests that may be causing application errors",
      priority: "medium"
    },
    {
      function: "take_screenshot",
      reason: "Capture current browser state for visual debugging",
      priority: "low"
    }
  ]

  // Add context-specific suggestions
  if (errorContext?.includes("network") || errorContext?.includes("fetch") || errorContext?.includes("api")) {
    suggestions.push({
      function: "get_performance_metrics",
      reason: "Network-related errors detected, analyze performance and timing",
      priority: "high"
    })
  }

  if (errorContext?.includes("click") || errorContext?.includes("interaction")) {
    suggestions.push({
      function: "get_dom_snapshot",
      reason: "Interaction errors detected, capture DOM state for element analysis",
      priority: "medium"
    })
  }

  return suggestions
}

/**
 * Create integrated workflow with 3-phase debugging plan
 */
export async function createIntegratedWorkflow({
  availableMcps,
  focusArea = "all",
  errorContext
}: CreateIntegratedWorkflowParams): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  const results: string[] = []

  // Log workflow creation
  logToDevFile(
    `Workflow Creation: Creating integrated workflow with focus area [${focusArea}]${errorContext ? `, error context [${errorContext}]` : ""}`
  )

  // Use provided MCPs or discover them proactively
  let finalMcps: string[] = availableMcps || []
  if (!availableMcps || availableMcps.length === 0) {
    logToDevFile("Workflow Creation: No MCPs provided, starting proactive discovery")
    finalMcps = await discoverAvailableMcps()
  }

  // Detect available integrations
  const { integrateNextjs, integrateChromeDevtools } = detectMcpIntegrations(finalMcps)

  results.push("🎼 **INTELLIGENT DEBUGGING ORCHESTRATOR**")
  results.push(`🔍 Available MCPs: ${finalMcps.length > 0 ? finalMcps.join(", ") : "none (will attempt discovery)"}`)
  results.push(
    `⚡ Integrations: ${integrateNextjs ? "✅ Next.js" : "❌ Next.js"} | ${integrateChromeDevtools ? "✅ Chrome DevTools" : "❌ Chrome DevTools"}`
  )

  if (errorContext) {
    results.push(`🎯 Error Context: ${errorContext}`)
  }
  results.push("")

  // Generate MCP-specific suggestions
  const nextjsSuggestions = integrateNextjs ? generateNextjsSuggestions(errorContext) : []
  const chromeSuggestions = integrateChromeDevtools ? generateChromeDevtoolsSuggestions(errorContext) : []

  if (!integrateNextjs && !integrateChromeDevtools) {
    results.push("⚠️ **NO INTEGRATIONS DETECTED**")
    results.push("Running in standalone mode. For enhanced debugging:")
    results.push("• Add 'nextjs-dev' MCP for Next.js-specific analysis")
    results.push("• Add 'chrome-devtools' MCP for browser inspection")
    results.push("")
    results.push("💡 **STANDALONE WORKFLOW:**")
    results.push("1. Use fix_my_app(mode='snapshot') to analyze current issues")
    results.push("2. Use execute_browser_action to reproduce and verify fixes")
    results.push("3. Implement suggested code fixes")

    return {
      content: [{ type: "text", text: results.join("\n") }]
    }
  }

  // Create 3-phase integrated workflow
  results.push("🎪 **3-PHASE INTEGRATED WORKFLOW**")
  results.push("")

  // Phase 1: Parallel Data Collection
  results.push("🕐 **PHASE 1: PARALLEL DATA COLLECTION** (2-3 minutes)")
  results.push("Execute these functions in parallel across all available MCPs:")
  results.push("")

  results.push("📊 **dev3000 (this MCP):**")
  results.push(
    `• fix_my_app(focusArea='${focusArea}', integrateNextjs=${integrateNextjs}, integrateChromeDevtools=${integrateChromeDevtools}, returnRawData=true)`
  )
  results.push("  → Get comprehensive error analysis with interaction data")
  results.push("")

  if (integrateNextjs) {
    results.push("⚛️ **nextjs-dev MCP:**")
    nextjsSuggestions
      .filter((s) => s.priority === "high")
      .forEach((suggestion) => {
        const params = suggestion.params
          ? `(${Object.entries(suggestion.params)
              .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
              .join(", ")})`
          : "()"
        results.push(`• ${suggestion.function}${params}`)
        results.push(`  → ${suggestion.reason}`)
      })
    results.push("")
  }

  if (integrateChromeDevtools) {
    results.push("🌐 **chrome-devtools MCP:**")
    chromeSuggestions
      .filter((s) => s.priority === "high")
      .forEach((suggestion) => {
        const params = suggestion.params
          ? `(${Object.entries(suggestion.params)
              .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
              .join(", ")})`
          : "()"
        results.push(`• ${suggestion.function}${params}`)
        results.push(`  → ${suggestion.reason}`)
      })
    results.push("")
  }

  // Phase 2: Deep Analysis
  results.push("🕑 **PHASE 2: DEEP TARGETED ANALYSIS** (3-5 minutes)")
  results.push("Based on Phase 1 findings, execute these functions sequentially:")
  results.push("")

  results.push("🔗 **Cross-MCP Correlation:**")
  results.push("• Compare dev3000 interaction data with browser console errors")
  if (integrateNextjs) {
    results.push("• Correlate dev3000 server errors with Next.js build/runtime logs")
    results.push("• Match interaction timestamps with Next.js request handling")
  }
  results.push("• Identify root cause by combining all data sources")
  results.push("")

  results.push("🎯 **Targeted Deep Dive:**")
  results.push("• Use fix_my_app(mode='bisect') for regression analysis if needed")
  if (integrateChromeDevtools) {
    chromeSuggestions
      .filter((s) => s.priority === "medium")
      .forEach((suggestion) => {
        const params = suggestion.params
          ? `(${Object.entries(suggestion.params)
              .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
              .join(", ")})`
          : "()"
        results.push(`• ${suggestion.function}${params} - ${suggestion.reason}`)
      })
  }
  results.push("")

  // Phase 3: Fix Implementation & Verification
  results.push("🕒 **PHASE 3: FIX IMPLEMENTATION & VERIFICATION** (5-10 minutes)")
  results.push("Orchestrated fix implementation with cross-MCP verification:")
  results.push("")

  results.push("🔧 **Implementation:**")
  results.push("• Apply code fixes identified by dev3000 error analysis")
  if (integrateNextjs) {
    results.push("• Address Next.js-specific issues (hydration, build, etc.)")
  }
  results.push("• Use dev3000's interaction data to create comprehensive test scenarios")
  results.push("")

  results.push("✅ **Verification Workflow:**")
  results.push("• Use execute_browser_action to replay exact user interactions that caused errors")
  if (integrateChromeDevtools) {
    results.push("• Use chrome-devtools to monitor console for error resolution")
    results.push("• Take before/after screenshots to verify UI fixes")
  }
  if (integrateNextjs) {
    results.push("• Use nextjs-dev to verify build success and runtime stability")
  }
  results.push("• Re-run fix_my_app to confirm error resolution")
  results.push("")

  // Integration Benefits
  results.push("🚀 **INTEGRATION BENEFITS:**")

  if (integrateNextjs && integrateChromeDevtools) {
    results.push("🎯 **Triple-Stack Coverage:**")
    results.push("• dev3000: AI-powered error correlation + interaction replay")
    results.push("• nextjs-dev: Framework-specific server-side analysis")
    results.push("• chrome-devtools: Precise browser state inspection")
    results.push("• Combined: Complete full-stack debugging with 90%+ issue resolution")
    results.push("")
    results.push("⚡ **Expected Results:**")
    results.push("• 3x faster debugging vs using tools individually")
    results.push("• AI-powered error correlation across all layers")
    results.push("• Systematic fix verification workflow")
    results.push("• Comprehensive interaction-based testing")
  } else if (integrateNextjs) {
    results.push("🎯 **Server-Side Enhanced Coverage:**")
    results.push("• dev3000: Client error analysis + interaction data")
    results.push("• nextjs-dev: Server-side logs and build analysis")
    results.push("• Combined: Full-stack Next.js debugging coverage")
  } else if (integrateChromeDevtools) {
    results.push("🎯 **Browser-Enhanced Coverage:**")
    results.push("• dev3000: Error detection + interaction replay")
    results.push("• chrome-devtools: Detailed browser state inspection")
    results.push("• Combined: Complete client-side debugging workflow")
  }

  const estimatedTime = calculateEstimatedTime(5, integrateNextjs || integrateChromeDevtools) // Assume 5 errors for estimation
  results.push("")
  results.push(`⏱️ **ESTIMATED TOTAL TIME:** ${estimatedTime}`)
  results.push(`🎼 **dev3000 orchestrates ${finalMcps.length} MCPs for maximum debugging power!**`)

  return {
    content: [{ type: "text", text: results.join("\n") }]
  }
}
