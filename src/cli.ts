#!/usr/bin/env -S node --no-warnings

import chalk from "chalk"
import { Command } from "commander"
import { existsSync, readFileSync } from "fs"
import { homedir, tmpdir } from "os"
import { detect } from "package-manager-detector"
import { dirname, join, delimiter as pathDelimiter } from "path"
import { fileURLToPath } from "url"
import { createPersistentLogFile, startDevEnvironment } from "./dev-environment.js"
import { Logger, LogLevel, parseLogLevel } from "./utils/logger.js"
import { getProjectName } from "./utils/project-name.js"

// Global logger instance
let logger: Logger

interface ProjectConfig {
  type: "node" | "python" | "rails"
  packageManager?: string // Only for node projects
  pythonCommand?: string // Only for python projects
  defaultScript: string
  defaultPort: string
}

function detectPythonCommand(log?: Logger): string {
  if (log) {
    log.debug("━━━ Python Command Detection ━━━")
    log.logFields(LogLevel.DEBUG, "Environment check", {
      VIRTUAL_ENV: process.env.VIRTUAL_ENV || "(not set)",
      "PATH (first 3)": process.env.PATH
        ? `${process.env.PATH.split(pathDelimiter).slice(0, 3).join(", ")}...`
        : "(not set)"
    })
  }

  // Check if we're in a virtual environment
  if (process.env.VIRTUAL_ENV) {
    if (log) {
      log.debug(`✓ Virtual environment detected: ${process.env.VIRTUAL_ENV}`)
      log.debug("→ Using activated python command")
    }
    return "python"
  }

  // Check if python3 is available and prefer it
  try {
    const version = require("child_process")
      .execSync("python3 --version", {
        encoding: "utf-8",
        stdio: "pipe",
        timeout: 1500
      })
      .trim()
    if (log) {
      log.debug(`✓ python3 is available: ${version}`)
      log.debug("→ Using python3")
    }
    return "python3"
  } catch (error) {
    if (log) {
      log.debug(`✗ python3 not available: ${error instanceof Error ? error.message : "unknown error"}`)
      log.debug("→ Falling back to python")
    }
    return "python"
  }
}

