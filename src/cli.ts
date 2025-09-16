#!/usr/bin/env node

import chalk from "chalk"
import { Command } from "commander"
import { existsSync, readFileSync } from "fs"
import { tmpdir } from "os"
import { dirname, join } from "path"
import { fileURLToPath } from "url"
import { createPersistentLogFile, startDevEnvironment } from "./dev-environment.js"

interface ProjectConfig {
  type: "node" | "python"
  packageManager?: string // Only for node projects
  pythonCommand?: string // Only for python projects
  defaultScript: string
  defaultPort: string
}

function detectPythonCommand(debug = false): string {
  // Check if we're in a virtual environment
  if (process.env.VIRTUAL_ENV) {
    if (debug) {
      console.log(`[PYTHON DEBUG] Virtual environment detected: ${process.env.VIRTUAL_ENV}`)
      console.log(`[PYTHON DEBUG] Using activated python command`)
    }
    return "python"
  }

  // Check if python3 is available and prefer it
  try {
    require("child_process").execSync("python3 --version", { stdio: "ignore" })
    if (debug) {
      console.log(`[PYTHON DEBUG] python3 is available, using python3`)
    }
    return "python3"
  } catch {
    if (debug) {
      console.log(`[PYTHON DEBUG] python3 not available, falling back to python`)
    }
    return "python"
  }
}

function detectProjectType(debug = false): ProjectConfig {
  // Check for Python project
  if (existsSync("requirements.txt") || existsSync("pyproject.toml")) {
    if (debug) {
      console.log(`[PROJECT DEBUG] Python project detected (found requirements.txt or pyproject.toml)`)
    }
    return {
      type: "python",
      defaultScript: "main.py",
      defaultPort: "8000", // Common Python web server port
      pythonCommand: detectPythonCommand(debug)
    }
  }

  // Check for Node.js project
  if (existsSync("pnpm-lock.yaml")) {
    if (debug) {
      console.log(`[PROJECT DEBUG] Node.js project detected (found pnpm-lock.yaml)`)
    }
    return {
      type: "node",
      packageManager: "pnpm",
      defaultScript: "dev",
      defaultPort: "3000"
    }
  }
  if (existsSync("yarn.lock")) {
    if (debug) {
      console.log(`[PROJECT DEBUG] Node.js project detected (found yarn.lock)`)
    }
    return {
      type: "node",
      packageManager: "yarn",
      defaultScript: "dev",
      defaultPort: "3000"
    }
  }
  if (existsSync("package-lock.json")) {
    if (debug) {
      console.log(`[PROJECT DEBUG] Node.js project detected (found package-lock.json)`)
    }
    return {
      type: "node",
      packageManager: "npm",
      defaultScript: "dev",
      defaultPort: "3000"
    }
  }

  // Fallback to npm for Node.js
  if (debug) {
    console.log(`[PROJECT DEBUG] No project files detected, defaulting to Node.js with npm`)
  }
  return {
    type: "node",
    packageManager: "npm",
    defaultScript: "dev",
    defaultPort: "3000"
  }
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
  .option("-p, --port <port>", "Development server port (auto-detected by project type)")
  .option("--mcp-port <port>", "MCP server port", "3684")
  .option("-s, --script <script>", "Script to run (e.g. dev, main.py) - auto-detected by project type")
  .option("--profile-dir <dir>", "Chrome profile directory", join(tmpdir(), "dev3000-chrome-profile"))
  .option(
    "--browser <path>",
    "Full path to browser executable (e.g. for Arc: '/Applications/Arc.app/Contents/MacOS/Arc')"
  )
  .option("--servers-only", "Run servers only, skip browser launch (use with Chrome extension)")
  .option("--debug", "Enable debug logging to console")
  .action(async (options) => {
    // Detect project type and configuration
    const projectConfig = detectProjectType(options.debug)

    // Use defaults from project detection if not explicitly provided
    const port = options.port || projectConfig.defaultPort
    const script = options.script || projectConfig.defaultScript

    // Generate server command based on project type
    let serverCommand: string
    if (projectConfig.type === "python") {
      serverCommand = `${projectConfig.pythonCommand} ${script}`
    } else {
      // Node.js project
      serverCommand = `${projectConfig.packageManager} run ${script}`
    }

    if (options.debug) {
      console.log(`[CLI DEBUG] Project type: ${projectConfig.type}`)
      console.log(`[CLI DEBUG] Port: ${port} (${options.port ? 'explicit' : 'auto-detected'})`)
      console.log(`[CLI DEBUG] Script: ${script} (${options.script ? 'explicit' : 'auto-detected'})`)
      console.log(`[CLI DEBUG] Server command: ${serverCommand}`)
    }

    // Detect which command name was used (dev3000 or d3k)
    const executablePath = process.argv[1]
    const commandName = executablePath.endsWith("/d3k") || executablePath.includes("/d3k") ? "d3k" : "dev3000"

    try {
      // Create persistent log file and setup symlink
      const logFile = createPersistentLogFile()

      await startDevEnvironment({
        ...options,
        port,
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
