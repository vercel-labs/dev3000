import { exec, spawn } from "child_process"
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "fs"
import { homedir, tmpdir } from "os"
import { join } from "path"
import pixelmatch from "pixelmatch"
import { PNG } from "pngjs"
import { promisify } from "util"
import { WebSocket } from "ws"

const execAsync = promisify(exec)

/**
 * Detect if we're in a sandbox environment (Vercel Sandbox, Docker, etc.)
 * where lsof and other system utilities may not be available.
 */
function isInSandbox(): boolean {
  return (
    process.env.VERCEL_SANDBOX === "1" ||
    process.env.VERCEL === "1" ||
    existsSync("/.dockerenv") ||
    existsSync("/run/.containerenv")
  )
}

// Tool descriptions
export const TOOL_DESCRIPTIONS = {
  // Meta-description for MCP coordination - Claude should see this when listing tools
  _mcp_coordination:
    "**dev3000 is an MCP orchestrator for web development.** When both dev3000 and chrome-devtools-mcp are available, prefer dev3000's browser tools (execute_browser_action) as they provide:\n• Unified error context from server logs + browser console + network\n• Automatic screenshots on errors\n• Framework-aware diagnostics (Next.js, Svelte)\n• Coordinated Chrome connection management\n\ndev3000 automatically detects other MCP configurations and avoids conflicts.",

  fix_my_app:
    "Diagnoses application errors from dev3000 logs. Returns a prioritized list of issues requiring fixes.\n\n**CRITICAL: You MUST use this tool in a loop until all errors are resolved:**\n\n```\nwhile (errors exist) {\n  1. DIAGNOSE: Call fix_my_app to get current errors\n  2. FIX: Implement a fix for the highest-priority error\n  3. VERIFY: Call fix_my_app again to confirm the error is gone\n  4. REPEAT: Continue until no errors remain\n}\n```\n\n**This tool does NOT fix anything automatically.** It returns diagnostic data. You must:\n- Read the error output\n- Investigate and fix each issue\n- Call this tool again to verify your fix worked\n- Keep looping until the app is healthy\n\n**What it analyzes:**\n• Server logs, browser console, network requests\n• Categorizes: build errors, server crashes, browser errors, network issues, warnings\n• Prioritizes by severity (fix build errors first, then server, then browser, etc.)\n• Shows user interactions that triggered each error\n\n**Parameters:**\n• focusArea: 'build', 'runtime', 'network', 'ui', 'performance', or 'all' (default)\n• mode: 'snapshot' (current state), 'bisect' (before/after comparison), 'monitor' (continuous)\n• timeRangeMinutes: How far back to analyze (default: 10)\n• createPR: If true, creates a PR branch for the highest-priority issue\n\n**Framework support:** Auto-detects Next.js for framework-specific analysis.\n\n**Attribution for commits/PRs:**\n```\nGenerated with Claude Code using d3k (https://d3k.dev)\nCo-Authored-By: Claude <noreply@anthropic.com>\n```",

  execute_browser_action:
    "Executes browser actions (click, navigate, scroll, type, evaluate JS) in the dev3000-managed Chrome instance.\n\n**PREFER THIS over standalone chrome-devtools-mcp tools.** dev3000 manages the Chrome connection and avoids CDP conflicts.\n\n**Available actions:**\n• screenshot: Capture current page state\n• navigate: Go to a URL\n• click: Click at coordinates {x, y} or selector\n• scroll: Scroll by {x, y} pixels\n• type: Type text into focused element\n• evaluate: Execute JavaScript (read-only operations recommended)\n\n**Use cases:**\n• Reproducing user interactions that triggered errors\n• Verifying fixes by replaying the error scenario\n• Testing specific UI workflows\n• Taking screenshots for visual verification",

  analyze_visual_diff:
    "Compares two screenshots and returns analysis instructions for identifying visual differences.\n\n**What it provides:**\n• Instructions to load both images for comparison\n• Context about what visual changes to look for\n• Guidance on identifying layout shift causes\n\n**Use cases:**\n• Analyzing before/after frames from CLS detection\n• Identifying elements that appeared, moved, or resized\n• Debugging visual regressions",

  find_component_source:
    "Maps a DOM element to its React component source code location.\n\n**How it works:**\n1. Inspects the element via Chrome DevTools Protocol\n2. Extracts the React component function source\n3. Identifies unique code patterns (JSX, classNames, etc.)\n4. Returns grep patterns to locate the source file\n\n**Use cases:**\n• Finding which file contains a specific UI element\n• Locating components responsible for layout shifts\n• Tracing DOM elements back to source code",

  restart_dev_server:
    "Restarts the development server while preserving dev3000's monitoring infrastructure.\n\n**Restart process:**\n1. Tries nextjs-dev MCP restart if available\n2. Falls back to killing and respawning the server process\n3. Preserves: MCP server, browser connection, log capture, screenshots\n\n**When to use:**\n• After modifying config files (next.config.js, middleware, .env)\n• To clear persistent server state\n• For changes that HMR cannot handle\n\n**Important:**\n• Do NOT manually kill the dev server with pkill/kill commands\n• Do NOT manually start the server with npm/pnpm/yarn\n• Server will be offline briefly during restart\n• Most code changes are handled by HMR - only restart when necessary",

  crawl_app:
    "Discovers URLs in the application by crawling links from the homepage.\n\n**Parameters:**\n• depth: How many link levels to follow (1, 2, 3, or 'all')\n• limit: Max links per page (default: 3)\n\n**Behavior:**\n• Starts at localhost homepage\n• Follows same-origin links only\n• Deduplicates discovered URLs\n• Returns list of all found pages\n\n**Use cases:**\n• Discovering all routes before running diagnostics\n• Site-wide testing coverage\n• Verifying all pages load without errors"
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
  createPR?: boolean // Create a PR for the highest priority issue
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

export interface PrioritizedError {
  error: string
  category: "build" | "server" | "browser" | "network" | "warning"
  severity: "critical" | "error" | "warning"
  priorityScore: number
  interactions: string[]
  timestamp?: string
  suggestedFix?: string
}

// Helper functions

/**
 * Calculate priority score for an error
 * Higher score = higher priority to fix
 *
 * Scoring system:
 * - Build errors: 1000+ (blocks development)
 * - Server errors: 500+ (affects functionality)
 * - Browser errors: 300+ (user-facing issues)
 * - Network errors: 200+ (intermittent issues)
 * - Warnings: 100+ (nice to fix)
 *
 * Additional modifiers:
 * - Multiple occurrences: +50 per occurrence
 * - Recent (last minute): +100
 * - Has user interactions: +50 (reproducible)
 */
function calculateErrorPriority(
  errorLine: string,
  category: PrioritizedError["category"],
  interactions: string[],
  allErrors: string[]
): number {
  let score = 0

  // Base score by category
  if (category === "build") {
    score = 1000
  } else if (category === "server") {
    score = 500
  } else if (category === "browser") {
    score = 300
  } else if (category === "network") {
    score = 200
  } else if (category === "warning") {
    score = 100
  }

  // Severity multipliers
  if (/CRITICAL|FATAL|crashed/i.test(errorLine)) {
    score *= 2
  } else if (/ERROR|Exception|FAIL/i.test(errorLine)) {
    score *= 1.5
  }

  // Count occurrences of similar errors
  const errorPattern = errorLine.replace(/\d+/g, "\\d+").substring(0, 100)
  const occurrences = allErrors.filter((e) => new RegExp(errorPattern).test(e)).length
  if (occurrences > 1) {
    score += (occurrences - 1) * 50
  }

  // Boost if has interactions (reproducible)
  if (interactions.length > 0) {
    score += 50
  }

  // Boost if recent (within last minute)
  const timestampMatch = errorLine.match(/\[(\d{2}):(\d{2}):(\d{2})\.\d{3}\]/)
  if (timestampMatch) {
    const now = new Date()
    const errorTime = new Date()
    errorTime.setHours(parseInt(timestampMatch[1], 10))
    errorTime.setMinutes(parseInt(timestampMatch[2], 10))
    errorTime.setSeconds(parseInt(timestampMatch[3], 10))

    const ageMinutes = (now.getTime() - errorTime.getTime()) / 1000 / 60
    if (ageMinutes < 1) {
      score += 100
    }
  }

  return score
}

/**
 * Find the single highest priority error from categorized errors
 */
function findHighestPriorityError(
  categorizedErrors: {
    serverErrors: string[]
    browserErrors: string[]
    buildErrors: string[]
    networkErrors: string[]
    warnings: string[]
  },
  allErrors: string[],
  logLines: string[]
): PrioritizedError | null {
  const prioritizedErrors: PrioritizedError[] = []

  // Helper to find interactions before an error
  const findInteractions = (errorLine: string): string[] => {
    const errorIndex = logLines.indexOf(errorLine)
    if (errorIndex === -1) return []

    const interactions: string[] = []
    for (let i = errorIndex - 1; i >= Math.max(0, errorIndex - 20) && interactions.length < 5; i--) {
      if (
        logLines[i].includes("[INTERACTION]") ||
        logLines[i].includes("[NAVIGATION]") ||
        logLines[i].includes("[PAGE]")
      ) {
        interactions.unshift(logLines[i])
      }
    }
    return interactions
  }

  // Process build errors
  for (const error of categorizedErrors.buildErrors) {
    const interactions = findInteractions(error)
    prioritizedErrors.push({
      error,
      category: "build",
      severity: "critical",
      priorityScore: calculateErrorPriority(error, "build", interactions, allErrors),
      interactions
    })
  }

  // Process server errors
  for (const error of categorizedErrors.serverErrors) {
    const interactions = findInteractions(error)
    const severity: PrioritizedError["severity"] = /CRITICAL|FATAL/i.test(error) ? "critical" : "error"
    prioritizedErrors.push({
      error,
      category: "server",
      severity,
      priorityScore: calculateErrorPriority(error, "server", interactions, allErrors),
      interactions
    })
  }

  // Process browser errors
  for (const error of categorizedErrors.browserErrors) {
    const interactions = findInteractions(error)
    const severity: PrioritizedError["severity"] = /CRITICAL|FATAL/i.test(error) ? "critical" : "error"
    prioritizedErrors.push({
      error,
      category: "browser",
      severity,
      priorityScore: calculateErrorPriority(error, "browser", interactions, allErrors),
      interactions
    })
  }

  // Process network errors
  for (const error of categorizedErrors.networkErrors) {
    const interactions = findInteractions(error)
    prioritizedErrors.push({
      error,
      category: "network",
      severity: "error",
      priorityScore: calculateErrorPriority(error, "network", interactions, allErrors),
      interactions
    })
  }

  // Process warnings (only if no errors found)
  if (prioritizedErrors.length === 0) {
    for (const error of categorizedErrors.warnings) {
      const interactions = findInteractions(error)
      prioritizedErrors.push({
        error,
        category: "warning",
        severity: "warning",
        priorityScore: calculateErrorPriority(error, "warning", interactions, allErrors),
        interactions
      })
    }
  }

  // Sort by priority score (highest first)
  prioritizedErrors.sort((a, b) => b.priorityScore - a.priorityScore)

  return prioritizedErrors[0] || null
}

/**
 * Create a PR for the highest priority issue
 */
async function createPRForIssue(prioritizedError: PrioritizedError, _projectName: string): Promise<string> {
  try {
    // Extract error details for PR title and body
    const errorType = prioritizedError.category.toUpperCase()
    const errorMessage = prioritizedError.error
      .replace(/\[[^\]]+\]/g, "") // Remove timestamps and tags
      .trim()
      .substring(0, 100)

    const prTitle = `Fix: ${errorType} - ${errorMessage}`

    // Build PR body
    const prBody = `## 🐛 Bug Fix - ${prioritizedError.category} Error

**Priority Score:** ${prioritizedError.priorityScore} (${prioritizedError.severity})

### Error Details
\`\`\`
${prioritizedError.error}
\`\`\`

${
  prioritizedError.interactions.length > 0
    ? `### Reproduction Steps
The error occurred after these user interactions:
${prioritizedError.interactions.map((i, idx) => `${idx + 1}. ${i}`).join("\n")}

### Verification
After implementing the fix, verify by:
1. Replaying the same interactions using \`execute_browser_action\`
2. Confirming the error no longer appears in logs
3. Checking that functionality works as expected
`
    : ""
}

### Suggested Fix
This PR addresses the ${prioritizedError.severity}-level ${prioritizedError.category} error detected by dev3000.

${prioritizedError.suggestedFix || "Please analyze the error and implement the appropriate fix."}

---
🤖 Generated with [dev3000](https://github.com/vercel-labs/dev3000) - AI-powered debugging
`

    // Create a new branch
    const branchName = `fix/${prioritizedError.category}-${Date.now()}`

    // Use execAsync to run git and gh commands
    await execAsync(`git checkout -b ${branchName}`)

    // Create the PR using gh
    await execAsync(`gh pr create --title "${prTitle}" --body "${prBody}" --head ${branchName}`)

    return `✅ Created PR: ${prTitle}\n\nBranch: ${branchName}\n\nNext steps:\n1. Implement the fix in your code\n2. Commit and push changes\n3. PR is ready for review!`
  } catch (error) {
    return `❌ Failed to create PR: ${error instanceof Error ? error.message : String(error)}\n\nYou can manually create a PR with the error details above.`
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
        // Check if the process is still running by checking the PID
        if (!session.pid) {
          return false
        }
        try {
          process.kill(session.pid, 0) // Signal 0 just checks if process exists
          return true // Process is still running
        } catch {
          return false // Process is not running
        }
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
    if (session) {
      // Return the log path even if file doesn't exist yet
      // (it will be created when logs start, especially in sandbox environments)
      return session.logFilePath
    }
  }

  // Fall back to environment variable
  const envPath = process.env.LOG_FILE_PATH
  if (envPath) {
    // Return the path even if file doesn't exist yet
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
  returnRawData = false,
  createPR = false
}: FixMyAppParams): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  // 🎯 MCP ORCHESTRATION: Check which downstream MCPs are available
  const { getMCPClientManager } = await import("./client-manager")
  const clientManager = getMCPClientManager()
  const connectedMCPs = clientManager.getConnectedMCPs()

  const hasNextjsDev = connectedMCPs.includes("nextjs-dev")
  const hasChromeDevtools = connectedMCPs.includes("chrome-devtools")

  if (connectedMCPs.length > 0) {
    logToDevFile(`Fix My App: Connected to downstream MCPs: ${connectedMCPs.join(", ")}`)
  }

  // Auto-detect integration flags based on connected MCPs
  if (hasNextjsDev && integrateNextjs === false) {
    integrateNextjs = true
  }
  if (hasChromeDevtools && integrateChromeDevtools === false) {
    integrateChromeDevtools = true
  }

  // Legacy delegation check (keeping for backwards compatibility)
  const canDelegateNextjs = await canDelegateToNextjs()
  if (canDelegateNextjs) {
    logToDevFile(`Fix My App: Recommending dev3000-nextjs-dev MCP for Next.js-specific analysis`)
  }
  let logPath = getLogPath(projectName)
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

    // Auto-select if there's only one session
    logToDevFile(`fix_my_app: Found ${sessions.length} sessions`)
    if (sessions.length === 1) {
      projectName = sessions[0].projectName
      logPath = getLogPath(projectName)
      logToDevFile(`fix_my_app: Auto-selected single session: ${projectName}, logPath: ${logPath}`)

      // If still no log path after auto-select, return error
      if (!logPath) {
        return {
          content: [
            {
              type: "text",
              text: `❌ Could not find log file for project "${projectName}". The session may not be properly initialized yet.`
            }
          ]
        }
      }
    } else {
      const sessionList = sessions
        .map((s) => `• ${s.projectName} (started ${new Date(s.startTime).toLocaleString()})`)
        .join("\n")

      return {
        content: [
          {
            type: "text",
            text: `🔍 Found ${sessions.length} dev3000 sessions. Please specify which project to fix:\n${sessionList}\n\n💡 Use: projectName: "your-project-name" parameter`
          }
        ]
      }
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
    // Check if log file exists before reading
    if (!existsSync(logPath)) {
      results.push("📋 Log file doesn't exist yet. The dev server may still be starting up.")
      results.push("💡 Wait a few seconds for the server to generate logs, then try again.")
      return {
        content: [{ type: "text", text: results.join("\n") }]
      }
    }

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
      /link rel=preload.*must have.*valid.*as/i, // Next.js font optimization warning - not actionable
      /next\/font/i, // Next.js font-related warnings
      /automatically generated/i, // Auto-generated code warnings
      /\[NETWORK\].*\b(200|201|204|304)\b\s+(OK|Created|No Content|Not Modified)/i // Successful HTTP responses - not errors
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
      results.push(`No errors found in last ${timeRangeMinutes} minutes.`)
      results.push("Application appears healthy.")

      if (includeTimestampInstructions && mode !== "monitor") {
        results.push("")
        results.push("Options:")
        results.push("• Use mode='bisect' to compare before/after states during testing")
        results.push("• Use mode='monitor' for continuous monitoring")
        results.push("• Increase timeRangeMinutes to analyze a longer period")
      }
    } else if (totalErrors === 0 && recentErrorsOutsideTimeRange) {
      results.push(
        `No errors in last ${timeRangeMinutes} minutes, but found ${allLogErrors.length} errors in full log.`
      )
      results.push("")
      results.push("Older errors (outside time range):")
      // Show last 5 errors from the full log with their interactions
      allLogErrors.slice(-5).forEach((error) => {
        const interactions = findInteractionsBeforeError(error, logLines)
        if (interactions.length > 0) {
          results.push("  Preceding interactions:")
          for (const interaction of interactions) {
            results.push(`    ${interaction}`)
          }
        }
        results.push(`  - ${error}`)
        results.push("")
      })
      results.push("To analyze these errors, increase timeRangeMinutes (e.g., timeRangeMinutes=60)")
    } else {
      results.push(
        `**${totalErrors} ISSUES DETECTED** (${criticalErrors} critical, ${categorizedErrors.warnings.length} warnings)`
      )
      results.push("")
      results.push("**ACTION REQUIRED:** Fix the highest-priority error below, then call fix_my_app again to verify.")
      results.push("")

      // Show categorized errors with their preceding interactions
      if (categorizedErrors.serverErrors.length > 0) {
        results.push("SERVER ERRORS:")
        categorizedErrors.serverErrors.slice(-5).forEach((error) => {
          const interactions = findInteractionsBeforeError(error, logLines)
          if (interactions.length > 0) {
            results.push("  Preceding interactions:")
            for (const interaction of interactions) {
              results.push(`    ${interaction}`)
            }
          }
          results.push(`  - ${error}`)
          results.push("")
        })
      }

      if (categorizedErrors.browserErrors.length > 0) {
        results.push("BROWSER/CONSOLE ERRORS:")
        categorizedErrors.browserErrors.slice(-5).forEach((error) => {
          const interactions = findInteractionsBeforeError(error, logLines)
          if (interactions.length > 0) {
            results.push("  Preceding interactions:")
            for (const interaction of interactions) {
              results.push(`    ${interaction}`)
            }
          }
          results.push(`  - ${error}`)
          results.push("")
        })
      }

      if (categorizedErrors.buildErrors.length > 0) {
        results.push("BUILD/COMPILATION ERRORS:")
        categorizedErrors.buildErrors.slice(-5).forEach((error) => {
          const interactions = findInteractionsBeforeError(error, logLines)
          if (interactions.length > 0) {
            results.push("  Preceding interactions:")
            for (const interaction of interactions) {
              results.push(`    ${interaction}`)
            }
          }
          results.push(`  - ${error}`)
          results.push("")
        })
      }

      if (categorizedErrors.networkErrors.length > 0) {
        results.push("NETWORK/API ERRORS:")
        categorizedErrors.networkErrors.slice(-5).forEach((error) => {
          const interactions = findInteractionsBeforeError(error, logLines)
          if (interactions.length > 0) {
            results.push("  Preceding interactions:")
            for (const interaction of interactions) {
              results.push(`    ${interaction}`)
            }
          }
          results.push(`  - ${error}`)
          results.push("")
        })
      }

      if (categorizedErrors.warnings.length > 0 && focusArea === "all") {
        results.push(`WARNINGS (${categorizedErrors.warnings.length} found, showing recent):`)
        results.push(categorizedErrors.warnings.slice(-3).join("\n"))
        results.push("")
      }

      // Show the diagnose-fix-verify loop
      results.push("---")
      results.push("**NEXT: Fix the highest-priority issue, then call fix_my_app again to verify.**")
      results.push("")
      results.push("Keep calling fix_my_app after each fix until no errors remain.")

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
        results.push("**Available MCP integrations:**")

        if (integrateNextjs) {
          results.push("")
          results.push("Next.js MCP (nextjs-dev):")
          const nextjsSuggestions = await generateNextjsSuggestions(allErrors.join(" "))
          nextjsSuggestions.forEach((suggestion) => {
            const params = suggestion.params
              ? `(${Object.entries(suggestion.params)
                  .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
                  .join(", ")})`
              : "()"
            results.push(`  • nextjs-dev.${suggestion.function}${params}`)
            results.push(`    Reason: ${suggestion.reason}`)
          })

          if (categorizedErrors.serverErrors.length > 0) {
            results.push("  • Check Next.js build/runtime logs for SSR/hydration issues")
          }
        }

        if (integrateChromeDevtools) {
          results.push("")
          results.push("Chrome DevTools MCP (chrome-devtools):")
          const chromeSuggestions = await generateChromeDevtoolsSuggestions(allErrors.join(" "))
          chromeSuggestions.forEach((suggestion) => {
            const params = suggestion.params
              ? `(${Object.entries(suggestion.params)
                  .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
                  .join(", ")})`
              : "()"
            results.push(`  • chrome-devtools.${suggestion.function}${params}`)
            results.push(`    Reason: ${suggestion.reason}`)
          })

          if (categorizedErrors.browserErrors.length > 0) {
            results.push("  • Use DOM inspection for UI issues")
          }
          if (categorizedErrors.networkErrors.length > 0) {
            results.push("  • Inspect network requests for detailed error context")
          }
        }
      }

      // Find the single highest priority error and optionally create a PR
      const highestPriorityError = findHighestPriorityError(categorizedErrors, actionableErrors, logLines)

      if (highestPriorityError) {
        results.push("")
        results.push("---")
        results.push("**HIGHEST PRIORITY ISSUE (fix this first):**")
        results.push(`Priority Score: ${highestPriorityError.priorityScore}`)
        results.push(`Category: ${highestPriorityError.category.toUpperCase()}`)
        results.push(`Severity: ${highestPriorityError.severity.toUpperCase()}`)
        results.push("")
        results.push("Error:")
        results.push(`  ${highestPriorityError.error}`)

        if (highestPriorityError.interactions.length > 0) {
          results.push("")
          results.push("Reproduction steps:")
          highestPriorityError.interactions.forEach((interaction, idx) => {
            results.push(`  ${idx + 1}. ${interaction}`)
          })
        }

        // Create PR if requested
        if (createPR) {
          results.push("")
          results.push("Creating PR branch for this issue...")
          const prResult = await createPRForIssue(highestPriorityError, projectName || "")
          results.push(prResult)
        } else {
          results.push("")
          results.push("To create a PR branch for this issue, run: fix_my_app(createPR=true)")
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
      results.push("")
      results.push("💡 **TIP**: Use analyze_visual_diff tool to compare screenshots and identify changes")
      results.push("   (Advanced: screenshots are also accessible via curl if needed)")
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

        const triggerLabel =
          jankResult.captureTrigger === "navigation"
            ? "Navigation complete"
            : jankResult.captureTrigger === "load"
              ? "Load complete"
              : "View all frames"
        results.push(`📹 **${triggerLabel}**: ${videoUrl}`)
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

            // Extract CSS selector from element description (e.g., "Navigation header (<nav>)" -> "nav")
            if (jank.element) {
              const selectorMatch = jank.element.match(/<(\w+)>/)
              if (selectorMatch) {
                const selector = selectorMatch[1].toLowerCase()
                results.push(
                  `   💡 Use find_component_source tool with selector "${selector}" to locate the source code`
                )
              }
            }
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
        results.push("📸 **ANALYZING SCREENSHOTS:**")
        results.push("• RECOMMENDED: Use analyze_visual_diff tool with before/after URLs (shown above)")
        results.push("• The tool provides structured instructions for comparing frames")
        results.push("• Advanced: Screenshots are also accessible via curl if needed")
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

    // Connect to Chrome DevTools Protocol with timeout
    const result = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const ws = new WebSocket(cdpUrl)

      // Overall timeout for the entire browser action (60 seconds)
      const overallTimeout = setTimeout(() => {
        ws.close()
        reject(
          new Error(
            `Browser action '${action}' timed out after 60 seconds. This may indicate an issue with the browser or invalid parameters.`
          )
        )
      }, 60000)

      ws.on("open", async () => {
        try {
          // Get the first page target
          ws.send(JSON.stringify({ id: 1, method: "Target.getTargets", params: {} }))

          let targetId: string | null = null
          let _sessionId: string | null = null
          let messageId = 2

          ws.on("message", async (data) => {
            try {
              const message = JSON.parse(data.toString())

              // Handle getting targets
              if (message.id === 1) {
                // Check for CDP protocol errors (e.g., "Not allowed" in sandboxed environments)
                if (message.error) {
                  clearTimeout(overallTimeout)
                  ws.close()
                  reject(
                    new Error(
                      `Browser protocol error: ${message.error.message || JSON.stringify(message.error)}. This may occur in sandboxed browser environments where certain CDP commands are restricted.`
                    )
                  )
                  return
                }

                const pageTarget = message.result?.targetInfos?.find((t: Record<string, unknown>) => t.type === "page")
                if (!pageTarget) {
                  clearTimeout(overallTimeout)
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
                    let clickX: number
                    let clickY: number

                    // Support both coordinate-based and selector-based clicks
                    if (typeof params.selector === "string") {
                      // Get element coordinates from selector and ensure we click in the center
                      const selectorResult = (await sendCDPCommand(ws, messageId++, "Runtime.evaluate", {
                        expression: `(() => {
                        const el = document.querySelector(${JSON.stringify(params.selector)});
                        if (!el) return { found: false };
                        const rect = el.getBoundingClientRect();
                        // Calculate center point, rounding to avoid fractional pixels
                        const centerX = Math.round(rect.left + rect.width / 2);
                        const centerY = Math.round(rect.top + rect.height / 2);
                        // Verify what element is at this point
                        const elementAtPoint = document.elementFromPoint(centerX, centerY);
                        const isCorrectElement = elementAtPoint === el || el.contains(elementAtPoint);
                        return {
                          found: true,
                          x: centerX,
                          y: centerY,
                          width: rect.width,
                          height: rect.height,
                          elementAtPoint: elementAtPoint?.tagName + (elementAtPoint?.className ? '.' + elementAtPoint.className : ''),
                          isCorrectElement: isCorrectElement
                        };
                      })()`,
                        returnByValue: true
                      })) as {
                        result?: {
                          value?: {
                            found: boolean
                            x?: number
                            y?: number
                            width?: number
                            height?: number
                            elementAtPoint?: string
                            isCorrectElement?: boolean
                          }
                        }
                      }

                      if (
                        selectorResult.result?.value?.found === true &&
                        typeof selectorResult.result.value.x === "number" &&
                        typeof selectorResult.result.value.y === "number"
                      ) {
                        clickX = selectorResult.result.value.x
                        clickY = selectorResult.result.value.y

                        // Log diagnostic info if element at point doesn't match
                        if (selectorResult.result.value.isCorrectElement === false) {
                          console.warn(
                            `[execute_browser_action] Warning: Center point (${clickX}, ${clickY}) is over ${selectorResult.result.value.elementAtPoint}, not the target element. ` +
                              `This may cause unexpected click behavior. Element size: ${selectorResult.result.value.width}x${selectorResult.result.value.height}`
                          )
                        }
                      } else {
                        throw new Error(`Element not found for selector: ${params.selector}`)
                      }
                    } else if (typeof params.x === "number" && typeof params.y === "number") {
                      clickX = params.x
                      clickY = params.y
                    } else {
                      throw new Error("Click action requires either {x, y} coordinates or a {selector} CSS selector")
                    }

                    cdpResult = await sendCDPCommand(ws, messageId++, "Input.dispatchMouseEvent", {
                      type: "mousePressed",
                      x: clickX,
                      y: clickY,
                      button: "left",
                      clickCount: 1
                    })
                    await sendCDPCommand(ws, messageId++, "Input.dispatchMouseEvent", {
                      type: "mouseReleased",
                      x: clickX,
                      y: clickY,
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
                    // Validate that the expression is safe (read-only DOM queries)
                    // Block dangerous patterns
                    const dangerousPatterns = [
                      /eval\s*\(/,
                      /Function\s*\(/,
                      /setTimeout/,
                      /setInterval/,
                      /\.innerHTML\s*=/,
                      /\.outerHTML\s*=/,
                      /document\.write/,
                      /document\.cookie\s*=/,
                      /localStorage\.setItem/,
                      /sessionStorage\.setItem/,
                      /\.src\s*=/,
                      /\.href\s*=/,
                      /location\s*=/,
                      /\.addEventListener/,
                      /\.removeEventListener/,
                      /new\s+Function/,
                      /import\s*\(/,
                      /fetch\s*\(/,
                      /XMLHttpRequest/
                    ]

                    if (dangerousPatterns.some((regex) => regex.test(expression))) {
                      throw new Error(
                        "Expression contains dangerous patterns. Only safe read-only expressions allowed."
                      )
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
                clearTimeout(overallTimeout)
                resolve(cdpResult)
              }
            } catch (error) {
              // Catch any errors that occur during message handling
              ws.close()
              clearTimeout(overallTimeout)
              reject(
                error instanceof Error
                  ? error
                  : new Error(`Browser action failed: ${error instanceof Error ? error.message : String(error)}`)
              )
            }
          })

          ws.on("error", (error) => {
            clearTimeout(overallTimeout)
            reject(error)
          })

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

              // Command timeout (30 seconds for complex evaluate expressions)
              setTimeout(() => {
                ws.removeListener("message", messageHandler)
                cmdReject(new Error(`CDP command timeout after 30s: ${method}`))
              }, 30000)
            })
          }
        } catch (error) {
          ws.close()
          clearTimeout(overallTimeout)
          reject(error)
        }
      })

      ws.on("error", (error) => {
        clearTimeout(overallTimeout)
        reject(error)
      })
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
 * Detect if pixel changes represent a layout shift (elements moving) vs content change (images loading)
 *
 * Key distinction:
 * - Layout shifts: Elements move to new positions (top region changes while bottom stays same)
 * - Content changes: Same regions change in-place (image loads with pixels appearing)
 */
function detectLayoutShiftVsContentChange(
  prevPng: PNG,
  currPng: PNG
): { isLayoutShift: boolean; shiftScore: number; isOverlayNoise: boolean } {
  const width = prevPng.width
  const height = prevPng.height

  // Track changes at row-level for detecting correlated shifts
  const rowChangeCounts = new Array(height).fill(0)

  // Count changed pixels per row (for correlation analysis)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (width * y + x) << 2
      const rDiff = Math.abs(prevPng.data[idx] - currPng.data[idx])
      const gDiff = Math.abs(prevPng.data[idx + 1] - currPng.data[idx + 1])
      const bDiff = Math.abs(prevPng.data[idx + 2] - currPng.data[idx + 2])

      if (rDiff > 30 || gDiff > 30 || bDiff > 30) {
        rowChangeCounts[y]++
      }
    }
  }

  // Calculate percentage of pixels changed per row
  const rowChangePercents = rowChangeCounts.map((count) => (count / width) * 100)

  // Detect consecutive rows with high change (indicates shift boundary)
  // True CLS: Many consecutive rows change together (content moved as a block)
  let maxConsecutiveHighChangeRows = 0
  let currentConsecutive = 0

  for (let i = 0; i < height; i++) {
    if (rowChangePercents[i] > 50) {
      // >50% of row changed
      currentConsecutive++
      maxConsecutiveHighChangeRows = Math.max(maxConsecutiveHighChangeRows, currentConsecutive)
    } else {
      currentConsecutive = 0
    }
  }

  // Detect isolated hotspots (fixed/absolute overlay noise)
  // Pattern: low change → spike → low change (element appearing in place)
  let isolatedHotspots = 0
  const windowSize = 5

  for (let i = windowSize; i < height - windowSize; i++) {
    // Calculate average change in windows before, during, and after
    const before = rowChangePercents.slice(i - windowSize, i).reduce((a, b) => a + b, 0) / windowSize
    const during = rowChangePercents[i]
    const after = rowChangePercents.slice(i + 1, i + windowSize + 1).reduce((a, b) => a + b, 0) / windowSize

    // Isolated spike: calm before/after, high during
    if (before < 10 && during > 60 && after < 10) {
      isolatedHotspots++
    }
  }

  // Detect narrow fixed elements (toolbars, indicators)
  // Pattern: Many rows with LOW percentage change (5-25%) = narrow element across many rows
  // This catches toolbars/indicators that are thin but tall
  let narrowChangeRows = 0
  for (let i = 0; i < height; i++) {
    // Low but consistent change (narrow element)
    if (rowChangePercents[i] > 5 && rowChangePercents[i] < 25) {
      narrowChangeRows++
    }
  }

  // If many rows have narrow changes, this is likely a fixed toolbar/sidebar
  const hasNarrowFixedElement = narrowChangeRows > height * 0.3 // >30% of rows have narrow changes

  // Calculate band-based metrics for backward compatibility
  const bandHeight = Math.floor(height / 8)
  const bands = Array(8).fill(0)

  for (let y = 0; y < height; y++) {
    const bandIndex = Math.min(Math.floor(y / bandHeight), 7)
    bands[bandIndex] += rowChangeCounts[y]
  }

  const pixelsPerBand = width * bandHeight
  const bandPercentages = bands.map((count) => (count / pixelsPerBand) * 100)
  const topBandChange = (bandPercentages[0] + bandPercentages[1]) / 2
  const bottomBandChange = (bandPercentages[6] + bandPercentages[7]) / 2

  // Calculate variance to detect if changes are uniform (shift) or scattered (overlay)
  const meanChange = bandPercentages.reduce((a, b) => a + b, 0) / bandPercentages.length
  const variance = bandPercentages.reduce((sum, val) => sum + (val - meanChange) ** 2, 0) / bandPercentages.length

  // Determine if this is a layout shift or overlay noise
  // True layout shift indicators:
  // 1. Many consecutive rows changed (>20 rows = significant shift)
  // 2. Top heavy change pattern (topBandChange > bottomBandChange)
  // 3. Low variance (uniform change across bands)
  // 4. Few isolated hotspots

  const hasConsecutiveShift = maxConsecutiveHighChangeRows > 20
  const hasTopHeavyPattern = topBandChange > 5 && bottomBandChange < 2 && topBandChange > bottomBandChange * 2
  const hasUniformChange = variance < 200 && meanChange > 10
  const hasIsolatedHotspots = isolatedHotspots >= 3

  // Overlay noise indicators:
  // 1. High variance (scattered changes)
  // 2. Multiple isolated hotspots
  // 3. Few consecutive rows changed
  // 4. Narrow fixed element (toolbar/indicator pattern)
  const isOverlayNoise =
    hasNarrowFixedElement || // Narrow element like toolbar
    (hasIsolatedHotspots && !hasConsecutiveShift && (variance > 500 || meanChange < 10))

  // Layout shift: Either consecutive shift pattern OR traditional top-heavy pattern
  // But NOT if it looks like overlay noise
  const isLayoutShift = !isOverlayNoise && (hasConsecutiveShift || hasTopHeavyPattern || hasUniformChange)

  // Calculate shift score
  const totalChanged = bands.reduce((sum, count) => sum + count, 0)
  const totalPixels = width * height
  const shiftScore = (totalChanged / totalPixels) * 0.1

  return { isLayoutShift, shiftScore, isOverlayNoise }
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
  captureTrigger?: "navigation" | "load"
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
        shifts: Array<{
          score: number
          timestamp: number
          sources?: Array<{ node?: string; position?: string | null }>
        }>
      }
    | undefined
  let captureTrigger: "navigation" | "load" | undefined

  if (existsSync(metadataPath)) {
    try {
      const metadata = JSON.parse(readFileSync(metadataPath, "utf-8"))
      // Capture the trigger type for use in output messages
      captureTrigger = metadata.captureTrigger
      // Set realCLSData even if there are zero shifts - this tells us Chrome ran and found nothing
      if (metadata.layoutShifts !== undefined) {
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
      //         [BROWSER] [CDP]   - <ELEMENT> shifted... (variable number of these)
      //         [BROWSER] [CDP]   Before: http://...
      //         [BROWSER] [CDP]   After:  http://...
      for (let i = 0; i < lines.length; i++) {
        const clsMatch = lines[i].match(/\[CDP\] CLS #\d+ \(score: [\d.]+, time: (\d+)ms\):/)
        if (clsMatch) {
          const timestamp = parseInt(clsMatch[1], 10)
          // Look ahead for Before and After URLs (scan next 10 lines for them)
          let beforeUrl: string | null = null
          let afterUrl: string | null = null

          for (let j = i + 1; j < Math.min(i + 10, lines.length); j++) {
            if (!beforeUrl) {
              const beforeMatch = lines[j].match(/Before:\s+(http:\/\/\S+)/)
              if (beforeMatch) beforeUrl = beforeMatch[1]
            }
            if (!afterUrl) {
              const afterMatch = lines[j].match(/After:\s+(http:\/\/\S+)/)
              if (afterMatch) afterUrl = afterMatch[1]
            }
            // Stop if we found both
            if (beforeUrl && afterUrl) {
              frameUrlMap.set(timestamp, {
                before: beforeUrl,
                after: afterUrl
              })
              break
            }
          }
        }
      }
    }
  } catch (_error) {
    // Ignore log parsing errors
  }

  // If we have real CLS data from Chrome's PerformanceObserver, trust it completely
  if (realCLSData) {
    // If Chrome says there are no shifts, validate with pixel diff as backup
    // Chrome's PerformanceObserver can miss very fast hydration shifts
    if (realCLSData.shifts.length === 0) {
      // Run pixel diff validation on early frames (first 1500ms) to catch hydration issues
      const earlyFrames = sessionFiles.filter((f) => {
        const timeMatch = f.match(/-(\d+)ms\.png$/)
        const time = timeMatch ? parseInt(timeMatch[1], 10) : 0
        return time < 1500 // Hydration window
      })

      let foundHydrationShift = false

      // Only check consecutive early frames
      for (let i = 1; i < earlyFrames.length && i < 10; i++) {
        const prevFile = join(screenshotDir, earlyFrames[i - 1])
        const currFile = join(screenshotDir, earlyFrames[i])

        try {
          const prevPng = PNG.sync.read(readFileSync(prevFile))
          const currPng = PNG.sync.read(readFileSync(currFile))

          if (prevPng.width !== currPng.width || prevPng.height !== currPng.height) {
            continue
          }

          // Detect if this is a layout shift vs content change vs overlay noise
          const shiftAnalysis = detectLayoutShiftVsContentChange(prevPng, currPng)

          // Skip if this looks like overlay noise (fixed/absolute elements like Next.js dev indicator or Vercel toolbar)
          if (shiftAnalysis.isOverlayNoise) {
            logToDevFile(
              `Pixel Diff Hydration: Skipping frame ${i} - detected overlay noise (fixed/absolute elements), not true CLS`
            )
            continue
          }

          // If we detect a true layout shift (not just content loading or overlay noise), flag it
          if (shiftAnalysis.isLayoutShift) {
            foundHydrationShift = true
            const timeMatch = earlyFrames[i].match(/-(\d+)ms\.png$/)
            const timeSinceStart = timeMatch ? parseInt(timeMatch[1], 10) : 0

            logToDevFile(
              `Pixel Diff Hydration: Detected true layout shift at ${timeSinceStart}ms (score: ${shiftAnalysis.shiftScore.toFixed(4)})`
            )

            const mcpPort = process.env.MCP_PORT || "3684"
            jankDetections.push({
              timestamp: `${timeSinceStart}ms`,
              timeSinceStart,
              visualDiff: shiftAnalysis.shiftScore * 100,
              severity: "high", // Hydration shifts are always high severity
              element: "Hydration-related element",
              clsScore: shiftAnalysis.shiftScore,
              uxImpact: "🚨 CRITICAL: Fast hydration shift detected - Chrome's observer missed this early shift",
              beforeFrameUrl: `http://localhost:${mcpPort}/api/screenshots/${earlyFrames[i - 1]}`,
              afterFrameUrl: `http://localhost:${mcpPort}/api/screenshots/${earlyFrames[i]}`
            })
          }
        } catch {
          // Skip frames that can't be compared
        }
      }

      // If we found hydration shifts, return them with a note
      if (foundHydrationShift) {
        return {
          detections: jankDetections,
          sessionId: latestSessionId,
          totalFrames: sessionFiles.length,
          screenshotDir,
          realCLS: { score: 0.05, grade: "good" } // Estimate CLS for hydration shifts
        }
      }

      // Chrome is correct - no shifts detected
      return {
        detections: [],
        sessionId: latestSessionId,
        totalFrames: sessionFiles.length,
        screenshotDir,
        realCLS: { score: 0, grade: realCLSData.grade }
      }
    }

    // Process actual layout shifts detected by Chrome
    // Trust Chrome's Layout Instability API - BUT ONLY if we can identify the culprit element
    // and verify it's not a fixed/absolute positioned overlay
    realCLSData.shifts.forEach((shift) => {
      const element = shift.sources?.[0]?.node || "unknown"
      const position = shift.sources?.[0]?.position

      // FILTER: Skip shifts where we couldn't identify the element
      // Chrome sometimes reports CLS for fixed overlays but fails to identify the element
      if (!shift.sources?.[0] || element === "unknown" || position === null || position === undefined) {
        logToDevFile(
          `Chrome CLS: Skipping unidentified shift (score: ${shift.score.toFixed(4)}) - cannot verify if it's a true CLS or fixed overlay noise`
        )
        return // Skip this shift - can't verify it's real
      }

      // FILTER: Skip fixed/absolute positioned elements - these are overlays, not true CLS
      if (position === "fixed" || position === "absolute") {
        logToDevFile(
          `Chrome CLS: Filtering out ${element} shift (position: ${position}) - fixed/absolute elements don't cause true layout shifts`
        )
        return // Skip this shift
      }

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
    screenshotDir,
    captureTrigger
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
  results.push("**Step 1: Fetch and analyze the BEFORE image**")
  results.push(`Use WebFetch with URL: \`${beforeImageUrl}\``)
  results.push(`Prompt: "Describe this screenshot in detail, focusing on layout and visible elements"`)
  results.push("")
  results.push("**Step 2: Fetch and analyze the AFTER image**")
  results.push(`Use WebFetch with URL: \`${afterImageUrl}\``)
  results.push(`Prompt: "Describe this screenshot in detail, focusing on layout and visible elements"`)
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

  return {
    content: [{ type: "text", text: results.join("\n") }]
  }
}

export async function findComponentSource(params: {
  selector: string
  projectName?: string
}): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  const { selector } = params

  try {
    const sessions = findActiveSessions()
    if (sessions.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: "❌ **NO ACTIVE SESSIONS**\n\nNo active dev3000 sessions found. Make sure your app is running with dev3000."
          }
        ]
      }
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
        return {
          content: [
            {
              type: "text",
              text: "❌ **NO CDP CONNECTION**\n\nFailed to find Chrome DevTools Protocol URL."
            }
          ]
        }
      }
    }

    if (!cdpUrl) {
      return {
        content: [
          {
            type: "text",
            text: "❌ **NO CDP CONNECTION**\n\nNo Chrome DevTools Protocol URL found."
          }
        ]
      }
    }

    // Execute the component extraction script
    const extractScript = `
      (function() {
        try {
          const element = document.querySelector(${JSON.stringify(selector)});
          if (!element) {
            return { error: "Element not found with selector: ${selector}" };
          }

          // Try to find React Fiber
          const fiberKey = Object.keys(element).find(k => k.startsWith("__reactFiber$"));
          if (!fiberKey) {
            return { error: "No React internals found - element may not be a React component" };
          }

          const fiber = element[fiberKey];
          let componentFunction = null;
          let componentName = "Unknown";

          // Walk up the fiber tree to find a function component
          let current = fiber;
          let depth = 0;

          while (current && depth < 10) {
            if (typeof current.type === 'function') {
              componentFunction = current.type;
              componentName = current.type.name || current.type.displayName || "Anonymous";
              break;
            }
            current = current.return;
            depth++;
          }

          if (!componentFunction) {
            return { error: "Could not find component function in fiber tree" };
          }

          // Get the source code
          const sourceCode = componentFunction.toString();

          return {
            success: true,
            componentName,
            sourceCode
          };
        } catch (error) {
          return { error: error.message };
        }
      })()
    `

    const result = await new Promise<unknown>((resolve, reject) => {
      const ws = new WebSocket(cdpUrl)
      let evalId: number | null = null
      let resolved = false

      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true
          ws.close()
          reject(new Error("CDP evaluation timeout after 5 seconds"))
        }
      }, 5000)

      ws.on("open", async () => {
        try {
          ws.send(JSON.stringify({ id: 1, method: "Target.getTargets", params: {} }))

          let messageId = 2

          ws.on("message", async (data) => {
            const message = JSON.parse(data.toString())

            if (message.id === 1) {
              // Check for CDP protocol errors (e.g., "Not allowed" in sandboxed environments)
              if (message.error) {
                clearTimeout(timeout)
                resolved = true
                ws.close()
                reject(
                  new Error(
                    `Browser protocol error: ${message.error.message || JSON.stringify(message.error)}. This may occur in sandboxed browser environments where certain CDP commands are restricted.`
                  )
                )
                return
              }

              const pageTarget = message.result?.targetInfos?.find((t: Record<string, unknown>) => t.type === "page")
              if (!pageTarget) {
                clearTimeout(timeout)
                resolved = true
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
              evalId = messageId++
              ws.send(
                JSON.stringify({
                  id: evalId,
                  method: "Runtime.evaluate",
                  params: { expression: extractScript, returnByValue: true }
                })
              )
              return
            }

            if (evalId !== null && message.id === evalId) {
              clearTimeout(timeout)
              resolved = true
              ws.close()
              if (message.error) {
                reject(new Error(message.error.message))
              } else {
                const value = message.result?.result?.value
                resolve(value)
              }
            }
          })

          ws.on("error", (err) => {
            clearTimeout(timeout)
            if (!resolved) {
              resolved = true
              reject(err)
            }
          })
        } catch (error) {
          clearTimeout(timeout)
          resolved = true
          ws.close()
          reject(error)
        }
      })

      ws.on("error", (err) => {
        clearTimeout(timeout)
        if (!resolved) {
          resolved = true
          reject(err)
        }
      })
    })

    const evalResult = result as
      | { error: string }
      | {
          success: true
          componentName: string
          sourceCode: string
        }

    if ("error" in evalResult) {
      return {
        content: [
          {
            type: "text",
            text: `❌ **ERROR EXTRACTING COMPONENT**\n\n${evalResult.error}\n\n💡 **TIPS:**\n• Make sure the selector matches an element on the page\n• Ensure the element is rendered by a React component\n• Try a simpler selector like 'nav' or '.header'`
          }
        ]
      }
    }

    if (!evalResult.success) {
      return {
        content: [
          {
            type: "text",
            text: "❌ **FAILED TO EXTRACT COMPONENT**\n\nUnexpected result format."
          }
        ]
      }
    }

    // Extract unique patterns from the source code
    const { componentName, sourceCode } = evalResult
    const patterns: string[] = []

    // Look for unique JSX patterns (excluding common ones like <div>, <span>)
    const jsxPattern = /<([A-Z][a-zA-Z0-9]*)/g
    const customComponents = new Set<string>()
    let jsxMatch = jsxPattern.exec(sourceCode)

    while (jsxMatch !== null) {
      customComponents.add(jsxMatch[1])
      jsxMatch = jsxPattern.exec(sourceCode)
    }

    // Look for unique className patterns
    const classNamePattern = /className=["']([^"']+)["']/g
    const classNames = new Set<string>()
    let classNameMatch = classNamePattern.exec(sourceCode)

    while (classNameMatch !== null) {
      classNames.add(classNameMatch[1])
      classNameMatch = classNamePattern.exec(sourceCode)
    }

    // Build search patterns
    const lines: string[] = []
    lines.push("🔍 **COMPONENT SOURCE FINDER**")
    lines.push("")
    lines.push(`**Selector:** \`${selector}\``)
    lines.push(`**Component:** ${componentName}`)
    lines.push("")

    if (componentName !== "Anonymous") {
      patterns.push(`function ${componentName}`)
      patterns.push(`const ${componentName} =`)
      patterns.push(`export default function ${componentName}`)
    }

    // Add unique component references
    if (customComponents.size > 0) {
      const uniqueComponents = Array.from(customComponents).filter(
        (name) => !["Fragment", "Suspense", "ErrorBoundary"].includes(name)
      )
      if (uniqueComponents.length > 0) {
        patterns.push(`<${uniqueComponents[0]}`)
      }
    }

    // Add unique classNames
    if (classNames.size > 0) {
      const firstClassName = Array.from(classNames)[0]
      patterns.push(`className="${firstClassName}"`)
    }

    if (patterns.length === 0) {
      lines.push("⚠️ **NO UNIQUE PATTERNS FOUND**")
      lines.push("")
      lines.push("The component source code doesn't contain distinctive patterns to search for.")
      lines.push("You may need to manually search for the component.")
    } else {
      lines.push("📍 **SEARCH PATTERNS**")
      lines.push("")
      lines.push("Use these grep patterns to find the source file:")
      lines.push("")

      for (const pattern of patterns.slice(0, 3)) {
        lines.push(`\`\`\``)
        lines.push(`grep -r "${pattern.replace(/"/g, '\\"')}" .`)
        lines.push(`\`\`\``)
        lines.push("")
      }

      lines.push("💡 **TIP:** Start with the first pattern. If it returns multiple results, try combining patterns.")
    }

    // Show a preview of the source code
    const preview = sourceCode.substring(0, 300)
    lines.push("")
    lines.push("**Source Code Preview:**")
    lines.push("```javascript")
    lines.push(`${preview}...`)
    lines.push("```")

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

