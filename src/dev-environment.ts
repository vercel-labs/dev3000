import chalk from "chalk"
import { type ChildProcess, spawn } from "child_process"
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync
} from "fs"
import https from "https"
import ora from "ora"
import { homedir, tmpdir } from "os"
import { dirname, join, resolve, sep } from "path"
import { fileURLToPath } from "url"
import { CDPMonitor } from "./cdp-monitor.js"
import { ScreencastManager } from "./screencast-manager.js"
import { type LogEntry, NextJsErrorDetector, OutputProcessor, StandardLogParser } from "./services/parsers/index.js"
import { getBundledSkillsPath, listAvailableSkills } from "./skills/index.js"
import { DevTUI } from "./tui-interface.js"
import { getProjectDir, getProjectDisplayName, getProjectName } from "./utils/project-name.js"
import {
  getApplicablePackages,
  getSkillsPathForLocation,
  installSkillPackage,
  isPackageInstalled,
  type SkillsAgentId
} from "./utils/skill-installer.js"
import { formatTimestamp } from "./utils/timestamp.js"
import {
  checkForUpdates,
  initTelemetrySession,
  performUpgradeAsync,
  sendSessionEndTelemetry
} from "./utils/version-check.js"

// Declare the compile-time injected version (set by bun build --define)
declare const __D3K_VERSION__: string | undefined

// Vercel tools URL (legacy, kept for potential future use)
// @ts-expect-error Unused but kept for reference
const _VERCEL_TOOLS_URL = "https://mcp.vercel.com"

/**
 * Check if the current project has a .vercel directory (indicating a Vercel project)
 * Kept for potential future use
 */
// @ts-expect-error Unused but kept for potential future use
function _hasVercelProject(): boolean {
  return existsSync(join(process.cwd(), ".vercel"))
}

/**
 * Options for graceful process termination.
 */
export interface GracefulKillOptions {
  /** Process ID to terminate */
  pid: number
  /** Delay in ms to wait for graceful shutdown (default: 500) */
  gracePeriodMs?: number
  /** Function to send signals (for testing) */
  killFn?: (pid: number, signal: NodeJS.Signals | number) => void
  /** Function to delay (for testing) */
  delayFn?: (ms: number) => Promise<void>
  /** Optional debug logger */
  debugLog?: (msg: string) => void
}

/**
 * Result of graceful kill operation.
 */
export interface GracefulKillResult {
  /** Whether the process was terminated */
  terminated: boolean
  /** Whether graceful shutdown succeeded (SIGTERM was enough) */
  graceful: boolean
  /** Whether force kill (SIGKILL) was needed */
  forcedKill: boolean
}

/**
 * Gracefully terminate a process by first trying SIGTERM, waiting for graceful
 * shutdown, then falling back to SIGKILL if needed.
 *
 * This is important for processes like Next.js dev server that need to clean up
 * resources (like .next/dev/lock) before exiting.
 *
 * @param options - Kill options including PID and optional overrides for testing
 * @returns Result indicating how the process was terminated
 */
export async function gracefulKillProcess(options: GracefulKillOptions): Promise<GracefulKillResult> {
  const {
    pid,
    gracePeriodMs = 500,
    killFn = (p, s) => process.kill(p, s),
    delayFn = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    debugLog = () => {}
  } = options

  const result: GracefulKillResult = {
    terminated: false,
    graceful: false,
    forcedKill: false
  }

  // Try process group first (negative PID), fall back to direct PID
  const pgid = -pid

  // Step 1: Send SIGTERM for graceful shutdown
  debugLog(`Sending SIGTERM to process group ${pgid} (PID: ${pid})`)
  try {
    killFn(pgid, "SIGTERM")
  } catch {
    // Process group may not exist, try direct kill
    try {
      killFn(pid, "SIGTERM")
    } catch {
      // Process may already be dead
      debugLog(`Process ${pid} not found for SIGTERM`)
      return result
    }
  }

  // Step 2: Wait for graceful shutdown
  await delayFn(gracePeriodMs)

  // Step 3: Check if process is still running
  try {
    // Signal 0 checks if process exists without killing it
    killFn(pid, 0)

    // Process still running, need to force kill
    debugLog(`Process still running after SIGTERM, sending SIGKILL`)
    try {
      killFn(pgid, "SIGKILL")
    } catch {
      killFn(pid, "SIGKILL")
    }
    result.terminated = true
    result.forcedKill = true
  } catch {
    // Process already dead - graceful shutdown succeeded
    debugLog(`Process terminated gracefully after SIGTERM`)
    result.terminated = true
    result.graceful = true
  }

  return result
}

