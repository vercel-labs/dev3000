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
import { ScreencastManager } from "./screencast-manager.js"
import { type LogEntry, NextJsErrorDetector, OutputProcessor, StandardLogParser } from "./services/parsers/index.js"
import { DevTUI } from "./tui-interface.js"
import { LogLevel, Logger as StructuredLogger } from "./utils/logger.js"
import { getProjectDisplayName, getProjectName } from "./utils/project-name.js"
import { formatTimestamp } from "./utils/timestamp.js"

// MCP names
const MCP_NAMES = {
  DEV3000: "dev3000",
  CHROME_DEVTOOLS: "dev3000-chrome-devtools",
  NEXTJS_DEV: "dev3000-nextjs-dev"
} as const

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
  chromeDevtoolsMcp?: boolean // Whether to enable chrome-devtools MCP integration
  logger?: StructuredLogger // Structured logger from CLI
}

/**
 * FileLogger - Handles writing logs to file
 * (Renamed from Logger to avoid confusion with StructuredLogger)
 */
class FileLogger {
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
  if (existsSync("bun.lockb")) return "bun"
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
  const errorMsg = [
    "\n❌ NO AVAILABLE PORTS FOUND",
    `Starting port: ${startPort}`,
    `Searched range: ${startPort} - 65534`,
    `\nCAUSE: All ports in the range are already in use`,
    `\nEXPECTED: At least one free port in the range`,
    `ACTUAL: All ${65535 - startPort} ports are occupied`,
    `\nPOSSIBLE REASONS:`,
    `  - System has an excessive number of listening services`,
    `  - Port exhaustion due to TIME_WAIT connections`,
    `  - Firewall or security software blocking port checks`,
    `  - lsof command is malfunctioning`,
    `\nDEBUG STEPS:`,
    `  1. Check listening ports: lsof -i -P | grep LISTEN`,
    `  2. Check TIME_WAIT: netstat -an | grep TIME_WAIT | wc -l`,
    `  3. Specify a custom port: dev3000 --port <port>`,
    `  4. Restart system to clear stale connections`
  ].join("\n")
  throw new Error(errorMsg)
}

/**
 * Check if Next.js MCP server is enabled in the project configuration
 */
async function isNextjsMcpEnabled(): Promise<boolean> {
  try {
    const configFiles = ["next.config.js", "next.config.ts", "next.config.mjs", "next.config.cjs"]

    for (const configFile of configFiles) {
      if (existsSync(configFile)) {
        try {
          // Read the config file content
          const configContent = readFileSync(configFile, "utf8")

          // Look for experimental.mcpServer: true or experimental.mcpServer = true
          // This is a simple string-based check that should work for most cases
          const hasMcpServerConfig =
            /experimental\s*:\s*{[^}]*mcpServer\s*:\s*true|experimental\.mcpServer\s*[=:]\s*true/s.test(configContent)

          if (hasMcpServerConfig) {
            return true
          }
        } catch {
          // If we can't read the file, continue checking other config files
        }
      }
    }

    return false
  } catch {
    return false
  }
}

/**
 * Check if Chrome version supports chrome-devtools MCP (>= 140.0.7339.214)
 */
async function isChromeDevtoolsMcpSupported(): Promise<boolean> {
  try {
    // Try different Chrome binary paths
    const chromePaths = [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", // macOS
      "/opt/google/chrome/chrome", // Linux
      "chrome", // PATH
      "google-chrome", // Linux PATH
      "google-chrome-stable" // Linux PATH
    ]

    for (const chromePath of chromePaths) {
      try {
        const versionOutput = await new Promise<string>((resolve, reject) => {
          const chromeProcess = spawn(chromePath, ["--version"], {
            stdio: ["ignore", "pipe", "ignore"]
          })

          let output = ""
          chromeProcess.stdout?.on("data", (data) => {
            output += data.toString()
          })

          chromeProcess.on("close", (code) => {
            if (code === 0) {
              resolve(output.trim())
            } else {
              reject(new Error(`Chrome version check failed with code ${code}`))
            }
          })

          chromeProcess.on("error", reject)

          // Timeout after 3 seconds
          setTimeout(() => {
            chromeProcess.kill()
            reject(new Error("Chrome version check timeout"))
          }, 3000)
        })

        // Parse version from output like "Google Chrome 140.0.7339.214"
        const versionMatch = versionOutput.match(/(\d+)\.(\d+)\.(\d+)\.(\d+)/)
        if (versionMatch) {
          const [, major, minor, build, patch] = versionMatch.map(Number)
          const currentVersion = [major, minor, build, patch]
          const requiredVersion = [140, 0, 7339, 214]

          // Compare version numbers
          for (let i = 0; i < 4; i++) {
            if (currentVersion[i] > requiredVersion[i]) return true
            if (currentVersion[i] < requiredVersion[i]) return false
          }
          return true // Versions are equal
        }
        break // Found Chrome but couldn't parse version - continue with other paths
      } catch {
        // Try next Chrome path
      }
    }

    return false // Chrome not found or version not supported
  } catch {
    return false // Any error means not supported
  }
}

/**
 * Ensure MCP server configurations are added to project's .mcp.json (Claude Code)
 */
async function ensureMcpServers(
  mcpPort: string,
  _appPort: string,
  _enableChromeDevtools: boolean,
  _enableNextjsMcp: boolean
): Promise<void> {
  try {
    const settingsPath = join(process.cwd(), ".mcp.json")

    // Read or create settings
    let settings: {
      mcpServers?: Record<string, { type?: string; url?: string; command?: string; args?: string[] }>
      [key: string]: unknown
    }
    if (existsSync(settingsPath)) {
      const settingsContent = readFileSync(settingsPath, "utf-8")
      settings = JSON.parse(settingsContent)
    } else {
      settings = {}
    }

    // Ensure mcpServers structure exists
    if (!settings.mcpServers) {
      settings.mcpServers = {}
    }

    let added = false

    // Add dev3000 MCP server (HTTP type)
    // NOTE: dev3000 now acts as an MCP orchestrator/gateway that internally
    // spawns and connects to chrome-devtools-mcp and next-devtools-mcp as stdio processes,
    // so users only need to configure dev3000 once!
    if (!settings.mcpServers[MCP_NAMES.DEV3000]) {
      settings.mcpServers[MCP_NAMES.DEV3000] = {
        type: "http",
        url: `http://localhost:${mcpPort}/mcp`
      }
      added = true
    }

    // REMOVED: No longer auto-configure chrome-devtools and nextjs-dev
    // dev3000 MCP server now orchestrates these internally via the gateway pattern

    // Write if we added anything
    if (added) {
      writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf-8")
    }
  } catch (_error) {
    // Ignore errors - settings file manipulation is optional
  }
}

/**
 * Ensure MCP server configurations are added to project's .cursor/mcp.json
 */
async function ensureCursorMcpServers(
  mcpPort: string,
  _appPort: string,
  _enableChromeDevtools: boolean,
  _enableNextjsMcp: boolean
): Promise<void> {
  try {
    const cursorDir = join(process.cwd(), ".cursor")
    const settingsPath = join(cursorDir, "mcp.json")

    // Ensure .cursor directory exists
    if (!existsSync(cursorDir)) {
      mkdirSync(cursorDir, { recursive: true })
    }

    // Read or create settings
    let settings: {
      mcpServers?: Record<string, { type?: string; url?: string; command?: string; args?: string[] }>
      [key: string]: unknown
    }
    if (existsSync(settingsPath)) {
      const settingsContent = readFileSync(settingsPath, "utf-8")
      settings = JSON.parse(settingsContent)
    } else {
      settings = {}
    }

    // Ensure mcpServers structure exists
    if (!settings.mcpServers) {
      settings.mcpServers = {}
    }

    let added = false

    // Add dev3000 MCP server
    // NOTE: dev3000 now acts as an MCP orchestrator/gateway that internally
    // spawns and connects to chrome-devtools-mcp and next-devtools-mcp as stdio processes
    if (!settings.mcpServers[MCP_NAMES.DEV3000]) {
      settings.mcpServers[MCP_NAMES.DEV3000] = {
        type: "http",
        url: `http://localhost:${mcpPort}/mcp`
      }
      added = true
    }

    // REMOVED: No longer auto-configure chrome-devtools and nextjs-dev
    // dev3000 MCP server now orchestrates these internally via the gateway pattern

    // Write if we added anything
    if (added) {
      writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf-8")
    }
  } catch (_error) {
    // Ignore errors - settings file manipulation is optional
  }
}

