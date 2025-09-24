import chalk from "chalk"
import { type ChildProcess, spawn } from "child_process"
import {
  appendFileSync,
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  unlinkSync,
  writeFileSync
} from "fs"
import ora from "ora"
import { homedir, tmpdir } from "os"
import { dirname, join } from "path"
import { fileURLToPath } from "url"
import { CDPMonitor } from "./cdp-monitor.js"
import { type LogEntry, NextJsErrorDetector, OutputProcessor, StandardLogParser } from "./services/parsers/index.js"
import { DevTUI } from "./tui-interface.js"
import { getProjectDisplayName, getProjectName } from "./utils/project-name.js"
import { formatTimestamp } from "./utils/timestamp.js"

interface DevEnvironmentOptions {
  port: string
  mcpPort?: string // Make optional since we'll handle portMcp
  portMcp?: string // New option from CLI
  serverCommand: string
  profileDir: string
  logFile: string
  debug?: boolean
  serversOnly?: boolean
  commandName: string
  browser?: string
  defaultPort?: string // Default port from project type detection
  userSetPort?: boolean // Whether user explicitly set the port
  userSetMcpPort?: boolean // Whether user explicitly set the MCP port
  tail?: boolean // Whether to tail the log file to terminal
  tui?: boolean // Whether to use TUI mode (default true)
  dateTimeFormat?: "local" | "utc" // Timestamp format option
  pluginReactScan?: boolean // Whether to enable react-scan performance monitoring
}

class Logger {
  private logFile: string
  private tail: boolean
  private dateTimeFormat: "local" | "utc"

  constructor(logFile: string, tail: boolean = false, dateTimeFormat: "local" | "utc" = "local") {
    this.logFile = logFile
    this.tail = tail
    this.dateTimeFormat = dateTimeFormat
    // Ensure directory exists
    const logDir = dirname(logFile)
    if (!existsSync(logDir)) {
      mkdirSync(logDir, { recursive: true })
    }
    // Clear log file
    writeFileSync(this.logFile, "")
  }

  log(source: "server" | "browser", message: string) {
    const timestamp = formatTimestamp(new Date(), this.dateTimeFormat)
    const logEntry = `[${timestamp}] [${source.toUpperCase()}] ${message}\n`
    appendFileSync(this.logFile, logEntry)

    // If tail is enabled, also output to console
    if (this.tail) {
      process.stdout.write(logEntry)
    }
  }
}

function detectPackageManagerForRun(): string {
  if (existsSync("pnpm-lock.yaml")) return "pnpm"
  if (existsSync("yarn.lock")) return "yarn"
  if (existsSync("package-lock.json")) return "npm"
  return "npm" // fallback
}

async function isPortAvailable(port: string): Promise<boolean> {
  try {
    const result = await new Promise<string>((resolve) => {
      const proc = spawn("lsof", ["-ti", `:${port}`], { stdio: "pipe" })
      let output = ""
      proc.stdout?.on("data", (data) => {
        output += data.toString()
      })
      proc.on("exit", () => resolve(output.trim()))
    })
    return !result // If no output, port is available
  } catch {
    return true // Assume port is available if check fails
  }
}

async function findAvailablePort(startPort: number): Promise<string> {
  let port = startPort
  while (port < 65535) {
    if (await isPortAvailable(port.toString())) {
      return port.toString()
    }
    port++
  }
  throw new Error(`No available ports found starting from ${startPort}`)
}

export function createPersistentLogFile(): string {
  // Get unique project name
  const projectName = getProjectName()

  // Create /var/log/dev3000 directory
  const logBaseDir = "/var/log/dev3000"
  try {
    if (!existsSync(logBaseDir)) {
      mkdirSync(logBaseDir, { recursive: true })
    }
  } catch (_error) {
    // Fallback to user's temp directory if /var/log is not writable
    const fallbackDir = join(tmpdir(), "dev3000-logs")
    if (!existsSync(fallbackDir)) {
      mkdirSync(fallbackDir, { recursive: true })
    }
    return createLogFileInDir(fallbackDir, projectName)
  }

  return createLogFileInDir(logBaseDir, projectName)
}

// Write session info for MCP server to discover
function writeSessionInfo(
  projectName: string,
  logFilePath: string,
  appPort: string,
  mcpPort?: string,
  cdpUrl?: string
): void {
  const sessionDir = join(homedir(), ".d3k")

  try {
    // Create ~/.d3k directory if it doesn't exist
    if (!existsSync(sessionDir)) {
      mkdirSync(sessionDir, { recursive: true })
    }

    // Session file contains project info
    const sessionInfo = {
      projectName,
      logFilePath,
      appPort,
      mcpPort: mcpPort || null,
      cdpUrl: cdpUrl || null,
      startTime: new Date().toISOString(),
      pid: process.pid,
      cwd: process.cwd()
    }

    // Write session file - use project name as filename for easy lookup
    const sessionFile = join(sessionDir, `${projectName}.json`)
    writeFileSync(sessionFile, JSON.stringify(sessionInfo, null, 2))
  } catch (error) {
    // Non-fatal - just log a warning
    console.warn(chalk.yellow(`⚠️ Could not write session info: ${error}`))
  }
}

function createLogFileInDir(baseDir: string, projectName: string): string {
  // Create timestamp
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-")

  // Create log file path
  const logFileName = `dev3000-${projectName}-${timestamp}.log`
  const logFilePath = join(baseDir, logFileName)

  // Prune old logs for this project (keep only 10 most recent)
  pruneOldLogs(baseDir, projectName)

  // Create the log file
  writeFileSync(logFilePath, "")

  return logFilePath
}

function pruneOldLogs(baseDir: string, projectName: string): void {
  try {
    // Find all log files for this project
    const files = readdirSync(baseDir)
      .filter((file) => file.startsWith(`dev3000-${projectName}-`) && file.endsWith(".log"))
      .map((file) => ({
        name: file,
        path: join(baseDir, file),
        mtime: statSync(join(baseDir, file)).mtime
      }))
      .sort((a, b) => b.mtime.getTime() - a.mtime.getTime()) // Most recent first

    // Keep only the 10 most recent, delete the rest
    if (files.length >= 10) {
      const filesToDelete = files.slice(9) // Keep first 9, delete the rest
      for (const file of filesToDelete) {
        try {
          unlinkSync(file.path)
        } catch (_error) {
          // Silently ignore deletion errors
        }
      }
    }
  } catch (error) {
    console.warn(chalk.yellow(`⚠️ Could not prune logs: ${error}`))
  }
}

