/**
 * d3k logs - View recent logs from the d3k unified log
 *
 * Shows logs from both browser and server, with optional filtering.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import chalk from "chalk"

export interface LogsOptions {
  count?: string // number of lines to show
  type?: string // browser, server, network, or all
  follow?: boolean // tail -f mode (not implemented yet)
  json?: boolean
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

function matchesType(line: string, type: string): boolean {
  switch (type) {
    case "browser":
      return line.includes("[BROWSER]") || line.includes("[browser]") || line.includes("[CONSOLE")
    case "server":
      return line.includes("[SERVER]") || line.includes("[server]")
    case "network":
      return line.includes("[NETWORK]") || line.includes("[network]")
    default:
      return true
  }
}

function formatLogLine(line: string): string {
  // Determine source and color
  let formatted = line
  if (line.includes("[SERVER]") || line.includes("[server]")) {
    formatted = line.replace(/\[SERVER\]/i, chalk.magenta("[SERVER]"))
  } else if (line.includes("[BROWSER]") || line.includes("[browser]")) {
    formatted = line.replace(/\[BROWSER\]/i, chalk.yellow("[BROWSER]"))
  } else if (line.includes("[NETWORK]") || line.includes("[network]")) {
    formatted = line.replace(/\[NETWORK\]/i, chalk.cyan("[NETWORK]"))
  } else if (line.includes("[D3K]")) {
    formatted = line.replace(/\[D3K\]/, chalk.blue("[D3K]"))
  }

  // Highlight errors
  if (/ERROR|FAIL|Exception/i.test(line)) {
    formatted = chalk.red(formatted)
  } else if (/WARN/i.test(line)) {
    formatted = chalk.yellow(formatted)
  }

  return formatted
}

export async function showLogs(options: LogsOptions): Promise<void> {
  const count = parseInt(options.count || "50", 10)
  const type = options.type || "all"
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
  const allLines = content.trim().split("\n").filter(Boolean)

  if (allLines.length === 0) {
    if (outputJson) {
      console.log(JSON.stringify({ logs: [], message: "Log file is empty" }))
    } else {
      console.log(chalk.yellow("📋 Log file is empty."))
    }
    return
  }

  // Filter by type
  const filteredLines = allLines.filter((line) => matchesType(line, type))

  // Get last N lines
  const linesToShow = filteredLines.slice(-count)

  if (outputJson) {
    console.log(
      JSON.stringify({
        total: filteredLines.length,
        showing: linesToShow.length,
        type,
        logs: linesToShow
      })
    )
    return
  }

  // Header
  console.log(chalk.cyan(`\n📋 d3k logs`))
  if (type !== "all") {
    console.log(chalk.gray(`   Filtered by: ${type}`))
  }
  console.log(chalk.gray(`   Showing last ${linesToShow.length} of ${filteredLines.length} lines`))
  console.log(chalk.gray(`   Log: ${logPath}`))
  console.log()

  // Print logs
  for (const line of linesToShow) {
    console.log(formatLogLine(line))
  }

  console.log()
  console.log(chalk.gray("Tip: Use --type browser|server|network to filter. Use d3k errors to see only errors."))
}