/**
 * Ensure MCP server configurations are added to project's .opencode.json
 * OpenCode uses a different structure: "mcp" instead of "mcpServers" and "type": "local" for stdio servers
 */
async function ensureOpenCodeMcpServers(
  mcpPort: string,
  _appPort: string,
  _enableChromeDevtools: boolean,
  _enableNextjsMcp: boolean
): Promise<void> {
  try {
    const settingsPath = join(process.cwd(), ".opencode.json")

    // Read or create settings - OpenCode uses "mcp" not "mcpServers"
    let settings: {
      mcp?: Record<
        string,
        {
          type: "local"
          command: string[]
          enabled?: boolean
          environment?: Record<string, string>
        }
      >
      [key: string]: unknown
    }
    if (existsSync(settingsPath)) {
      const settingsContent = readFileSync(settingsPath, "utf-8")
      settings = JSON.parse(settingsContent)
    } else {
      settings = {}
    }

    // Ensure mcp structure exists
    if (!settings.mcp) {
      settings.mcp = {}
    }

    let added = false

    // Add dev3000 MCP server - use npx with mcp-client to connect to HTTP server
    // NOTE: dev3000 now acts as an MCP orchestrator/gateway that internally
    // spawns and connects to chrome-devtools-mcp and next-devtools-mcp as stdio processes
    if (!settings.mcp[MCP_NAMES.DEV3000]) {
      settings.mcp[MCP_NAMES.DEV3000] = {
        type: "local",
        command: ["npx", "@modelcontextprotocol/inspector", `http://localhost:${mcpPort}/mcp`],
        enabled: true
      }
      added = true
    }

    // REMOVED: No longer auto-configure chrome-devtools and nextjs-dev
    // dev3000 MCP server now orchestrates these internally via the gateway pattern

    // Write if we added anything
    if (added) {
      writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf-8")
    }
  } catch (_error) {
    // Ignore errors - settings file manipulation is optional
  }
}

// REMOVED: cleanup functions are no longer needed
// MCP config files are now kept persistent across dev3000 restarts

export function createPersistentLogFile(): string {
  // Get unique project name
  const projectName = getProjectName()

  // Use ~/.d3k/logs directory for persistent, accessible logs
  const logBaseDir = join(homedir(), ".d3k", "logs")
  try {
    if (!existsSync(logBaseDir)) {
      mkdirSync(logBaseDir, { recursive: true })
    }
    return createLogFileInDir(logBaseDir, projectName)
  } catch (_error) {
    // Fallback to user's temp directory if ~/.d3k is not writable
    const fallbackDir = join(tmpdir(), "dev3000-logs")
    if (!existsSync(fallbackDir)) {
      mkdirSync(fallbackDir, { recursive: true })
    }
    return createLogFileInDir(fallbackDir, projectName)
  }
}

// Write session info for MCP server to discover
function writeSessionInfo(
  projectName: string,
  logFilePath: string,
  appPort: string,
  mcpPort?: string,
  cdpUrl?: string | null,
  chromePids?: number[],
  serverCommand?: string
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
      cwd: process.cwd(),
      chromePids: chromePids || [],
      serverCommand: serverCommand || null
    }

    // Write session file - use project name as filename for easy lookup
    const sessionFile = join(sessionDir, `${projectName}.json`)
    writeFileSync(sessionFile, JSON.stringify(sessionInfo, null, 2))
  } catch (error) {
    // Non-fatal - just log a warning
    console.warn(chalk.yellow(`⚠️ Could not write session info: ${error}`))
  }
}

// Get Chrome PIDs for this instance
function getSessionChromePids(projectName: string): number[] {
  const sessionDir = join(homedir(), ".d3k")
  const sessionFile = join(sessionDir, `${projectName}.json`)

  try {
    if (existsSync(sessionFile)) {
      const sessionInfo = JSON.parse(readFileSync(sessionFile, "utf8"))
      return sessionInfo.chromePids || []
    }
  } catch (_error) {
    // Non-fatal - return empty array
  }
  return []
}