export class DevEnvironment {
  private serverProcess: ChildProcess | null = null
  private mcpServerProcess: ChildProcess | null = null
  private cdpMonitor: CDPMonitor | null = null
  private logger: Logger
  private outputProcessor: OutputProcessor
  private options: DevEnvironmentOptions
  private screenshotDir: string
  private mcpPublicDir: string
  private pidFile: string
  private spinner: ReturnType<typeof ora>
  private version: string
  private isShuttingDown: boolean = false
  private serverStartTime: number | null = null
  private healthCheckTimer: NodeJS.Timeout | null = null
  private tui: DevTUI | null = null
  private portChangeMessage: string | null = null

  constructor(options: DevEnvironmentOptions) {
    // Handle portMcp vs mcpPort naming
    this.options = {
      ...options,
      mcpPort: options.portMcp || options.mcpPort || "3684"
    }
    this.logger = new Logger(options.logFile, options.tail || false, options.dateTimeFormat || "local")
    this.outputProcessor = new OutputProcessor(new StandardLogParser(), new NextJsErrorDetector())

    // Set up MCP server public directory for web-accessible screenshots
    const currentFile = fileURLToPath(import.meta.url)
    const packageRoot = dirname(dirname(currentFile))

    // Always use MCP server's public directory for screenshots to ensure they're web-accessible
    // and avoid permission issues with /var/log paths
    this.screenshotDir = join(packageRoot, "mcp-server", "public", "screenshots")
    this.pidFile = join(tmpdir(), "dev3000.pid")
    this.mcpPublicDir = join(packageRoot, "mcp-server", "public", "screenshots")

    // Read version from package.json for startup message
    this.version = "0.0.0"
    try {
      const packageJsonPath = join(packageRoot, "package.json")
      const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"))
      this.version = packageJson.version

      // Use git to detect if we're in the dev3000 source repository
      try {
        const { execSync } = require("child_process")
        const gitRemote = execSync("git remote get-url origin 2>/dev/null", {
          cwd: packageRoot,
          encoding: "utf8"
        }).trim()

        if (gitRemote.includes("vercel-labs/dev3000") && !this.version.includes("canary")) {
          this.version += "-local"
        }
      } catch {
        // Not in git repo or no git - use version as-is
      }
    } catch (_error) {
      // Use fallback version
    }

    // Initialize spinner for clean output management (only if not in TUI mode)
    this.spinner = ora({
      text: "Initializing...",
      spinner: "dots",
      isEnabled: !options.tui // Disable spinner in TUI mode
    })

    // Ensure directories exist
    if (!existsSync(this.screenshotDir)) {
      mkdirSync(this.screenshotDir, { recursive: true })
    }
    if (!existsSync(this.mcpPublicDir)) {
      mkdirSync(this.mcpPublicDir, { recursive: true })
    }
  }

  private async checkPortsAvailable(silent: boolean = false) {
    // Always kill any existing MCP server to ensure clean state
    if (this.options.mcpPort) {
      const isPortInUse = !(await isPortAvailable(this.options.mcpPort.toString()))
      if (isPortInUse) {
        this.debugLog(`Killing existing process on port ${this.options.mcpPort}`)
        await this.killMcpServer()
      }
    }

    // Check if user explicitly set ports via CLI flags
    const userSetAppPort = this.options.userSetPort || false

    // If user didn't set ports, find available ones first (before checking)
    if (!userSetAppPort) {
      const startPort = parseInt(this.options.port, 10)
      const availablePort = await findAvailablePort(startPort)
      if (availablePort !== this.options.port) {
        if (!silent) {
          console.log(chalk.yellow(`Port ${this.options.port} is in use, using port ${availablePort} for app server`))
        }
        // Store message for TUI display
        this.portChangeMessage = `Port ${this.options.port} is in use, using port ${availablePort} for app server`
        this.options.port = availablePort
      }
    }

    // If user set explicit app port, fail if it's not available
    if (userSetAppPort) {
      const available = await isPortAvailable(this.options.port)
      if (!available) {
        if (this.spinner?.isSpinning) {
          this.spinner.fail(`Port ${this.options.port} is already in use`)
        }
        if (!silent) {
          console.log(
            chalk.yellow(`💡 To free up port ${this.options.port}, run: lsof -ti:${this.options.port} | xargs kill -9`)
          )
        }
        if (this.tui) {
          await this.tui.shutdown()
        }
        throw new Error(`Port ${this.options.port} is already in use. Please free the port and try again.`)
      }
    }

    // Now check MCP port availability (it should be free after killing)
    if (this.options.mcpPort) {
      const available = await isPortAvailable(this.options.mcpPort)
      if (!available) {
        if (this.spinner?.isSpinning) {
          this.spinner.fail(`Port ${this.options.mcpPort} is still in use after cleanup`)
        }
        if (!silent) {
          console.log(
            chalk.yellow(
              `💡 To force kill port ${this.options.mcpPort}, run: lsof -ti:${this.options.mcpPort} | xargs kill -9`
            )
          )
        }
        if (this.tui) {
          await this.tui.shutdown()
        }
        throw new Error(`Port ${this.options.mcpPort} is still in use. Please free the port and try again.`)
      }
    }
  }

  private async killMcpServer(): Promise<void> {
    try {
      // First, get the PIDs
      const getPidsProcess = spawn("lsof", ["-ti", `:${this.options.mcpPort}`], {
        stdio: "pipe"
      })

      const pids = await new Promise<string>((resolve) => {
        let output = ""
        getPidsProcess.stdout?.on("data", (data) => {
          output += data.toString()
        })
        getPidsProcess.on("exit", () => resolve(output.trim()))
      })

      if (pids) {
        this.debugLog(`Found MCP server processes: ${pids}`)

        // Kill each PID individually with kill -9
        const pidList = pids.split("\n").filter(Boolean)
        for (const pid of pidList) {
          await new Promise<void>((resolve) => {
            const killCmd = spawn("kill", ["-9", pid.trim()], { stdio: "ignore" })
            killCmd.on("exit", (code) => {
              this.debugLog(`Kill command for PID ${pid} exited with code ${code}`)
              resolve()
            })
          })
        }

        // Give it time to fully release the port
        this.debugLog(`Waiting for port ${this.options.mcpPort} to be released...`)
        await new Promise((resolve) => setTimeout(resolve, 1000))
      }
    } catch (error) {
      this.debugLog(`Error killing MCP server: ${error}`)
    }
  }