interface DevEnvironmentOptions {
  port: string
  serverCommand: string
  profileDir: string
  logFile: string
  debug?: boolean
  serversOnly?: boolean
  commandName: string
  browser?: string
  defaultPort?: string // Default port from project type detection
  framework?: "nextjs" | "svelte" | "other" // Framework type from project detection
  userSetPort?: boolean // Whether user explicitly set the port
  tail?: boolean // Whether to tail the log file to terminal
  tui?: boolean // Whether to use TUI mode (default true)
  dateTimeFormat?: "local" | "utc" // Timestamp format option
  pluginReactScan?: boolean // Whether to enable react-scan performance monitoring
  debugPort?: number // Chrome debugging port (default 9222, auto-incremented for multiple instances)
  headless?: boolean // Run Chrome in headless mode (for serverless/CI environments)
  withAgent?: string // Command to run an embedded agent (e.g. "claude --dangerously-skip-permissions")
  skillsAgentId?: string // Selected agent id for skills/d3k skill placement
  autoSkills?: boolean // Auto-install recommended skills (non-interactive)
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

/**
 * Detect if we're in a sandbox environment (Vercel Sandbox, Docker, etc.)
 * where lsof and other system utilities may not be available.
 */
function isInSandbox(): boolean {
  return (
    process.env.VERCEL_SANDBOX === "1" ||
    process.env.VERCEL === "1" ||
    existsSync("/.dockerenv") ||
    existsSync("/run/.containerenv")
  )
}

/**
 * Count active d3k instances by checking PID files in tmpdir.
 * Returns the count of running d3k processes (excluding the current one if specified).
 *
 * CRITICAL FOR PROCESS CLEANUP:
 * This function is used to reason about multi-instance shutdown behavior.
 */
export function countActiveD3kInstances(excludeCurrentPid: boolean = false): number {
  try {
    const tmpDir = tmpdir()
    const files = readdirSync(tmpDir)
    const pidFiles = files.filter((f) => f.startsWith("dev3000-") && f.endsWith(".pid"))

    let activeCount = 0
    for (const pidFile of pidFiles) {
      try {
        const pidPath = join(tmpDir, pidFile)
        const pidStr = readFileSync(pidPath, "utf-8").trim()
        const pid = parseInt(pidStr, 10)

        if (Number.isNaN(pid)) continue

        // Skip current process if requested
        if (excludeCurrentPid && pid === process.pid) continue

        // Check if process is still running (signal 0 just checks existence)
        process.kill(pid, 0)
        activeCount++
      } catch {
        // Process doesn't exist or can't be signaled - not active
      }
    }

    return activeCount
  } catch {
    // Can't read tmpdir - assume we're the only one
    return excludeCurrentPid ? 0 : 1
  }
}

/**
 * Check if a port is available for binding (no process is listening on it).
 * Used for finding available ports before starting servers.
 * In sandbox environments, skips checking since lsof often doesn't exist.
 */
async function isPortAvailable(port: string): Promise<boolean> {
  // In sandboxed environments, skip port checking - lsof often doesn't exist
  // and port conflicts are rare due to process isolation
  if (isInSandbox()) {
    return true
  }

  // Regular environment - do proper port checking with lsof
  try {
    // Check if lsof command exists first
    const checkCmd = process.platform === "win32" ? "where" : "which"
    try {
      await new Promise<void>((resolve, reject) => {
        const check = spawn(checkCmd, ["lsof"], { stdio: "pipe" })
        check.on("error", reject)
        check.on("exit", (code) => {
          if (code === 0) resolve()
          else reject(new Error("lsof not found"))
        })
      })
    } catch {
      // lsof doesn't exist, assume port is available
      return true
    }

    // lsof exists, use it to check the port
    const result = await new Promise<string>((resolve, reject) => {
      const proc = spawn("lsof", ["-ti", `:${port}`], { stdio: "pipe" })
      let output = ""

      proc.on("error", (err) => {
        reject(err)
      })

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

/**
 * Check if a server is actually listening and responding on a port.
 * Used for waiting for a dev server to start up.
 * Works in all environments including sandboxes by using HTTP requests.
 */
export interface ServerListeningResult {
  listening: boolean
  https: boolean
}

export async function isServerListening(port: string | number): Promise<ServerListeningResult> {
  // Try HTTP first
  if (await tryHttpConnection(port)) {
    return { listening: true, https: false }
  }
  // Fall back to HTTPS (for servers using --experimental-https or similar)
  if (await tryHttpsConnection(port)) {
    return { listening: true, https: true }
  }
  return { listening: false, https: false }
}

export async function tryHttpConnection(port: string | number): Promise<boolean> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 2000)

    try {
      await fetch(`http://localhost:${port}/`, {
        method: "HEAD",
        signal: controller.signal
      })
      clearTimeout(timeout)
      // Any response (even 4xx/5xx) means server is listening
      return true
    } catch (error: unknown) {
      clearTimeout(timeout)
      const errorMsg = error instanceof Error ? error.message : String(error)
      // ECONNREFUSED means no server is listening
      // AbortError means timeout (server might be starting)
      if (errorMsg.includes("ECONNREFUSED") || errorMsg.includes("fetch failed") || errorMsg.includes("aborted")) {
        return false
      }
      // Other errors (like network issues) - assume not listening
      return false
    }
  } catch {
    return false
  }
}

export async function tryHttpsConnection(port: string | number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: "localhost",
        port: Number(port),
        path: "/",
        method: "HEAD",
        rejectUnauthorized: false, // Accept self-signed certificates
        timeout: 2000
      },
      () => {
        // Any response means server is listening
        req.destroy()
        resolve(true)
      }
    )

    req.on("error", () => {
      req.destroy()
      resolve(false)
    })

    req.on("timeout", () => {
      req.destroy()
      resolve(false)
    })

    req.end()
  })
}

export async function findAvailablePort(startPort: number): Promise<string> {
  let port = startPort
  while (port < 65535) {
    if (await isPortAvailable(port.toString())) {
      return port.toString()
    }
    port++
  }
  throw new Error(`No available ports found starting from ${startPort}`)
}

// REMOVED: isNextjsMcpEnabled check - now using framework detection from cli.ts
// Framework detection happens in cli.ts and is stored in session files for CLI integration

/**
 * Ensure d3k skill is installed in project's skills directory.
 * Claude Code reads from .claude/skills/ (must be real files, not symlinks).
 */
async function ensureD3kSkill(skillsAgentId?: string): Promise<void> {
  try {
    const bundledSkillsDir = getBundledSkillsPath()
    if (!bundledSkillsDir) return

    const bundledSkillPath = join(bundledSkillsDir, "d3k", "SKILL.md")
    if (!existsSync(bundledSkillPath)) return

    const targetSkillsDir = skillsAgentId ? getSkillsPathForLocation(skillsAgentId, "project")?.path : null

    const skillRoots = new Set<string>()

    // Install directly to the agent-specific skills dir (fallback to .agents)
    const defaultSkillsRoot = join(process.cwd(), ".agents", "skills")
    skillRoots.add(targetSkillsDir || defaultSkillsRoot)

    // Ensure Claude Code can load the skill from .claude/skills when applicable
    if (skillsAgentId === "claude-code") {
      skillRoots.add(join(process.cwd(), ".claude", "skills"))
    }

    const bundledContent = readFileSync(bundledSkillPath, "utf-8")

    for (const skillsRoot of skillRoots) {
      const skillDir = join(skillsRoot, "d3k")
      const skillPath = join(skillDir, "SKILL.md")

      if (existsSync(skillPath)) {
        const existingContent = readFileSync(skillPath, "utf-8")
        if (existingContent === bundledContent) {
          continue
        }
      }

      if (!existsSync(skillDir)) {
        mkdirSync(skillDir, { recursive: true })
      }
      copyFileSync(bundledSkillPath, skillPath)
    }
  } catch (_error) {
    // Ignore errors - skill installation is optional
  }
}

async function autoInstallSkills(agentId: SkillsAgentId | undefined, debugLog: (msg: string) => void): Promise<void> {
  if (!agentId) {
    return
  }

  const packages = getApplicablePackages()
  if (packages.length === 0) {
    return
  }

  for (const pkg of packages) {
    if (isPackageInstalled(pkg, agentId)) {
      continue
    }

    debugLog(`Auto-installing skill package: ${pkg.repo}`)
    const result = await installSkillPackage(pkg, "project", agentId)
    if (!result.success) {
      debugLog(`Skill install failed for ${pkg.repo}: ${result.error || "unknown error"}`)
    }
  }
}

// REMOVED: cleanup functions are no longer needed
// CLI integration config files are now kept persistent across dev3000 restarts