function createLogFileInDir(baseDir: string, projectName: string): string {
  // Create timestamp
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-")

  // Create log file path with dev3000- prefix for MCP server UI discovery
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
    // Find all log files for this project (with dev3000- prefix)
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
  private screencastManager: ScreencastManager | null = null
  private fileLogger: FileLogger // File-based logging
  private logger: StructuredLogger // Structured console logging
  private outputProcessor: OutputProcessor
  private options: DevEnvironmentOptions
  private screenshotDir: string
  private mcpPublicDir: string
  private pidFile: string
  private lockFile: string
  private spinner: ReturnType<typeof ora>
  private version: string
  private isShuttingDown: boolean = false
  private serverStartTime: number | null = null
  private healthCheckTimer: NodeJS.Timeout | null = null
  private tui: DevTUI | null = null
  private portChangeMessage: string | null = null
  private firstSigintTime: number | null = null
  private enableNextjsMcp: boolean = false
  private chromeDevtoolsSupported: boolean = false

  constructor(options: DevEnvironmentOptions) {
    // Handle portMcp vs mcpPort naming
    this.options = {
      ...options,
      mcpPort: options.portMcp || options.mcpPort || "3684"
    }
    this.fileLogger = new FileLogger(options.logFile, options.tail || false, options.dateTimeFormat || "local")

    // Use provided logger or create a default one
    this.logger =
      options.logger ||
      new StructuredLogger({
        level: options.debug ? LogLevel.DEBUG : LogLevel.INFO,
        prefix: "dev-env",
        enableColors: true,
        enableTimestamp: false
      })

    this.outputProcessor = new OutputProcessor(new StandardLogParser(), new NextJsErrorDetector())

    // Set up MCP server public directory for web-accessible screenshots
    const currentFile = fileURLToPath(import.meta.url)
    const packageRoot = dirname(dirname(currentFile))

    // Always use MCP server's public directory for screenshots to ensure they're web-accessible
    // and avoid permission issues with /var/log paths
    this.screenshotDir = join(packageRoot, "mcp-server", "public", "screenshots")
    // Use project-specific PID and lock files to allow multiple projects to run simultaneously
    const projectName = getProjectName()
    this.pidFile = join(tmpdir(), `dev3000-${projectName}.pid`)
    this.lockFile = join(tmpdir(), `dev3000-${projectName}.lock`)
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

    // Initialize project-specific D3K log file (clear for new session)
    this.initializeD3KLog()
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
      // In Docker environments, use HTTP health checks instead of lsof
      // lsof may not detect listening ports correctly due to network namespaces
      const ports = [
        { port: this.options.port, name: "app" },
        { port: this.options.mcpPort, name: "mcp" }
      ]

      for (const { port, name } of ports) {
        // Try HTTP health check first
        try {
          const http = await import("http")
          const path = name === "mcp" ? "/health" : "/"
          let httpError: Error | null = null
          const isResponding = await new Promise<boolean>((resolve) => {
            const req = http.get({ host: "localhost", port, path }, (res) => {
              const ok = (res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 400
              resolve(ok)
            })
            req.on("error", (err) => {
              httpError = err instanceof Error ? err : new Error(String(err))
              resolve(false)
            })
            req.setTimeout(2000, () => {
              req.destroy()
              httpError = new Error("Connection timeout after 2000ms")
              resolve(false)
            })
          })

          if (!isResponding) {
            const errorMsg = [
              `\n❌ HEALTH CHECK FAILED - ${name.toUpperCase()} SERVER NOT RESPONDING`,
              `Server: ${name}`,
              `Port: ${port}`,
              `URL: http://localhost:${port}/`,
              httpError ? `HTTP Error: ${(httpError as Error).message}` : "No response",
              `\nCAUSE: ${name} server is not responding to HTTP requests`,
              `\nPOSSIBLE REASONS:`,
              `  - ${name} server crashed or exited unexpectedly`,
              `  - ${name} server is frozen or deadlocked`,
              `  - Port ${port} is bound but process is not accepting connections`,
              `  - Network namespace issues (Docker/containers)`,
              `\nDEBUG STEPS:`,
              `  1. Check if process is running: lsof -i :${port}`,
              `  2. Review ${name} server logs above for crash/error messages`,
              `  3. Check system resources: top or htop`,
              `  4. For Docker: Check container health: docker ps`,
              `  5. Manual test: curl -v http://localhost:${port}/`,
              `\nACTION: Initiating graceful shutdown...`
            ].join("\n")
            this.debugLog(errorMsg)
            this.fileLogger.log("server", errorMsg)
            return false
          }
        } catch (error) {
          this.debugLog(`Health check error for port ${port}: ${error}`)
          // Fall back to lsof check
          const result = await new Promise<string>((resolve) => {
            const proc = spawn("lsof", ["-ti", `:${port}`], { stdio: "pipe" })
            let output = ""
            proc.stdout?.on("data", (data) => {
              output += data.toString()
            })
            proc.on("exit", () => resolve(output.trim()))
            proc.on("error", (err) => {
              // lsof not available (e.g., in containers/WSL)
              this.debugLog(`lsof not available: ${err.message}`)
              resolve("") // Return empty to trigger failure
            })
          })

          if (!result) {
            const errorMsg = [
              `\n❌ HEALTH CHECK FAILED - PORT NOT IN USE`,
              `Server: ${name}`,
              `Port: ${port}`,
              `\nCAUSE: No process is listening on port ${port}`,
              `\nEXPECTED: ${name} server process listening on port ${port}`,
              `ACTUAL: Port ${port} is free (no process bound)`,
              `\nPOSSIBLE REASONS:`,
              `  - ${name} server exited/crashed`,
              `  - Process was killed externally (kill, pkill, OOM killer)`,
              `  - Server failed to bind to port on startup`,
              `  - Port was released due to error condition`,
              `\nDEBUG STEPS:`,
              `  1. Check exit code in logs (if process terminated)`,
              `  2. Check system logs: dmesg | grep -i killed`,
              `  3. Check memory: free -h (OOM killer may have terminated it)`,
              `  4. Review ${name} server startup logs for bind errors`,
              `  5. Verify no port conflicts occurred`,
              `\nACTION: Initiating graceful shutdown...`
            ].join("\n")
            this.debugLog(errorMsg)
            this.fileLogger.log("server", errorMsg)
            return false
          }
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
    this.logger.info("━━━ Development Environment Starting ━━━")
    this.logger.logFields(LogLevel.INFO, "Configuration", {
      Command: this.options.commandName,
      Port: this.options.port,
      "MCP Port": this.options.mcpPort || "3684",
      "Server Command": this.options.serverCommand,
      "TUI Mode": this.options.tui ? "enabled" : "disabled",
      "Debug Mode": this.options.debug ? "enabled" : "disabled",
      "Servers Only": this.options.serversOnly ? "yes" : "no"
    })

    // Check if another instance is already running for this project
    this.logger.debug("Checking for existing instance lock...")
    if (!this.acquireLock()) {
      this.logger.error(`Another dev3000 instance is already running`)
      this.logger.error(`Lock file: ${this.lockFile}`)
      console.error(chalk.red(`\n❌ Another dev3000 instance is already running for this project.`))
      console.error(chalk.yellow(`   If you're sure no other instance is running, remove: ${this.lockFile}`))
      process.exit(1)
    }
    this.logger.debug("✓ Lock acquired successfully")

    // Check if TUI mode is enabled (default) and stdin supports it
    const canUseTUI = this.options.tui && process.stdin.isTTY

    this.logger.debug(`TUI check: requested=${this.options.tui}, isTTY=${process.stdin.isTTY}, result=${canUseTUI}`)

    if (!canUseTUI && this.options.tui) {
      this.logger.warn("TTY not available, falling back to non-TUI mode")
      this.debugLog("TTY not available, falling back to non-TUI mode")
    }

    if (canUseTUI) {
      this.logger.debug("Starting TUI mode")
      // Clear console and start TUI immediately for fast render
      console.clear()

      // Get unique project name
      const projectName = getProjectName()
      const projectDisplayName = getProjectDisplayName()

      this.logger.debug(`Project names: internal=${projectName}, display=${projectDisplayName}`)

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
      await new Promise((resolve) => setTimeout(resolve, 50))

      // Check ports in background after TUI is visible
      await this.tui.updateStatus("Checking ports...")
      await this.checkPortsAvailable(true) // silent mode for TUI

      // Update the app port in TUI (may have changed during port check)
      this.tui.updateAppPort(this.options.port)

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

      // Setup cleanup handlers BEFORE starting TUI to ensure they work
      this.setupCleanupHandlers()

      // Start user's dev server
      await this.tui.updateStatus("Starting your dev server...")
      await this.startServer()

      // Start MCP server
      await this.tui.updateStatus(`Starting ${this.options.commandName} MCP server...`)
      await this.startMcpServer()

      // Wait for servers to be ready
      await this.tui.updateStatus("Waiting for your app server...")
      const serverStarted = await this.waitForServer()

      if (!serverStarted) {
        await this.tui.updateStatus("❌ Server failed to start")
        console.error(chalk.red("\n❌ Your app server failed to start after 30 seconds."))
        console.error(chalk.yellow(`Check the logs at ~/.d3k/logs/${getProjectName()}-d3k.log for errors.`))
        console.error(chalk.yellow("Exiting without launching browser."))
        process.exit(1)
      }

      await this.tui.updateStatus(`Waiting for ${this.options.commandName} MCP server...`)
      await this.waitForMcpServer()

      // Progressive MCP discovery - after dev server is ready (non-blocking)
      // Run in background to avoid delaying browser startup
      this.discoverMcpsAfterServerStart().catch((error) => {
        this.debugLog(`MCP discovery after server start failed: ${error.message}`)
      })

      // Configure AI CLI integrations (both dev3000 and chrome-devtools MCPs)
      if (!this.options.serversOnly) {
        await this.tui.updateStatus("Configuring AI CLI integrations...")
        // Check if NextJS MCP is enabled and store the result
        this.enableNextjsMcp = await isNextjsMcpEnabled()

        // Check if Chrome version supports chrome-devtools MCP
        if (this.options.chromeDevtoolsMcp !== false) {
          this.chromeDevtoolsSupported = await isChromeDevtoolsMcpSupported()
          if (!this.chromeDevtoolsSupported) {
            this.logD3K("Chrome version < 140.0.7339.214 detected - chrome-devtools MCP will be skipped")
          }
        }

        // Ensure MCP server configurations in project settings files (instant, local)
        await ensureMcpServers(
          this.options.mcpPort || "3684",
          this.options.port,
          this.chromeDevtoolsSupported,
          this.enableNextjsMcp
        )
        await ensureCursorMcpServers(
          this.options.mcpPort || "3684",
          this.options.port,
          this.chromeDevtoolsSupported,
          this.enableNextjsMcp
        )
        await ensureOpenCodeMcpServers(
          this.options.mcpPort || "3684",
          this.options.port,
          this.chromeDevtoolsSupported,
          this.enableNextjsMcp
        )

        this.logD3K(`AI CLI Integration: Configured MCP servers in .mcp.json, .cursor/mcp.json, and .opencode.json`)
      }

      // Start CDP monitoring only if server started successfully and not in servers-only mode
      if (!this.options.serversOnly && serverStarted) {
        await this.tui.updateStatus(`Starting ${this.options.commandName} browser...`)
        await this.startCDPMonitoringSync()

        // Progressive MCP discovery - after browser is ready (non-blocking)
        // Run in background to avoid delaying startup completion
        this.discoverMcpsAfterBrowserStart().catch((error) => {
          this.debugLog(`MCP discovery after browser start failed: ${error.message}`)
        })
      } else if (!this.options.serversOnly) {
        this.debugLog("Browser monitoring skipped - server failed to start")
      } else {
        this.debugLog("Browser monitoring disabled via --servers-only flag")
      }

      // Write session info for MCP server discovery (include CDP URL if browser monitoring was started)
      const cdpUrl = this.cdpMonitor?.getCdpUrl() || null
      const chromePids = this.cdpMonitor?.getChromePids() || []
      writeSessionInfo(
        projectName,
        this.options.logFile,
        this.options.port,
        this.options.mcpPort,
        cdpUrl,
        chromePids,
        this.options.serverCommand
      )

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
      const serverStarted = await this.waitForServer()

      if (!serverStarted) {
        this.spinner.fail("Server failed to start")
        console.error(chalk.red("\n❌ Your app server failed to start after 30 seconds."))
        console.error(chalk.yellow(`Check the logs at ~/.d3k/logs/${getProjectName()}-d3k.log for errors.`))
        console.error(chalk.yellow("Exiting without launching browser."))
        process.exit(1)
      }

      this.spinner.text = `Waiting for ${this.options.commandName} MCP server...`
      await this.waitForMcpServer()

      // Progressive MCP discovery - after dev server is ready (non-blocking)
      // Run in background to avoid delaying browser startup
      this.discoverMcpsAfterServerStart().catch((error) => {
        this.debugLog(`MCP discovery after server start failed: ${error.message}`)
      })

      // Configure AI CLI integrations (both dev3000 and chrome-devtools MCPs)
      if (!this.options.serversOnly) {
        this.spinner.text = "Configuring AI CLI integrations..."
        // Check if NextJS MCP is enabled and store the result
        this.enableNextjsMcp = await isNextjsMcpEnabled()

        // Check if Chrome version supports chrome-devtools MCP
        if (this.options.chromeDevtoolsMcp !== false) {
          this.chromeDevtoolsSupported = await isChromeDevtoolsMcpSupported()
          if (!this.chromeDevtoolsSupported) {
            this.logD3K("Chrome version < 140.0.7339.214 detected - chrome-devtools MCP will be skipped")
          }
        }

        // Ensure MCP server configurations in project settings files (instant, local)
        await ensureMcpServers(
          this.options.mcpPort || "3684",
          this.options.port,
          this.chromeDevtoolsSupported,
          this.enableNextjsMcp
        )
        await ensureCursorMcpServers(
          this.options.mcpPort || "3684",
          this.options.port,
          this.chromeDevtoolsSupported,
          this.enableNextjsMcp
        )
        await ensureOpenCodeMcpServers(
          this.options.mcpPort || "3684",
          this.options.port,
          this.chromeDevtoolsSupported,
          this.enableNextjsMcp
        )

        this.logD3K(`AI CLI Integration: Configured MCP servers in .mcp.json, .cursor/mcp.json, and .opencode.json`)
      }

      // Start CDP monitoring only if server started successfully and not in servers-only mode
      if (!this.options.serversOnly && serverStarted) {
        this.spinner.text = `Starting ${this.options.commandName} browser...`
        await this.startCDPMonitoringSync()

        // Progressive MCP discovery - after browser is ready (non-blocking)
        // Run in background to avoid delaying startup completion
        this.discoverMcpsAfterBrowserStart().catch((error) => {
          this.debugLog(`MCP discovery after browser start failed: ${error.message}`)
        })
      } else if (!this.options.serversOnly) {
        this.debugLog("Browser monitoring skipped - server failed to start")
      } else {
        this.debugLog("Browser monitoring disabled via --servers-only flag")
      }

      // Get project name for session info and Visual Timeline URL
      const projectName = getProjectName()
      // Include CDP URL if browser monitoring was started
      const cdpUrl = this.cdpMonitor?.getCdpUrl() || null
      const chromePids = this.cdpMonitor?.getChromePids() || []
      writeSessionInfo(
        projectName,
        this.options.logFile,
        this.options.port,
        this.options.mcpPort,
        cdpUrl,
        chromePids,
        this.options.serverCommand
      )

      // Complete startup with success message only in non-TUI mode
      this.spinner.succeed("Development environment ready!")

      // Regular console output (when TUI is disabled with --no-tui)
      console.log(chalk.cyan(`Logs: ${this.options.logFile}`))
      console.log(chalk.cyan("☝️ Give this to an AI to auto debug and fix your app\n"))
      console.log(chalk.cyan(`🌐 Your App: http://localhost:${this.options.port}`))
      console.log(chalk.cyan(`🤖 MCP Server: http://localhost:${this.options.mcpPort}`))
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
    this.logger.info("Starting development server")
    this.logger.debug(`Command: ${this.options.serverCommand}`)
    this.debugLog(`Starting server process: ${this.options.serverCommand}`)

    this.serverStartTime = Date.now()
    // Use the full command string with shell: true to properly handle complex commands
    this.serverProcess = spawn(this.options.serverCommand, {
      stdio: ["ignore", "pipe", "pipe"],
      shell: true,
      detached: true // Run independently
    })

    if (this.serverProcess.pid) {
      this.logger.info(`✓ Server process started (PID: ${this.serverProcess.pid})`)
    }
    this.debugLog(`Server process spawned with PID: ${this.serverProcess.pid}`)

    // Log server output (to file only, reduce stdout noise)
    this.serverProcess.stdout?.on("data", (data) => {
      const text = data.toString()
      const entries = this.outputProcessor.process(text, false)

      entries.forEach((entry: LogEntry) => {
        this.fileLogger.log("server", entry.formatted)
      })
    })

    this.serverProcess.stderr?.on("data", (data) => {
      const text = data.toString()
      const entries = this.outputProcessor.process(text, true)

      entries.forEach((entry: LogEntry) => {
        this.fileLogger.log("server", entry.formatted)

        // Show critical errors to console (parser determines what's critical)
        if (entry.isCritical && entry.rawMessage) {
          console.error(chalk.red("[ERROR]"), entry.rawMessage)
        }
      })
    })

    this.serverProcess.on("exit", (code) => {
      if (this.isShuttingDown) return // Don't handle exits during shutdown

      if (code !== 0 && code !== null) {
        this.debugLog(`Server process exited with code ${code}`)
        this.fileLogger.log("server", `Server process exited with code ${code}`)

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

  private acquireLock(): boolean {
    try {
      // Check if lock file exists
      if (existsSync(this.lockFile)) {
        const lockContent = readFileSync(this.lockFile, "utf8")
        const oldPID = parseInt(lockContent, 10)

        // Check if the process is still running
        try {
          process.kill(oldPID, 0) // Signal 0 just checks if process exists
          // Process is running, lock is valid
          return false
        } catch {
          // Process doesn't exist, remove stale lock
          this.debugLog(`Removing stale lock file for PID ${oldPID}`)
          unlinkSync(this.lockFile)
        }
      }

      // Create lock file with our PID
      writeFileSync(this.lockFile, process.pid.toString())
      this.debugLog(`Acquired lock file: ${this.lockFile}`)
      return true
    } catch (error) {
      this.debugLog(`Failed to acquire lock: ${error}`)
      return false
    }
  }

  private releaseLock() {
    try {
      if (existsSync(this.lockFile)) {
        unlinkSync(this.lockFile)
        this.debugLog(`Released lock file: ${this.lockFile}`)
      }
    } catch (error) {
      this.debugLog(`Failed to release lock: ${error}`)
    }
  }

  private debugLog(message: string) {
    // Use structured logger for debug messages
    this.logger.debug(message)

    // Also log to file with timestamp
    const timestamp = formatTimestamp(new Date(), this.options.dateTimeFormat || "local")
    if (this.options.debug && this.fileLogger) {
      // Optionally write debug messages to file when in debug mode
      // (Only if debug is enabled, to avoid cluttering file logs)
    }

    // Handle spinner interaction for non-TUI mode
    if (this.options.debug && !this.options.tui) {
      if (this.spinner?.isSpinning) {
        // Temporarily stop the spinner, show debug message, then restart
        const currentText = this.spinner.text
        this.spinner.stop()
        // Message already logged by logger.debug() above
        this.spinner.start(currentText)
      } else {
        console.log(chalk.gray(`[DEBUG] ${message}`))
      }
    }

    // Always write to d3k debug log file (even when not in debug mode)
    try {
      const debugLogDir = join(homedir(), ".d3k")
      if (!existsSync(debugLogDir)) {
        mkdirSync(debugLogDir, { recursive: true })
      }

      const debugLogFile = join(debugLogDir, "d3k.log")
      const logEntry = `[${timestamp}] [DEBUG] ${message}\n`
      appendFileSync(debugLogFile, logEntry)
    } catch {
      // Ignore debug log write errors
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
      console.log(chalk.cyan(`   Quick access: tail -f ${this.options.logFile}`))
    } catch (_error) {
      // Fallback if we can't read the log file
      console.log(chalk.yellow(`💡 Check logs for details: ${this.options.logFile}`))
    }
  }

  private async startMcpServer() {
    this.logger.info("━━━ MCP Server Setup ━━━")
    this.debugLog("Starting MCP server setup")

    // Note: MCP server cleanup now happens earlier in checkPortsAvailable()
    // to ensure the port is free before we check availability

    // Get the path to our bundled MCP server
    const currentFile = fileURLToPath(import.meta.url)
    const packageRoot = dirname(dirname(currentFile)) // Go up from dist/ to package root
    let mcpServerPath = join(packageRoot, "mcp-server")
    this.logger.debug(`Resolving MCP server path...`)
    this.logger.trace(`Initial path: ${mcpServerPath}`)
    this.debugLog(`Initial MCP server path: ${mcpServerPath}`)

    // For pnpm global installs, resolve symlinks to get the real path
    if (existsSync(mcpServerPath)) {
      try {
        const realPath = realpathSync(mcpServerPath)
        if (realPath !== mcpServerPath) {
          this.logger.debug(`Symlink resolved: ${mcpServerPath} -> ${realPath}`)
          this.debugLog(`MCP server path resolved from symlink: ${mcpServerPath} -> ${realPath}`)
          mcpServerPath = realPath
        }
      } catch (e) {
        // Error resolving path, continue with original
        this.logger.warn(`Error resolving symlink: ${e}`)
        this.debugLog(`Error resolving real path: ${e}`)
      }
    }

    this.logger.debug(`Final MCP server path: ${mcpServerPath}`)
    this.debugLog(`Final MCP server path: ${mcpServerPath}`)

    if (!existsSync(mcpServerPath)) {
      const errorMsg = `MCP server directory not found at ${mcpServerPath}`
      this.logger.error(errorMsg)
      throw new Error(errorMsg)
    }
    this.logger.debug("✓ MCP server directory found")
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
    this.logger.info("Configuring MCP server launch")
    this.logger.logFields(LogLevel.DEBUG, "MCP server configuration", {
      "Working directory": actualWorkingDir,
      Port: this.options.mcpPort || "3684",
      "Screenshot dir": this.screenshotDir,
      "Pre-built": isPreBuilt ? "yes" : "no",
      "Global install": isGlobalInstall ? "yes" : "no"
    })

    this.debugLog(`MCP server working directory: ${actualWorkingDir}`)
    this.debugLog(`MCP server port: ${this.options.mcpPort}`)
    this.debugLog(`Screenshot directory: ${this.screenshotDir}`)
    this.debugLog(`Is pre-built: ${isPreBuilt}`)
    this.debugLog(`Is global install: ${isGlobalInstall}`)

    let mcpCommand: string[]
    let mcpCwd = actualWorkingDir

    if (isGlobalInstall && isPreBuilt) {
      this.logger.debug("Using global install pre-built mode")
      // For global installs with pre-built servers, use the standalone server directly
      // This avoids the turbopack runtime issues with npx
      const serverJsPath = join(mcpServerPath, ".next", "standalone", "mcp-server", "server.js")

      if (existsSync(serverJsPath)) {
        // Use the standalone server directly
        this.logger.debug(`✓ Found standalone server: ${serverJsPath}`)
        this.debugLog(`Global install with standalone server at ${serverJsPath}`)
        mcpCommand = ["node", serverJsPath]
        mcpCwd = dirname(serverJsPath)
      } else {
        // Check for start-production.mjs script
        const startProdScript = join(mcpServerPath, "start-production.mjs")

        if (existsSync(startProdScript)) {
          // Use the production script
          this.logger.debug(`✓ Found start-production.mjs`)
          this.debugLog(`Global install with start-production.mjs script`)
          mcpCommand = ["node", startProdScript]
          mcpCwd = mcpServerPath
        } else {
          // Fallback to finding Next.js binary
          const dev3000NodeModules = join(mcpServerPath, "..", "..", "node_modules")
          const nextBinPath = join(dev3000NodeModules, ".bin", "next")

          this.logger.debug(`Searching for Next.js binary: ${nextBinPath}`)
          this.debugLog(`Looking for Next.js at: ${nextBinPath}`)

          if (existsSync(nextBinPath)) {
            // Found Next.js in the dev3000 package
            this.logger.debug(`✓ Found Next.js binary`)
            this.debugLog(`Global install with Next.js found at ${nextBinPath}`)
            mcpCommand = [nextBinPath, "start"]
            mcpCwd = mcpServerPath
          } else {
            // Fallback to npx with the exact version we built with
            this.logger.debug(`Using npx fallback`)
            this.debugLog(`Global install with pre-built server - using npx next start`)
            mcpCommand = ["npx", "--yes", "next@15.5.1-canary.30", "start"]
            mcpCwd = mcpServerPath
          }
        }
      }
    } else {
      // Non-global or non-pre-built: use package manager
      const packageManagerForRun = detectPackageManagerForRun()
      this.logger.debug(`Using package manager: ${packageManagerForRun}`)
      this.debugLog(`Using package manager: ${packageManagerForRun}`)
      mcpCommand = [packageManagerForRun, "run", "start"]
      mcpCwd = actualWorkingDir
    }

    this.logger.info(`Starting MCP server: ${mcpCommand.join(" ")}`)
    this.logger.debug(`Working directory: ${mcpCwd}`)
    this.debugLog(`MCP server command: ${mcpCommand.join(" ")}`)
    this.debugLog(`MCP server cwd: ${mcpCwd}`)

    // Get CDP URL for MCP orchestration
    const cdpUrl = this.cdpMonitor?.getCdpUrl() || null

    if (cdpUrl) {
      this.logger.debug(`CDP URL for MCP orchestration: ${cdpUrl}`)
    }

    // Start MCP server as a true background singleton process
    this.logger.debug("Spawning MCP server process...")
    this.mcpServerProcess = spawn(mcpCommand[0], mcpCommand.slice(1), {
      stdio: ["ignore", "pipe", "pipe"],
      detached: true, // Run independently of parent process
      cwd: mcpCwd,
      env: {
        ...process.env,
        PORT: this.options.mcpPort,
        LOG_FILE_PATH: this.options.logFile, // Pass log file path to MCP server
        DEV3000_VERSION: this.version, // Pass version to MCP server
        SCREENSHOT_DIR: this.screenshotDir, // Pass screenshot directory for global installs
        CDP_URL: cdpUrl || "" // Pass CDP URL for chrome-devtools MCP orchestration
      }
    })

    if (this.mcpServerProcess.pid) {
      this.logger.info(`✓ MCP server process started (PID: ${this.mcpServerProcess.pid})`)
    } else {
      this.logger.warn("MCP server process spawned but PID unknown")
    }

    // Unref the process so it continues running after parent exits
    this.mcpServerProcess.unref()

    this.logger.debug("MCP server running as detached background service")
    this.debugLog("MCP server process spawned as singleton background service")

    // Log MCP server output to separate file for debugging
    const mcpLogFile = join(dirname(this.options.logFile), "mcp.log")
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
        // Exclude MCP Orchestrator connection errors (they're expected and non-critical)
        if ((message.includes("FATAL") || message.includes("Error:")) && !message.includes("[MCP Orchestrator]")) {
          console.error(chalk.red("[ERROR]"), message)
        }
      }
    })

    this.mcpServerProcess.on("exit", (code) => {
      this.debugLog(`MCP server process exited with code ${code}`)
      // Only show exit messages for unexpected failures, not restarts
      if (code !== 0 && code !== null) {
        this.fileLogger.log("server", `MCP server process exited with code ${code}`)
      }
    })

    this.debugLog("MCP server event handlers setup complete")
  }

  private async waitForServer(): Promise<boolean> {
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

        if (
          response.ok ||
          response.status === 404 ||
          response.status === 405 ||
          response.status === 500 ||
          response.status === 503
        ) {
          const totalTime = Date.now() - startTime
          this.debugLog(`Server is ready! Total wait time: ${totalTime}ms (${attempts + 1} attempts)`)
          this.debugLog(
            `Status ${response.status} indicates server is running (200=OK, 404=Not Found, 405=Method Not Allowed, 500=App Error, 503=Service Unavailable)`
          )
          return true
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
    this.debugLog(`Server readiness check timed out after ${totalTime}ms (${maxAttempts} attempts)`)
    return false
  }

  private detectPackageManagerInDir(dir: string): string {
    if (existsSync(join(dir, "bun.lockb"))) return "bun"
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

      // Package manager specific install args to include devDependencies
      const installArgs =
        packageManager === "pnpm"
          ? ["install", "--prod=false"] // Install both prod and dev dependencies
          : packageManager === "bun"
            ? ["install", "--dev"] // bun syntax
            : ["install", "--include=dev"] // npm/yarn syntax

      const fullCommand = `${packageManager} ${installArgs.join(" ")}`

      if (this.options.debug) {
        console.log(`[DEBUG] Installing MCP server dependencies...`)
        console.log(`[DEBUG] Working directory: ${workingDir}`)
        console.log(`[DEBUG] Package manager detected: ${packageManager}`)
        console.log(`[DEBUG] Command: ${fullCommand}`)
        console.log(`[DEBUG] Is global install: ${isGlobalInstall}`)
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
            console.log(`[DEBUG] Installation timed out after 3 minutes`)
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
          console.log(`[DEBUG] Installation completed in ${installTime}ms with exit code: ${code}`)
          if (debugOutput) {
            console.log(`[DEBUG] stdout:`, debugOutput.trim())
          }
          if (debugErrors) {
            console.log(`[DEBUG] stderr:`, debugErrors.trim())
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

  private async discoverMcpsAfterServerStart() {
    try {
      this.debugLog("Starting MCP discovery after dev server startup")

      // Call the MCP discovery function - make HTTP request to our own MCP server
      const mcpUrl = `http://localhost:${this.options.mcpPort}/mcp`
      const projectName = getProjectName()

      this.debugLog(`Running MCP discovery for project: ${projectName} via ${mcpUrl}`)

      const requestPayload = {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "discover_available_mcps",
          arguments: {
            projectName: projectName
          }
        }
      }

      const response = await fetch(mcpUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream"
        },
        body: JSON.stringify(requestPayload)
      })

      if (!response.ok) {
        throw new Error(`MCP request failed: ${response.status} ${response.statusText}`)
      }

      // Handle both JSON and SSE responses
      const contentType = response.headers.get("content-type") || ""
      let result: { error?: { message: string }; result?: { content?: Array<{ text?: string }> } }

      if (contentType.includes("text/event-stream")) {
        // Parse Server-Sent Events format
        const sseText = await response.text()
        const dataLine = sseText.split("\n").find((line) => line.startsWith("data: "))
        if (dataLine) {
          result = JSON.parse(dataLine.substring(6)) // Remove "data: " prefix
        } else {
          throw new Error("No data found in SSE response")
        }
      } else {
        // Parse regular JSON
        result = await response.json()
      }

      if (result.error) {
        throw new Error(`MCP error: ${result.error.message}`)
      }

      // Parse the discovered MCPs from the response
      const responseText = result.result?.content?.[0]?.text || ""
      const discoveredMcps = this.parseMcpDiscoveryResult(responseText)

      if (discoveredMcps.length > 0) {
        this.debugLog(`MCP discovery found: ${discoveredMcps.join(", ")}`)

        // Log discovery results to the main log file with [D3K] tags
        const discoveryMessage = `MCP Discovery: Found ${discoveredMcps.join(", ")} after dev server startup`
        this.logD3K(discoveryMessage)

        // Additional logging for each MCP
        for (const mcp of discoveredMcps) {
          this.logD3K(`MCP Integration: ${mcp} MCP detected via process/port scanning`)
        }
      } else {
        this.debugLog("MCP discovery found no MCPs after dev server startup")
        this.logD3K("MCP Discovery: No MCPs detected after dev server startup")
      }
    } catch (error) {
      this.debugLog(`MCP discovery error after server start: ${error}`)
      // Non-fatal - just log the error
      this.logD3K(`MCP Discovery Error: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  private async discoverMcpsAfterBrowserStart() {
    try {
      this.debugLog("Starting MCP discovery after browser startup")

      // Call the MCP discovery function - make HTTP request to our own MCP server
      const mcpUrl = `http://localhost:${this.options.mcpPort}/mcp`
      const projectName = getProjectName()

      this.debugLog(`Running final MCP discovery for project: ${projectName} via ${mcpUrl}`)

      const requestPayload = {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "discover_available_mcps",
          arguments: {
            projectName: projectName
          }
        }
      }

      const response = await fetch(mcpUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream"
        },
        body: JSON.stringify(requestPayload)
      })

      if (!response.ok) {
        throw new Error(`MCP request failed: ${response.status} ${response.statusText}`)
      }

      // Handle both JSON and SSE responses
      const contentType = response.headers.get("content-type") || ""
      let result: { error?: { message: string }; result?: { content?: Array<{ text?: string }> } }

      if (contentType.includes("text/event-stream")) {
        // Parse Server-Sent Events format
        const sseText = await response.text()
        const dataLine = sseText.split("\n").find((line) => line.startsWith("data: "))
        if (dataLine) {
          result = JSON.parse(dataLine.substring(6)) // Remove "data: " prefix
        } else {
          throw new Error("No data found in SSE response")
        }
      } else {
        // Parse regular JSON
        result = await response.json()
      }

      if (result.error) {
        throw new Error(`MCP error: ${result.error.message}`)
      }

      // Parse the discovered MCPs from the response
      const responseText = result.result?.content?.[0]?.text || ""
      const discoveredMcps = this.parseMcpDiscoveryResult(responseText)

      if (discoveredMcps.length > 0) {
        this.debugLog(`Final MCP discovery found: ${discoveredMcps.join(", ")}`)

        // Log discovery results to the main log file with [D3K] tags
        const discoveryMessage = `MCP Discovery: Final scan found ${discoveredMcps.join(", ")} after browser startup`
        this.logD3K(discoveryMessage)

        // Log integration summary
        const integrationTypes = []
        if (discoveredMcps.includes("nextjs-dev")) integrationTypes.push("Next.js")
        if (discoveredMcps.includes("chrome-devtools")) integrationTypes.push("Chrome DevTools")

        if (integrationTypes.length > 0) {
          this.logD3K(`MCP Integration: Activated integrations [${integrationTypes.join(", ")}]`)
          this.logD3K(
            `Orchestrator Mode: dev3000 is now running as debugging orchestrator with ${integrationTypes.length} MCP integration(s)`
          )

          // If chrome-devtools is detected, share CDP URL for coordination
          if (discoveredMcps.includes("chrome-devtools")) {
            this.shareCdpUrlWithChromeDevtools()
          }
        }
      } else {
        this.debugLog("Final MCP discovery found no MCPs")
        this.logD3K("MCP Discovery: Final scan completed - running in standalone mode")
      }
    } catch (error) {
      this.debugLog(`MCP discovery error after browser start: ${error}`)
      // Non-fatal - just log the error
      this.logD3K(`MCP Discovery Error: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  private initializeD3KLog() {
    try {
      const debugLogDir = join(homedir(), ".d3k", "logs")
      if (!existsSync(debugLogDir)) {
        mkdirSync(debugLogDir, { recursive: true })
      }

      // Create project-specific D3K log file and clear it for new session
      const projectName = getProjectName()
      const d3kLogFile = join(debugLogDir, `${projectName}-d3k.log`)
      writeFileSync(d3kLogFile, "")
    } catch {
      // Ignore D3K log initialization errors - non-critical
    }
  }

  private logD3K(message: string) {
    // Write [D3K] logs to project-specific dev3000 debug log, NOT to main project log
    // This prevents Claude from thinking dev3000's orchestration logic needs to be "fixed"
    const timestamp = formatTimestamp(new Date(), this.options.dateTimeFormat || "local")
    const logEntry = `[${timestamp}] [D3K] ${message}\n`

    try {
      const debugLogDir = join(homedir(), ".d3k", "logs")
      if (!existsSync(debugLogDir)) {
        mkdirSync(debugLogDir, { recursive: true })
      }

      // Create project-specific D3K log file to avoid confusion between multiple instances
      const projectName = getProjectName()
      const d3kLogFile = join(debugLogDir, `${projectName}-d3k.log`)
      appendFileSync(d3kLogFile, logEntry)
    } catch {
      // Ignore D3K log write errors - non-critical
    }
  }

  private shareCdpUrlWithChromeDevtools() {
    if (!this.cdpMonitor) return

    const cdpUrl = this.cdpMonitor.getCdpUrl()
    if (cdpUrl) {
      this.logD3K(`CDP Integration: Chrome DevTools can connect to existing browser at ${cdpUrl}`)
      this.logD3K(`CDP Coordination: Use this URL to avoid launching duplicate Chrome instances`)
      this.logD3K(
        `CDP Enhanced Workflow: chrome-devtools can now take screenshots, inject JS, and debug using dev3000's browser`
      )
      this.logD3K(`CDP Claude Suggestion: When using chrome-devtools MCP, connect to: ${cdpUrl}`)

      // Also update session info to make CDP URL immediately available
      const projectName = getProjectName()
      writeSessionInfo(
        projectName,
        this.options.logFile,
        this.options.port,
        this.options.mcpPort,
        cdpUrl,
        this.cdpMonitor.getChromePids(),
        this.options.serverCommand
      )
    } else {
      this.logD3K("CDP Integration: CDP URL not yet available - browser may still be starting")

      // Retry after a short delay since browser might still be initializing
      setTimeout(() => {
        if (this.cdpMonitor) {
          const delayedCdpUrl = this.cdpMonitor.getCdpUrl()
          if (delayedCdpUrl) {
            this.logD3K(`CDP Integration: Chrome DevTools can now connect to ${delayedCdpUrl}`)
            this.logD3K(`CDP Delayed Coordination: Browser initialization complete`)

            const projectName = getProjectName()
            writeSessionInfo(
              projectName,
              this.options.logFile,
              this.options.port,
              this.options.mcpPort,
              delayedCdpUrl,
              this.cdpMonitor.getChromePids(),
              this.options.serverCommand
            )
          }
        }
      }, 2000) // Wait 2 seconds for browser to fully initialize
    }
  }

  private parseMcpDiscoveryResult(responseText: string): string[] {
    // Parse the MCP discovery response text to extract discovered MCPs
    // Example: "🔍 **MCP DISCOVERY RESULTS**\n\nDiscovered MCPs: chrome-devtools, nextjs-dev"
    const mcps: string[] = []

    // Look for the "Discovered MCPs:" line
    const match = responseText.match(/Discovered MCPs:\s*([^\n]+)/i)
    if (match?.[1]) {
      const mcpList = match[1].trim()
      if (mcpList !== "none") {
        // Split by comma and clean up each MCP name
        mcps.push(
          ...mcpList
            .split(",")
            .map((name) => name.trim())
            .filter(Boolean)
        )
      }
    }

    return mcps
  }

  private async startCDPMonitoringSync() {
    // Skip if in servers-only mode
    if (this.options.serversOnly) {
      return
    }

    try {
      await this.startCDPMonitoring()
    } catch (error) {
      // Detailed error reporting for CDP connection failures
      const cdpUrl = process.env.DEV3000_CDP_URL
      const skipLaunch = process.env.DEV3000_CDP_SKIP_LAUNCH === "1"
      const externalCdpConfigured = cdpUrl && skipLaunch

      console.log(chalk.red("\n════════════════════════════════════════════════════════════════"))
      console.log(chalk.red("⚠️  CDP MONITORING SETUP FAILED"))
      console.log(chalk.red("════════════════════════════════════════════════════════════════\n"))

      console.log(chalk.yellow("📋 CDP Configuration:"))
      console.log(chalk.cyan(`   DEV3000_CDP_URL: ${cdpUrl || "(not set)"}`))
      console.log(chalk.cyan(`   DEV3000_CDP_SKIP_LAUNCH: ${skipLaunch ? "1 (enabled)" : "(not set)"}`))
      console.log(chalk.cyan(`   External CDP Mode: ${externalCdpConfigured ? "Yes" : "No"}`))
      console.log("")

      console.log(chalk.yellow("❌ Error Details:"))
      if (error instanceof Error) {
        console.log(chalk.red(`   ${error.message}`))
        if (error.stack) {
          console.log(chalk.gray(`   Stack: ${error.stack.split("\n").slice(0, 3).join("\n   ")}`))
        }
      } else {
        console.log(chalk.red(`   ${error}`))
      }
      console.log("")

      if (externalCdpConfigured) {
        // External CDP configured (Docker/WSL2 mode)
        console.log(chalk.yellow("🔍 Troubleshooting External CDP (Docker/WSL2):"))
        console.log(chalk.cyan("   1. Verify Chrome is running on host with CDP enabled:"))
        console.log(
          chalk.white(`      Windows: chrome.exe --remote-debugging-port=9222 --remote-debugging-address=0.0.0.0`)
        )
        console.log(
          chalk.white(`      Linux/Mac: google-chrome --remote-debugging-port=9222 --remote-debugging-address=0.0.0.0`)
        )
        console.log("")
        console.log(chalk.cyan("   2. Test CDP connectivity from container:"))
        console.log(
          chalk.white(`      docker exec -it <container> curl -v http://host.docker.internal:9222/json/version`)
        )
        console.log("")
        console.log(chalk.cyan("   3. Check network configuration:"))
        console.log(chalk.white(`      - Ensure host.docker.internal resolves correctly`))
        console.log(chalk.white(`      - Verify firewall allows port 9222`))
        console.log(chalk.white(`      - Check Docker network mode (bridge/host)`))
        console.log("")
        console.log(chalk.cyan("   4. Verify Chrome CDP endpoint accessibility:"))
        console.log(chalk.white(`      curl http://localhost:9222/json/version  # from host`))
        console.log("")
        console.log(chalk.yellow("ℹ️  Continuing in servers-only mode (no browser monitoring)"))
        console.log(
          chalk.cyan("📝 Server logs will still be captured, but browser console/network logs will not be available")
        )
        console.log(chalk.cyan("🖥️  Use Chrome DevTools or browser extensions for client-side debugging"))
        console.log(chalk.red("\n════════════════════════════════════════════════════════════════\n"))
        return
      } else {
        // Local mode (Chrome should be launched automatically)
        console.log(chalk.yellow("🔍 Troubleshooting Local Chrome Launch:"))
        console.log(chalk.cyan("   1. Chrome installation paths checked:"))
        console.log(chalk.white(`      - Chrome not found in standard locations`))
        console.log("")
        console.log(chalk.cyan("   2. For Docker/WSL2 environments, configure external CDP:"))
        console.log(chalk.white(`      export DEV3000_CDP_URL="http://host.docker.internal:9222"`))
        console.log(chalk.white(`      export DEV3000_CDP_SKIP_LAUNCH="1"`))
        console.log("")
        console.log(chalk.cyan("   3. Or use servers-only mode:"))
        console.log(chalk.white(`      dev3000 --servers-only`))
        console.log("")
        console.log(chalk.red("❌ CDP monitoring is critical in local mode - shutting down"))
        console.log(chalk.red("════════════════════════════════════════════════════════════════\n"))
        // CDP monitoring is critical - shutdown if it fails (only if not using external CDP)
        this.gracefulShutdown()
        throw error
      }
    }
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
    this.logger.debug("Initializing CDP monitor")
    this.cdpMonitor = new CDPMonitor(
      this.options.profileDir,
      this.mcpPublicDir,
      (_source: string, message: string) => {
        this.fileLogger.log("browser", message)
      },
      this.logger, // Pass structured logger
      this.options.browser,
      this.options.pluginReactScan,
      this.options.port, // App server port to monitor
      this.options.mcpPort // MCP server port to ignore
    )

    try {
      // Set up callback for when Chrome window is manually closed
      this.cdpMonitor.setOnWindowClosedCallback(() => {
        this.debugLog("Chrome window closed callback triggered, initiating graceful shutdown")
        this.fileLogger.log("browser", "[CDP] Chrome window was manually closed, shutting down d3k")
        // Trigger graceful shutdown
        this.gracefulShutdown()
      })

      // Start CDP monitoring
      await this.cdpMonitor.start()
      this.fileLogger.log("browser", "[CDP] Chrome launched with DevTools Protocol monitoring")

      // Update session info with CDP URL and Chrome PIDs now that we have them
      const projectName = getProjectName()
      const cdpUrl = this.cdpMonitor.getCdpUrl()
      const chromePids = this.cdpMonitor.getChromePids()

      // Start screencast manager for automatic jank detection
      if (cdpUrl) {
        this.screencastManager = new ScreencastManager(
          cdpUrl,
          (msg: string) => {
            // Pass through CDP messages directly - they already have their own category tags
            this.fileLogger.log("browser", msg)
          },
          this.options.port.toString()
        )
        await this.screencastManager.start()
        // this.fileLogger.log("browser", "[Screencast] Auto-capture enabled for navigation events")
      }

      if (cdpUrl || chromePids.length > 0) {
        writeSessionInfo(
          projectName,
          this.options.logFile,
          this.options.port,
          this.options.mcpPort,
          cdpUrl || undefined,
          chromePids,
          this.options.serverCommand
        )
        this.debugLog(`Updated session info with CDP URL: ${cdpUrl}, Chrome PIDs: [${chromePids.join(", ")}]`)
      }

      // Navigate to the app
      await this.cdpMonitor.navigateToApp(this.options.port)
      this.fileLogger.log("browser", `[CDP] Navigated to http://localhost:${this.options.port}`)
    } catch (error) {
      // Log error and throw to trigger graceful shutdown
      this.fileLogger.log("browser", `[CDP] Failed to start CDP monitoring: ${error}`)
      throw error
    }
  }

  private async gracefulShutdown() {
    if (this.isShuttingDown) return // Prevent multiple shutdown attempts
    this.isShuttingDown = true

    // Stop health monitoring
    this.stopHealthCheck()

    // Stop screencast manager
    if (this.screencastManager) {
      await this.screencastManager.stop()
      this.screencastManager = null
    }

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
    const projectName = getProjectName()
    console.log(
      chalk.yellow(
        `Check the logs at ~/.d3k/logs/${projectName}-d3k.log for errors. Feeling like helping? Run dev3000 --debug and file an issue at https://github.com/vercel-labs/dev3000/issues`
      )
    )
    process.exit(1)
  }

  private setupCleanupHandlers() {
    this.debugLog(`Setting up cleanup handlers for ${this.options.tui ? "TUI" : "debug"} mode`)

    // Handle Ctrl+C to kill all processes
    process.on("SIGINT", () => {
      this.debugLog("SIGINT received")
      const now = Date.now()

      // If first Ctrl+C or more than 3 seconds since last one
      if (!this.firstSigintTime || now - this.firstSigintTime > 3000) {
        this.firstSigintTime = now
        this.debugLog("First Ctrl+C detected")

        if (this.options.tui && this.tui) {
          // In TUI mode, update the TUI status to show warning
          this.debugLog("Updating TUI status with warning")
          this.tui.updateStatus("⚠️ Press Ctrl+C again to quit")

          // Clear the message after 3 seconds
          setTimeout(() => {
            if (this.tui && !this.isShuttingDown) {
              this.debugLog("Clearing TUI warning message")
              this.tui.updateStatus(null)
            }
          }, 3000)
        } else {
          console.log(chalk.yellow("\n⚠️ Press Ctrl+C again to quit"))
        }
        return
      }

      // Second Ctrl+C - proceed with shutdown
      if (this.isShuttingDown) return // Prevent multiple shutdown attempts
      this.isShuttingDown = true
      this.debugLog("Second Ctrl+C detected, starting shutdown")

      if (this.options.tui && this.tui) {
        // In TUI mode, show shutting down message
        this.debugLog("Updating TUI status with shutdown message")
        this.tui.updateStatus("Shutting down...")
      }

      // Set a timeout to force exit if shutdown takes too long
      const forceExitTimeout = setTimeout(() => {
        this.debugLog("Shutdown timeout reached, forcing exit")
        process.exit(1)
      }, 5000) // 5 second timeout

      // Call async cleanup in a non-blocking way
      this.handleShutdown()
        .then(() => {
          clearTimeout(forceExitTimeout)
          this.debugLog("Graceful shutdown completed")
          process.exit(0)
        })
        .catch((error) => {
          clearTimeout(forceExitTimeout)
          this.debugLog(`Shutdown error: ${error}`)
          process.exit(1)
        })
    })

    // Also handle SIGTERM
    process.on("SIGTERM", () => {
      if (this.isShuttingDown) return
      this.isShuttingDown = true

      this.handleShutdown()
        .then(() => {
          process.exit(0)
        })
        .catch(() => {
          process.exit(1)
        })
    })
  }

  private async handleShutdown() {
    // Stop health monitoring
    this.stopHealthCheck()

    // Release the lock file
    this.releaseLock()

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

    // Shutdown CDP monitor FIRST - this should close Chrome
    if (this.cdpMonitor) {
      try {
        if (!this.options.tui) {
          console.log(chalk.cyan("🔄 Closing Chrome browser..."))
        }
        await this.cdpMonitor.shutdown()
        if (!this.options.tui) {
          console.log(chalk.green("✅ Chrome browser closed"))
        }
      } catch (_error) {
        if (!this.options.tui) {
          console.log(chalk.gray("⚠️ Chrome shutdown failed"))
        }

        // Fallback: force kill any remaining Chrome processes for THIS instance only
        try {
          const projectName = getProjectName()
          const chromePids = getSessionChromePids(projectName)

          if (chromePids.length > 0) {
            this.debugLog(`Fallback cleanup: killing Chrome PIDs for this instance: [${chromePids.join(", ")}]`)
            const { spawn } = await import("child_process")

            for (const pid of chromePids) {
              try {
                spawn("kill", ["-9", pid.toString()], { stdio: "ignore" })
              } catch {
                // Ignore individual kill errors
              }
            }
          } else {
            this.debugLog("Fallback cleanup: no Chrome PIDs found for this instance")
          }
        } catch {
          // Ignore errors in fallback cleanup
        }
      }
    }

    // REMOVED: No longer clean up MCP config files on shutdown
    // This was causing Claude Code instances to crash when dev3000 was killed
    // Now we keep .mcp.json, .cursor/mcp.json, and .opencode.json configured
    // for the next dev3000 run, providing a better developer experience

    // Kill processes on both ports
    const killPortProcess = async (port: string, name: string) => {
      try {
        const { spawn } = await import("child_process")

        // First, find PIDs on the port
        const findPids = spawn("lsof", ["-ti", `:${port}`], { stdio: "pipe" })
        let pidsOutput = ""

        findPids.stdout?.on("data", (data) => {
          pidsOutput += data.toString()
        })

        return new Promise<void>((resolve) => {
          findPids.on("exit", (code) => {
            if (code === 0 && pidsOutput.trim()) {
              // Found PIDs, now kill them
              const pids = pidsOutput.trim().split("\n").filter(Boolean)
              this.debugLog(`Found PIDs on port ${port}: [${pids.join(", ")}]`)

              // Kill each PID individually
              let killedCount = 0
              for (const pid of pids) {
                try {
                  process.kill(parseInt(pid.trim(), 10), "SIGKILL")
                  killedCount++
                  this.debugLog(`Killed PID ${pid} on port ${port}`)
                } catch (error) {
                  this.debugLog(`Failed to kill PID ${pid}: ${error}`)
                }
              }

              if (killedCount > 0 && !this.options.tui) {
                console.log(chalk.green(`✅ Killed ${killedCount} ${name} process(es) on port ${port}`))
              }
            } else {
              this.debugLog(`No processes found on port ${port} (exit code: ${code})`)
              if (!this.options.tui) {
                console.log(chalk.gray(`ℹ️ No ${name} running on port ${port}`))
              }
            }
            resolve()
          })
        })
      } catch (error) {
        this.debugLog(`Error killing processes on port ${port}: ${error}`)
        if (!this.options.tui) {
          console.log(chalk.gray(`⚠️ Could not kill ${name} on port ${port}`))
        }
      }
    }

    // Kill app server (MCP server remains as singleton)
    if (!this.options.tui) {
      console.log(chalk.yellow("🔄 Killing app server..."))
    }
    await killPortProcess(this.options.port, "your app server")

    // Add a small delay to let the kill process complete
    await new Promise((resolve) => setTimeout(resolve, 100))

    // Double-check: try to kill any remaining processes on the app port
    try {
      const { spawn } = await import("child_process")
      spawn("sh", ["-c", `pkill -f ":${this.options.port}"`], { stdio: "ignore" })
      this.debugLog(`Sent pkill signal for port ${this.options.port}`)
    } catch {
      // Ignore pkill errors
    }

    if (!this.options.tui) {
      console.log(chalk.green("✅ Cleanup complete"))
    }
  }
}

export async function startDevEnvironment(options: DevEnvironmentOptions) {
  // Clear terminal before starting TUI (unless in servers-only or debug mode)
  if (options.tui && !options.serversOnly && !options.debug) {
    // ANSI escape codes: clear screen + move cursor to top-left
    process.stdout.write("\x1b[2J\x1b[0f")
  }

  const devEnv = new DevEnvironment(options)
  await devEnv.start()
}
