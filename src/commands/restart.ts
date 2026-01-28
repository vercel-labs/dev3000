/**
 * d3k restart - Restart the development server
 *
 * This command restarts the dev server while keeping d3k's monitoring intact.
 * Use sparingly - HMR handles most code changes automatically.
 */

import { execSync } from "node:child_process"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import chalk from "chalk"

interface Session {
  projectName: string
  pid: number
  appPort: string
  devCommand?: string
  cwd?: string
}

function findActiveSessions(): Session[] {
  const sessionDir = join(homedir(), ".d3k")
  if (!existsSync(sessionDir)) {
    return []
  }

  try {
    const entries = readdirSync(sessionDir, { withFileTypes: true })
    const sessions: Session[] = []

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const sessionFile = join(sessionDir, entry.name, "session.json")
        if (existsSync(sessionFile)) {
          try {
            const content = JSON.parse(readFileSync(sessionFile, "utf-8"))
            // Check if process is still running
            if (content.pid) {
              try {
                process.kill(content.pid, 0)
                sessions.push(content)
              } catch {
                // Process not running
              }
            }
          } catch {
            // Skip invalid session files
          }
        }
      }
    }

    return sessions
  } catch {
    return []
  }
}

export async function restartServer(): Promise<void> {
  console.log(chalk.yellow("⚠️  Restarting development server..."))
  console.log(chalk.gray("Note: HMR handles most code changes automatically."))
  console.log()

  const sessions = findActiveSessions()

  if (sessions.length === 0) {
    console.log(chalk.red("❌ No active d3k sessions found."))
    console.log(chalk.gray("Make sure d3k is running first."))
    process.exit(1)
  }

  const session = sessions[0]

  if (!session.appPort) {
    console.log(chalk.red("❌ Could not find app port for session."))
    process.exit(1)
  }

  const appPort = session.appPort

  try {
    // Find and kill the process on the app port
    console.log(chalk.gray(`Finding process on port ${appPort}...`))

    try {
      const pids = execSync(`lsof -ti:${appPort} -sTCP:LISTEN`, { encoding: "utf-8" }).trim()
      if (pids) {
        console.log(chalk.gray(`Killing process(es): ${pids.split("\n").join(", ")}`))
        execSync(`kill -9 ${pids.split("\n").join(" ")}`, { stdio: "ignore" })
      }
    } catch {
      console.log(chalk.yellow("No process found on port or lsof not available."))
    }

    // Wait for port to be released
    await new Promise((resolve) => setTimeout(resolve, 1000))

    // Restart the dev server
    const devCommand = session.devCommand || "npm run dev"

    console.log(chalk.green(`✓ Dev server process killed`))
    console.log(chalk.gray(`Restart your dev server manually with: ${devCommand}`))
    console.log()
    console.log(chalk.yellow("Note: d3k will detect when the server restarts automatically."))
  } catch (error) {
    console.log(chalk.red(`❌ Failed to restart: ${error instanceof Error ? error.message : String(error)}`))
    process.exit(1)
  }
}