async function detectProjectType(log?: Logger): Promise<ProjectConfig> {
  if (log) {
    log.debug("━━━ Project Type Detection ━━━")
    log.logFields(LogLevel.DEBUG, "Project indicators", {
      "Current directory": process.cwd(),
      "requirements.txt": existsSync("requirements.txt") ? "✓ found" : "✗ not found",
      "pyproject.toml": existsSync("pyproject.toml") ? "✓ found" : "✗ not found",
      Gemfile: existsSync("Gemfile") ? "✓ found" : "✗ not found",
      "config/application.rb": existsSync("config/application.rb") ? "✓ found" : "✗ not found",
      "package.json": existsSync("package.json") ? "✓ found" : "✗ not found"
    })
  }

  // Check for Python project
  const hasPythonFiles = existsSync("requirements.txt") || existsSync("pyproject.toml")
  if (hasPythonFiles) {
    const pythonCommand = detectPythonCommand(log)
    if (log) {
      const files = [
        existsSync("requirements.txt") && "requirements.txt",
        existsSync("pyproject.toml") && "pyproject.toml"
      ]
        .filter(Boolean)
        .join(", ")
      log.debug("✓ Python project detected")
      log.logFields(LogLevel.DEBUG, "Python project config", {
        "Detected files": files,
        "Python command": pythonCommand,
        "Default port": "8000"
      })
    }
    return {
      type: "python",
      defaultScript: "main.py",
      defaultPort: "8000",
      pythonCommand
    }
  }

  // Check for Rails project
  const hasRailsFiles = existsSync("Gemfile") && existsSync("config/application.rb")
  if (hasRailsFiles) {
    if (log) {
      log.debug("✓ Rails project detected")
      log.logFields(LogLevel.DEBUG, "Rails project config", {
        "Detected files": "Gemfile, config/application.rb",
        "Default command": "bundle exec rails server",
        "Default port": "3000"
      })
    }
    return {
      type: "rails",
      defaultScript: "server",
      defaultPort: "3000"
    }
  }

  // Check for Node.js project using package-manager-detector
  if (log) {
    log.debug("Detecting Node.js package manager...")
  }
  const detected = await detect()

  if (detected) {
    if (log) {
      log.debug("✓ Node.js project detected")
      log.logFields(LogLevel.DEBUG, "Node.js project config", {
        "Package manager": detected.agent,
        "Lock file": detected.name,
        "Default script": "dev",
        "Default port": "3000"
      })
    }
    return {
      type: "node",
      packageManager: detected.agent,
      defaultScript: "dev",
      defaultPort: "3000"
    }
  }

  // Fallback to npm for Node.js
  if (log) {
    log.warn("⚠ No project indicators detected, using fallback")
    log.logFields(LogLevel.DEBUG, "Fallback config", {
      Type: "node",
      "Package manager": "npm (fallback)",
      "Default script": "dev",
      "Default port": "3000"
    })
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

// Check if installed globally before proceeding
function checkGlobalInstall(log?: Logger): boolean {
  const currentFile = fileURLToPath(import.meta.url)
  const packageRoot = dirname(dirname(currentFile))

  if (log) {
    log.debug("━━━ Global Install Check ━━━")
    log.logFields(LogLevel.DEBUG, "Installation paths", {
      "Current file": currentFile,
      "Package root": packageRoot
    })
  }

  // Check common global install paths
  const globalPaths = [
    "/usr/local/lib/node_modules",
    "/usr/lib/node_modules",
    process.env.NPM_CONFIG_PREFIX && join(process.env.NPM_CONFIG_PREFIX, "lib/node_modules"),
    process.env.PNPM_HOME,
    process.platform === "win32" && process.env.APPDATA && join(process.env.APPDATA, "npm/node_modules"),
    process.env.HOME && join(process.env.HOME, ".npm-global/lib/node_modules"),
    process.env.HOME && join(process.env.HOME, ".pnpm"),
    process.env.HOME && join(process.env.HOME, ".yarn/global/node_modules")
  ].filter(Boolean) as string[]

  if (log) {
    log.debug(`Checking ${globalPaths.length} global install paths`)
    globalPaths.forEach((path, i) => {
      const isMatch = packageRoot.includes(path)
      log.trace(`  [${i + 1}] ${isMatch ? "✓" : "✗"} ${path}`)
    })
  }

  // Check if our package path contains any of these global paths
  for (const globalPath of globalPaths) {
    if (packageRoot.includes(globalPath)) {
      if (log) {
        log.debug(`✓ Global installation detected: ${globalPath}`)
      }
      return true
    }
  }

  // Additional check: if we're in node_modules but not in a project's node_modules
  if (packageRoot.includes("node_modules") && !existsSync(join(packageRoot, "..", "..", "..", "package.json"))) {
    return true
  }

  // If we're in dev (running from source), that's fine
  if (!packageRoot.includes("node_modules")) {
    return true
  }

  return false
}

// Perform the check
if (!checkGlobalInstall()) {
  console.error(chalk.red("\n❌ Error: dev3000 must be installed globally.\n"))
  console.error(chalk.white("This package won't work correctly as a local dependency.\n"))
  console.error(chalk.cyan("To install globally, use one of these commands:"))
  console.error(chalk.gray("  pnpm install -g dev3000"))
  console.error(chalk.gray("  npm install -g dev3000"))
  console.error(chalk.gray("  yarn global add dev3000\n"))
  console.error(chalk.white("Then run 'd3k' or 'dev3000' from any project directory.\n"))
  process.exit(1)
}

const program = new Command()

program
  .name("dev3000")
  .description("AI-powered development tools with browser monitoring and MCP server")
  .version(getVersion())

program
  .description("AI-powered development tools with browser monitoring and MCP server")
  .option("-p, --port <port>", "Development server port (auto-detected by project type)")
  .option("-m, --port-mcp <port>", "MCP server port", "3684")
  .option("-s, --script <script>", "Script to run (e.g. dev, main.py) - auto-detected by project type")
  .option("--profile-dir <dir>", "Chrome profile directory", join(tmpdir(), "dev3000-chrome-profile"))
  .option(
    "--browser <path>",
    "Full path to browser executable (e.g. for Arc: '/Applications/Arc.app/Contents/MacOS/Arc')"
  )
  .option("--servers-only", "Run servers only, skip browser launch (use with Chrome extension)")
  .option("--debug", "Enable debug logging to console (automatically disables TUI) - Alias for --log-level=DEBUG")
  .option("--log-level <level>", "Log level: ERROR, WARN, INFO, DEBUG, TRACE (default: INFO, env: DEV3000_LOG_LEVEL)")
  .option("-t, --tail", "Output consolidated logfile to terminal (like tail -f)")
  .option("--no-tui", "Disable TUI mode and use standard terminal output")
  .option(
    "--date-time <format>",
    "Timestamp format: 'local' (default, e.g. 12:54:03 PM) or 'utc' (ISO string)",
    "local"
  )
  .option("--plugin-react-scan", "Enable react-scan performance monitoring for React applications")
  .option("--no-chrome-devtools-mcp", "Disable chrome-devtools MCP integration (enabled by default)")
  .option("--kill-mcp", "Kill the MCP server on port 3684 and exit")
  .action(async (options) => {
    // Initialize logger with appropriate log level
    let logLevel = LogLevel.INFO // Default

    // Check for log level from options (priority: --log-level > --debug > env)
    if (options.logLevel) {
      try {
        logLevel = parseLogLevel(options.logLevel)
      } catch (error) {
        console.error(chalk.red(`❌ Invalid log level: ${options.logLevel}`))
        console.error(chalk.yellow(`   Valid levels: ERROR, WARN, INFO, DEBUG, TRACE`))
        process.exit(1)
      }
    } else if (options.debug) {
      logLevel = LogLevel.DEBUG
    } else if (process.env.DEV3000_LOG_LEVEL) {
      try {
        logLevel = parseLogLevel(process.env.DEV3000_LOG_LEVEL)
      } catch (error) {
        console.error(chalk.yellow(`⚠ Invalid DEV3000_LOG_LEVEL: ${process.env.DEV3000_LOG_LEVEL}, using INFO`))
      }
    }

    logger = new Logger({
      level: logLevel,
      prefix: "cli",
      enableColors: true,
      enableTimestamp: false
    })

    logger.debug("━━━ CLI Initialization ━━━")
    logger.debug(`Log level: ${LogLevel[logLevel]}`)
    logger.debug(`Command line args: ${process.argv.slice(2).join(" ")}`)
    logger.debug(`Working directory: ${process.cwd()}`)

    // Handle --kill-mcp option
    if (options.killMcp) {
      console.log(chalk.yellow("🛑 Killing MCP server on port 3684..."))
      try {
        const { spawn } = require("child_process")
        await new Promise<void>((resolve) => {
          const killProcess = spawn("sh", ["-c", "lsof -ti:3684 | xargs kill -9"], { stdio: "inherit" })
          killProcess.on("exit", () => resolve())
        })
        console.log(chalk.green("✅ MCP server killed"))
      } catch (_error) {
        console.log(chalk.gray("⚠️ No MCP server found on port 3684"))
      }
      process.exit(0)
    }

    // Detect project type and configuration
    const projectConfig = await detectProjectType(logger)

    // Use defaults from project detection if not explicitly provided
    const port = options.port || projectConfig.defaultPort
    const script = options.script || projectConfig.defaultScript
    const userSetPort = options.port !== undefined
    const userSetMcpPort = process.argv.includes("--port-mcp") || process.argv.includes("-p-mcp")

    // Generate server command based on project type
    let serverCommand: string
    if (projectConfig.type === "python") {
      serverCommand = `${projectConfig.pythonCommand} ${script}`
    } else if (projectConfig.type === "rails") {
      serverCommand = `bundle exec rails ${script}`
    } else {
      // Node.js project
      serverCommand = `${projectConfig.packageManager} run ${script}`
    }

    logger.debug("━━━ Configuration ━━━")
    logger.logFields(LogLevel.DEBUG, "Server configuration", {
      "Project type": projectConfig.type,
      Port: `${port} (${userSetPort ? "explicit" : "auto-detected"})`,
      Script: `${script} (${options.script ? "explicit" : "auto-detected"})`,
      "Server command": serverCommand,
      "User set port": userSetPort,
      "User set MCP port": userSetMcpPort
    })

    // Check for circular dependency - detect if the script would invoke dev3000 itself
    if (projectConfig.type === "node") {
      try {
        const packageJson = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf-8"))
        const scriptContent = packageJson.scripts?.[script]

        // Check if the script invokes dev3000 or d3k
        if (scriptContent && (scriptContent.includes("dev3000") || /\bd3k\b/.test(scriptContent))) {
          console.error(chalk.red(`\n❌ Circular dependency detected!`))
          console.error(
            chalk.yellow(
              `   The "${script}" script in package.json calls dev3000, which would create an infinite loop.`
            )
          )
          console.error(chalk.yellow(`   Current script content: "${scriptContent}"`))
          console.error(chalk.yellow(`\n💡 Fix this by either:`))
          console.error(chalk.yellow(`   1. Change the "${script}" script to call your actual dev server`))
          console.error(
            chalk.yellow(`   2. Use dev3000 globally (run 'd3k' directly) instead of via package.json scripts`)
          )
          console.error(
            chalk.yellow(
              `   3. Use a different script name that doesn't invoke dev3000 (e.g., '${script === "dev" ? "dev:next" : "dev:server"}')`
            )
          )
          process.exit(1)
        }
      } catch (error) {
        logger.trace(`Error reading package.json for circular dependency check: ${error}`)
      }
    }

    // Detect which command name was used (dev3000 or d3k)
    const executablePath = process.argv[1]
    const commandName = executablePath.endsWith("/d3k") || executablePath.includes("/d3k") ? "d3k" : "dev3000"

    logger.debug(`Command name detected: ${commandName}`)

    try {
      // Create persistent log file
      const logFile = createPersistentLogFile()
      logger.debug(`Log file created: ${logFile}`)

      // Get unique project name to create profile dir
      const projectName = getProjectName()
      const profileDir = join(homedir(), ".d3k", "chrome-profiles", projectName)

      logger.debug("━━━ Starting Development Environment ━━━")
      logger.logFields(LogLevel.DEBUG, "Environment paths", {
        "Log file": logFile,
        "Project name": projectName,
        "Profile directory": profileDir
      })

      // Create a child logger for dev-environment
      const devEnvLogger = logger.child("dev-env")

      await startDevEnvironment({
        ...options,
        port,
        portMcp: options.portMcp,
        defaultPort: projectConfig.defaultPort,
        userSetPort,
        userSetMcpPort,
        logFile,
        profileDir,
        serverCommand,
        debug: options.debug,
        serversOnly: options.serversOnly,
        commandName,
        tail: options.tail,
        tui: options.noTui !== true && !options.debug, // TUI is default unless --no-tui or --debug is specified
        dateTimeFormat: options.dateTime || "local",
        pluginReactScan: options.pluginReactScan || false,
        chromeDevtoolsMcp: options.chromeDevtoolsMcp !== false, // Default to true unless explicitly disabled
        logger: devEnvLogger // Pass structured logger to dev-environment
      })
    } catch (error) {
      console.error(chalk.red("❌ Failed to start development environment:"), error)
      process.exit(1)
    }
  })

program.parse()