  private async checkProcessHealth(): Promise<boolean> {
    if (this.isShuttingDown) return true // Skip health check if already shutting down

    try {
      const ports = [this.options.port, this.options.mcpPort]

      for (const port of ports) {
        const result = await new Promise<string>((resolve) => {
          const proc = spawn("lsof", ["-ti", `:${port}`], { stdio: "pipe" })
          let output = ""
          proc.stdout?.on("data", (data) => {
            output += data.toString()
          })
          proc.on("exit", () => resolve(output.trim()))
        })

        if (!result) {
          this.debugLog(`Health check failed: Port ${port} is no longer in use`)
          this.logger.log("server", `Health check failed: Critical process on port ${port} is no longer running`)
          return false
        }
      }

      this.debugLog("Health check passed: All critical processes are running")
      return true
    } catch (error) {
      this.debugLog(`Health check error: ${error}`)
      // Treat errors as non-fatal - network issues shouldn't kill the process
      return true
    }
  }

  private startHealthCheck() {
    // Start health checks every 10 seconds
    this.healthCheckTimer = setInterval(async () => {
      const isHealthy = await this.checkProcessHealth()
      if (!isHealthy) {
        console.log(chalk.yellow("⚠️ Critical processes no longer detected. Shutting down gracefully..."))
        this.gracefulShutdown()
      }
    }, 10000) // 10 seconds

    this.debugLog("Health check timer started (10 second intervals)")
  }

