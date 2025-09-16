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
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import ora from "ora";
import { tmpdir } from "os";
import { basename, dirname, join } from "path";
import { fileURLToPath } from "url";
import { CDPMonitor } from "./cdp-monitor.js";
import { OutputProcessor, LogEntry, StandardLogParser, NextJsErrorDetector } from "./services/parsers/index.js";

interface DevEnvironmentOptions {
  port: string
  mcpPort: string
  serverCommand: string
  profileDir: string
  logFile: string
  debug?: boolean
  serversOnly?: boolean
  commandName: string
}

class Logger {
  private logFile: string

  constructor(logFile: string) {
    this.logFile = logFile
    // Ensure directory exists
    const logDir = dirname(logFile)
    if (!existsSync(logDir)) {
      mkdirSync(logDir, { recursive: true })
    }
    // Clear log file
    writeFileSync(this.logFile, "")
  }

  log(source: "server" | "browser", message: string) {
    const timestamp = new Date().toISOString()
    const logEntry = `[${timestamp}] [${source.toUpperCase()}] ${message}\n`
    appendFileSync(this.logFile, logEntry)
  }
}

function detectPackageManagerForRun(): string {
  if (existsSync("pnpm-lock.yaml")) return "pnpm"
  if (existsSync("yarn.lock")) return "yarn"
  if (existsSync("package-lock.json")) return "npm"
  return "npm" // fallback
}

export function createPersistentLogFile(): string {
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
    return createLogFileInDir(fallbackDir)
  }

  return createLogFileInDir(logBaseDir)
}

function createLogFileInDir(baseDir: string): string {
  // Get current working directory name
  const cwdName = basename(process.cwd()).replace(/[^a-zA-Z0-9-_]/g, "_")

  // Create timestamp
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-")

  // Create log file path
  const logFileName = `dev3000-${cwdName}-${timestamp}.log`
  const logFilePath = join(baseDir, logFileName)

  // Prune old logs for this project (keep only 10 most recent)
  pruneOldLogs(baseDir, cwdName)

  // Create the log file
  writeFileSync(logFilePath, "")

  // Create or update symlinks to /tmp/dev3000.log and /tmp/d3k.log
  const symlinkPaths = ["/tmp/dev3000.log", "/tmp/d3k.log"]
  for (const symlinkPath of symlinkPaths) {
    try {
      if (existsSync(symlinkPath)) {
        unlinkSync(symlinkPath)
      }
      symlinkSync(logFilePath, symlinkPath)
    } catch (error) {
      console.warn(chalk.yellow(`⚠️ Could not create symlink ${symlinkPath}: ${error}`))
    }
  }

  return logFilePath
}

