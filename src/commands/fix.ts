/**
 * d3k fix - Diagnose application errors from logs
 *
 * Analyzes d3k session logs and categorizes errors by type and severity.
 * Returns a prioritized list of issues that need to be fixed.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import chalk from "chalk"

export interface FixOptions {
  focus?: string // build, runtime, network, ui, all
  time?: string // minutes to look back
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

interface CategorizedErrors {
  serverErrors: string[]
  browserErrors: string[]
  buildErrors: string[]
  networkErrors: string[]
  warnings: string[]
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

function getLogPath(projectName?: string): string | null {
  if (projectName) {
    const sessions = findActiveSessions()
    const session = sessions.find((s) => s.projectName === projectName)
    if (session) {
      return session.logFilePath
    }
  }

  const envPath = process.env.LOG_FILE_PATH
  if (envPath) {
    return envPath
  }

  return null
}

function findInteractionsBeforeError(errorLine: string, allLines: string[]): string[] {
  const errorIndex = allLines.indexOf(errorLine)
  if (errorIndex === -1) return []

  const interactions: string[] = []
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

export async function fixMyApp(options: FixOptions): Promise<void> {
  const focusArea = options.focus || "all"
  const timeRangeMinutes = parseInt(options.time || "10", 10)
  const outputJson = options.json || false

  const sessions = findActiveSessions()

  if (sessions.length === 0) {
    if (outputJson) {
      console.log(JSON.stringify({ error: "No active d3k sessions found" }))
    } else {
      console.log(chalk.red("❌ No active d3k sessions found."))
      console.log(chalk.gray("Make sure d3k is running first."))
    }
    process.exit(1)
  }

  // Auto-select if only one session
  const session = sessions[0]
  let logPath: string | null = session.logFilePath

  if (!logPath) {
    logPath = getLogPath(session.projectName)
  }

  if (!logPath) {
    if (outputJson) {
      console.log(JSON.stringify({ error: "Could not find log file" }))
    } else {
      console.log(chalk.red("❌ Could not find log file for session."))
    }
    process.exit(1)
  }

  if (!existsSync(logPath)) {
    if (outputJson) {
      console.log(JSON.stringify({ status: "waiting", message: "Log file doesn't exist yet" }))
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
      console.log(JSON.stringify({ status: "empty", message: "Log file is empty" }))
    } else {
      console.log(chalk.yellow("📋 Log file is empty."))
      console.log(chalk.gray("Make sure your app is running and generating logs."))
    }
    return
  }

  if (!outputJson) {
    console.log(chalk.cyan(`🔍 FIX MY APP ANALYSIS`))
    console.log(chalk.gray(`📁 Log file: ${logPath}`))
    console.log(chalk.gray(`📊 Total log entries: ${logLines.length}`))
    console.log()
  }

  // Time-based filtering
  const now = new Date()
  const cutoffTime = new Date(now.getTime() - timeRangeMinutes * 60 * 1000)

  // Error patterns
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
    /RUNTIME\.ERROR/,
    /hydration.*mismatch/i,
    /Uncaught/i,
    /throwOnHydrationMismatch/i
  ]

  // Filter logs by time range
  const timeFilteredLines = logLines.filter((line) => {
    const isoMatch = line.match(/\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\]/)
    if (isoMatch) {
      const logTime = new Date(isoMatch[1])
      return logTime >= cutoffTime
    }

    const timeMatch = line.match(/\[(\d{2}):(\d{2}):(\d{2})\.(\d{3})\]/)
    if (timeMatch) {
      const logTime = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
        parseInt(timeMatch[1], 10),
        parseInt(timeMatch[2], 10),
        parseInt(timeMatch[3], 10),
        parseInt(timeMatch[4], 10)
      )
      if (logTime > now) {
        logTime.setDate(logTime.getDate() - 1)
      }
      return logTime >= cutoffTime
    }

    return true
  })

  // Find all errors
  const allErrors = timeFilteredLines.filter((line) => {
    return errorPatterns.some((pattern) => pattern.test(line))
  })

  // Filter out framework noise
  const frameworkNoisePatterns = [
    /link rel=preload.*must have.*valid.*as/i,
    /next\/font/i,
    /automatically generated/i,
    /\[NETWORK\].*\b(200|201|204|304)\b\s+(OK|Created|No Content|Not Modified)/i
  ]

  const actionableErrors = allErrors.filter((line) => {
    return !frameworkNoisePatterns.some((pattern) => pattern.test(line))
  })

  // Categorize errors
  const categorizedErrors: CategorizedErrors = {
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
      if (/\b(200|201|204|304)\b/.test(line)) return false
      return line.includes("NETWORK") || line.includes("404") || line.includes("500") || line.includes("timeout")
    }),
    warnings: actionableErrors.filter(
      (line) => /WARN|WARNING|deprecated/i.test(line) && !/ERROR|Exception|FAIL/i.test(line)
    )
  }

  const totalErrors = actionableErrors.length
  const criticalErrors = totalErrors - categorizedErrors.warnings.length

  if (outputJson) {
    console.log(
      JSON.stringify(
        {
          totalErrors,
          criticalErrors,
          warnings: categorizedErrors.warnings.length,
          categorized: {
            server: categorizedErrors.serverErrors.length,
            browser: categorizedErrors.browserErrors.length,
            build: categorizedErrors.buildErrors.length,
            network: categorizedErrors.networkErrors.length
          },
          errors: {
            server: categorizedErrors.serverErrors.slice(-5),
            browser: categorizedErrors.browserErrors.slice(-5),
            build: categorizedErrors.buildErrors.slice(-5),
            network: categorizedErrors.networkErrors.slice(-5),
            warnings: categorizedErrors.warnings.slice(-3)
          }
        },
        null,
        2
      )
    )
    return
  }

  if (totalErrors === 0) {
    console.log(chalk.green(`✅ No errors found in last ${timeRangeMinutes} minutes.`))
    console.log(chalk.gray("Application appears healthy."))
    return
  }

  console.log(chalk.red(`❌ ${totalErrors} ISSUES DETECTED`))
  console.log(chalk.gray(`   (${criticalErrors} critical, ${categorizedErrors.warnings.length} warnings)`))
  console.log()

  const printErrors = (title: string, errors: string[], color: typeof chalk.red) => {
    if (errors.length === 0) return

    console.log(color(`${title}:`))
    for (const error of errors.slice(-5)) {
      const interactions = findInteractionsBeforeError(error, logLines)
      if (interactions.length > 0) {
        console.log(chalk.gray("  Preceding interactions:"))
        for (const i of interactions) {
          console.log(chalk.gray(`    ${i}`))
        }
      }
      console.log(`  ${error}`)
      console.log()
    }
  }

  if (focusArea === "all" || focusArea === "build") {
    printErrors("BUILD/COMPILATION ERRORS", categorizedErrors.buildErrors, chalk.red)
  }

  if (focusArea === "all" || focusArea === "runtime") {
    printErrors("SERVER ERRORS", categorizedErrors.serverErrors, chalk.red)
    printErrors("BROWSER/CONSOLE ERRORS", categorizedErrors.browserErrors, chalk.yellow)
  }

  if (focusArea === "all" || focusArea === "network") {
    printErrors("NETWORK/API ERRORS", categorizedErrors.networkErrors, chalk.magenta)
  }

  if (focusArea === "all" && categorizedErrors.warnings.length > 0) {
    console.log(chalk.yellow(`WARNINGS (${categorizedErrors.warnings.length} found, showing recent):`))
    for (const w of categorizedErrors.warnings.slice(-3)) {
      console.log(`  ${w}`)
    }
    console.log()
  }

  console.log(chalk.gray("---"))
  console.log(chalk.cyan("Fix the highest-priority error, then run `d3k fix` again to verify."))
}
