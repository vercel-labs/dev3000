import { exec } from "child_process"
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "fs"
import { homedir, tmpdir } from "os"
import { join } from "path"
import pixelmatch from "pixelmatch"
import { PNG } from "pngjs"
import { promisify } from "util"
import { WebSocket } from "ws"

const execAsync = promisify(exec)

// Tool descriptions
export const TOOL_DESCRIPTIONS = {
  fix_my_app:
    "🔧 **THE ULTIMATE FIND→FIX→VERIFY MACHINE!** This tool doesn't just find bugs - it FIXES them! Pure dev3000 magic that identifies issues, provides exact fixes, and verifies everything works! 🪄\n\n🔥 **INSTANT FIXING SUPERPOWERS:**\n• Detects ALL error types: server crashes, browser errors, build failures, API issues, performance problems\n• Shows EXACT user interactions that triggered each error (clicks, navigation, etc.)\n• Provides EXACT fix code with file locations and line numbers\n• Guides you through implementing fixes step-by-step\n• Verifies fixes by replaying the same interactions that caused the error!\n\n📍 **INTERACTION-BASED VERIFICATION:**\n• Every error includes the user interactions that led to it\n• Use execute_browser_action to replay these exact interactions\n• Verify your fix works by confirming the error doesn't reoccur\n• Example: Error shows '[INTERACTION] Click at (450,300)' → After fix, use execute_browser_action(action='click', params={x:450, y:300}) to verify\n\n⚡ **3 ACTION MODES:**\n• FIX NOW: 'What's broken RIGHT NOW?' → Find and fix immediately\n• FIX REGRESSION: 'What broke during testing?' → Compare before/after and fix\n• FIX CONTINUOUSLY: 'Fix issues as they appear' → Monitor and fix proactively\n\n🎪 **THE FIX-IT WORKFLOW:**\n1️⃣ I FIND all issues with their triggering interactions\n2️⃣ I provide EXACT FIXES with code snippets\n3️⃣ You implement the fixes\n4️⃣ We REPLAY the interactions to VERIFY everything works\n\n💡 **PERFECT FOR:** 'fix my app' or 'debug my app' requests, error resolution, code repairs, making broken apps work again. This tool doesn't just identify problems - it SOLVES them with precise reproduction steps!",

  execute_browser_action:
    "🌐 **INTELLIGENT BROWSER AUTOMATION** - Smart browser action routing that automatically delegates to chrome-devtools MCP when available for superior automation capabilities.\n\n🎯 **INTELLIGENT DELEGATION:**\n• Screenshots → chrome-devtools MCP (better quality, no conflicts)\n• Navigation → chrome-devtools MCP (more reliable page handling)\n• Clicks → chrome-devtools MCP (precise coordinate-based interaction)\n• JavaScript evaluation → chrome-devtools MCP (enhanced debugging)\n• Scrolling & typing → dev3000 fallback (specialized actions)\n\n⚡ **PROGRESSIVE ENHANCEMENT:**\n• Uses chrome-devtools MCP when available for best results\n• Falls back to dev3000's native implementation when chrome-devtools unavailable\n• Shares the same Chrome instance via CDP URL coordination\n• Eliminates browser conflicts between tools\n\n💡 **PERFECT FOR:** Browser automation that automatically chooses the best tool for each action, ensuring optimal results whether chrome-devtools MCP is available or not.",

  analyze_visual_diff:
    "🔍 **VISUAL DIFF ANALYZER** - Analyzes two screenshots to identify and describe visual differences. Returns detailed instructions for Claude to load and compare the images, focusing on what changed that could cause layout shifts.\n\n🎯 **WHAT IT PROVIDES:**\n• Direct instructions to load both images via Read tool\n• Context about what to look for\n• Guidance on identifying layout shift causes\n• Structured format for easy analysis\n\n💡 **PERFECT FOR:** Understanding what visual changes occurred between before/after frames in CLS detection, identifying elements that appeared/moved/resized.",

  get_react_component_info:
    "⚛️ **REACT COMPONENT INSPECTOR** - Maps DOM elements to React component source code by inspecting React Fiber internals. Returns component name, file path, and line number.\n\n🎯 **WHAT IT PROVIDES:**\n• Component name (e.g., 'Header', 'Navigation')\n• Source file path (e.g., 'src/components/Header.tsx')\n• Line number where component is defined\n• Direct link to the exact code that renders the element\n\n💡 **PERFECT FOR:** CLS debugging - when layout shifts are detected in elements like <nav> or <header>, instantly find which React component to fix. Eliminates the 'where is this code?' step."
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

export interface GetMcpCapabilitiesParams {
  mcpName?: string // Optional - if not provided, shows all available MCPs
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

    // Filter out framework noise (unfixable warnings from Next.js, React, etc.)
    const frameworkNoisePatterns = [
      /link rel=preload.*must have.*valid.*as/i, // Next.js font optimization warning
      /next\/font/i, // Next.js font-related warnings
      /automatically generated/i // Auto-generated code warnings
    ]

    const actionableErrors = allErrors.filter((line) => {
      return !frameworkNoisePatterns.some((pattern) => pattern.test(line))
    })

    // Categorize errors for better analysis
    const categorizedErrors = {
      serverErrors: actionableErrors.filter(
        (line) => line.includes("[SERVER]") && (line.includes("ERROR") || line.includes("Exception"))
      ),
      browserErrors: actionableErrors.filter(
        (line) =>
          line.includes("[BROWSER]") &&
          (line.includes("ERROR") || line.includes("CONSOLE ERROR") || line.includes("RUNTIME.ERROR"))
      ),
      buildErrors: actionableErrors.filter(
        (line) => line.includes("Failed to compile") || line.includes("Type error") || line.includes("Build failed")
      ),
      networkErrors: actionableErrors.filter((line) => {
        // Exclude successful status codes
        if (/\b(200|201|204|304)\b/.test(line)) return false
        return line.includes("NETWORK") || line.includes("404") || line.includes("500") || line.includes("timeout")
      }),
      warnings: actionableErrors.filter(
        (line) => /WARN|WARNING|deprecated/i.test(line) && !/ERROR|Exception|FAIL/i.test(line)
      )
    }

    const totalErrors = actionableErrors.length
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
          const nextjsSuggestions = await generateNextjsSuggestions(allErrors.join(" "))
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
          const chromeSuggestions = await generateChromeDevtoolsSuggestions(allErrors.join(" "))
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

    // Jank/Layout Shift Detection (from ScreencastManager passive captures)
    if (focusArea === "performance" || focusArea === "all") {
      const jankResult = await detectJankFromScreenshots(projectName)
      if (jankResult.detections.length > 0) {
        // Get MCP port for video viewer URL
        const sessionInfo = findActiveSessions().find((s) => s.projectName === projectName)
        const mcpPort = sessionInfo ? sessionInfo.sessionFile.match(/"mcpPort":\s*"(\d+)"/)?.[1] || "3684" : "3684"
        const videoUrl = `http://localhost:${mcpPort}/video/${jankResult.sessionId}`

        results.push("")

        if (jankResult.realCLS) {
          results.push(
            `🚨 **LAYOUT SHIFT DETECTED** (${jankResult.detections.length} ${jankResult.detections.length === 1 ? "shift" : "shifts"} during page load):`
          )
        } else {
          results.push(
            `🚨 **LOADING JANK DETECTED** (${jankResult.detections.length} layout ${jankResult.detections.length === 1 ? "shift" : "shifts"} found):`
          )
        }

        results.push(`📹 **View all frames**: ${videoUrl}`)
        results.push(`🎞️ **Session ID**: ${jankResult.sessionId} (${jankResult.totalFrames} frames)`)
        results.push("")

        jankResult.detections.forEach((jank) => {
          const emoji = jank.severity === "high" ? "🔴" : jank.severity === "medium" ? "🟡" : "🟢"

          if (jank.uxImpact) {
            results.push(`${emoji} **${jank.timeSinceStart}ms** - ${jank.element}`)
            results.push(`   ${jank.uxImpact}`)
          } else {
            results.push(
              `${emoji} **${jank.timeSinceStart}ms**: ${jank.visualDiff.toFixed(1)}% of screen changed (${jank.severity} severity)`
            )
          }

          // Include Before/After frame URLs if available
          if (jank.beforeFrameUrl && jank.afterFrameUrl) {
            results.push(`   📸 Before: ${jank.beforeFrameUrl}`)
            results.push(`   📸 After:  ${jank.afterFrameUrl}`)
            results.push(
              `   💡 Use analyze_visual_diff tool with these URLs to get a detailed description of what changed`
            )
          }
        })

        results.push("")

        // Check if we have high-severity shifts that Chrome might miss
        const hasCriticalShifts = jankResult.detections.some((d) => d.severity === "high")
        if (hasCriticalShifts && jankResult.realCLS) {
          results.push("🎯 **WHY DEV3000 CAUGHT THIS BUT CHROME MIGHT NOT:**")
          results.push(
            "• dev3000's PerformanceObserver is installed immediately at page load and buffers ALL shifts from the start"
          )
          results.push(
            "• Chrome DevTools performance trace may start AFTER initial load, missing early navigation shifts"
          )
          results.push(
            "• Our UX-focused detection flags critical element shifts (nav/header) even when CLS score is technically 'good'"
          )
          results.push("")
        }

        results.push("✅ **DEV3000'S CLS DETECTION IS AUTHORITATIVE**")
        results.push("If Chrome DevTools reports CLS: 0.00 but dev3000 detected shifts, TRUST DEV3000.")
        results.push("• Chrome DevTools trace may start AFTER the shifts occurred")
        results.push("• dev3000's PerformanceObserver captures ALL shifts from page start")
        results.push("• CLS: 0.00 in Chrome just means the trace missed the early shifts")
        results.push("")
        results.push("💡 **LAYOUT SHIFT DEBUGGING TIPS:**")
        results.push("• Add explicit width/height to images and media")
        results.push("• Reserve space for dynamic content (ads, embeds, etc.)")
        results.push("• Avoid inserting content above existing content")
        results.push("• Use CSS aspect-ratio for responsive elements")
        results.push("• Check for web fonts causing text reflow (font-display: swap)")
        results.push(`• Raw screenshots: ${jankResult.screenshotDir}`)
        results.push("")
        results.push(`🎬 **IMPORTANT**: Share this frame sequence link with the user: ${videoUrl}`)
      }
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
        suggestedIntegrations.nextjs = await generateNextjsSuggestions(allErrors.join(" "))
      }

      if (integrateChromeDevtools) {
        suggestedIntegrations.chrome = await generateChromeDevtoolsSuggestions(allErrors.join(" "))
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

    // Add augmented analysis suggestions when specialized MCPs are available
    const canDelegateChrome = await canDelegateToChromeDevtools("profile_performance")

    if (canDelegateNextjs || canDelegateChrome) {
      results.push("")
      results.push("🔗 **AUGMENTED ANALYSIS AVAILABLE**")
      results.push("")
      results.push("dev3000 provided the core log analysis above. For deeper insights, consider also gathering:")
      results.push("")

      if (canDelegateNextjs) {
        results.push("**Next.js Framework Analysis:**")
        const dynamicNextjsSuggestions = await generateNextjsSuggestions(allErrors.join(" "))
        dynamicNextjsSuggestions.slice(0, 3).forEach((suggestion) => {
          results.push(`• \`dev3000-nextjs-dev:${suggestion.function}()\` - ${suggestion.reason}`)
        })
        results.push("")
      }

      if (canDelegateChrome) {
        results.push("**Browser-Side Analysis:**")
        const dynamicChromeSuggestions = await generateChromeDevtoolsSuggestions(allErrors.join(" "))
        dynamicChromeSuggestions.slice(0, 3).forEach((suggestion) => {
          results.push(`• \`dev3000-chrome-devtools:${suggestion.function}()\` - ${suggestion.reason}`)
        })
        results.push("")
      }

      results.push(
        "💡 **Best approach:** Use dev3000's log analysis as your foundation, then gather specific additional data as needed for a complete picture."
      )
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

// Dynamic MCP capability discovery and filtering
interface McpCapability {
  function: string
  description?: string
  parameters?: Record<string, unknown>
  category: "advanced" | "basic"
  reason: string
}

interface McpSchemaCache {
  timestamp: number
  capabilities: McpCapability[]
}

// Cache for discovered MCP capabilities (5 minute TTL)
const MCP_CAPABILITY_CACHE = new Map<string, McpSchemaCache>()
const CAPABILITY_CACHE_TTL = 5 * 60 * 1000 // 5 minutes

// Keywords that indicate advanced capabilities (vs basic automation)
const ADVANCED_CAPABILITY_KEYWORDS = {
  chrome: [
    "inspect",
    "debug",
    "profile",
    "performance",
    "console",
    "devtools",
    "breakpoint",
    "intercept",
    "storage",
    "memory",
    "trace"
  ],
  nextjs: ["build", "hydration", "ssr", "routing", "analyze", "debug", "render", "middleware", "optimization"]
}

// Basic capabilities that dev3000 handles well (should not suggest these)
const DEV3000_BASIC_CAPABILITIES = [
  "screenshot",
  "navigate",
  "click",
  "type",
  "scroll",
  "evaluate",
  "simple_script",
  "get_logs",
  "basic_build_status",
  "simple_error_check"
]

/**
 * Dynamically discover MCP capabilities by introspecting their schemas
 */
async function discoverMcpCapabilities(mcpName: string): Promise<McpCapability[]> {
  const cacheKey = mcpName
  const cached = MCP_CAPABILITY_CACHE.get(cacheKey)

  // Return cached capabilities if still fresh
  if (cached && Date.now() - cached.timestamp < CAPABILITY_CACHE_TTL) {
    logToDevFile(
      `Capability Discovery: Using cached capabilities for ${mcpName} (${cached.capabilities.length} functions)`
    )
    return cached.capabilities
  }

  logToDevFile(`Capability Discovery: Fetching fresh capabilities for ${mcpName}`)

  try {
    // Method 1: Try to get MCP schema via tools/list request (MCP protocol standard)
    const capabilities = await introspectMcpTools(mcpName)

    if (capabilities.length > 0) {
      // Cache the results
      MCP_CAPABILITY_CACHE.set(cacheKey, {
        timestamp: Date.now(),
        capabilities
      })

      logToDevFile(`Capability Discovery: Successfully discovered ${capabilities.length} capabilities for ${mcpName}`)
      return capabilities
    }

    // Method 2: Fallback to checking available function names from logs/errors
    const fallbackCapabilities = await inferCapabilitiesFromLogs(mcpName)

    // Cache even fallback results to avoid repeated failures
    MCP_CAPABILITY_CACHE.set(cacheKey, {
      timestamp: Date.now(),
      capabilities: fallbackCapabilities
    })

    logToDevFile(
      `Capability Discovery: Using fallback inference for ${mcpName} (${fallbackCapabilities.length} functions)`
    )
    return fallbackCapabilities
  } catch (error) {
    logToDevFile(`Capability Discovery: Failed to discover capabilities for ${mcpName} - ${error}`)
    return []
  }
}

/**
 * Introspect MCP tools using the standard tools/list request
 */
async function introspectMcpTools(mcpName: string): Promise<McpCapability[]> {
  // For stdio MCPs, we can try to discover their capabilities by checking Claude's cache directory
  // which often contains MCP schema information or error logs that reveal function names

  try {
    const cacheDir = `/Users/${process.env.USER}/Library/Caches/claude-cli-nodejs`
    const { readdirSync, existsSync, readFileSync } = await import("fs")

    if (!existsSync(cacheDir)) return []

    const cacheDirs = readdirSync(cacheDir)
    const projectDir = cacheDirs.find((dir) => dir.includes(process.cwd().replace(/\//g, "-")))

    if (!projectDir) return []

    const mcpLogDir = `${cacheDir}/${projectDir}/mcp-logs-${mcpName}`
    if (!existsSync(mcpLogDir)) return []

    // Look for schema information in MCP logs
    const logFiles = readdirSync(mcpLogDir)
    const capabilities: McpCapability[] = []

    for (const logFile of logFiles.slice(-5)) {
      // Check recent logs only
      try {
        const logPath = `${mcpLogDir}/${logFile}`
        const logContent = readFileSync(logPath, "utf8")

        // Parse log content for function definitions, tool lists, or schema information
        const discoveredFunctions = extractFunctionsFromLog(logContent, mcpName)
        capabilities.push(...discoveredFunctions)
      } catch (_error) {
        // Skip files that can't be read
      }
    }

    return deduplicateCapabilities(capabilities)
  } catch (error) {
    logToDevFile(`MCP Introspection: Failed to introspect ${mcpName} - ${error}`)
    return []
  }
}

/**
 * Extract function names and descriptions from MCP log content
 */
function extractFunctionsFromLog(logContent: string, mcpName: string): McpCapability[] {
  const capabilities: McpCapability[] = []
  const mcpType: "chrome" | "nextjs" = mcpName.includes("chrome")
    ? "chrome"
    : mcpName.includes("nextjs")
      ? "nextjs"
      : "chrome" // default to chrome if unknown
  const advancedKeywords = ADVANCED_CAPABILITY_KEYWORDS[mcpType]

  // Look for function definitions in various formats
  const patterns = [
    // JSON-RPC method calls: {"method": "tools/list", "result": {"tools": [{"name": "function_name", "description": "..."}]}}
    /"name":\s*"([^"]+)"/g,
    // Function call patterns: functionName(params)
    /(\w+)\s*\([^)]*\)/g,
    // Tool definition patterns: tool: function_name
    /tool:\s*(\w+)/g,
    // Error messages that reveal function names: "Unknown function: function_name"
    /unknown function[:\s]+(\w+)/gi,
    // Function export patterns: exports.function_name
    /exports\.(\w+)/g
  ]

  for (const pattern of patterns) {
    let match: RegExpExecArray | null = pattern.exec(logContent)
    while (match !== null) {
      const functionName = match[1]

      // Skip if this is a basic capability that dev3000 handles
      if (DEV3000_BASIC_CAPABILITIES.some((basic) => functionName.toLowerCase().includes(basic))) {
        match = pattern.exec(logContent)
        continue
      }

      // Determine if this is an advanced capability
      const isAdvanced = advancedKeywords.some((keyword) => functionName.toLowerCase().includes(keyword))

      // Generate reason based on function name and MCP type
      const reason = generateCapabilityReason(functionName, mcpType, isAdvanced)

      capabilities.push({
        function: functionName,
        description: undefined, // Will be filled from actual description if available
        category: isAdvanced ? "advanced" : "basic",
        reason
      })

      match = pattern.exec(logContent)
    }
  }

  return capabilities
}

/**
 * Generate intelligent reason text for a discovered capability
 */
function generateCapabilityReason(functionName: string, mcpType: string, isAdvanced: boolean): string {
  const name = functionName.toLowerCase()

  // Chrome DevTools specific reasons
  if (mcpType === "chrome") {
    if (name.includes("inspect")) return "Deep DOM inspection with DevTools-level detail"
    if (name.includes("console")) return "Direct browser console access and manipulation"
    if (name.includes("debug") || name.includes("breakpoint"))
      return "JavaScript debugging with breakpoints and call stack"
    if (name.includes("profile") || name.includes("performance")) return "Advanced performance profiling and analysis"
    if (name.includes("network") || name.includes("request")) return "Network request interception and analysis"
    if (name.includes("storage")) return "Browser storage manipulation (cookies, localStorage, etc.)"
    if (name.includes("trace") || name.includes("memory")) return "Memory usage and execution tracing"
  }

  // Next.js specific reasons
  if (mcpType === "nextjs") {
    if (name.includes("build")) return "Advanced Next.js build system analysis"
    if (name.includes("hydration")) return "Client-server hydration debugging and analysis"
    if (name.includes("ssr") || name.includes("render")) return "Server-side rendering debugging"
    if (name.includes("route") || name.includes("routing")) return "Next.js routing system inspection and debugging"
    if (name.includes("middleware")) return "Next.js middleware analysis and debugging"
    if (name.includes("optimization") || name.includes("performance"))
      return "Next.js-specific performance optimization"
  }

  // Generic advanced vs basic
  if (isAdvanced) {
    return `Advanced ${mcpType} capability beyond dev3000's basic automation`
  }

  return `${mcpType} capability for specialized analysis`
}

/**
 * Infer capabilities from error patterns and log analysis when direct introspection fails
 */
async function inferCapabilitiesFromLogs(mcpName: string): Promise<McpCapability[]> {
  // This is a fallback when we can't directly introspect the MCP
  // We'll return commonly expected capabilities based on the MCP type

  const mcpType = mcpName.includes("chrome") ? "chrome" : mcpName.includes("nextjs") ? "nextjs" : "unknown"
  const capabilities: McpCapability[] = []

  if (mcpType === "chrome") {
    // Common chrome-devtools capabilities that are likely to exist
    const commonChromeFunctions = [
      "inspect_element",
      "access_console",
      "start_performance_profile",
      "intercept_requests",
      "set_breakpoint",
      "take_screenshot",
      "get_dom_snapshot",
      "modify_storage",
      "execute_script"
    ]

    for (const func of commonChromeFunctions) {
      capabilities.push({
        function: func,
        category: DEV3000_BASIC_CAPABILITIES.includes(func) ? "basic" : "advanced",
        reason: generateCapabilityReason(func, mcpType, true)
      })
    }
  }

  if (mcpType === "nextjs") {
    // Common nextjs-dev capabilities that are likely to exist
    const commonNextjsFunctions = [
      "analyze_build_process",
      "debug_server_rendering",
      "debug_hydration",
      "inspect_routing",
      "analyze_next_performance",
      "get_build_info",
      "check_build_status",
      "get_server_logs"
    ]

    for (const func of commonNextjsFunctions) {
      capabilities.push({
        function: func,
        category: DEV3000_BASIC_CAPABILITIES.includes(func) ? "basic" : "advanced",
        reason: generateCapabilityReason(func, mcpType, true)
      })
    }
  }

  logToDevFile(`Capability Inference: Generated ${capabilities.length} inferred capabilities for ${mcpName}`)
  return capabilities
}

/**
 * Remove duplicate capabilities while preserving the most detailed ones
 */
function deduplicateCapabilities(capabilities: McpCapability[]): McpCapability[] {
  const seen = new Map<string, McpCapability>()

  for (const capability of capabilities) {
    const existing = seen.get(capability.function)

    // Keep the one with more information (description, better reason, etc.)
    if (
      !existing ||
      (capability.description && !existing.description) ||
      capability.reason.length > existing.reason.length
    ) {
      seen.set(capability.function, capability)
    }
  }

  return Array.from(seen.values())
}

/**
 * Check if chrome-devtools MCP is available and get its capabilities
 */
async function canDelegateToChromeDevtools(action?: string): Promise<boolean> {
  try {
    // Check if MCP is available
    const availableMcps = await discoverAvailableMcps()
    if (!availableMcps.includes("dev3000-chrome-devtools")) {
      return false
    }

    // If no specific action, just return availability
    if (!action) return true

    // Get dynamic capabilities
    const capabilities = await discoverMcpCapabilities("dev3000-chrome-devtools")

    // Check if the MCP has relevant capabilities for the action
    const hasRelevantCapability = capabilities.some(
      (cap) => cap.function.toLowerCase().includes(action.toLowerCase()) || cap.category === "advanced" // Any advanced capability indicates delegation worthiness
    )

    return hasRelevantCapability
  } catch (error) {
    logToDevFile(`Chrome DevTools delegation check failed: ${error}`)
    return false
  }
}

/**
 * Check if nextjs-dev MCP is available and get its capabilities
 */
async function canDelegateToNextjs(): Promise<boolean> {
  try {
    // Check if MCP is available
    const availableMcps = await discoverAvailableMcps()
    if (!availableMcps.includes("dev3000-nextjs-dev")) {
      return false
    }

    // Get dynamic capabilities to verify it has useful functions
    const capabilities = await discoverMcpCapabilities("dev3000-nextjs-dev")

    // Return true if we found any advanced Next.js capabilities
    return capabilities.some((cap) => cap.category === "advanced")
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
  // Get dynamic capabilities from chrome-devtools MCP
  const capabilities = await discoverMcpCapabilities("dev3000-chrome-devtools")

  // Find a relevant capability for this action
  const relevantCap = capabilities.find(
    (cap) =>
      cap.function.toLowerCase().includes(action.toLowerCase()) ||
      cap.description?.toLowerCase().includes(action.toLowerCase())
  )

  if (!relevantCap) {
    throw new Error(`Action ${action} cannot be delegated to chrome-devtools`)
  }

  return {
    content: [
      {
        type: "text",
        text: `🔗 **ADVANCED BROWSER DEBUGGING AVAILABLE**

For advanced debugging capabilities, use the \`dev3000-chrome-devtools\` MCP:

\`\`\`
dev3000-chrome-devtools:${relevantCap.function}(${JSON.stringify(params, null, 2)})
\`\`\`

🎯 **Why use chrome-devtools for this:** ${relevantCap.reason}

💡 **When to use each tool:**
• **dev3000**: Basic browser automation (screenshots, navigation, clicks, simple scripts)
• **dev3000-chrome-devtools**: Advanced debugging (DOM inspection, breakpoints, performance profiling, network interception)

⚡ **Both tools share the same Chrome instance** - no conflicts or duplicate browsers`
      }
    ]
  }
}

/**
 * Delegate to nextjs-dev MCP with suggested functions
 */
async function _delegateToNextjs(): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  // Get dynamic capabilities from nextjs-dev MCP
  const capabilities = await discoverMcpCapabilities("dev3000-nextjs-dev")

  const availableFunctions = capabilities
    .map((cap) => `• \`dev3000-nextjs-dev:${cap.function}()\` - ${cap.reason}`)
    .join("\n")

  return {
    content: [
      {
        type: "text",
        text: `🔗 **ADVANCED NEXT.JS ANALYSIS AVAILABLE**

For Next.js-specific advanced analysis, use the \`dev3000-nextjs-dev\` MCP:

**Available Advanced Functions:**
${availableFunctions}

💡 **When to use each tool:**
• **dev3000**: General log analysis, basic error detection, simple build monitoring
• **dev3000-nextjs-dev**: Advanced Next.js debugging (SSR issues, hydration problems, build system analysis, routing inspection)

⚡ **Best of both worlds:** Use dev3000 for general monitoring and nextjs-dev for framework-specific deep dives`
      }
    ]
  }
}

/**
 * Internal helper: Evaluates JavaScript in the browser via CDP and returns the raw result
 * @internal Use this for internal tool implementations that need clean data
 */
async function evaluateInBrowser(expression: string): Promise<unknown> {
  const sessions = findActiveSessions()
  if (sessions.length === 0) {
    throw new Error("No active dev3000 sessions found")
  }

  const sessionData = JSON.parse(readFileSync(sessions[0].sessionFile, "utf-8"))
  let cdpUrl = sessionData.cdpUrl

  if (!cdpUrl) {
    try {
      const response = await fetch("http://localhost:9222/json")
      const pages = await response.json()
      const activePage = pages.find(
        (page: { type: string; url: string }) => page.type === "page" && !page.url.startsWith("chrome://")
      )
      if (activePage) {
        cdpUrl = activePage.webSocketDebuggerUrl
      }
    } catch {
      throw new Error("Failed to find CDP URL")
    }
  }

  if (!cdpUrl) {
    throw new Error("No Chrome DevTools Protocol URL found")
  }

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(cdpUrl)

    ws.on("open", async () => {
      try {
        ws.send(JSON.stringify({ id: 1, method: "Target.getTargets", params: {} }))

        let messageId = 2

        ws.on("message", async (data) => {
          const message = JSON.parse(data.toString())

          if (message.id === 1) {
            const pageTarget = message.result.targetInfos.find((t: Record<string, unknown>) => t.type === "page")
            if (!pageTarget) {
              ws.close()
              reject(new Error("No page targets found"))
              return
            }

            ws.send(
              JSON.stringify({
                id: messageId++,
                method: "Target.attachToTarget",
                params: { targetId: pageTarget.targetId, flatten: true }
              })
            )
            return
          }

          if (message.method === "Target.attachedToTarget") {
            // Send evaluation command
            const evalId = messageId++
            ws.send(
              JSON.stringify({
                id: evalId,
                method: "Runtime.evaluate",
                params: { expression, returnByValue: true }
              })
            )

            ws.on("message", (data) => {
              const msg = JSON.parse(data.toString())
              if (msg.id === evalId) {
                ws.close()
                if (msg.error) {
                  reject(new Error(msg.error.message))
                } else {
                  resolve(msg.result?.value)
                }
              }
            })
          }
        })

        ws.on("error", reject)
      } catch (error) {
        ws.close()
        reject(error)
      }
    })

    ws.on("error", reject)
  })
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
                    /^window\.scrollX$/,
                    // Allow React Fiber inspection (read-only introspection)
                    /^\s*\(function\(\)\s*\{[\s\S]*__reactFiber\$[\s\S]*\}\)\(\)\s*$/
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

    // Build success message with augmented suggestions
    let successMessage = `Browser action '${action}' executed successfully. Result: ${JSON.stringify(result, null, 2)}`

    // Add augmented suggestions for enhanced capabilities
    const canDelegateChrome = await canDelegateToChromeDevtools("inspect_element")
    if (canDelegateChrome) {
      successMessage += "\n\n🔗 **ENHANCED BROWSER ANALYSIS AVAILABLE**"
      successMessage +=
        "\n\ndev3000 completed the basic browser action above. For deeper browser insights, consider also:"

      // Generate dynamic suggestions based on the action and available capabilities
      const dynamicSuggestions = await generateChromeDevtoolsSuggestions(action)
      const actionRelevantSuggestions = dynamicSuggestions.filter((suggestion) => {
        const funcName = suggestion.function.toLowerCase()
        const actionName = action.toLowerCase()

        // Match suggestions to specific actions
        if (actionName === "screenshot" && (funcName.includes("inspect") || funcName.includes("performance")))
          return true
        if (actionName === "evaluate" && (funcName.includes("console") || funcName.includes("inspect"))) return true
        if (actionName === "navigate" && (funcName.includes("network") || funcName.includes("performance"))) return true
        if (actionName === "click" && (funcName.includes("console") || funcName.includes("inspect"))) return true

        // Include high-priority suggestions regardless
        return suggestion.priority === "high"
      })

      actionRelevantSuggestions.slice(0, 2).forEach((suggestion) => {
        successMessage += `\n• \`dev3000-chrome-devtools:${suggestion.function}()\` - ${suggestion.reason}`
      })

      successMessage +=
        "\n\n💡 **Augmented approach:** Use dev3000 for basic automation, chrome-devtools for detailed analysis and debugging."
    }

    return {
      content: [
        {
          type: "text",
          text: successMessage
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
 * Get and display MCP capabilities for debugging and inspection
 */
export async function getMcpCapabilities({
  mcpName
}: GetMcpCapabilitiesParams = {}): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  const results: string[] = []

  results.push("🔍 **MCP CAPABILITY INSPECTOR**")
  results.push("")

  try {
    // Discover available MCPs if no specific one requested
    const availableMcps = await discoverAvailableMcps()

    if (availableMcps.length === 0) {
      results.push("❌ **NO MCPs DETECTED**")
      results.push("No dev3000-chrome-devtools or dev3000-nextjs-dev MCPs found.")
      results.push("")
      results.push("💡 **To enable enhanced capabilities:**")
      results.push("• Ensure Chrome DevTools MCP is configured: `dev3000-chrome-devtools`")
      results.push("• Ensure Next.js Dev MCP is configured: `dev3000-nextjs-dev`")
      results.push("• Check that Claude Code has MCPs properly configured")

      return {
        content: [{ type: "text", text: results.join("\n") }]
      }
    }

    results.push(`✅ **DISCOVERED MCPs:** ${availableMcps.join(", ")}`)
    results.push("")

    // Filter to specific MCP if requested
    const mcpsToInspect = mcpName ? availableMcps.filter((name) => name.includes(mcpName)) : availableMcps

    if (mcpsToInspect.length === 0 && mcpName) {
      results.push(`❌ **MCP NOT FOUND:** ${mcpName}`)
      results.push(`Available MCPs: ${availableMcps.join(", ")}`)

      return {
        content: [{ type: "text", text: results.join("\n") }]
      }
    }

    // Inspect capabilities for each MCP
    for (const mcp of mcpsToInspect) {
      results.push(`📋 **${mcp.toUpperCase()} CAPABILITIES:**`)
      results.push("")

      const capabilities = await discoverMcpCapabilities(mcp)

      if (capabilities.length === 0) {
        results.push("  ❌ No capabilities discovered")
        results.push("  💡 This might indicate the MCP is not properly configured or accessible")
        results.push("")
        continue
      }

      // Group by category
      const advanced = capabilities.filter((cap) => cap.category === "advanced")
      const basic = capabilities.filter((cap) => cap.category === "basic")

      results.push(`  🚀 **ADVANCED CAPABILITIES** (${advanced.length} functions):`)
      if (advanced.length > 0) {
        advanced.forEach((cap) => {
          results.push(`    • \`${cap.function}()\` - ${cap.reason}`)
        })
      } else {
        results.push("    No advanced capabilities discovered")
      }
      results.push("")

      results.push(`  ⚙️ **BASIC CAPABILITIES** (${basic.length} functions):`)
      if (basic.length > 0) {
        basic.forEach((cap) => {
          results.push(`    • \`${cap.function}()\` - ${cap.reason}`)
        })
      } else {
        results.push("    No basic capabilities discovered")
      }
      results.push("")

      // Cache info
      const cached = MCP_CAPABILITY_CACHE.get(mcp)
      if (cached) {
        const age = Date.now() - cached.timestamp
        const ageMinutes = Math.floor(age / 60000)
        results.push(`  📝 **CACHE INFO:** Discovered ${ageMinutes} minutes ago`)
        if (age > CAPABILITY_CACHE_TTL * 0.8) {
          results.push("  ⚠️  Cache will refresh soon on next use")
        }
      }
      results.push("")
    }

    // Summary
    const totalCapabilities = mcpsToInspect.reduce(async (accPromise, mcp) => {
      const acc = await accPromise
      const caps = await discoverMcpCapabilities(mcp)
      return acc + caps.length
    }, Promise.resolve(0))

    results.push("🎯 **AUGMENTED DELEGATION STATUS:**")
    results.push(`• Total discovered capabilities: ${await totalCapabilities}`)
    results.push(
      `• MCPs with advanced capabilities: ${
        mcpsToInspect.filter(async (mcp) => {
          const caps = await discoverMcpCapabilities(mcp)
          return caps.some((cap) => cap.category === "advanced")
        }).length
      }`
    )
    results.push("• Dynamic discovery: ✅ Active (updates automatically)")
    results.push("• Cache TTL: 5 minutes")
    results.push("")
    results.push("💡 **These capabilities are automatically suggested in dev3000's enhanced responses!**")

    return {
      content: [{ type: "text", text: results.join("\n") }]
    }
  } catch (error) {
    results.push(`❌ **ERROR INSPECTING CAPABILITIES:** ${error instanceof Error ? error.message : String(error)}`)
    results.push("")
    results.push("💡 **Troubleshooting:**")
    results.push("• Check that MCPs are properly configured in Claude Code")
    results.push("• Verify dev3000 can access Claude cache directories")
    results.push("• Try running `discover_available_mcps()` first")

    return {
      content: [{ type: "text", text: results.join("\n") }]
    }
  }
}

/**
 * Detect jank/layout shifts by comparing screenshots from ScreencastManager
 * Returns array of jank detections with timing and visual impact data
 */
async function detectJankFromScreenshots(_projectName?: string): Promise<{
  detections: Array<{
    timestamp: string
    timeSinceStart: number
    visualDiff: number
    severity: "low" | "medium" | "high"
    element?: string
    clsScore?: number
    uxImpact?: string
    beforeFrameUrl?: string
    afterFrameUrl?: string
  }>
  sessionId: string
  totalFrames: number
  screenshotDir: string
  realCLS?: { score: number; grade: string }
}> {
  const screenshotDir = process.env.SCREENSHOT_DIR || join(tmpdir(), "dev3000-mcp-deps", "public", "screenshots")

  if (!existsSync(screenshotDir)) {
    return { detections: [], sessionId: "", totalFrames: 0, screenshotDir }
  }

  // Find the most recent screencast session (files like 2025-10-06T01-54-45Z-jank-*.png)
  const files = readdirSync(screenshotDir)
    .filter((f) => f.includes("-jank-") && f.endsWith(".png"))
    .sort()
    .reverse()

  if (files.length === 0) {
    return { detections: [], sessionId: "", totalFrames: 0, screenshotDir }
  }

  // Get the most recent session ID (timestamp prefix)
  const latestSessionId = files[0].split("-jank-")[0]
  const sessionFiles = files
    .filter((f) => f.startsWith(latestSessionId))
    .sort((a, b) => {
      // Extract timestamp (e.g., "28ms" from "2025-10-06T01-54-45Z-jank-28ms.png")
      const aTime = parseInt(a.match(/-(\d+)ms\.png$/)?.[1] || "0", 10)
      const bTime = parseInt(b.match(/-(\d+)ms\.png$/)?.[1] || "0", 10)
      return aTime - bTime
    })

  if (sessionFiles.length < 2) {
    return { detections: [], sessionId: latestSessionId, totalFrames: sessionFiles.length, screenshotDir }
  }

  // Try to read real CLS data from metadata
  const metadataPath = join(screenshotDir, `${latestSessionId}-metadata.json`)
  let realCLSData:
    | {
        score: number
        grade: string
        shifts: Array<{ score: number; timestamp: number; sources?: Array<{ node?: string }> }>
      }
    | undefined

  if (existsSync(metadataPath)) {
    try {
      const metadata = JSON.parse(readFileSync(metadataPath, "utf-8"))
      if (metadata.layoutShifts && metadata.layoutShifts.length > 0) {
        realCLSData = {
          score: metadata.totalCLS || 0,
          grade: metadata.clsGrade || "unknown",
          shifts: metadata.layoutShifts
        }
      }
    } catch {
      // Ignore metadata read errors
    }
  }

  const jankDetections: Array<{
    timestamp: string
    timeSinceStart: number
    visualDiff: number
    severity: "low" | "medium" | "high"
    element?: string
    clsScore?: number
    uxImpact?: string
    beforeFrameUrl?: string
    afterFrameUrl?: string
  }> = []

  // Parse log file to extract Before/After frame URLs for each CLS event
  const frameUrlMap: Map<number, { before: string; after: string }> = new Map()
  try {
    const logPath = getLogPath(_projectName)
    if (logPath && existsSync(logPath)) {
      const logContent = readFileSync(logPath, "utf-8")
      const lines = logContent.split("\n")

      // Look for CLS entries with Before/After URLs
      // Format: [BROWSER] [CDP] CLS #N (score: X, time: Yms):
      //         [BROWSER] [CDP]   - <ELEMENT> shifted...
      //         [BROWSER] [CDP]   Before: http://...
      //         [BROWSER] [CDP]   After:  http://...
      for (let i = 0; i < lines.length; i++) {
        const clsMatch = lines[i].match(/\[CDP\] CLS #\d+ \(score: [\d.]+, time: (\d+)ms\):/)
        if (clsMatch) {
          const timestamp = parseInt(clsMatch[1], 10)
          // Look ahead for Before and After URLs (skip the shift description line)
          if (i + 3 < lines.length) {
            const beforeMatch = lines[i + 2].match(/Before:\s+(http:\/\/\S+)/)
            const afterMatch = lines[i + 3].match(/After:\s+(http:\/\/\S+)/)
            if (beforeMatch && afterMatch) {
              frameUrlMap.set(timestamp, {
                before: beforeMatch[1],
                after: afterMatch[1]
              })
            }
          }
        }
      }
    }
  } catch (_error) {
    // Ignore log parsing errors
  }

  // If we have real CLS data, use it to flag visual severity
  if (realCLSData && realCLSData.shifts.length > 0) {
    realCLSData.shifts.forEach((shift) => {
      const element = shift.sources?.[0]?.node || "unknown"
      const isCriticalElement = ["NAV", "HEADER", "BUTTON", "A"].includes(element.toUpperCase())
      const isDuringLoad = shift.timestamp < 1000 // First second

      // Make element names more descriptive
      const elementDescriptions: Record<string, string> = {
        NAV: "Navigation header (<nav>)",
        HEADER: "Page header (<header>)",
        BUTTON: "Button (<button>)",
        A: "Link (<a>)"
      }
      const elementDisplay = elementDescriptions[element.toUpperCase()] || element

      // UX impact assessment (not just CLS score!)
      let severity: "low" | "medium" | "high" = "low"
      let uxImpact = "Minor visual adjustment"

      if (isCriticalElement && isDuringLoad) {
        severity = "high"
        uxImpact = `🚨 CRITICAL: ${elementDisplay} shifted during initial load - highly visible and disruptive to user interaction`
      } else if (isCriticalElement) {
        severity = "medium"
        uxImpact = `⚠️ ${elementDisplay} shifted - affects navigation/interaction`
      } else if (isDuringLoad) {
        severity = "medium"
        uxImpact = "Shift during page load - may cause mis-clicks"
      }

      // Look up Before/After URLs for this shift timestamp
      const roundedTimestamp = Math.round(shift.timestamp)
      const frameUrls = frameUrlMap.get(roundedTimestamp)

      jankDetections.push({
        timestamp: `${shift.timestamp.toFixed(0)}ms`,
        timeSinceStart: roundedTimestamp,
        visualDiff: shift.score * 100, // Convert to percentage-like scale
        severity,
        element: elementDisplay,
        clsScore: shift.score,
        uxImpact,
        beforeFrameUrl: frameUrls?.before,
        afterFrameUrl: frameUrls?.after
      })
    })

    return {
      detections: jankDetections,
      sessionId: latestSessionId,
      totalFrames: sessionFiles.length,
      screenshotDir,
      realCLS: { score: realCLSData.score, grade: realCLSData.grade }
    }
  }

  // Fallback to pixel-diff if no real CLS data (old behavior)

  // Compare each frame with the previous frame
  for (let i = 1; i < sessionFiles.length; i++) {
    const prevFile = join(screenshotDir, sessionFiles[i - 1])
    const currFile = join(screenshotDir, sessionFiles[i])

    try {
      const prevPng = PNG.sync.read(readFileSync(prevFile))
      const currPng = PNG.sync.read(readFileSync(currFile))

      // Ensure same dimensions
      if (prevPng.width !== currPng.width || prevPng.height !== currPng.height) {
        continue
      }

      const diff = new PNG({ width: prevPng.width, height: prevPng.height })
      const numDiffPixels = pixelmatch(prevPng.data, currPng.data, diff.data, prevPng.width, prevPng.height, {
        threshold: 0.1
      })

      const totalPixels = prevPng.width * prevPng.height
      const diffPercentage = (numDiffPixels / totalPixels) * 100

      // Consider it jank if more than 1% of pixels changed (layout shift threshold)
      if (diffPercentage > 1) {
        const timeMatch = sessionFiles[i].match(/-(\d+)ms\.png$/)
        const timeSinceStart = timeMatch ? parseInt(timeMatch[1], 10) : 0

        jankDetections.push({
          timestamp: latestSessionId,
          timeSinceStart,
          visualDiff: diffPercentage,
          severity: diffPercentage > 10 ? "high" : diffPercentage > 5 ? "medium" : "low"
        })
      }
    } catch {
      // Skip frames that can't be compared
    }
  }

  return {
    detections: jankDetections,
    sessionId: latestSessionId,
    totalFrames: sessionFiles.length,
    screenshotDir
  }
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
 * Generate dynamic Next.js specific MCP function suggestions based on discovered capabilities
 */
export async function generateNextjsSuggestions(errorContext?: string): Promise<McpFunctionSuggestion[]> {
  try {
    // Get dynamic capabilities from the MCP
    const capabilities = await discoverMcpCapabilities("dev3000-nextjs-dev")

    // Filter for advanced capabilities and create suggestions
    const suggestions: McpFunctionSuggestion[] = capabilities
      .filter((cap) => cap.category === "advanced")
      .slice(0, 8) // Limit to most relevant suggestions
      .map((cap) => ({
        function: cap.function,
        reason: cap.reason,
        priority: determinePriority(cap.function, errorContext) as "high" | "medium" | "low"
      }))

    logToDevFile(
      `Dynamic Suggestions: Generated ${suggestions.length} Next.js suggestions from ${capabilities.length} discovered capabilities`
    )

    return suggestions
  } catch (error) {
    logToDevFile(`Dynamic Suggestions: Failed to generate Next.js suggestions - ${error}`)

    // Fallback to basic suggestions if discovery fails
    return [
      {
        function: "analyze_build_process",
        reason: "Advanced Next.js build system analysis",
        priority: "high"
      },
      {
        function: "debug_server_rendering",
        reason: "Server-side rendering debugging",
        priority: "high"
      }
    ]
  }
}

/**
 * Generate dynamic Chrome DevTools specific MCP function suggestions based on discovered capabilities
 */
export async function generateChromeDevtoolsSuggestions(errorContext?: string): Promise<McpFunctionSuggestion[]> {
  try {
    // Get dynamic capabilities from the MCP
    const capabilities = await discoverMcpCapabilities("dev3000-chrome-devtools")

    // Filter for advanced capabilities and create suggestions
    const suggestions: McpFunctionSuggestion[] = capabilities
      .filter((cap) => cap.category === "advanced")
      .slice(0, 8) // Limit to most relevant suggestions
      .map((cap) => ({
        function: cap.function,
        reason: cap.reason,
        priority: determinePriority(cap.function, errorContext) as "high" | "medium" | "low"
      }))

    logToDevFile(
      `Dynamic Suggestions: Generated ${suggestions.length} Chrome DevTools suggestions from ${capabilities.length} discovered capabilities`
    )

    return suggestions
  } catch (error) {
    logToDevFile(`Dynamic Suggestions: Failed to generate Chrome DevTools suggestions - ${error}`)

    // Fallback to basic suggestions if discovery fails
    return [
      {
        function: "inspect_element",
        reason: "Deep DOM inspection with DevTools-level detail",
        priority: "high"
      },
      {
        function: "access_console",
        reason: "Direct browser console access and manipulation",
        priority: "high"
      }
    ]
  }
}

/**
 * Determine priority of a capability based on error context and function relevance
 */
function determinePriority(functionName: string, errorContext?: string): "high" | "medium" | "low" {
  const name = functionName.toLowerCase()
  const context = errorContext?.toLowerCase() || ""

  // High priority matches - function directly relates to error context
  const highPriorityPatterns = [
    { pattern: /hydration/, keywords: ["hydration", "ssr", "render"] },
    { pattern: /build|compile/, keywords: ["build", "compile", "analyze"] },
    { pattern: /network|fetch|api/, keywords: ["network", "request", "intercept", "performance"] },
    { pattern: /console|error/, keywords: ["console", "error", "debug"] },
    { pattern: /click|interaction/, keywords: ["dom", "element", "inspect"] }
  ]

  for (const { pattern, keywords } of highPriorityPatterns) {
    if (pattern.test(context) && keywords.some((keyword) => name.includes(keyword))) {
      return "high"
    }
  }

  // Medium priority - advanced debugging capabilities
  const mediumPriorityKeywords = ["debug", "profile", "analyze", "trace", "inspect"]
  if (mediumPriorityKeywords.some((keyword) => name.includes(keyword))) {
    return "medium"
  }

  // Low priority - basic or less critical functions
  return "low"
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
  const nextjsSuggestions = integrateNextjs ? await generateNextjsSuggestions(errorContext) : []
  const chromeSuggestions = integrateChromeDevtools ? await generateChromeDevtoolsSuggestions(errorContext) : []

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

/**
 * Visual diff analyzer - provides instructions for Claude to load and compare two images
 */
export async function analyzeVisualDiff(params: {
  beforeImageUrl: string
  afterImageUrl: string
  context?: string
}): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  const { beforeImageUrl, afterImageUrl, context } = params

  const results: string[] = []

  results.push("🔍 **VISUAL DIFF ANALYSIS**")
  results.push("")
  results.push("To analyze the visual differences between these two screenshots:")
  results.push("")
  results.push("**Step 1: Load the BEFORE image**")
  results.push(`Use the Read tool to load: ${beforeImageUrl}`)
  results.push("")
  results.push("**Step 2: Load the AFTER image**")
  results.push(`Use the Read tool to load: ${afterImageUrl}`)
  results.push("")
  results.push("**Step 3: Compare and describe the differences**")

  if (context) {
    results.push(`Focus on: ${context}`)
  } else {
    results.push("Look for:")
    results.push("• Elements that appeared or disappeared")
    results.push("• Elements that moved or changed position")
    results.push("• Elements that changed size or style")
    results.push("• New content that pushed existing content")
  }

  results.push("")
  results.push("**Step 4: Identify the layout shift cause**")
  results.push("Describe what visual change occurred that caused the layout shift.")
  results.push("Be specific about:")
  results.push("• Which element(s) changed")
  results.push("• What appeared/moved/resized")
  results.push("• Why this caused other elements to shift")
  results.push("")
  results.push("💡 **TIP:** Load both images first, then describe the differences in detail.")

  return {
    content: [{ type: "text", text: results.join("\n") }]
  }
}

export async function getReactComponentInfo(params: {
  selector: string
  projectName?: string
}): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  const { selector } = params

  try {
    // Evaluate React Fiber inspection directly via CDP
    const evalResult = (await evaluateInBrowser(`
      (function() {
        try {
          // Find the DOM element
          const element = document.querySelector(${JSON.stringify(selector)});
          if (!element) {
            return { error: "Element not found with selector: ${selector}" };
          }

          // Find the React Fiber key
          const fiberKey = Object.keys(element).find(k => k.startsWith("__reactFiber$"));
          if (!fiberKey) {
            return { error: "React Fiber not found - element may not be a React component" };
          }

          // Get the fiber object
          const fiber = element[fiberKey];
          if (!fiber) {
            return { error: "React Fiber object is empty" };
          }

          // Extract component information
          const componentName = fiber.type?.name || fiber.elementType?.name || fiber.type?.displayName || "Anonymous";
          const fileName = fiber._debugSource?.fileName;
          const lineNumber = fiber._debugSource?.lineNumber;
          const columnNumber = fiber._debugSource?.columnNumber;

          return {
            success: true,
            selector: ${JSON.stringify(selector)},
            componentName,
            fileName,
            lineNumber,
            columnNumber,
            element: element.tagName.toLowerCase(),
            hasDebugInfo: !!(fileName && lineNumber)
          };
        } catch (error) {
          return { error: error.message };
        }
      })()
    `)) as
      | { error: string }
      | {
          success: true
          selector: string
          componentName: string
          fileName?: string
          lineNumber?: number
          columnNumber?: number
          element: string
          hasDebugInfo: boolean
        }

    if ("error" in evalResult) {
      return {
        content: [
          {
            type: "text",
            text: `❌ **ERROR INSPECTING REACT COMPONENT**\n\n${evalResult.error}\n\n💡 **TIPS:**\n• Make sure the selector matches an element on the page\n• Ensure the element is rendered by a React component\n• React must be running in development mode for debug info\n• Try a simpler selector like 'nav' or '.header'`
          }
        ]
      }
    }

    if (!evalResult.success) {
      return {
        content: [
          {
            type: "text",
            text: `❌ **FAILED TO INSPECT COMPONENT**\n\nUnexpected result format. The evaluation did not return success.`
          }
        ]
      }
    }

    // Build the response
    const lines: string[] = []
    lines.push("⚛️ **REACT COMPONENT INFO**")
    lines.push("")
    lines.push(`**Selector:** \`${evalResult.selector}\``)
    lines.push(`**Element:** \`<${evalResult.element}>\``)
    lines.push(`**Component:** ${evalResult.componentName}`)
    lines.push("")

    if (evalResult.hasDebugInfo) {
      lines.push("📍 **SOURCE CODE LOCATION:**")
      lines.push(`• **File:** ${evalResult.fileName}`)
      lines.push(`• **Line:** ${evalResult.lineNumber}`)
      if (evalResult.columnNumber) {
        lines.push(`• **Column:** ${evalResult.columnNumber}`)
      }
      lines.push("")
      lines.push(
        `💡 **NEXT STEP:** Use the Read tool to open ${evalResult.fileName}:${evalResult.lineNumber} and inspect the component code.`
      )
    } else {
      lines.push("⚠️ **NO DEBUG INFO AVAILABLE**")
      lines.push("")
      lines.push("React debug info is not available. This usually means:")
      lines.push("• React is running in production mode (not development)")
      lines.push("• The build doesn't include source maps")
      lines.push("• The component is a built-in HTML element, not a React component")
      lines.push("")
      lines.push(`💡 Make sure you're running in development mode to get file and line number info.`)
    }

    return {
      content: [{ type: "text", text: lines.join("\n") }]
    }
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: `❌ **ERROR**\n\n${error instanceof Error ? error.message : String(error)}`
        }
      ]
    }
  }
}