export function createPersistentLogFile(): string {
  // Get unique project name
  const projectName = getProjectName()

  // Use ~/.d3k/{projectName}/logs directory for persistent, accessible logs
  const logBaseDir = join(getProjectDir(), "logs")
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

/**
 * Write session info for external tooling to discover.
 *
 * CRITICAL FOR PROCESS CLEANUP:
 * This writes the session.json file that contains chromePids and serverPid.
 * These PIDs are read during shutdown to kill the correct processes.
 *
 * The chromePids array is particularly important - it tracks which Chrome
 * processes belong to THIS d3k instance so we don't accidentally kill
 * Chrome instances from other d3k sessions.
 */
export function writeSessionInfo(
  projectName: string,
  logFilePath: string,
  appPort: string,
  cdpUrl?: string | null,
  chromePids?: number[],
  serverCommand?: string,
  framework?: "nextjs" | "svelte" | "other",
  serverPid?: number,
  skillsInstalled?: string[],
  skillsAgentId?: string | null
): void {
  const projectDir = getProjectDir()

  try {
    // Create project directory if it doesn't exist
    if (!existsSync(projectDir)) {
      mkdirSync(projectDir, { recursive: true })
    }

    // Session file contains project info
    const sessionInfo = {
      projectName,
      logFilePath,
      appPort,
      cdpUrl: cdpUrl || null,
      startTime: new Date().toISOString(),
      pid: process.pid,
      cwd: process.cwd(),
      chromePids: chromePids || [],
      serverCommand: serverCommand || null,
      framework: framework || null,
      serverPid: serverPid || null,
      skillsInstalled: skillsInstalled || [],
      skillsAgentId: skillsAgentId || null
    }

    // Write session file in project directory
    const sessionFile = join(projectDir, "session.json")
    writeFileSync(sessionFile, JSON.stringify(sessionInfo, null, 2))
  } catch (error) {
    // Non-fatal - just log a warning
    console.warn(chalk.yellow(`⚠️ Could not write session info: ${error}`))
  }
}

/**
 * Get Chrome PIDs for a d3k session from the session.json file.
 *
 * CRITICAL FOR PROCESS CLEANUP:
 * Chrome PIDs are stored in session.json and used during shutdown to kill
 * the specific Chrome instances spawned by THIS d3k instance.
 *
 * The SIGHUP handler uses this to synchronously kill Chrome on tmux close
 * before the process terminates.
 *
 * @param projectName - The project name (used to locate session.json)
 * @returns Array of Chrome PIDs, or empty array if none found
 */
type SessionInfo = {
  serverPid: number | null
  chromePids: number[]
  cwd: string | null
}

function getSessionInfo(projectName: string): SessionInfo | null {
  const sessionFile = join(homedir(), ".d3k", projectName, "session.json")

  try {
    if (existsSync(sessionFile)) {
      const sessionInfo = JSON.parse(readFileSync(sessionFile, "utf8")) as {
        serverPid?: number | null
        chromePids?: number[]
        cwd?: string | null
      }
      return {
        serverPid: sessionInfo.serverPid ?? null,
        chromePids: sessionInfo.chromePids ?? [],
        cwd: sessionInfo.cwd ?? null
      }
    }
  } catch (_error) {
    // Non-fatal - return null
  }
  return null
}

export function getSessionChromePids(projectName: string): number[] {
  return getSessionInfo(projectName)?.chromePids ?? []
}

function createLogFileInDir(baseDir: string, _projectName: string): string {
  // Create short timestamp: MMDD-HHmmss (e.g., 0106-171301)
  const now = new Date()
  const timestamp = [
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
    "-",
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
    String(now.getSeconds()).padStart(2, "0")
  ].join("")

  // Create log file path (project name already in directory path)
  const logFileName = `${timestamp}.log`
  const logFilePath = join(baseDir, logFileName)

  // Prune old logs (keep only 10 most recent)
  pruneOldLogs(baseDir)

  // Create the log file
  writeFileSync(logFilePath, "")

  return logFilePath
}

function pruneOldLogs(baseDir: string): void {
  try {
    // Find all log files in directory
    const files = readdirSync(baseDir)
      .filter((file) => file.endsWith(".log"))
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
  } catch (_error) {
    // Silently ignore prune errors
  }
}

export class DevEnvironment {
  private serverProcess: ChildProcess | null = null
  private cdpMonitor: CDPMonitor | null = null
  private screencastManager: ScreencastManager | null = null
  private logger: Logger
  private outputProcessor: OutputProcessor
  private options: DevEnvironmentOptions
  private screenshotDir: string
  private pidFile: string
  private lockFile: string
  private spinner: ReturnType<typeof ora>
  private version: string
  private isShuttingDown: boolean = false
  private serverStartTime: number | null = null
  private healthCheckTimer: NodeJS.Timeout | null = null
  private tui: DevTUI | null = null
  private portChangeMessage: string | null = null
  private portDetected: boolean = false
  private serverUsesHttps: boolean = false

  /** Returns "https" or "http" based on detected server protocol */
  private get serverProtocol(): "http" | "https" {
    return this.serverUsesHttps ? "https" : "http"
  }

  constructor(options: DevEnvironmentOptions) {
    this.options = { ...options }
    this.logger = new Logger(options.logFile, options.tail || false, options.dateTimeFormat || "local")
    this.outputProcessor = new OutputProcessor(new StandardLogParser(), new NextJsErrorDetector())

    // Detect if running from compiled binary
    const execPath = process.execPath
    const isCompiledBinary =
      execPath.includes("@d3k/darwin-") || execPath.includes("d3k-darwin-") || execPath.endsWith("/dev3000")

    let packageRoot: string
    if (isCompiledBinary) {
      // For compiled binaries: bin/dev3000 -> package root
      const binDir = dirname(execPath)
      packageRoot = dirname(binDir)
    } else {
      // Normal install: dist/dev-environment.js -> package root
      const currentFile = fileURLToPath(import.meta.url)
      packageRoot = dirname(dirname(currentFile))
    }

    // Store screenshots in project-specific directory for local access
    const projectName = getProjectName()
    this.screenshotDir = join(getProjectDir(), "screenshots")
    // Use project-specific PID and lock files to allow multiple projects to run simultaneously
    this.pidFile = join(tmpdir(), `dev3000-${projectName}.pid`)
    this.lockFile = join(tmpdir(), `dev3000-${projectName}.lock`)

    // Allow CLI-level crash handlers to trigger emergency cleanup.
    globalThis.__d3kEmergencyShutdown = (reason: string, error?: unknown) => {
      this.emergencyShutdown(1, reason, error)
    }

    // Read version - for compiled binaries, use injected version; otherwise read from package.json
    this.version = "0.0.0"
    // Check for compile-time injected version first
    if (typeof __D3K_VERSION__ !== "undefined") {
      this.version = __D3K_VERSION__
    } else {
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
    }

    // Initialize spinner for clean output management (only if not in TUI mode)
    this.spinner = ora({
      text: "Initializing...",
      spinner: "dots",
      isEnabled: !options.tui && !options.tail // Disable spinner in TUI mode
    })

    // Ensure screenshot directory exists
    try {
      if (!existsSync(this.screenshotDir)) {
        mkdirSync(this.screenshotDir, { recursive: true })
      }
    } catch {
      // Fall back to temp directory if project dir isn't writable
      this.screenshotDir = join(tmpdir(), "d3k-screenshots")
      if (!existsSync(this.screenshotDir)) {
        mkdirSync(this.screenshotDir, { recursive: true })
      }
    }

    // Initialize project-specific D3K log file (clear for new session)
    this.initializeD3KLog()
  }

  private async checkPortsAvailable(silent: boolean = false) {
    // No legacy server to clean up; continue with port checks.

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

    // Legacy server removed - only check app port availability
  }

  private async checkProcessHealth(): Promise<boolean> {
    if (this.isShuttingDown) return true // Skip health check if already shutting down

    // In sandbox environments, skip lsof-based health checks since lsof doesn't exist
    // Trust that the sandbox manages process lifecycle
    if (isInSandbox()) {
      this.debugLog("Health check skipped: Running in sandbox environment")
      return true
    }

    try {
      // Only check app port - legacy server has been removed
      const ports = [this.options.port]

      for (const port of ports) {
        const result = await new Promise<string>((resolve, reject) => {
          const proc = spawn("lsof", ["-ti", `:${port}`], { stdio: "pipe" })
          let output = ""
          proc.stdout?.on("data", (data) => {
            output += data.toString()
          })
          proc.on("error", (err) => reject(err))
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

  private emergencyShutdown(exitCode: number, reason: string, error?: unknown) {
    if (this.isShuttingDown) return
    this.isShuttingDown = true
    this.debugLog(`Emergency shutdown requested (${reason})`)
    if (error) {
      const errorText = error instanceof Error ? error.stack || error.message : String(error)
      this.debugLog(`Emergency shutdown error: ${errorText}`)
    }

    // Stop CDP reconnection attempts before killing the app server.
    if (this.cdpMonitor) {
      this.cdpMonitor.prepareShutdown()
    }

    // Best-effort synchronous cleanup (mirrors SIGHUP handler).
    const { spawnSync } = require("child_process")
    const port = this.options.port
    this.debugLog(`Synchronous kill for port ${port}`)
    spawnSync("sh", ["-c", `lsof -ti:${port} | xargs kill -9 2>/dev/null`], {
      stdio: "pipe",
      timeout: 5000
    })

    const projectName = getProjectName()
    const sessionInfo = getSessionInfo(projectName)
    const chromePids = sessionInfo?.chromePids ?? []
    if (chromePids.length > 0) {
      this.debugLog(`Synchronously killing Chrome PIDs: [${chromePids.join(", ")}]`)
      for (const pid of chromePids) {
        try {
          process.kill(pid, "SIGTERM")
        } catch {
          // Ignore - process may already be dead
        }
      }
    }

    if (sessionInfo?.serverPid) {
      this.killServerPidIfOwned(sessionInfo.serverPid, sessionInfo.cwd, `emergency:${reason}`)
    }

    this.handleShutdown()
      .then(() => {
        process.exit(exitCode)
      })
      .catch(() => {
        process.exit(exitCode)
      })
  }

  async start() {
    // Check if another instance is already running for this project
    if (!this.acquireLock()) {
      console.error(chalk.red(`\n❌ Another dev3000 instance is already running for this project.`))
      console.error(chalk.yellow(`   If you're sure no other instance is running, remove: ${this.lockFile}`))
      process.exit(1)
    }

    // Initialize telemetry session (used by version check)
    initTelemetrySession(this.options.framework)

    // Kill any orphaned server process from a previous run of this project
    this.cleanupOrphanedServer()

    // Check if TUI mode is enabled (default) and stdin supports it
    const canUseTUI = this.options.tui && process.stdin.isTTY

    if (!canUseTUI && this.options.tui) {
      this.debugLog("TTY not available, falling back to non-TUI mode")
    }

    if (canUseTUI) {
      // Get unique project name
      const projectName = getProjectName()
      const projectDisplayName = getProjectDisplayName()

      // Check for updates in parallel with TUI startup (non-blocking)
      const updateCheckPromise = checkForUpdates().catch(() => null)

      // Start TUI interface with initial status and updated port
      this.tui = new DevTUI({
        appPort: this.options.port, // This may have been updated by checkPortsAvailable
        logFile: this.options.logFile,
        commandName: this.options.commandName,
        serversOnly: this.options.serversOnly,
        version: this.version,
        projectName: projectDisplayName,
        updateInfo: null, // Will be updated async after auto-upgrade
        onRequestShutdown: () => {
          // Direct shutdown callback from TUI - bypasses signal handling
          if (this.isShuttingDown) return
          this.isShuttingDown = true
          this.debugLog("TUI requested shutdown via callback")

          // Signal CDP monitor to stop reconnection attempts BEFORE killing the app server
          if (this.cdpMonitor) {
            this.cdpMonitor.prepareShutdown()
          }

          // CRITICAL: Kill port processes SYNCHRONOUSLY first, before anything else
          // This ensures cleanup happens even if the event loop gets interrupted
          const { spawnSync } = require("child_process")
          const port = this.options.port
          this.debugLog(`Synchronous kill for port ${port}`)
          spawnSync("sh", ["-c", `lsof -ti:${port} | xargs kill -9 2>/dev/null`], {
            stdio: "pipe",
            timeout: 5000
          })

          const projectName = getProjectName()
          const chromePids = getSessionChromePids(projectName)
          if (chromePids.length > 0) {
            this.debugLog(`Synchronous kill for Chrome PIDs: [${chromePids.join(", ")}]`)
            for (const pid of chromePids) {
              try {
                process.kill(pid, "SIGTERM")
                process.kill(pid, 0)
                process.kill(pid, "SIGKILL")
              } catch {
                // Ignore - process may already be dead
              }
            }
          }

          // Now do the rest of cleanup async
          this.tui?.updateStatus("Shutting down...")
          this.handleShutdown()
            .then(() => {
              this.debugLog("Shutdown complete")
              process.exit(0)
            })
            .catch((error) => {
              this.debugLog(`Shutdown error: ${error}`)
              process.exit(1)
            })
        }
      })

      await this.tui.start()

      // Auto-upgrade if update available (non-blocking)
      updateCheckPromise.then(async (versionInfo) => {
        if (versionInfo?.updateAvailable && versionInfo.latestVersion && this.tui) {
          this.debugLog(
            `Update available: ${versionInfo.currentVersion} -> ${versionInfo.latestVersion}, auto-upgrading...`
          )
          // Perform upgrade in background
          const result = await performUpgradeAsync()
          if (result.success) {
            const newVersion = result.newVersion || versionInfo.latestVersion
            this.debugLog(`Auto-upgrade successful: ${newVersion}`)
            // Show "Updated to vX.X.X" message (auto-hides after 10s)
            this.tui.updateUpdateInfo({ type: "updated", newVersion })
          } else {
            // Upgrade failed - show update available instead
            this.debugLog(`Auto-upgrade failed: ${result.error}, showing update available`)
            this.tui.updateUpdateInfo({ type: "available", latestVersion: versionInfo.latestVersion })
          }
        }
      })

      // Show initial status message
      await this.tui.updateStatus("d3k is checking for skill updates...")

      // Install d3k skill early so it's available when Claude Code starts
      // This is important for --with-agent where both start simultaneously
      await ensureD3kSkill(this.options.skillsAgentId)
      if (this.options.autoSkills) {
        await autoInstallSkills(this.options.skillsAgentId as SkillsAgentId | undefined, this.debugLog)
      }

      // Check ports in background after TUI is visible
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

      // Legacy tools server removed - using CLI commands instead
      // await this.startMcpServer()

      // Wait for servers to be ready
      await this.tui.updateStatus("Waiting for app...")
      const serverStarted = await this.waitForServer()

      if (!serverStarted) {
        await this.tui.updateStatus("❌ Server failed to start")
        console.error(chalk.red("\n❌ Your app server failed to start after 30 seconds."))
        console.error(chalk.yellow(`Check the logs at ~/.d3k/${getProjectName()}/logs/ for errors.`))
        console.error(chalk.yellow("Exiting without launching browser."))
        process.exit(1)
      }

      // Update TUI with confirmed port (may have changed during server startup)
      this.tui.updateAppPort(this.options.port)

      // Legacy tools server removed - using CLI commands instead
      // await this.waitForMcpServer()

      // Start CDP monitoring only if server started successfully and not in servers-only mode
      if (!this.options.serversOnly && serverStarted) {
        await this.tui.updateStatus(`Starting ${this.options.commandName} browser...`)
        await this.startCDPMonitoringSync()
      } else if (!this.options.serversOnly) {
        this.debugLog("Browser monitoring skipped - server failed to start")
      } else {
        this.debugLog("Browser monitoring disabled via --servers-only flag")
      }

      // Write session info for tooling discovery (include CDP URL if browser monitoring was started)
      const cdpUrl = this.cdpMonitor?.getCdpUrl() || null
      const chromePids = this.cdpMonitor?.getChromePids() || []
      const skillsInstalled = listAvailableSkills(process.cwd())
      writeSessionInfo(
        projectName,
        this.options.logFile,
        this.options.port,
        cdpUrl,
        chromePids,
        this.options.serverCommand,
        this.options.framework,
        this.serverProcess?.pid,
        skillsInstalled,
        this.options.skillsAgentId ?? null
      )

      // Clear status - ready!
      await this.tui.updateStatus(null)
    } else {
      // Non-TUI mode - original flow
      console.log(chalk.hex("#A18CE5")(`Starting ${this.options.commandName} (v${this.version})`))

      // Install d3k skill early so it's available when Claude Code starts
      // This is important for --with-agent where both start simultaneously
      await ensureD3kSkill(this.options.skillsAgentId)
      if (this.options.autoSkills) {
        await autoInstallSkills(this.options.skillsAgentId as SkillsAgentId | undefined, this.debugLog)
      }

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

      // Legacy server removed - using CLI commands instead
      // await this.startMcpServer()

      // Wait for servers to be ready
      this.spinner.text = "Waiting for app..."
      const serverStarted = await this.waitForServer()

      if (!serverStarted) {
        this.spinner.fail("Server failed to start")
        console.error(chalk.red("\n❌ Your app server failed to start after 30 seconds."))
        console.error(chalk.yellow(`Check the logs at ~/.d3k/${getProjectName()}/logs/ for errors.`))
        console.error(chalk.yellow("Exiting without launching browser."))
        process.exit(1)
      }

      // Legacy server removed - using CLI commands instead
      // await this.waitForMcpServer()

      // Start CDP monitoring only if server started successfully and not in servers-only mode
      if (!this.options.serversOnly && serverStarted) {
        this.spinner.text = `Starting ${this.options.commandName} browser...`
        await this.startCDPMonitoringSync()
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
      const skillsInstalled = listAvailableSkills(process.cwd())
      writeSessionInfo(
        projectName,
        this.options.logFile,
        this.options.port,
        cdpUrl,
        chromePids,
        this.options.serverCommand,
        this.options.framework,
        this.serverProcess?.pid,
        skillsInstalled,
        this.options.skillsAgentId ?? null
      )

      // Complete startup with success message only in non-TUI mode
      this.spinner.succeed("Development environment ready!")

      // Regular console output (when TUI is disabled with --no-tui)
      console.log(chalk.cyan(`Logs: ${this.options.logFile}`))
      console.log(chalk.cyan("☝️ Give this to an AI to auto debug and fix your app\n"))
      console.log(chalk.cyan(`🌐 Your App: ${this.serverProtocol}://localhost:${this.options.port}`))
      console.log(chalk.cyan(`🔧 CLI Tools: d3k fix, d3k crawl, d3k find-component`))
      if (this.options.serversOnly) {
        console.log(chalk.cyan("🖥️  Servers-only mode - browser monitoring disabled"))
      }
      console.log(chalk.cyan("\nUse Ctrl-C to stop.\n"))

      // Auto-upgrade in non-TUI mode (non-blocking)
      checkForUpdates()
        .then(async (versionInfo) => {
          if (versionInfo?.updateAvailable && versionInfo.latestVersion) {
            this.debugLog(
              `Update available: ${versionInfo.currentVersion} -> ${versionInfo.latestVersion}, auto-upgrading...`
            )
            const result = await performUpgradeAsync()
            if (result.success) {
              const newVersion = result.newVersion || versionInfo.latestVersion
              console.log(chalk.green(`\n✓ Updated to v${newVersion}`))
            } else {
              // Upgrade failed - show update available
              console.log(
                chalk.yellow(`\n↑ Update available: v${versionInfo.currentVersion} → v${versionInfo.latestVersion}`)
              )
              console.log(chalk.gray(`  Run 'd3k upgrade' to update\n`))
            }
          }
        })
        .catch(() => {
          // Silently ignore update check failures
        })
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

        // Detect when server switches to a different port
        this.detectPortChange(text)
      })
    })

    this.serverProcess.stderr?.on("data", (data) => {
      const text = data.toString()
      const entries = this.outputProcessor.process(text, true)

      entries.forEach((entry: LogEntry) => {
        this.logger.log("server", entry.formatted)

        // Detect when server switches to a different port
        this.detectPortChange(text)

        // Show critical errors to console (parser determines what's critical)
        if (entry.isCritical && entry.rawMessage) {
          console.error(chalk.red("[ERROR]"), entry.rawMessage)
        }
      })

      // Check for Next.js lock file error - show in TUI status since it's a critical startup error
      if (text.includes("Unable to acquire lock")) {
        const errorMsg = "❌ Another Next.js dev server is running. Kill it or remove .next/dev/lock"
        if (this.tui) {
          this.tui.updateStatus(errorMsg)
        } else {
          console.error(chalk.red(errorMsg))
        }
      }
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

  private isSessionCwdOwned(sessionCwd: string | null): boolean {
    if (!sessionCwd) return false
    try {
      const current = resolve(process.cwd())
      const session = resolve(sessionCwd)
      return session === current || current.startsWith(session + sep) || session.startsWith(current + sep)
    } catch {
      return false
    }
  }

  private isPidRunning(pid: number): boolean {
    try {
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  }

  private killServerPidIfOwned(pid: number, sessionCwd: string | null, reason: string) {
    if (!this.isSessionCwdOwned(sessionCwd)) {
      this.debugLog(`Skipping server PID ${pid} kill (${reason}): session cwd mismatch`)
      return
    }
    if (!this.isPidRunning(pid)) {
      this.debugLog(`Skipping server PID ${pid} kill (${reason}): not running`)
      return
    }

    this.debugLog(`Killing server PID ${pid} (${reason})`)

    try {
      process.kill(pid, "SIGTERM")
    } catch {
      // Ignore - process may already be dead
    }

    if (process.platform !== "win32") {
      try {
        process.kill(-pid, "SIGTERM")
      } catch {
        // Ignore - process group may not exist
      }
    }

    try {
      process.kill(pid, 0)
      process.kill(pid, "SIGKILL")
    } catch {
      // Ignore - process may already be dead
    }

    if (process.platform !== "win32") {
      try {
        process.kill(-pid, "SIGKILL")
      } catch {
        // Ignore - process group may not exist
      }
    }

    if (!isInSandbox()) {
      try {
        const { spawnSync } = require("child_process")
        spawnSync("pkill", ["-P", pid.toString()], { stdio: "ignore" })
      } catch {
        // Ignore pkill errors
      }
    }
  }

  private cleanupOrphanedServer() {
    const projectName = getProjectName()
    const sessionInfo = getSessionInfo(projectName)
    if (!sessionInfo?.serverPid) return

    this.killServerPidIfOwned(sessionInfo.serverPid, sessionInfo.cwd, "startup orphan cleanup")
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

  private detectPortChange(text: string) {
    // Detect Next.js port switch: "⚠ Port 3000 is in use by process 39543, using available port 3001 instead."
    // Also detect: "Local: http://localhost:3001"
    const nextJsPortSwitchMatch = text.match(/using available port (\d+) instead/i)
    const localUrlMatch = text.match(/Local:.*localhost:(\d+)/i)

    const detectedPort = nextJsPortSwitchMatch?.[1] || localUrlMatch?.[1]

    if (detectedPort && detectedPort !== this.options.port) {
      const oldPort = this.options.port
      this.debugLog(`Detected server port change from ${oldPort} to ${detectedPort}`)
      this.logger.log("server", `[PORT] Server switched from port ${oldPort} to ${detectedPort}`)
      this.options.port = detectedPort
      this.portDetected = true

      // Update session info with new port
      const projectName = getProjectName()
      const cdpUrl = this.cdpMonitor?.getCdpUrl()
      const chromePids = this.cdpMonitor?.getChromePids() || []

      if (cdpUrl || chromePids.length > 0) {
        const skillsInstalled = listAvailableSkills(process.cwd())
        writeSessionInfo(
          projectName,
          this.options.logFile,
          this.options.port,
          cdpUrl || undefined,
          chromePids,
          this.options.serverCommand,
          this.options.framework,
          this.serverProcess?.pid,
          skillsInstalled,
          this.options.skillsAgentId ?? null
        )
        this.debugLog(`Updated session info with new port: ${this.options.port}`)
      }

      // Update TUI header with new port
      if (this.tui) {
        this.tui.updateAppPort(detectedPort)
      }

      // Navigate browser to new port if CDP monitor is active
      if (this.cdpMonitor) {
        this.debugLog(`Re-navigating browser from port ${oldPort} to ${detectedPort}`)
        this.logger.log(
          "browser",
          `[CDP] Port changed - navigating to ${this.serverProtocol}://localhost:${detectedPort}`
        )
        this.cdpMonitor.navigateToApp(detectedPort, this.serverUsesHttps).catch((error: Error) => {
          this.debugLog(`Failed to navigate browser to new port: ${error}`)
        })
      }
    } else if (!this.portDetected) {
      // Fallback: detect generic server startup messages when no explicit port is found
      // This handles test apps and servers that don't output port information
      const serverStartPatterns = [
        /server\s+(is\s+)?running/i,
        /ready\s+(in|on)/i,
        /listening\s+on/i,
        /started\s+server/i,
        /http:\/\/localhost/i
      ]

      if (serverStartPatterns.some((pattern) => pattern.test(text))) {
        this.debugLog(`Detected server startup via generic message, using configured port ${this.options.port}`)
        this.portDetected = true

        // Update TUI header with configured port
        if (this.tui) {
          this.tui.updateAppPort(this.options.port)
        }
      }
    }
  }

  private debugLog(message: string) {
    const timestamp = formatTimestamp(new Date(), this.options.dateTimeFormat || "local")

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

    // Always write to d3k debug log file (even when not in debug mode)
    try {
      const projectDir = getProjectDir()
      if (!existsSync(projectDir)) {
        mkdirSync(projectDir, { recursive: true })
      }

      const debugLogFile = join(projectDir, "debug.log")
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

  private checkForCommonIssues() {
    try {
      if (!existsSync(this.options.logFile)) return

      const logContent = readFileSync(this.options.logFile, "utf8")

      // Check for Next.js lock file issue (this fix also kills the process holding the port)
      if (logContent.includes("Unable to acquire lock") && logContent.includes(".next/dev/lock")) {
        console.log(chalk.yellow("\n💡 Detected Next.js lock file issue!"))
        console.log(chalk.white("   Another Next.js dev server may be running or crashed without cleanup."))
        console.log(chalk.white("   To fix, run:"))
        console.log(chalk.cyan("   rm -f .next/dev/lock && pkill -f 'next dev'"))
        return // pkill also fixes the port-in-use issue, so skip that check
      }

      // Check for port in use (only if not a Next.js lock issue)
      const portInUseMatch = logContent.match(/Port (\d+) is in use by process (\d+)/)
      if (portInUseMatch) {
        const [, port, pid] = portInUseMatch
        console.log(chalk.yellow(`\n💡 Port ${port} was already in use by process ${pid}`))
        console.log(chalk.white("   To kill that process, run:"))
        console.log(chalk.cyan(`   kill -9 ${pid}`))
      }
    } catch {
      // Ignore errors reading log file
    }
  }

  private async waitForServer(): Promise<boolean> {
    const maxAttempts = 30
    let attempts = 0
    const startTime = Date.now()

    this.debugLog(`Waiting for server to report its port...`)

    while (attempts < maxAttempts) {
      const attemptStartTime = Date.now()

      // Wait for port to be detected from server logs before checking
      if (!this.portDetected) {
        this.debugLog(`Port not yet detected from server logs, waiting... (attempt ${attempts + 1}/${maxAttempts})`)
        await new Promise((resolve) => setTimeout(resolve, 1000))
        attempts++
        continue
      }

      // Now check if the detected port is actually listening
      const currentPort = this.options.port

      try {
        this.debugLog(`Server check attempt ${attempts + 1}/${maxAttempts}: checking port ${currentPort}`)

        // Use HTTP-based check which works in sandboxes where lsof doesn't exist
        const serverStatus = await isServerListening(currentPort)

        const attemptTime = Date.now() - attemptStartTime

        if (serverStatus.listening) {
          const totalTime = Date.now() - startTime
          this.serverUsesHttps = serverStatus.https
          // Update TUI to show correct protocol
          if (this.tui) {
            this.tui.updateUseHttps(serverStatus.https)
          }
          const protocol = serverStatus.https ? "HTTPS" : "HTTP"
          this.debugLog(
            `Server is ready! Port ${currentPort} is listening (${protocol}). Total wait time: ${totalTime}ms (${attempts + 1} attempts)`
          )
          return true
        } else {
          this.debugLog(`Port ${currentPort} not yet responding after ${attemptTime}ms`)
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
  private initializeD3KLog() {
    try {
      const projectDir = getProjectDir()
      if (!existsSync(projectDir)) {
        mkdirSync(projectDir, { recursive: true })
      }

      // Create D3K log file and clear it for new session
      const d3kLogFile = join(projectDir, "d3k.log")
      writeFileSync(d3kLogFile, "")
    } catch {
      // Ignore D3K log initialization errors - non-critical
    }
  }

  private async startCDPMonitoringSync() {
    // Skip if in servers-only mode
    if (this.options.serversOnly) {
      return
    }

    try {
      await this.startCDPMonitoring()
    } catch (error) {
      console.error(chalk.red("⚠️ CDP monitoring setup failed:"), error)
      // CDP monitoring is critical - shutdown if it fails
      this.gracefulShutdown()
      throw error
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

    // Initialize CDP monitor with enhanced logging
    this.cdpMonitor = new CDPMonitor(
      this.options.profileDir,
      this.screenshotDir,
      (_source: string, message: string) => {
        this.logger.log("browser", message)
      },
      this.options.debug,
      this.options.browser,
      this.options.pluginReactScan,
      this.options.port, // App server port to monitor
      this.options.debugPort, // Chrome debug port
      this.options.headless // Headless mode for serverless/CI environments
    )

    try {
      // Set up callback for when Chrome window is manually closed
      this.cdpMonitor.setOnWindowClosedCallback(() => {
        this.debugLog("Chrome window closed callback triggered, initiating graceful shutdown")
        this.logger.log("browser", "[CDP] Chrome window was manually closed, shutting down d3k")
        // Trigger graceful shutdown
        this.gracefulShutdown()
      })

      // Start CDP monitoring
      await this.cdpMonitor.start()
      this.logger.log("browser", "[CDP] Chrome launched with DevTools Protocol monitoring")

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
            this.logger.log("browser", msg)
          },
          this.options.port.toString(),
          this.options.debug
        )
        await this.screencastManager.start()
        // this.logger.log("browser", "[Screencast] Auto-capture enabled for navigation events")
      }

      // Always write session info after CDP monitoring starts - this is critical for
      // sandbox environments where external tools poll for the cdpUrl in the session file
      writeSessionInfo(
        projectName,
        this.options.logFile,
        this.options.port,
        cdpUrl || undefined,
        chromePids,
        this.options.serverCommand,
        this.options.framework,
        this.serverProcess?.pid,
        listAvailableSkills(process.cwd()),
        this.options.skillsAgentId ?? null
      )
      this.debugLog(`Updated session info with CDP URL: ${cdpUrl}, Chrome PIDs: [${chromePids.join(", ")}]`)
      this.logger.log("browser", `[CDP] Session info written with cdpUrl: ${cdpUrl ? "available" : "null"}`)

      // Navigate to the app
      await this.cdpMonitor.navigateToApp(this.options.port, this.serverUsesHttps)
      this.logger.log("browser", `[CDP] Navigated to ${this.serverProtocol}://localhost:${this.options.port}`)
    } catch (error) {
      // Log error and throw to trigger graceful shutdown
      this.logger.log("browser", `[CDP] Failed to start CDP monitoring: ${error}`)
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

    // Read session info BEFORE deleting it (needed for cleanup)
    const projectName = getProjectName()
    const sessionInfo = getSessionInfo(projectName)

    // Clean up session file
    try {
      const sessionFile = join(homedir(), ".d3k", projectName, "session.json")
      if (existsSync(sessionFile)) {
        unlinkSync(sessionFile)
      }
    } catch (_error) {
      // Non-fatal - ignore cleanup errors
    }

    // Check PID file ownership BEFORE deleting (needed for cleanup decisions)
    let weOwnPidFile = false
    try {
      if (existsSync(this.pidFile)) {
        const pidInFile = parseInt(readFileSync(this.pidFile, "utf-8").trim(), 10)
        weOwnPidFile = pidInFile === process.pid
        this.debugLog(`PID file check: file has ${pidInFile}, we are ${process.pid}, we own it: ${weOwnPidFile}`)
        if (weOwnPidFile) {
          unlinkSync(this.pidFile)
        }
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

    // Kill processes on both ports (skip in sandbox - lsof doesn't exist)
    const killPortProcess = async (port: string, name: string) => {
      if (isInSandbox()) {
        console.log(chalk.gray(`ℹ️ Skipping ${name} port kill in sandbox environment`))
        return
      }
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

    // Kill app server only
    console.log(chalk.cyan("🔄 Killing app server..."))
    await killPortProcess(this.options.port, "your app server")

    // Kill server process and its children using the saved PID (from before session file was deleted)
    if (sessionInfo?.serverPid) {
      this.killServerPidIfOwned(sessionInfo.serverPid, sessionInfo.cwd, "graceful shutdown")
    }

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

    // Show recent log entries to help diagnose the issue
    this.showRecentLogs()

    // Check for common issues and provide specific guidance
    this.checkForCommonIssues()

    process.exit(1)
  }

  private setupCleanupHandlers() {
    this.debugLog(`Setting up cleanup handlers for ${this.options.tui ? "TUI" : "debug"} mode`)

    // Debug: log when process is about to exit
    process.on("exit", (code) => {
      console.log(`[DEBUG] Process exiting with code ${code}`)
      this.debugLog(`Process exiting with code ${code}`)
    })

    // Handle Ctrl+C to kill all processes
    process.on("SIGINT", () => {
      this.debugLog("SIGINT received")

      // In TUI mode, the TUI already handles double-tap protection
      if (this.options.tui && this.tui) {
        this.debugLog("TUI mode - proceeding directly to shutdown")
        // Fall through to shutdown code below
      } else {
        // Non-TUI mode: proceed directly to shutdown
        // (double Ctrl+C doesn't work reliably in bun compiled binaries)
        this.debugLog("Non-TUI mode - proceeding to shutdown")
      }

      // Proceed with shutdown
      if (this.isShuttingDown) return // Prevent multiple shutdown attempts
      this.isShuttingDown = true
      this.debugLog("Starting shutdown")

      // Signal CDP monitor to stop reconnection attempts
      if (this.cdpMonitor) {
        this.cdpMonitor.prepareShutdown()
      }

      // CRITICAL: Kill port processes SYNCHRONOUSLY first, before anything else
      // This ensures cleanup happens even if the event loop gets interrupted
      const { spawnSync } = require("child_process")
      const port = this.options.port
      this.debugLog(`Synchronous kill for port ${port}`)
      spawnSync("sh", ["-c", `lsof -ti:${port} | xargs kill -9 2>/dev/null`], {
        stdio: "pipe",
        timeout: 5000
      })

      const projectName = getProjectName()
      const sessionInfo = getSessionInfo(projectName)
      const chromePids = sessionInfo?.chromePids ?? []
      if (chromePids.length > 0) {
        this.debugLog(`Synchronous kill for Chrome PIDs: [${chromePids.join(", ")}]`)
        for (const pid of chromePids) {
          try {
            process.kill(pid, "SIGTERM")
            process.kill(pid, 0)
            process.kill(pid, "SIGKILL")
          } catch {
            // Ignore - process may already be dead
          }
        }
      }

      if (sessionInfo?.serverPid) {
        this.killServerPidIfOwned(sessionInfo.serverPid, sessionInfo.cwd, "SIGINT")
      }

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
      this.debugLog("SIGTERM received")

      // Signal CDP monitor to stop reconnection attempts BEFORE killing the app server
      if (this.cdpMonitor) {
        this.cdpMonitor.prepareShutdown()
      }

      // CRITICAL: Kill port processes SYNCHRONOUSLY first, before anything else
      const { spawnSync } = require("child_process")
      const port = this.options.port
      this.debugLog(`Synchronous kill for port ${port}`)
      spawnSync("sh", ["-c", `lsof -ti:${port} | xargs kill -9 2>/dev/null`], {
        stdio: "pipe",
        timeout: 5000
      })

      const projectName = getProjectName()
      const sessionInfo = getSessionInfo(projectName)
      const chromePids = sessionInfo?.chromePids ?? []
      if (chromePids.length > 0) {
        this.debugLog(`Synchronous kill for Chrome PIDs: [${chromePids.join(", ")}]`)
        for (const pid of chromePids) {
          try {
            process.kill(pid, "SIGTERM")
            process.kill(pid, 0)
            process.kill(pid, "SIGKILL")
          } catch {
            // Ignore - process may already be dead
          }
        }
      }

      if (sessionInfo?.serverPid) {
        this.killServerPidIfOwned(sessionInfo.serverPid, sessionInfo.cwd, "SIGTERM")
      }

      this.handleShutdown()
        .then(() => {
          process.exit(0)
        })
        .catch(() => {
          process.exit(1)
        })
    })

    /**
     * SIGHUP Handler - CRITICAL for tmux/TUI mode cleanup
     *
     * When tmux kills a pane (Ctrl+C in agent pane, or closing terminal), it sends
     * SIGHUP to the process. We MUST clean up SYNCHRONOUSLY because tmux may
     * terminate us very quickly after sending the signal.
     *
     * CLEANUP ORDER (tested and verified - DO NOT CHANGE without updating tests):
     * 1. Signal CDP monitor to stop reconnection attempts
     * 2. Kill dev server processes on app port (synchronous via lsof)
     * 3. Kill Chrome PIDs from session.json (synchronous)
     * 4. Call handleShutdown() for async cleanup
     *
     * INVARIANTS (enforced by tests in dev-environment.test.ts):
     * - Chrome PIDs are stored per-session in session.json
     * - We only kill Chrome instances WE spawned (via chromePids array)
     * - All cleanup happens BEFORE process.exit()
     *
     * @see dev-environment.test.ts - "SIGHUP handler cleanup" test suite
     */
    process.on("SIGHUP", () => {
      this.debugLog("SIGHUP received (tmux session closing)")
      this.emergencyShutdown(0, "SIGHUP")
    })
  }

  private async handleShutdown() {
    // Stop health monitoring
    this.stopHealthCheck()

    // Send session end telemetry (fire-and-forget, won't block shutdown)
    sendSessionEndTelemetry().catch(() => {})

    // Release the lock file
    this.releaseLock()

    // Read session info BEFORE deleting it (needed for cleanup)
    const projectName = getProjectName()
    const sessionInfo = getSessionInfo(projectName)

    // Clean up session file
    try {
      const sessionFile = join(homedir(), ".d3k", projectName, "session.json")
      if (existsSync(sessionFile)) {
        unlinkSync(sessionFile)
      }
    } catch (_error) {
      // Non-fatal - ignore cleanup errors
    }

    // Check PID file ownership BEFORE deleting (needed for cleanup decisions)
    let weOwnPidFile = false
    try {
      if (existsSync(this.pidFile)) {
        const pidInFile = parseInt(readFileSync(this.pidFile, "utf-8").trim(), 10)
        weOwnPidFile = pidInFile === process.pid
        this.debugLog(`PID file check: file has ${pidInFile}, we are ${process.pid}, we own it: ${weOwnPidFile}`)
        // Only delete the PID file if we own it
        if (weOwnPidFile) {
          unlinkSync(this.pidFile)
          this.debugLog("Deleted our PID file")
        }
      } else {
        // PID file doesn't exist - might have been cleaned by another process
        this.debugLog("PID file doesn't exist")
      }
    } catch (_error) {
      // Non-fatal - ignore cleanup errors
      this.debugLog(`PID file check error: ${_error}`)
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
          const sessionInfo = getSessionInfo(projectName)
          const chromePids = sessionInfo?.chromePids ?? []

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

          if (sessionInfo?.serverPid) {
            this.killServerPidIfOwned(sessionInfo.serverPid, sessionInfo.cwd, "TUI shutdown")
          }
        } catch {
          // Ignore errors in fallback cleanup
        }
      }
    }

    // REMOVED: No longer clean up CLI config files on shutdown
    // This was causing Claude Code instances to crash when dev3000 was killed
    // Config file cleanup removed; keep user config files untouched on shutdown

    // Kill processes on both ports (skip in sandbox - lsof doesn't exist)
    const killPortProcess = async (port: string, name: string) => {
      // Skip lsof-based kill in sandbox environments
      if (isInSandbox()) {
        this.debugLog(`Skipping ${name} port kill in sandbox environment`)
        return
      }
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

    // Kill app server
    if (!this.options.tui) {
      console.log(chalk.yellow("🔄 Killing app server..."))
    }

    // IMPORTANT: With shell: true, the shell process exits quickly after spawning
    // the actual command, leaving Next.js orphaned (reparented to PID 1).
    // We use SYNCHRONOUS lsof kill first to ensure it completes before process exits.

    // Primary: Synchronous kill - most reliable, ensures completion
    // NOTE: We always try this, even if lsof might not exist - errors are caught
    try {
      const { spawnSync } = await import("child_process")
      const result = spawnSync("sh", ["-c", `lsof -ti:${this.options.port} | xargs kill -9 2>/dev/null`], {
        stdio: "pipe",
        timeout: 5000
      })
      this.debugLog(`Synchronous kill for port ${this.options.port} exit code: ${result.status}`)
    } catch (error) {
      this.debugLog(`Synchronous kill error: ${error}`)
    }

    // Also try async kill as backup
    await killPortProcess(this.options.port, "your app server")

    // Also try to kill the process group if we have the reference (belt and suspenders)
    if (this.serverProcess?.pid) {
      try {
        const result = await gracefulKillProcess({
          pid: this.serverProcess.pid,
          gracePeriodMs: 500,
          debugLog: (msg) => this.debugLog(msg)
        })
        if (result.terminated) {
          this.debugLog(`Killed server process group (PID: ${this.serverProcess.pid})`)
        }
      } catch (error) {
        this.debugLog(`Could not kill process group: ${error}`)
      }
    }

    // Wait for processes to fully terminate
    await new Promise((resolve) => setTimeout(resolve, 300))

    // Second pass: kill any remaining processes on the port
    await killPortProcess(this.options.port, "your app server")

    // Double-check: try to kill any remaining processes on the app port
    try {
      const { spawnSync } = await import("child_process")
      // Kill by port pattern
      spawnSync("sh", ["-c", `pkill -f ":${this.options.port}"`], { stdio: "ignore" })
      this.debugLog(`Sent pkill signal for port ${this.options.port}`)

      // Specifically kill any remaining next dev processes in the current directory
      // This catches cases where the shell wrapper exited but next-server survived
      const cwd = process.cwd()
      spawnSync("sh", ["-c", `pkill -f "next dev.*${cwd}"`], { stdio: "ignore" })
      spawnSync("sh", ["-c", `pkill -f "next-server.*${cwd}"`], { stdio: "ignore" })
      this.debugLog(`Sent pkill signal for next processes in ${cwd}`)

      // Kill server process and its children using the saved PID (from before session file was deleted)
      if (sessionInfo?.serverPid) {
        this.killServerPidIfOwned(sessionInfo.serverPid, sessionInfo.cwd, "handleShutdown")
      }

      // Final synchronous lsof kill - most reliable method
      const portNum = Number(this.options.port)
      if (!Number.isInteger(portNum) || portNum <= 0 || portNum > 65535) {
        this.debugLog(`Skipping final lsof kill due to invalid port: ${this.options.port}`)
      } else {
        const result = spawnSync("sh", ["-c", `lsof -ti:${portNum} | xargs kill -9 2>/dev/null`], {
          stdio: "pipe"
        })
        this.debugLog(`Final lsof kill exit code: ${result.status}`)
      }
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