function pruneOldLogs(baseDir: string, cwdName: string): void {
  try {
    // Find all log files for this project
    const files = readdirSync(baseDir)
      .filter((file) => file.startsWith(`dev3000-${cwdName}-`) && file.endsWith(".log"))
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
  private serverProcess: ChildProcess | null = null;
  private mcpServerProcess: ChildProcess | null = null;
  private cdpMonitor: CDPMonitor | null = null;
  private logger: Logger;
  private outputProcessor: OutputProcessor;
  private options: DevEnvironmentOptions;
  private screenshotDir: string;
  private mcpPublicDir: string;
  private pidFile: string;
  private spinner: ReturnType<typeof ora>;
  private version: string;
  private isShuttingDown: boolean = false;
  private serverStartTime: number | null = null
  private healthCheckTimer: NodeJS.Timeout | null = null

  constructor(options: DevEnvironmentOptions) {
    this.options = options;
    this.logger = new Logger(options.logFile);
    this.outputProcessor = new OutputProcessor(
      new StandardLogParser(),
      new NextJsErrorDetector()
    );

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

    // Initialize spinner for clean output management
    this.spinner = ora({ text: "Initializing...", spinner: "dots" })

    // Ensure directories exist
    if (!existsSync(this.screenshotDir)) {
      mkdirSync(this.screenshotDir, { recursive: true })
    }
    if (!existsSync(this.mcpPublicDir)) {
      mkdirSync(this.mcpPublicDir, { recursive: true })
    }
  }

  private async checkPortsAvailable() {
    const ports = [this.options.port, this.options.mcpPort]

    for (const port of ports) {
      try {
        const result = await new Promise<string>((resolve) => {
          const proc = spawn("lsof", ["-ti", `:${port}`], { stdio: "pipe" })
          let output = ""
          // biome-ignore lint/suspicious/noAssignInExpressions: whatever
          proc.stdout?.on("data", (data) => (output += data.toString()))
          proc.on("exit", () => resolve(output.trim()))
        })

        if (result) {
          result.split("\n").filter((line) => line.trim())

          // Stop spinner and show error
          if (this.spinner?.isSpinning) {
            this.spinner.fail(`Port ${port} is already in use`)
          }
          console.log(chalk.yellow(`💡 To free up port ${port}, run: lsof -ti:${port} | xargs kill -9`))
          throw new Error(`Port ${port} is already in use. Please free the port and try again.`)
        }
      } catch (error) {
        if (error instanceof Error && error.message.includes("Port")) {
          throw error // Re-throw our custom error
        }
        // Ignore other errors - port might just be free
      }
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
    // Show startup message first
    console.log(chalk.greenBright(`Starting ${this.options.commandName} (v${this.version})`))

    // Start spinner
    this.spinner.start("Checking ports...")

    // Check if ports are available first
    await this.checkPortsAvailable()

    this.spinner.text = "Setting up environment..."
    // Write our process group ID to PID file for cleanup
    writeFileSync(this.pidFile, process.pid.toString())

    // Setup cleanup handlers
    this.setupCleanupHandlers()

    // Start user's dev server
    this.spinner.text = "Starting your dev server..."
    await this.startServer()

    // Start MCP server
    this.spinner.text = `Starting ${this.options.commandName} services...`
    await this.startMcpServer()

    // Wait for servers to be ready
    this.spinner.text = "Waiting for your app server..."
    await this.waitForServer()

    this.spinner.text = `Waiting for ${this.options.commandName} services...`
    await this.waitForMcpServer()

    // Start CDP monitoring if not in servers-only mode
    if (!this.options.serversOnly) {
      this.spinner.text = "Launching browser monitor..."
      this.startCDPMonitoringAsync()
    } else {
      this.debugLog("Browser monitoring disabled via --servers-only flag")
    }

    // Complete startup
    this.spinner.succeed("Development environment ready!")

    console.log(chalk.cyan(`Logs: /tmp/d3k.log -> ${this.options.logFile}`))
    console.log(chalk.cyan("☝️ Give this to an AI to auto debug and fix your app\n"))
    console.log(chalk.cyan(`🌐 Your App: http://localhost:${this.options.port}`))
    console.log(chalk.cyan(`🤖 MCP Server: http://localhost:${this.options.mcpPort}/api/mcp/mcp`))
    console.log(chalk.cyan(`📸 Visual Timeline: http://localhost:${this.options.mcpPort}/logs`))
    if (this.options.serversOnly) {
      console.log(chalk.cyan("🖥️  Servers-only mode - use Chrome extension for browser monitoring"))
    }
    console.log(chalk.gray(`\n💡 To stop all servers and kill ${this.options.commandName}: Ctrl-C`))

    // Start health monitoring after everything is ready
    this.startHealthCheck()
  }

  private async startServer() {
    const [command, ...args] = this.options.serverCommand.split(" ")

    this.serverStartTime = Date.now()
    this.serverProcess = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      shell: true,
      detached: true // Run independently
    })

    // Log server output (to file only, reduce stdout noise)
    this.serverProcess.stdout?.on("data", (data) => {
      const text = data.toString();
      const entries = this.outputProcessor.process(text, false);

      entries.forEach((entry: LogEntry) => {
        this.logger.log("server", entry.formatted);
      });
    });

    this.serverProcess.stderr?.on("data", (data) => {
      const text = data.toString();
      const entries = this.outputProcessor.process(text, true);

      entries.forEach((entry: LogEntry) => {
        this.logger.log("server", entry.formatted);

        // Show critical errors to console (parser determines what's critical)
        if (entry.isCritical && entry.rawMessage) {
          console.error(chalk.red("[CRITICAL ERROR]"), entry.rawMessage);
        }
      });
    });

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
          // Show last 10 lines, or fewer if log is shorter
          const recentLines = lines.slice(-10)
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
    // Get the path to our bundled MCP server
    const currentFile = fileURLToPath(import.meta.url)
    const packageRoot = dirname(dirname(currentFile)) // Go up from dist/ to package root
    const mcpServerPath = join(packageRoot, "mcp-server")
    this.debugLog(`MCP server path: ${mcpServerPath}`)

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

    // Always install dependencies to ensure they're up to date
    this.debugLog("Installing/updating MCP server dependencies")
    await this.installMcpServerDeps(mcpServerPath)

    // Use version already read in constructor

    // For global installs, ensure all necessary files are copied to temp directory
    if (isGlobalInstall && actualWorkingDir !== mcpServerPath) {
      const requiredFiles = ["app", "public", "next.config.ts", "next-env.d.ts", "tsconfig.json"]
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

    // Start the MCP server using detected package manager
    const packageManagerForRun = detectPackageManagerForRun()
    this.debugLog(`Using package manager: ${packageManagerForRun}`)
    this.debugLog(`MCP server working directory: ${actualWorkingDir}`)
    this.debugLog(`MCP server port: ${this.options.mcpPort}`)

    this.mcpServerProcess = spawn(packageManagerForRun, ["run", "dev"], {
      stdio: ["ignore", "pipe", "pipe"],
      shell: true,
      detached: true, // Run independently
      cwd: actualWorkingDir,
      env: {
        ...process.env,
        PORT: this.options.mcpPort,
        LOG_FILE_PATH: this.options.logFile, // Pass log file path to MCP server
        DEV3000_VERSION: this.version // Pass version to MCP server
      }
    })

    this.debugLog("MCP server process spawned")

    // Log MCP server output to separate file for debugging
    const mcpLogFile = join(dirname(this.options.logFile), "dev3000-mcp.log")
    writeFileSync(mcpLogFile, "") // Clear the file

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

    while (attempts < maxAttempts) {
      try {
        const response = await fetch(`http://localhost:${this.options.port}`, {
          method: "HEAD",
          signal: AbortSignal.timeout(2000)
        })
        if (response.ok || response.status === 404) {
          return
        }
      } catch (_error) {
        // Server not ready yet, continue waiting
      }

      attempts++
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }

    // Continue anyway if health check fails
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
        copyFileSync(sourcePackageJson, tmpPackageJson)

        workingDir = tmpDirPath
      }

      const packageManager = detectPackageManagerForRun()

      // Don't show any console output during dependency installation
      // All status will be handled by the progress bar

      // For pnpm, use --dev flag to include devDependencies
      const installArgs =
        packageManager === "pnpm"
          ? ["install", "--prod=false"] // Install both prod and dev dependencies
          : ["install", "--include=dev"] // npm/yarn syntax

      const installProcess = spawn(packageManager, installArgs, {
        stdio: ["ignore", "pipe", "pipe"],
        shell: true,
        cwd: workingDir
      })

      // Add timeout (3 minutes)
      const timeout = setTimeout(
        () => {
          installProcess.kill("SIGKILL")
          reject(new Error("MCP server dependency installation timed out after 3 minutes"))
        },
        3 * 60 * 1000
      )

      // Suppress all output to prevent progress bar interference
      installProcess.stdout?.on("data", (_data) => {
        // Silently consume output
      })

      installProcess.stderr?.on("data", (_data) => {
        // Silently consume output
      })

      installProcess.on("exit", (code) => {
        clearTimeout(timeout)

        if (code === 0) {
          resolve()
        } else {
          reject(new Error(`MCP server dependency installation failed with exit code ${code}`))
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
      this.options.debug
    )

    try {
      // Start CDP monitoring
      await this.cdpMonitor.start()
      this.logger.log("browser", "[CDP] Chrome launched with DevTools Protocol monitoring")

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

    // Stop spinner if it's running
    if (this.spinner?.isSpinning) {
      this.spinner.fail("Critical failure detected")
    }

    console.log(chalk.yellow(`🛑 Shutting down ${this.options.commandName} due to critical failure...`))

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

    // Kill servers
    console.log(chalk.cyan("🔄 Killing servers..."))
    await Promise.all([
      killPortProcess(this.options.port, "your app server"),
      killPortProcess(this.options.mcpPort, `${this.options.commandName} MCP server`)
    ])

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

      // Stop spinner if it's running
      if (this.spinner?.isSpinning) {
        this.spinner.fail("Interrupted")
      }

      console.log(chalk.yellow("\n🛑 Received interrupt signal. Cleaning up processes..."))

      // Kill processes on both ports FIRST - this is most important
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

      // Kill servers immediately - don't wait for browser cleanup
      console.log(chalk.yellow("🔄 Killing servers..."))
      await Promise.all([
        killPortProcess(this.options.port, "your app server"),
        killPortProcess(this.options.mcpPort, `${this.options.commandName} MCP server`)
      ])

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

      console.log(chalk.green("✅ Cleanup complete"))
      process.exit(0)
    })
  }
}

export async function startDevEnvironment(options: DevEnvironmentOptions) {
  const devEnv = new DevEnvironment(options)
  await devEnv.start()
}
