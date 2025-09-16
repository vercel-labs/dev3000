#!/usr/bin/env node

import chalk from "chalk"
import { Command } from "commander"
import { existsSync, readFileSync } from "fs"
import { tmpdir } from "os"
import { dirname, join } from "path"
import { fileURLToPath } from "url"
import { createPersistentLogFile, startDevEnvironment } from "./dev-environment.js"

function detectPackageManager(): string {
  if (existsSync("pnpm-lock.yaml")) return "pnpm"
  if (existsSync("yarn.lock")) return "yarn"
  if (existsSync("package-lock.json")) return "npm"
  return "npm" // fallback
}

// Read version from package.json
function getVersion(): string {
  try {
    const currentFile = fileURLToPath(import.meta.url)
    const packageRoot = dirname(dirname(currentFile)) // Go up from dist/ to package root
    const packageJsonPath = join(packageRoot, "package.json")
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"))
    let version = packageJson.version

    // Use git to detect if we're in the dev3000 source repository
    try {
      const { execSync } = require("child_process")
      const gitRemote = execSync("git remote get-url origin 2>/dev/null", {
        cwd: packageRoot,
        encoding: "utf8"
      }).trim()

      if (gitRemote.includes("vercel-labs/dev3000") && !version.includes("canary")) {
        version += "-local"
      }
    } catch {
      // Not in git repo or no git - use version as-is
    }

    return version
  } catch (_error) {
    return "0.0.0" // fallback
  }
}

const program = new Command()

program
  .name("dev3000")
  .description("AI-powered development tools with browser monitoring and MCP server")
  .version(getVersion())

program
  .description("AI-powered development tools with browser monitoring and MCP server")
  .option("-p, --port <port>", "Development server port", "3000")
  .option("--mcp-port <port>", "MCP server port", "3684")
  .option("-s, --script <script>", "Package.json script to run (e.g. dev, build-start)", "dev")
  .option("--profile-dir <dir>", "Chrome profile directory", join(tmpdir(), "dev3000-chrome-profile"))
  .option("--browser <path>", "Full path to browser executable (e.g. for Arc: '/Applications/Arc.app/Contents/MacOS/Arc')")
  .option("--servers-only", "Run servers only, skip browser launch (use with Chrome extension)")
  .option("--debug", "Enable debug logging to console")
  .action(async (options) => {
    // Convert script option to full command
    const packageManager = detectPackageManager()
    const serverCommand = `${packageManager} run ${options.script}`

    // Detect which command name was used (dev3000 or d3k)
    const executablePath = process.argv[1]
    const commandName = executablePath.endsWith("/d3k") || executablePath.includes("/d3k") ? "d3k" : "dev3000"

    try {
      // Create persistent log file and setup symlink
      const logFile = createPersistentLogFile()

      await startDevEnvironment({
        ...options,
        logFile,
        serverCommand,
        debug: options.debug,
        serversOnly: options.serversOnly,
        commandName
      })
    } catch (error) {
      console.error(chalk.red("❌ Failed to start development environment:"), error)
      process.exit(1)
    }
  })

program.parse()