/**
 * Restart the development server while preserving logs and monitoring
 */
export async function restartDevServer(params: {
  projectName?: string
}): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  const { projectName } = params

  try {
    // Find active session
    const sessions = findActiveSessions()
    if (sessions.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: "❌ **NO ACTIVE SESSIONS**\n\nNo active dev3000 sessions found. Make sure your app is running with dev3000."
          }
        ]
      }
    }

    // Use specified project or first available session
    let targetSession = sessions[0]
    if (projectName) {
      const found = sessions.find((s) => s.projectName === projectName)
      if (found) {
        targetSession = found
      }
    }

    const sessionData = JSON.parse(readFileSync(targetSession.sessionFile, "utf-8"))
    const appPort = sessionData.appPort
    const serverCommand = sessionData.serverCommand
    const cwd = sessionData.cwd

    if (!appPort) {
      return {
        content: [
          {
            type: "text",
            text: "❌ **NO APP PORT FOUND**\n\nSession file doesn't contain app port information."
          }
        ]
      }
    }

    if (!serverCommand) {
      return {
        content: [
          {
            type: "text",
            text: "❌ **NO SERVER COMMAND FOUND**\n\nSession file doesn't contain the original server command. This session may have been created with an older version of dev3000."
          }
        ]
      }
    }

    logToDevFile(
      `Restart Dev Server: Starting restart for project [${targetSession.projectName}] on port ${appPort} with command [${serverCommand}]`
    )

    // Check if nextjs-dev MCP is available
    const availableMcps = await discoverAvailableMcps(targetSession.projectName)
    const hasNextjsDev = availableMcps.includes("nextjs-dev")

    logToDevFile(`Restart Dev Server: Has nextjs-dev MCP: ${hasNextjsDev}`)

    // Try nextjs-dev MCP first if available
    if (hasNextjsDev) {
      try {
        logToDevFile("Restart Dev Server: Attempting to use nextjs-dev MCP restart")

        // Check if nextjs-dev has restart capability
        const capabilities = await getMcpCapabilities({ mcpName: "nextjs-dev" })
        const capabilitiesText =
          capabilities.content[0] && "text" in capabilities.content[0] ? capabilities.content[0].text : ""

        if (capabilitiesText.includes("restart") || capabilitiesText.includes("reload")) {
          logToDevFile("Restart Dev Server: nextjs-dev MCP has restart capability, delegating")

          return {
            content: [
              {
                type: "text",
                text: "✅ **DELEGATING TO NEXTJS-DEV MCP**\n\nThe nextjs-dev MCP has restart capabilities. Please use the nextjs-dev MCP restart tool directly for better integration with Next.js."
              }
            ]
          }
        }

        logToDevFile("Restart Dev Server: nextjs-dev MCP doesn't have restart capability, falling back")
      } catch (error) {
        logToDevFile(`Restart Dev Server: Failed to check nextjs-dev capabilities - ${error}`)
      }
    }

    // Fallback: Use dev3000's own restart mechanism
    logToDevFile("Restart Dev Server: Using dev3000 restart mechanism")

    // In sandbox environments, lsof doesn't exist - skip process killing
    if (isInSandbox()) {
      logToDevFile("Restart Dev Server: Skipping lsof-based kill in sandbox environment")
      return {
        content: [
          {
            type: "text",
            text: `⚠️ **RESTART NOT SUPPORTED IN SANDBOX**\n\nDev server restart is not supported in sandbox environments (Vercel Sandbox, Docker containers).\n\nThe \`lsof\` utility needed for process management is not available.\n\n💡 If running in Vercel Sandbox, the dev server is managed by the sandbox infrastructure.`
          }
        ]
      }
    }

    // Kill processes on the app port
    const killCommand = `lsof -ti :${appPort} | xargs kill 2>/dev/null || true`
    logToDevFile(`Restart Dev Server: Executing kill command: ${killCommand}`)

    try {
      await execAsync(killCommand)
      logToDevFile("Restart Dev Server: Kill command executed successfully")
    } catch (error) {
      logToDevFile(`Restart Dev Server: Kill command failed (may be ok) - ${error}`)
    }

    // Wait for clean shutdown
    await new Promise((resolve) => setTimeout(resolve, 2000))

    // Check if port is now free
    const checkCommand = `lsof -ti :${appPort}`
    let portFree = false
    try {
      const { stdout } = await execAsync(checkCommand)
      portFree = stdout.trim() === ""
      logToDevFile(`Restart Dev Server: Port check result - free: ${portFree}`)
    } catch {
      // Command failed means no process on port (port is free)
      portFree = true
      logToDevFile("Restart Dev Server: Port is free (lsof returned no results)")
    }

    if (!portFree) {
      return {
        content: [
          {
            type: "text",
            text: `⚠️ **PORT STILL IN USE**\n\nFailed to free port ${appPort}. There may be a process that couldn't be killed.\n\nTry manually killing the process:\n\`\`\`bash\nlsof -ti :${appPort} | xargs kill -9\n\`\`\``
          }
        ]
      }
    }

    logToDevFile("Restart Dev Server: Port is now free, spawning new server process")

    // Spawn new server process
    try {
      const serverProcess = spawn(serverCommand, {
        stdio: "inherit", // Inherit stdio so output goes to dev3000's logs
        shell: true,
        detached: true, // Run independently
        cwd: cwd || process.cwd() // Use original working directory
      })

      // Unref so this process doesn't keep MCP server alive
      serverProcess.unref()

      logToDevFile(`Restart Dev Server: Spawned new server process with PID ${serverProcess.pid}`)

      // Wait a moment for server to start
      await new Promise((resolve) => setTimeout(resolve, 1000))

      // Check if server is actually running on the port
      try {
        const { stdout: checkResult } = await execAsync(`lsof -ti :${appPort}`)
        const isRunning = checkResult.trim() !== ""

        if (isRunning) {
          logToDevFile("Restart Dev Server: Server successfully restarted and running on port")
          return {
            content: [
              {
                type: "text",
                text: `✅ **DEV SERVER RESTARTED**\n\nSuccessfully restarted the development server on port ${appPort}.\n\n🎯 **STATUS:**\n• Old server process: Killed\n• New server process: Running (PID ${serverProcess.pid})\n• Port ${appPort}: Active\n• Browser monitoring: Unchanged\n• Logs: Still being captured\n\n💡 The server has been restarted while keeping dev3000's monitoring, screenshots, and logging intact.`
              }
            ]
          }
        }
        logToDevFile("Restart Dev Server: Server process spawned but not yet listening on port (may still be starting)")
      } catch {
        logToDevFile("Restart Dev Server: Server process spawned but not yet listening on port (may still be starting)")
      }

      return {
        content: [
          {
            type: "text",
            text: `🔄 **DEV SERVER RESTARTING**\n\nStarted a new server process (PID ${serverProcess.pid}).\n\n⏳ **STATUS:**\n• Old server: Killed\n• New server: Starting (may take a few moments)\n• Command: \`${serverCommand}\`\n• Port: ${appPort}\n\nThe server is restarting. Check the dev3000 logs to see when it's ready.`
          }
        ]
      }
    } catch (spawnError) {
      logToDevFile(`Restart Dev Server: Failed to spawn new server process - ${spawnError}`)
      return {
        content: [
          {
            type: "text",
            text: `❌ **RESTART FAILED**\n\nFailed to start new server process.\n\n**Error:** ${spawnError instanceof Error ? spawnError.message : String(spawnError)}\n\n**Command:** \`${serverCommand}\`\n\nThe old server was killed but the new one failed to start. You may need to manually restart dev3000.`
          }
        ]
      }
    }
  } catch (error) {
    logToDevFile(`Restart Dev Server: Error - ${error}`)
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

// Crawl app - discover all URLs
export interface CrawlAppParams {
  depth?: number | "all"
  limit?: number
  projectName?: string
}

export async function crawlApp(params: CrawlAppParams) {
  const { depth = 1, limit = 3, projectName } = params

  try {
    // Find active session
    const sessions = findActiveSessions()
    const session = projectName ? sessions.find((s) => s.projectName === projectName) : sessions[0]

    if (!session) {
      return {
        content: [
          {
            type: "text" as const,
            text: projectName
              ? `❌ No active session found for project "${projectName}". Available projects: ${sessions.map((s) => s.projectName).join(", ") || "none"}`
              : "❌ No active dev3000 sessions found. Start dev3000 first with `d3k` in your project directory."
          }
        ]
      }
    }

    // Get CDP URL and app port from session
    const sessionData = JSON.parse(readFileSync(session.sessionFile, "utf-8"))
    const cdpUrl = sessionData.cdpUrl?.replace("http://", "ws://")
    const appPort = sessionData.appPort || "3000"
    const baseUrl = `http://localhost:${appPort}`

    if (!cdpUrl) {
      return {
        content: [
          {
            type: "text" as const,
            text: "❌ No Chrome DevTools connection found. Browser monitoring must be active to crawl."
          }
        ]
      }
    }

    logToDevFile(`Crawl App: Starting crawl at depth ${depth} with limit ${limit} for ${baseUrl}`)

    // Connect to CDP
    const ws = new WebSocket(cdpUrl)
    await new Promise((resolve, reject) => {
      ws.on("open", resolve)
      ws.on("error", reject)
      setTimeout(() => reject(new Error("CDP connection timeout")), 5000)
    })

    let messageId = 2000
    // biome-ignore lint/suspicious/noExplicitAny: CDP protocol responses are dynamic
    const sendCommand = (method: string, params: Record<string, unknown> = {}): Promise<any> => {
      return new Promise((resolve, reject) => {
        const id = messageId++
        const message = JSON.stringify({ id, method, params })

        const handler = (data: Buffer) => {
          const response = JSON.parse(data.toString())
          if (response.id === id) {
            ws.off("message", handler)
            if (response.error) {
              reject(new Error(response.error.message))
            } else {
              resolve(response.result)
            }
          }
        }

        ws.on("message", handler)
        ws.send(message)

        setTimeout(() => {
          ws.off("message", handler)
          reject(new Error("Command timeout"))
        }, 10000)
      })
    }

    // Enable necessary domains
    await sendCommand("Runtime.enable")
    await sendCommand("Page.enable")

    // Discovered URLs
    const discovered = new Set<string>([baseUrl])
    const visited = new Set<string>()
    const toVisit: string[] = [baseUrl]

    let currentDepth = 0
    const maxDepth = depth === "all" ? Number.POSITIVE_INFINITY : depth

    while (toVisit.length > 0 && currentDepth <= maxDepth) {
      const currentLevelUrls = [...toVisit]
      toVisit.length = 0

      logToDevFile(`Crawl App: Processing depth ${currentDepth} with ${currentLevelUrls.length} URLs`)

      for (const url of currentLevelUrls) {
        if (visited.has(url)) continue
        visited.add(url)

        try {
          // Navigate to URL
          logToDevFile(`Crawl App: Visiting ${url}`)
          await sendCommand("Page.navigate", { url })

          // Wait for page load
          await new Promise((resolve) => setTimeout(resolve, 2000))

          // Extract all links
          const result = await sendCommand("Runtime.evaluate", {
            expression: `
              Array.from(document.querySelectorAll('a[href]')).map(a => {
                try {
                  const url = new URL(a.href, window.location.href);
                  // Only return same-origin links
                  if (url.origin === window.location.origin) {
                    // Remove hash and query params for deduplication
                    return url.origin + url.pathname;
                  }
                } catch {}
                return null;
              }).filter(Boolean)
            `,
            returnByValue: true
          })

          const links = result.result?.value || []

          // Apply limit to prevent following too many links per page
          let linksAdded = 0
          for (const link of links) {
            if (!discovered.has(link)) {
              discovered.add(link)
              if (currentDepth < maxDepth && linksAdded < limit) {
                toVisit.push(link)
                linksAdded++
              }
            }
          }

          logToDevFile(
            `Crawl App: Found ${links.length} links on ${url}, added ${linksAdded} to queue (limit: ${limit})`
          )
        } catch (error) {
          logToDevFile(`Crawl App: Error visiting ${url} - ${error}`)
        }
      }

      currentDepth++

      // For "all" mode, stop when no new URLs are found
      if (depth === "all" && toVisit.length === 0) {
        break
      }
    }

    ws.close()

    const urls = Array.from(discovered).sort()
    const depthReached = depth === "all" ? currentDepth - 1 : Math.min(currentDepth - 1, maxDepth)

    logToDevFile(`Crawl App: Complete - discovered ${urls.length} URLs at depth ${depthReached}`)

    return {
      content: [
        {
          type: "text" as const,
          text: `🕷️ **APP CRAWL COMPLETE**\n\n📊 **SUMMARY:**\n• Base URL: ${baseUrl}\n• Depth: ${depthReached}${depth === "all" ? " (exhaustive)" : ""}\n• Total URLs: ${urls.length}\n\n📍 **DISCOVERED URLs:**\n${urls.map((url) => `• ${url}`).join("\n")}\n\n💡 **NEXT STEPS:**\n• Use fix_my_app to check for errors across all pages\n• Use execute_browser_action to test specific pages\n• Verify all routes are working correctly`
        }
      ]
    }
  } catch (error) {
    logToDevFile(`Crawl App: Error - ${error}`)
    return {
      content: [
        {
          type: "text" as const,
          text: `❌ **CRAWL FAILED**\n\n${error instanceof Error ? error.message : String(error)}`
        }
      ]
    }
  }
}
