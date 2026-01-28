/**
 * d3k errors - Quick view of recent errors from d3k logs
 *
 * Shows the most recent errors from both browser and server logs.
 * This is the quick "what went wrong?" command.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import chalk from "chalk"

export interface ErrorsOptions {
  count?: string // number of errors to show
  all?: boolean // show all errors, not just recent
  context?: boolean // show interactions that preceded each error
  json?: boolean // output as JSON
}

interface Session {
  projectName: string
  startTime: string
  logFilePath: string
  sessionFile: string
  pid: number
  lastModified: Date
}

function findActiveSessions(): Session[] {
  const sessionDir = join(homedir(), ".d3k")
  if (!existsSync(sessionDir)) {
    return []
  }

  try {
    const entries = readdirSync(sessionDir, { withFileTypes: true })
    const sessionFiles: string[] = []

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const sessionFile = join(sessionDir, entry.name, "session.json")
        if (existsSync(sessionFile)) {
          sessionFiles.push(sessionFile)
        }
      }
    }

    const sessions = sessionFiles
      .map((filePath) => {
        try {
          const content = JSON.parse(readFileSync(filePath, "utf-8"))
          const stat = statSync(filePath)
          return {
            ...content,
            sessionFile: filePath,
            lastModified: stat.mtime
          }
        } catch {
          return null
        }
      })
      .filter((session): session is Session => {
        if (!session || !session.pid) return false
        try {
          process.kill(session.pid, 0)
          return true
        } catch {
          return false
        }
      })
      .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime())

    return sessions
  } catch {
    return []
  }
}

function getLogPath(): string | null {
  // First check for active sessions
  const sessions = findActiveSessions()
  if (sessions.length > 0) {
    return sessions[0].logFilePath
  }

  // Fall back to environment variable
  const envPath = process.env.LOG_FILE_PATH
  if (envPath) {
    return envPath
  }

  // Try to find the most recent log file
  const sessionDir = join(homedir(), ".d3k")
  if (!existsSync(sessionDir)) {
    return null
  }

  try {
    const entries = readdirSync(sessionDir, { withFileTypes: true })
    let mostRecentLog: { path: string; mtime: Date } | null = null

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const logFile = join(sessionDir, entry.name, "d3k.log")
        if (existsSync(logFile)) {
          const stat = statSync(logFile)
          if (!mostRecentLog || stat.mtime > mostRecentLog.mtime) {
            mostRecentLog = { path: logFile, mtime: stat.mtime }
          }
        }
      }
    }

    return mostRecentLog?.path || null
  } catch {
    return null
  }
}

// Error patterns to match
const errorPatterns = [
  /\[.*ERROR.*\]/i,
  /\[.*FAIL.*\]/i,
  /Exception/i,
  /CRITICAL/i,
  /FATAL/i,
  /Uncaught/i,
  /TypeError/i,
  /ReferenceError/i,
  /SyntaxError/i,
  /RUNTIME\.ERROR/,
  /hydration.*mismatch/i,
  /Failed to compile/i,
  /Build failed/i,
  /\b500\b.*Internal Server Error/i,
  /\b503\b.*Service Unavailable/i,
  /ECONNREFUSED/i,
  /ENOTFOUND/i,
  /timeout/i
]

// Patterns to ignore (framework noise)
const ignorePatterns = [
  /link rel=preload.*must have.*valid.*as/i,
  /next\/font/i,
  /automatically generated/i,
  /Download the React DevTools/i,
  /\[HMR\]/i
]

function isError(line: string): boolean {
  // Skip ignored patterns
  if (ignorePatterns.some((p) => p.test(line))) {
    return false
  }
  // Check for error patterns
  return errorPatterns.some((p) => p.test(line))
}

// Patterns that indicate user interactions (for replay context)
function isInteraction(line: string): boolean {
  return (
    line.includes("[INTERACTION]") ||
    line.includes("[NAVIGATION]") ||
    line.includes("[PAGE]") ||
    line.includes("[CLICK]") ||
    line.includes("[INPUT]") ||
    line.includes("[SUBMIT]") ||
    line.includes("[SCROLL]")
  )
}

// Find interactions that happened before an error (for replay)
function findInteractionsBefore(errorLine: string, allLines: string[], maxCount = 5): string[] {
  const errorIndex = allLines.indexOf(errorLine)
  if (errorIndex === -1) return []

  const interactions: string[] = []
  // Look back up to 30 lines to find interactions
  for (let i = errorIndex - 1; i >= Math.max(0, errorIndex - 30) && interactions.length < maxCount; i--) {
    if (isInteraction(allLines[i])) {
      interactions.unshift(allLines[i])
    }
  }
  return interactions
}

function formatInteraction(line: string): string {
  // Extract timestamp if present
  const timeMatch = line.match(/\[(\d{2}:\d{2}:\d{2}\.\d{3})\]/)
  const time = timeMatch ? timeMatch[1] : ""

  // Clean up the line
  const message = line
    .replace(/\[\d{2}:\d{2}:\d{2}\.\d{3}\]\s*/, "") // Remove timestamp
    .trim()

  return `  ${chalk.gray(time)} ${chalk.cyan("→")} ${chalk.dim(message)}`
}