  private stopHealthCheck() {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer)
      this.healthCheckTimer = null
      this.debugLog("Health check timer stopped")
    }
  }

  async start() {
    // Check if TUI mode is enabled (default)
    if (this.options.tui) {
      // Check ports BEFORE starting TUI to avoid console output conflicts
      await this.checkPortsAvailable(true) // silent mode for TUI

      // Clear console and start TUI
      console.clear()

      // Get unique project name
      const projectName = getProjectName()
      const projectDisplayName = getProjectDisplayName()

      // Start TUI interface with initial status and updated port
      this.tui = new DevTUI({
        appPort: this.options.port, // This may have been updated by checkPortsAvailable
        mcpPort: this.options.mcpPort || "3684",
        logFile: this.options.logFile,
        commandName: this.options.commandName,
        serversOnly: this.options.serversOnly,
        version: this.version,
        projectName: projectDisplayName
      })

      await this.tui.start()

      // Give TUI a moment to fully initialize
      await new Promise((resolve) => setTimeout(resolve, 200))

      // Show port change message if needed
      if (this.portChangeMessage) {
        await this.tui.updateStatus(this.portChangeMessage)
        // Clear the message after a moment
        setTimeout(async () => {
          if (this.tui) {
            await this.tui.updateStatus("Setting up environment...")
          }
        }, 2000)
      } else {
        await this.tui.updateStatus("Setting up environment...")
      }
      // Write our process group ID to PID file for cleanup
      writeFileSync(this.pidFile, process.pid.toString())

      // Setup cleanup handlers
      this.setupCleanupHandlers()

      // Start user's dev server
      await this.tui.updateStatus("Starting your dev server...")
      await this.startServer()

      // Start MCP server
      await this.tui.updateStatus(`Starting ${this.options.commandName} MCP server...`)
      await this.startMcpServer()

      // Wait for servers to be ready
      await this.tui.updateStatus("Waiting for your app server...")
      await this.waitForServer()

      await this.tui.updateStatus(`Waiting for ${this.options.commandName} MCP server...`)
      await this.waitForMcpServer()

      // Start CDP monitoring if not in servers-only mode
      if (!this.options.serversOnly) {
        await this.tui.updateStatus(`Starting ${this.options.commandName} browser...`)
        this.startCDPMonitoringAsync()
      } else {
        this.debugLog("Browser monitoring disabled via --servers-only flag")
      }

      // Write session info for MCP server discovery
      writeSessionInfo(projectName, this.options.logFile, this.options.port, this.options.mcpPort)

      // Clear status - ready!
      await this.tui.updateStatus(null)
    } else {
      // Non-TUI mode - original flow
      console.log(chalk.hex("#A18CE5")(`Starting ${this.options.commandName} (v${this.version})`))

      // Start spinner
      this.spinner.start("Checking ports...")

      // Check if ports are available first
      await this.checkPortsAvailable(false) // normal mode with console output

      this.spinner.text = "Setting up environment..."
      // Write our process group ID to PID file for cleanup
      writeFileSync(this.pidFile, process.pid.toString())

      // Setup cleanup handlers
      this.setupCleanupHandlers()

      // Start user's dev server
      this.spinner.text = "Starting your dev server..."
      await this.startServer()

      // Start MCP server
      this.spinner.text = `Starting ${this.options.commandName} MCP server...`
      await this.startMcpServer()

      // Wait for servers to be ready
      this.spinner.text = "Waiting for your app server..."
      await this.waitForServer()

      this.spinner.text = `Waiting for ${this.options.commandName} MCP server...`
      await this.waitForMcpServer()

      // Start CDP monitoring if not in servers-only mode
      if (!this.options.serversOnly) {
        this.spinner.text = `Starting ${this.options.commandName} browser...`
        this.startCDPMonitoringAsync()
      } else {
        this.debugLog("Browser monitoring disabled via --servers-only flag")
      }

      // Get project name for session info and Visual Timeline URL
      const projectName = getProjectName()
      writeSessionInfo(projectName, this.options.logFile, this.options.port, this.options.mcpPort)

      // Complete startup with success message only in non-TUI mode
      this.spinner.succeed("Development environment ready!")

      // Regular console output (when TUI is disabled with --no-tui)
      console.log(chalk.cyan(`Logs: ${this.options.logFile}`))
      console.log(chalk.cyan("☝️ Give this to an AI to auto debug and fix your app\n"))
      console.log(chalk.cyan(`🌐 Your App: http://localhost:${this.options.port}`))
      console.log(chalk.cyan(`🤖 MCP Server: http://localhost:${this.options.mcpPort}/mcp`))
      console.log(
        chalk.cyan(
          `📸 Visual Timeline: http://localhost:${this.options.mcpPort}/logs?project=${encodeURIComponent(projectName)}`
        )
      )
      if (this.options.serversOnly) {
        console.log(chalk.cyan("🖥️  Servers-only mode - use Chrome extension for browser monitoring"))
      }
      console.log(chalk.cyan("\nUse Ctrl-C to stop.\n"))
    }

    // Start health monitoring after everything is ready
    this.startHealthCheck()
  }

  private async startServer() {
    this.debugLog(`Starting server process: ${this.options.serverCommand}`)

    this.serverStartTime = Date.now()
    // Use the full command string with shell: true to properly handle complex commands
    this.serverProcess = spawn(this.options.serverCommand, {
      stdio: ["ignore", "pipe", "pipe"],
      shell: true,
      detached: true // Run independently
    })

    this.debugLog(`Server process spawned with PID: ${this.serverProcess.pid}`)

    // Log server output (to file only, reduce stdout noise)
    this.serverProcess.stdout?.on("data", (data) => {
      const text = data.toString()
      const entries = this.outputProcessor.process(text, false)

      entries.forEach((entry: LogEntry) => {
        this.logger.log("server", entry.formatted)
      })
    })

    this.serverProcess.stderr?.on("data", (data) => {
      const text = data.toString()
      const entries = this.outputProcessor.process(text, true)

      entries.forEach((entry: LogEntry) => {
        this.logger.log("server", entry.formatted)

        // Show critical errors to console (parser determines what's critical)
        if (entry.isCritical && entry.rawMessage) {
          console.error(chalk.red("[CRITICAL ERROR]"), entry.rawMessage)
        }
      })
    })

    this.serverProcess.on("exit", (code) => {
      if (this.isShuttingDown) return // Don't handle exits during shutdown

      if (code !== 0 && code !== null) {
        this.debugLog(`Server process exited with code ${code}`)
        this.logger.log("server", `Server process exited with code ${code}`)

        const timeSinceStart = this.serverStartTime ? Date.now() - this.serverStartTime : 0
        const isEarlyExit = timeSinceStart < 5000 // Less than 5 seconds

        // Check if node_modules exists
        const nodeModulesExists = existsSync(join(process.cwd(), "node_modules"))

        // If it's an early exit and node_modules doesn't exist, show helpful message
        if (isEarlyExit && !nodeModulesExists) {
          if (this.spinner?.isSpinning) {
            this.spinner.fail("Server script failed to start - missing dependencies")
          } else {
            console.log(chalk.red("\n❌ Server script failed to start"))
          }
          console.log(chalk.yellow("💡 It looks like dependencies are not installed."))
          console.log(chalk.yellow("   Run 'pnpm install' (or npm/yarn install) and try again."))
          this.showRecentLogs()
          this.gracefulShutdown()
          return
        }

        // If it's an early exit but node_modules exists, it's still likely a configuration issue
        if (isEarlyExit) {
          if (this.spinner?.isSpinning) {
            this.spinner.fail(`Server script failed to start (exited with code ${code})`)
          } else {
            console.log(chalk.red(`\n❌ Server script failed to start (exited with code ${code})`))
          }
          console.log(chalk.yellow("💡 Check your server command configuration and project setup"))
          console.log(chalk.yellow(`   Command: ${this.options.serverCommand}`))
          this.showRecentLogs()
          this.gracefulShutdown()
          return
        }

        // For later exits, any non-zero exit code should be treated as fatal
        // Only ignore successful exit and specific signal-based exit codes:
        // - Code 0: Success (not fatal)
        // - Code 130: Ctrl+C (SIGINT)
        // - Code 143: SIGTERM
        const isFatalExit = code !== 0 && code !== 130 && code !== 143

        if (isFatalExit) {
          // Stop spinner and show error for fatal exits
          if (this.spinner?.isSpinning) {
            this.spinner.fail(`Server process exited with code ${code}`)
          } else {
            console.log(chalk.red(`\n❌ Server process exited with code ${code}`))
          }

          // Show recent log entries to help with debugging
          this.showRecentLogs()
          this.gracefulShutdown()
        } else {
          // For non-fatal exits (like build failures), just log and continue
          if (this.spinner?.isSpinning) {
            this.spinner.text = "Server process restarted, waiting..."
          }
        }
      }
    })
  }

  private debugLog(message: string) {
    if (this.options.debug) {
      if (this.spinner?.isSpinning) {
        // Temporarily stop the spinner, show debug message, then restart
        const currentText = this.spinner.text
        this.spinner.stop()
        console.log(chalk.gray(`[DEBUG] ${message}`))
        this.spinner.start(currentText)
      } else {
        console.log(chalk.gray(`[DEBUG] ${message}`))
      }
    }
  }

  private showRecentLogs() {
    try {
      if (existsSync(this.options.logFile)) {
        const logContent = readFileSync(this.options.logFile, "utf8")
        const lines = logContent
          .trim()
          .split("\n")
          .filter((line) => line.trim())

        if (lines.length > 0) {
          // Show last 20 lines, or fewer if log is shorter
          const recentLines = lines.slice(-20)
          console.log(chalk.yellow("\n📋 Recent log entries:"))
          for (const line of recentLines) {
            console.log(chalk.gray(`   ${line}`))
          }
        }
      }

      console.log(chalk.cyan(`\n📄 Full logs: ${this.options.logFile}`))
      console.log(chalk.cyan(`   Quick access: tail -f /tmp/d3k.log`))
    } catch (_error) {
      // Fallback if we can't read the log file
      console.log(chalk.yellow(`💡 Check logs for details: ${this.options.logFile}`))
    }
  }

  private async startMcpServer() {
    this.debugLog("Starting MCP server setup")

    // Note: MCP server cleanup now happens earlier in checkPortsAvailable()
    // to ensure the port is free before we check availability

    // Get the path to our bundled MCP server
    const currentFile = fileURLToPath(import.meta.url)
    const packageRoot = dirname(dirname(currentFile)) // Go up from dist/ to package root
    let mcpServerPath = join(packageRoot, "mcp-server")
    this.debugLog(`Initial MCP server path: ${mcpServerPath}`)

    // For pnpm global installs, resolve symlinks to get the real path
    if (existsSync(mcpServerPath)) {
      try {
        const realPath = realpathSync(mcpServerPath)
        if (realPath !== mcpServerPath) {
          this.debugLog(`MCP server path resolved from symlink: ${mcpServerPath} -> ${realPath}`)
          mcpServerPath = realPath
        }
      } catch (e) {
        // Error resolving path, continue with original
        this.debugLog(`Error resolving real path: ${e}`)
      }
    }

    this.debugLog(`Final MCP server path: ${mcpServerPath}`)

    if (!existsSync(mcpServerPath)) {
      throw new Error(`MCP server directory not found at ${mcpServerPath}`)
    }
    this.debugLog("MCP server directory found")

    // Check if MCP server dependencies are installed, install if missing
    const isGlobalInstall = mcpServerPath.includes(".pnpm")
    this.debugLog(`Is global install: ${isGlobalInstall}`)
    let nodeModulesPath = join(mcpServerPath, "node_modules")
    let actualWorkingDir = mcpServerPath
    this.debugLog(`Node modules path: ${nodeModulesPath}`)

    if (isGlobalInstall) {
      const tmpDirPath = join(tmpdir(), "dev3000-mcp-deps")
      nodeModulesPath = join(tmpDirPath, "node_modules")
      actualWorkingDir = tmpDirPath

      // Update screenshot and MCP public directory to use the temp directory for global installs
      this.screenshotDir = join(actualWorkingDir, "public", "screenshots")
      this.mcpPublicDir = join(actualWorkingDir, "public", "screenshots")
      if (!existsSync(this.mcpPublicDir)) {
        mkdirSync(this.mcpPublicDir, { recursive: true })
      }
    }

    // Check if .next build directory exists - if so, skip dependency installation
    const nextBuildPath = join(mcpServerPath, ".next")
    this.debugLog(`Checking for pre-built MCP server at: ${nextBuildPath}`)

    let isPreBuilt = false

    if (existsSync(nextBuildPath)) {
      this.debugLog("MCP server is pre-built (.next directory exists), skipping dependency installation")
      isPreBuilt = true

      // For global installs with pre-built servers, we'll run from the original location
      // No need to copy anything to temp directory
      if (isGlobalInstall) {
        this.debugLog("Global install with pre-built server - will run from original location")
        actualWorkingDir = mcpServerPath

        // Still need to set up screenshot directory in temp
        const tmpDirPath = join(tmpdir(), "dev3000-mcp-deps")
        this.screenshotDir = join(tmpDirPath, "public", "screenshots")
        this.mcpPublicDir = join(tmpDirPath, "public", "screenshots")
        if (!existsSync(this.mcpPublicDir)) {
          mkdirSync(this.mcpPublicDir, { recursive: true })
        }
      }
    } else {
      this.debugLog("No .next directory found, installing/updating MCP server dependencies")
      this.debugLog(`WARNING: MCP server appears to not be pre-built. This is unexpected for a published package.`)
      await this.installMcpServerDeps(mcpServerPath)
    }

    // Use version already read in constructor

    // For global installs, only copy files if NOT pre-built
    // Pre-built servers run from their original location
    if (isGlobalInstall && actualWorkingDir !== mcpServerPath && !isPreBuilt) {
      const requiredFiles = ["app", "public", "next.config.ts", "next-env.d.ts", "tsconfig.json", ".next"]
      for (const file of requiredFiles) {
        const srcPath = join(mcpServerPath, file)
        const destPath = join(actualWorkingDir, file)

        // Check if we need to copy (source exists and destination doesn't exist or source is newer)
        if (existsSync(srcPath)) {
          let shouldCopy = !existsSync(destPath)

          // If destination exists, check if source is newer
          if (!shouldCopy && existsSync(destPath)) {
            const srcStat = lstatSync(srcPath)
            const destStat = lstatSync(destPath)
            shouldCopy = srcStat.mtime > destStat.mtime
          }

          if (shouldCopy) {
            // Remove existing destination if it exists
            if (existsSync(destPath)) {
              if (lstatSync(destPath).isDirectory()) {
                cpSync(destPath, `${destPath}.bak`, { recursive: true })
                cpSync(srcPath, destPath, { recursive: true, force: true })
              } else {
                unlinkSync(destPath)
                copyFileSync(srcPath, destPath)
              }
            } else {
              if (lstatSync(srcPath).isDirectory()) {
                cpSync(srcPath, destPath, { recursive: true })
              } else {
                copyFileSync(srcPath, destPath)
              }
            }
          }
        }
      }
    }

    // Start the MCP server
    this.debugLog(`MCP server working directory: ${actualWorkingDir}`)
    this.debugLog(`MCP server port: ${this.options.mcpPort}`)
    this.debugLog(`Screenshot directory: ${this.screenshotDir}`)
    this.debugLog(`Is pre-built: ${isPreBuilt}`)
    this.debugLog(`Is global install: ${isGlobalInstall}`)

    let mcpCommand: string[]
    let mcpCwd = actualWorkingDir

    if (isGlobalInstall && isPreBuilt) {
      // For global installs with pre-built servers, use the standalone server directly
      // This avoids the turbopack runtime issues with npx
      const serverJsPath = join(mcpServerPath, ".next", "standalone", "mcp-server", "server.js")

      if (existsSync(serverJsPath)) {
        // Use the standalone server directly
        this.debugLog(`Global install with standalone server at ${serverJsPath}`)
        mcpCommand = ["node", serverJsPath]
        mcpCwd = dirname(serverJsPath)
      } else {
        // Check for start-production.js script
        const startProdScript = join(mcpServerPath, "start-production.js")

        if (existsSync(startProdScript)) {
          // Use the production script
          this.debugLog(`Global install with start-production.js script`)
          mcpCommand = ["node", startProdScript]
          mcpCwd = mcpServerPath
        } else {
          // Fallback to finding Next.js binary
          const dev3000NodeModules = join(mcpServerPath, "..", "..", "node_modules")
          const nextBinPath = join(dev3000NodeModules, ".bin", "next")

          this.debugLog(`Looking for Next.js at: ${nextBinPath}`)

          if (existsSync(nextBinPath)) {
            // Found Next.js in the dev3000 package
            this.debugLog(`Global install with Next.js found at ${nextBinPath}`)
            mcpCommand = [nextBinPath, "start"]
            mcpCwd = mcpServerPath
          } else {
            // Fallback to npx with the exact version we built with
            this.debugLog(`Global install with pre-built server - using npx next start`)
            mcpCommand = ["npx", "--yes", "next@15.5.1-canary.30", "start"]
            mcpCwd = mcpServerPath
          }
        }
      }
    } else {
      // Non-global or non-pre-built: use package manager
      const packageManagerForRun = detectPackageManagerForRun()
      this.debugLog(`Using package manager: ${packageManagerForRun}`)
      mcpCommand = [packageManagerForRun, "run", "start"]
      mcpCwd = actualWorkingDir
    }

    this.debugLog(`MCP server command: ${mcpCommand.join(" ")}`)
    this.debugLog(`MCP server cwd: ${mcpCwd}`)

    // Start MCP server as a true background singleton process
    this.mcpServerProcess = spawn(mcpCommand[0], mcpCommand.slice(1), {
      stdio: ["ignore", "pipe", "pipe"],
      detached: true, // Run independently of parent process
      cwd: mcpCwd,
      env: {
        ...process.env,
        PORT: this.options.mcpPort,
        LOG_FILE_PATH: this.options.logFile, // Pass log file path to MCP server
        DEV3000_VERSION: this.version, // Pass version to MCP server
        SCREENSHOT_DIR: this.screenshotDir // Pass screenshot directory for global installs
      }
    })

    // Unref the process so it continues running after parent exits
    this.mcpServerProcess.unref()

    this.debugLog("MCP server process spawned as singleton background service")

    // Log MCP server output to separate file for debugging
    const mcpLogFile = join(dirname(this.options.logFile), "dev3000-mcp.log")
    writeFileSync(mcpLogFile, "") // Clear the file

    // In debug mode, output the MCP log file path
    if (this.options.debug) {
      console.log(chalk.gray(`[DEBUG] MCP server logs: ${mcpLogFile}`))
    }

    this.mcpServerProcess.stdout?.on("data", (data) => {
      const message = data.toString().trim()
      if (message) {
        const timestamp = new Date().toISOString()
        appendFileSync(mcpLogFile, `[${timestamp}] [MCP-STDOUT] ${message}\n`)
      }
    })

    this.mcpServerProcess.stderr?.on("data", (data) => {
      const message = data.toString().trim()
      if (message) {
        const timestamp = new Date().toISOString()
        appendFileSync(mcpLogFile, `[${timestamp}] [MCP-STDERR] ${message}\n`)
        // Only show critical errors in stdout for debugging
        if (message.includes("FATAL") || message.includes("Error:")) {
          console.error(chalk.red("[LOG VIEWER ERROR]"), message)
        }
      }
    })

    this.mcpServerProcess.on("exit", (code) => {
      this.debugLog(`MCP server process exited with code ${code}`)
      // Only show exit messages for unexpected failures, not restarts
      if (code !== 0 && code !== null) {
        this.logger.log("server", `MCP server process exited with code ${code}`)
      }
    })

    this.debugLog("MCP server event handlers setup complete")
  }

  private async waitForServer() {
    const maxAttempts = 30
    let attempts = 0
    const serverUrl = `http://localhost:${this.options.port}`
    const startTime = Date.now()

    this.debugLog(`Starting server readiness check for ${serverUrl}`)

    while (attempts < maxAttempts) {
      const attemptStartTime = Date.now()
      try {
        this.debugLog(`Server check attempt ${attempts + 1}/${maxAttempts}: ${serverUrl}`)

        const response = await fetch(serverUrl, {
          method: "HEAD",
          signal: AbortSignal.timeout(2000)
        })

        const attemptTime = Date.now() - attemptStartTime
        this.debugLog(`Server responded with status ${response.status} in ${attemptTime}ms`)

        if (response.ok || response.status === 404 || response.status === 405) {
          const totalTime = Date.now() - startTime
          this.debugLog(`Server is ready! Total wait time: ${totalTime}ms (${attempts + 1} attempts)`)
          this.debugLog(
            `Status ${response.status} indicates server is running (200=OK, 404=Not Found, 405=Method Not Allowed)`
          )
          return
        } else {
          this.debugLog(`Server responded with non-OK status: ${response.status}, continuing to wait`)
        }
      } catch (error) {
        const attemptTime = Date.now() - attemptStartTime
        this.debugLog(
          `Server check failed in ${attemptTime}ms: ${error instanceof Error ? error.message : "Unknown error"}`
        )
      }

      attempts++
      if (attempts < maxAttempts) {
        this.debugLog(`Waiting 1 second before next attempt...`)
        await new Promise((resolve) => setTimeout(resolve, 1000))
      }
    }

    const totalTime = Date.now() - startTime
    this.debugLog(`Server readiness check timed out after ${totalTime}ms (${maxAttempts} attempts), continuing anyway`)
  }

  private detectPackageManagerInDir(dir: string): string {
    if (existsSync(join(dir, "pnpm-lock.yaml"))) return "pnpm"
    if (existsSync(join(dir, "yarn.lock"))) return "yarn"
    if (existsSync(join(dir, "package-lock.json"))) return "npm"
    return "npm" // fallback
  }

  private async installMcpServerDeps(mcpServerPath: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      // For global installs, we need to install to a writable location
      // Check if this is a global install by looking for .pnpm in the path
      const isGlobalInstall = mcpServerPath.includes(".pnpm")

      let workingDir = mcpServerPath
      if (isGlobalInstall) {
        // Create a writable copy in temp directory for global installs
        const tmpDirPath = join(tmpdir(), "dev3000-mcp-deps")

        // Ensure tmp directory exists
        if (!existsSync(tmpDirPath)) {
          mkdirSync(tmpDirPath, { recursive: true })
        }

        // Always copy package.json to temp directory to ensure it's up to date
        const tmpPackageJson = join(tmpDirPath, "package.json")
        const sourcePackageJson = join(mcpServerPath, "package.json")

        // Debug: Check if source package.json exists
        if (!existsSync(sourcePackageJson)) {
          const errorDetails = [
            `ERROR: package.json not found at ${sourcePackageJson}`,
            `MCP server path: ${mcpServerPath}`,
            `Contents of MCP server directory:`
          ]

          try {
            const files = readdirSync(mcpServerPath)
            files.forEach((file) => {
              errorDetails.push(`  - ${file}`)
            })
          } catch (e) {
            errorDetails.push(`  Error listing directory: ${e}`)
          }

          // Additional debug: Check parent directories
          errorDetails.push(`Parent directory: ${dirname(mcpServerPath)}`)
          try {
            const parentFiles = readdirSync(dirname(mcpServerPath))
            parentFiles.forEach((file) => {
              errorDetails.push(`  Parent dir file: ${file}`)
            })
          } catch (e) {
            errorDetails.push(`  Error listing parent directory: ${e}`)
          }

          // Log all error details
          errorDetails.forEach((detail) => {
            this.debugLog(detail)
          })

          reject(new Error(`MCP server package.json not found at ${sourcePackageJson}`))
          return
        }

        copyFileSync(sourcePackageJson, tmpPackageJson)

        workingDir = tmpDirPath
      }

      // Detect package manager from MCP server directory, not current directory
      const packageManager = this.detectPackageManagerInDir(mcpServerPath)

      // For pnpm, use --dev flag to include devDependencies
      const installArgs =
        packageManager === "pnpm"
          ? ["install", "--prod=false"] // Install both prod and dev dependencies
          : ["install", "--include=dev"] // npm/yarn syntax

      const fullCommand = `${packageManager} ${installArgs.join(" ")}`

      if (this.options.debug) {
        console.log(`[MCP DEBUG] Installing MCP server dependencies...`)
        console.log(`[MCP DEBUG] Working directory: ${workingDir}`)
        console.log(`[MCP DEBUG] Package manager detected: ${packageManager}`)
        console.log(`[MCP DEBUG] Command: ${fullCommand}`)
        console.log(`[MCP DEBUG] Is global install: ${isGlobalInstall}`)
      }

      const installStartTime = Date.now()
      const installProcess = spawn(packageManager, installArgs, {
        stdio: ["ignore", "pipe", "pipe"],
        cwd: workingDir
      })

      // Add timeout (3 minutes)
      const timeout = setTimeout(
        () => {
          if (this.options.debug) {
            console.log(`[MCP DEBUG] Installation timed out after 3 minutes`)
          }
          installProcess.kill("SIGKILL")
          reject(new Error("MCP server dependency installation timed out after 3 minutes"))
        },
        3 * 60 * 1000
      )

      // Capture output for debugging, but suppress for normal operation
      let debugOutput = ""
      let debugErrors = ""

      installProcess.stdout?.on("data", (data) => {
        const text = data.toString()
        if (this.options.debug) {
          debugOutput += text
        }
      })

      installProcess.stderr?.on("data", (data) => {
        const text = data.toString()
        if (this.options.debug) {
          debugErrors += text
        }
      })

      installProcess.on("exit", (code) => {
        clearTimeout(timeout)
        const installTime = Date.now() - installStartTime

        if (this.options.debug) {
          console.log(`[MCP DEBUG] Installation completed in ${installTime}ms with exit code: ${code}`)
          if (debugOutput) {
            console.log(`[MCP DEBUG] stdout:`, debugOutput.trim())
          }
          if (debugErrors) {
            console.log(`[MCP DEBUG] stderr:`, debugErrors.trim())
          }
        }

        if (code === 0) {
          resolve()
        } else {
          const errorMsg = `MCP server dependency installation failed with exit code ${code}`
          const fullError = this.options.debug && debugErrors ? `${errorMsg}\nstderr: ${debugErrors.trim()}` : errorMsg
          reject(new Error(fullError))
        }
      })

      installProcess.on("error", (error) => {
        clearTimeout(timeout)
        reject(new Error(`Failed to start MCP server dependency installation: ${error.message}`))
      })
    })
  }

  private async waitForMcpServer() {
    const maxAttempts = 30
    let attempts = 0

    while (attempts < maxAttempts) {
      try {
        // Test the actual MCP endpoint
        const response = await fetch(`http://localhost:${this.options.mcpPort}`, {
          method: "HEAD",
          signal: AbortSignal.timeout(2000)
        })
        this.debugLog(`MCP server health check: ${response.status}`)
        if (response.status === 500) {
          const errorText = await response.text()
          this.debugLog(`MCP server 500 error: ${errorText}`)
        }
        if (response.ok || response.status === 404) {
          // 404 is OK - means server is responding
          return
        }
      } catch (error) {
        this.debugLog(`MCP server not ready (attempt ${attempts}): ${error}`)
      }

      attempts++
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }

    this.debugLog("MCP server health check failed, terminating")
    throw new Error(`MCP server failed to start after ${maxAttempts} seconds. Check the logs for errors.`)
  }

  private startCDPMonitoringAsync() {
    // Skip if in servers-only mode
    if (this.options.serversOnly) {
      return
    }

    // Start CDP monitoring in background without blocking completion
    this.startCDPMonitoring().catch((error) => {
      console.error(chalk.red("⚠️ CDP monitoring setup failed:"), error)
      // CDP monitoring is critical - shutdown if it fails
      this.gracefulShutdown()
    })
  }

  private async startCDPMonitoring() {
    // Skip if in servers-only mode
    if (this.options.serversOnly) {
      this.debugLog("Browser monitoring disabled via --servers-only flag")
      return
    }

    // Ensure profile directory exists
    if (!existsSync(this.options.profileDir)) {
      mkdirSync(this.options.profileDir, { recursive: true })
    }

    // Initialize CDP monitor with enhanced logging - use MCP public directory for screenshots
    this.cdpMonitor = new CDPMonitor(
      this.options.profileDir,
      this.mcpPublicDir,
      (_source: string, message: string) => {
        this.logger.log("browser", message)
      },
      this.options.debug,
      this.options.browser,
      this.options.pluginReactScan
    )

    try {
      // Start CDP monitoring
      await this.cdpMonitor.start()
      this.logger.log("browser", "[CDP] Chrome launched with DevTools Protocol monitoring")

      // Update session info with CDP URL now that we have it
      const projectName = getProjectName()
      const cdpUrl = this.cdpMonitor.getCdpUrl()
      if (cdpUrl) {
        writeSessionInfo(projectName, this.options.logFile, this.options.port, this.options.mcpPort, cdpUrl)
        this.debugLog(`Updated session info with CDP URL: ${cdpUrl}`)
      }

      // Navigate to the app
      await this.cdpMonitor.navigateToApp(this.options.port)
      this.logger.log("browser", `[CDP] Navigated to http://localhost:${this.options.port}`)
    } catch (error) {
      // Log error and throw to trigger graceful shutdown
      this.logger.log("browser", `[CDP ERROR] Failed to start CDP monitoring: ${error}`)
      throw error
    }
  }

  private async gracefulShutdown() {
    if (this.isShuttingDown) return // Prevent multiple shutdown attempts
    this.isShuttingDown = true

    // Stop health monitoring
    this.stopHealthCheck()

    // Clean up session file
    try {
      const projectName = getProjectName()
      const sessionFile = join(homedir(), ".d3k", `${projectName}.json`)
      if (existsSync(sessionFile)) {
        unlinkSync(sessionFile)
      }
    } catch (_error) {
      // Non-fatal - ignore cleanup errors
    }

    // Stop TUI if it's running
    if (this.tui) {
      await this.tui.shutdown()
      this.tui = null
    }

    // Stop spinner if it's running
    if (this.spinner?.isSpinning) {
      this.spinner.fail("Critical failure detected")
    }

    // Only show console messages if not in TUI mode
    if (!this.options.tui) {
      console.log(chalk.yellow(`🛑 Shutting down ${this.options.commandName} due to critical failure...`))
    }

    // Kill processes on both ports
    const killPortProcess = async (port: string, name: string) => {
      try {
        const { spawn } = await import("child_process")
        const killProcess = spawn("sh", ["-c", `lsof -ti:${port} | xargs kill -9`], { stdio: "inherit" })
        return new Promise<void>((resolve) => {
          killProcess.on("exit", (code) => {
            if (code === 0) {
              console.log(chalk.green(`✅ Killed ${name} on port ${port}`))
            }
            resolve()
          })
        })
      } catch (_error) {
        console.log(chalk.gray(`⚠️ Could not kill ${name} on port ${port}`))
      }
    }

    // Kill app server only (MCP server remains as singleton)
    console.log(chalk.cyan("🔄 Killing app server..."))
    await killPortProcess(this.options.port, "your app server")

    // Shutdown CDP monitor if it was started
    if (this.cdpMonitor) {
      try {
        console.log(chalk.cyan("🔄 Closing CDP monitor..."))
        await this.cdpMonitor.shutdown()
        console.log(chalk.green("✅ CDP monitor closed"))
      } catch (_error) {
        console.log(chalk.gray("⚠️ CDP monitor shutdown failed"))
      }
    }

    console.log(chalk.red(`❌ ${this.options.commandName} exited due to server failure`))
    process.exit(1)
  }

  private setupCleanupHandlers() {
    // Handle Ctrl+C to kill all processes
    process.on("SIGINT", async () => {
      if (this.isShuttingDown) return // Prevent multiple shutdown attempts
      this.isShuttingDown = true

      // Stop health monitoring
      this.stopHealthCheck()

      // Clean up session file
      try {
        const projectName = getProjectName()
        const sessionFile = join(homedir(), ".d3k", `${projectName}.json`)
        if (existsSync(sessionFile)) {
          unlinkSync(sessionFile)
        }
      } catch (_error) {
        // Non-fatal - ignore cleanup errors
      }

      // Stop TUI if it's running
      if (this.tui) {
        await this.tui.shutdown()
        this.tui = null
      }

      // Stop spinner if it's running
      if (this.spinner?.isSpinning) {
        this.spinner.fail("Interrupted")
      }

      // Only show console messages if not in TUI mode
      if (!this.options.tui) {
        console.log(chalk.yellow("\n🛑 Received interrupt signal. Cleaning up processes..."))
      }

      // Kill processes on both ports FIRST - this is most important
      const killPortProcess = async (port: string, name: string) => {
        try {
          const { spawn } = await import("child_process")
          const killProcess = spawn("sh", ["-c", `lsof -ti:${port} | xargs kill -9`], { stdio: "inherit" })
          return new Promise<void>((resolve) => {
            killProcess.on("exit", (code) => {
              if (code === 0 && !this.options.tui) {
                console.log(chalk.green(`✅ Killed ${name} on port ${port}`))
              }
              resolve()
            })
          })
        } catch (_error) {
          if (!this.options.tui) {
            console.log(chalk.gray(`⚠️ Could not kill ${name} on port ${port}`))
          }
        }
      }

      // Kill app server immediately (MCP server remains as singleton)
      if (!this.options.tui) {
        console.log(chalk.yellow("🔄 Killing app server..."))
      }
      await killPortProcess(this.options.port, "your app server")

      // Shutdown CDP monitor if it was started
      if (this.cdpMonitor) {
        try {
          if (!this.options.tui) {
            console.log(chalk.cyan("🔄 Closing CDP monitor..."))
          }
          await this.cdpMonitor.shutdown()
          if (!this.options.tui) {
            console.log(chalk.green("✅ CDP monitor closed"))
          }
        } catch (_error) {
          if (!this.options.tui) {
            console.log(chalk.gray("⚠️ CDP monitor shutdown failed"))
          }
        }
      }

      if (!this.options.tui) {
        console.log(chalk.green("✅ Cleanup complete"))
      }
      process.exit(0)
    })
  }
}

export async function startDevEnvironment(options: DevEnvironmentOptions) {
  const devEnv = new DevEnvironment(options)
  await devEnv.start()
}