function formatError(line: string): string {
  // Extract timestamp if present
  const timeMatch = line.match(/\[(\d{2}:\d{2}:\d{2}\.\d{3})\]/)
  const time = timeMatch ? timeMatch[1] : ""

  // Determine error type and color
  let prefix = ""
  const color = chalk.red

  if (line.includes("[SERVER]") || line.includes("[server]")) {
    prefix = chalk.magenta("SERVER")
  } else if (line.includes("[BROWSER]") || line.includes("[browser]")) {
    prefix = chalk.yellow("BROWSER")
  } else if (line.includes("[NETWORK]") || line.includes("[network]")) {
    prefix = chalk.cyan("NETWORK")
  } else if (line.includes("Failed to compile") || line.includes("Build failed")) {
    prefix = chalk.red("BUILD")
  } else {
    prefix = chalk.gray("LOG")
  }

  // Clean up the line for display
  let message = line
    .replace(/\[\d{2}:\d{2}:\d{2}\.\d{3}\]\s*/, "") // Remove timestamp
    .replace(/\[(SERVER|BROWSER|NETWORK|D3K)\]\s*/gi, "") // Remove source tag
    .trim()

  // Truncate very long lines
  if (message.length > 200) {
    message = `${message.substring(0, 197)}...`
  }

  return `${chalk.gray(time)} ${prefix} ${color(message)}`
}

export async function showErrors(options: ErrorsOptions): Promise<void> {
  const count = parseInt(options.count || "10", 10)
  const showAll = options.all || false
  const showContext = options.context || false
  const outputJson = options.json || false

  const logPath = getLogPath()

  if (!logPath) {
    if (outputJson) {
      console.log(JSON.stringify({ error: "No d3k log file found" }))
    } else {
      console.log(chalk.red("❌ No d3k log file found."))
      console.log(chalk.gray("Make sure d3k is running or has been run recently."))
    }
    process.exit(1)
  }

  if (!existsSync(logPath)) {
    if (outputJson) {
      console.log(JSON.stringify({ error: "Log file doesn't exist", path: logPath }))
    } else {
      console.log(chalk.yellow("📋 Log file doesn't exist yet."))
      console.log(chalk.gray("The dev server may still be starting up."))
    }
    return
  }

  const content = readFileSync(logPath, "utf-8")
  const logLines = content.trim().split("\n").filter(Boolean)

  if (logLines.length === 0) {
    if (outputJson) {
      console.log(JSON.stringify({ errors: [], message: "Log file is empty" }))
    } else {
      console.log(chalk.yellow("📋 Log file is empty."))
    }
    return
  }

  // Find all error lines
  const errorLines = logLines.filter(isError)

  if (errorLines.length === 0) {
    if (outputJson) {
      console.log(JSON.stringify({ errors: [], message: "No errors found" }))
    } else {
      console.log(chalk.green("✅ No errors found in the logs."))
    }
    return
  }

  // Get the requested number of errors (from the end)
  const errorsToShow = showAll ? errorLines : errorLines.slice(-count)

  if (outputJson) {
    const result: {
      total: number
      showing: number
      errors: string[] | Array<{ error: string; interactions: string[] }>
    } = {
      total: errorLines.length,
      showing: errorsToShow.length,
      errors: showContext
        ? errorsToShow.map((error) => ({
            error,
            interactions: findInteractionsBefore(error, logLines)
          }))
        : errorsToShow
    }
    console.log(JSON.stringify(result, null, 2))
    return
  }

  // Header
  console.log(chalk.red(`\n❌ ${errorLines.length} error${errorLines.length === 1 ? "" : "s"} found`))
  if (!showAll && errorLines.length > count) {
    console.log(chalk.gray(`   Showing last ${count}. Use --all to see all errors.`))
  }
  if (showContext) {
    console.log(chalk.gray(`   Showing interaction context for replay.`))
  }
  console.log(chalk.gray(`   Log: ${logPath}`))
  console.log()

  // Print errors with optional context
  for (const line of errorsToShow) {
    if (showContext) {
      const interactions = findInteractionsBefore(line, logLines)
      if (interactions.length > 0) {
        console.log(chalk.dim("  Interactions before error:"))
        for (const interaction of interactions) {
          console.log(formatInteraction(interaction))
        }
      }
    }
    console.log(formatError(line))
    if (showContext) {
      console.log() // Extra spacing between errors when showing context
    }
  }

  if (!showContext) {
    console.log()
  }
  console.log(chalk.gray("Tip: Use --context to see interactions for replay verification."))
}
