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
import https from "https"
import ora from "ora"
import { homedir, tmpdir } from "os"
import { dirname, join } from "path"
import { fileURLToPath } from "url"
import { CDPMonitor } from "./cdp-monitor.js"
import { ScreencastManager } from "./screencast-manager.js"
import { type LogEntry, NextJsErrorDetector, OutputProcessor, StandardLogParser } from "./services/parsers/index.js"
import { DevTUI } from "./tui-interface.js"
import { formatMcpConfigTargets, MCP_CONFIG_TARGETS, type McpConfigTarget } from "./utils/mcp-configs.js"
import { getProjectDir, getProjectDisplayName, getProjectName } from "./utils/project-name.js"
import { formatTimestamp } from "./utils/timestamp.js"
import { checkForUpdates, performUpgradeAsync } from "./utils/version-check.js"

// Declare the compile-time injected version (set by bun build --define)
declare const __D3K_VERSION__: string | undefined

// MCP names
const MCP_NAMES = {
  DEV3000: "dev3000",
  CHROME_DEVTOOLS: "dev3000-chrome-devtools",
  NEXTJS_DEV: "dev3000-nextjs-dev",
  VERCEL: "vercel"
} as const

// Vercel MCP URL (public OAuth-based MCP)
const VERCEL_MCP_URL = "https://mcp.vercel.com"

/**
 * Patterns for identifying orphaned MCP-related processes to clean up on startup.
 *
 * IMPORTANT: This list must NOT include ".d3k/chrome-profiles" or any pattern
 * that would match Chrome instances from OTHER running d3k instances.
 * Each d3k instance handles its own profile cleanup via killExistingChromeWithProfile().
 *
 * @see cleanupOrphanedPlaywrightProcesses
 */
export const ORPHANED_PROCESS_CLEANUP_PATTERNS = [
  "ms-playwright/mcp-chrome", // Playwright MCP Chrome user data dir
  "mcp-server-playwright" // Playwright MCP server node process
] as const

/**
 * Check if the current project has a .vercel directory (indicating a Vercel project)
 */
function hasVercelProject(): boolean {
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
  framework?: "nextjs" | "svelte" | "other" // Framework type from project detection
  userSetPort?: boolean // Whether user explicitly set the port
  userSetMcpPort?: boolean // Whether user explicitly set the MCP port
  tail?: boolean // Whether to tail the log file to terminal
  tui?: boolean // Whether to use TUI mode (default true)
  dateTimeFormat?: "local" | "utc" // Timestamp format option
  pluginReactScan?: boolean // Whether to enable react-scan performance monitoring
  chromeDevtoolsMcp?: boolean // Whether to enable chrome-devtools MCP integration
  disabledMcpConfigs?: McpConfigTarget[] // Which MCP config files should be skipped
  debugPort?: number // Chrome debugging port (default 9222, auto-incremented for multiple instances)
  headless?: boolean // Run Chrome in headless mode (for serverless/CI environments)
  withAgent?: string // Command to run an embedded agent (e.g. "claude --dangerously-skip-permissions")
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
  if (existsSync("bun.lockb")) return "bun"
  if (existsSync("pnpm-lock.yaml")) return "pnpm"
  if (existsSync("yarn.lock")) return "yarn"
  if (existsSync("package-lock.json")) return "npm"
  return "npm" // fallback
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
 * Clean up orphaned Playwright/MCP Chrome processes from previous d3k sessions.
 * These processes can become orphaned when d3k crashes or is force-killed,
 * leaving Chrome instances that prevent new sessions from starting properly.
 *
 * This function identifies and kills:
 * - Chrome processes spawned by ms-playwright for MCP servers
 * - mcp-server-playwright node processes
 * - Chrome using d3k-specific profile directories
 */
async function cleanupOrphanedPlaywrightProcesses(debugLog: (msg: string) => void): Promise<void> {
  // Skip in sandbox environments where ps/grep may not work
  if (isInSandbox()) {
    debugLog("Skipping orphaned process cleanup in sandbox environment")
    return
  }

  try {
    const { execSync } = await import("child_process")

    for (const pattern of ORPHANED_PROCESS_CLEANUP_PATTERNS) {
      try {
        // Find PIDs matching the pattern
        const result = execSync(`ps aux | grep -i "${pattern}" | grep -v grep | awk '{print $2}'`, {
          encoding: "utf-8",
          stdio: ["pipe", "pipe", "pipe"]
        }).trim()

        if (result) {
          const pids = result.split("\n").filter(Boolean)
          debugLog(`Found ${pids.length} orphaned process(es) matching "${pattern}": [${pids.join(", ")}]`)

          for (const pid of pids) {
            try {
              const pidNum = parseInt(pid, 10)
              // First try SIGTERM for graceful shutdown
              process.kill(pidNum, "SIGTERM")
              debugLog(`Sent SIGTERM to orphaned process ${pid}`)

              // Give it a moment to terminate
              await new Promise((resolve) => setTimeout(resolve, 100))

              // Check if still alive and force kill if needed
              try {
                process.kill(pidNum, 0) // Check if process exists
                process.kill(pidNum, "SIGKILL")
                debugLog(`Sent SIGKILL to stubborn process ${pid}`)
              } catch {
                // Process already dead, good
              }
            } catch (error) {
              // Process may have already exited or we don't have permission
              debugLog(`Could not kill process ${pid}: ${error}`)
            }
          }
        }
      } catch {
        // grep returns exit code 1 when no matches found, which is fine
      }
    }

    // Also clean up any stale Chrome lock files that might prevent new instances
    const lockFilePaths = [
      join(homedir(), "Library/Caches/ms-playwright/mcp-chrome/SingletonLock"),
      join(homedir(), "Library/Caches/ms-playwright/mcp-chrome/SingletonSocket"),
      join(homedir(), "Library/Caches/ms-playwright/mcp-chrome/SingletonCookie")
    ]

    for (const lockFile of lockFilePaths) {
      try {
        if (existsSync(lockFile)) {
          unlinkSync(lockFile)
          debugLog(`Removed stale lock file: ${lockFile}`)
        }
      } catch {
        // Ignore errors - file might be locked by running process
      }
    }

    debugLog("Orphaned process cleanup completed")
  } catch (error) {
    debugLog(`Error during orphaned process cleanup: ${error}`)
    // Non-fatal - continue with startup
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
        resolve(true)
      }
    )

    req.on("error", () => {
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
// Framework detection happens in cli.ts and is stored in session files for MCP orchestrator

/**
 * Check if Chrome version supports chrome-devtools MCP (>= 140.0.7339.214)
 */
async function isChromeDevtoolsMcpSupported(): Promise<boolean> {
  try {
    // Try different Chrome binary paths
    const chromePaths = [
      "/tmp/chromium", // Vercel Sandbox (@sparticuz/chromium)
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
async function ensureMcpServers(mcpPort: string, _appPort: string, _enableChromeDevtools: boolean): Promise<void> {
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

    // Add Vercel MCP if this is a Vercel project (.vercel directory exists)
    // Vercel MCP uses OAuth authentication handled by the client (Claude Code)
    if (hasVercelProject() && !settings.mcpServers[MCP_NAMES.VERCEL]) {
      settings.mcpServers[MCP_NAMES.VERCEL] = {
        type: "http",
        url: VERCEL_MCP_URL
      }
      added = true
    }

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
  _enableChromeDevtools: boolean
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

    // Add Vercel MCP if this is a Vercel project (.vercel directory exists)
    // Vercel MCP uses OAuth authentication handled by the client (Cursor)
    if (hasVercelProject() && !settings.mcpServers[MCP_NAMES.VERCEL]) {
      settings.mcpServers[MCP_NAMES.VERCEL] = {
        type: "http",
        url: VERCEL_MCP_URL
      }
      added = true
    }

    // Write if we added anything
    if (added) {
      writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf-8")
    }
  } catch (_error) {
    // Ignore errors - settings file manipulation is optional
  }
}

/**
 * Ensure MCP server configurations are added to project's opencode.json
 * OpenCode uses a different structure: "mcp" instead of "mcpServers"
 *
 * IMPORTANT: OpenCode has issues with "type": "remote" for HTTP MCP servers.
 * The workaround is to use "type": "local" with mcp-remote package to proxy requests.
 * See: https://github.com/sst/opencode/issues/1595
 */
async function ensureOpenCodeMcpServers(
  mcpPort: string,
  _appPort: string,
  _enableChromeDevtools: boolean
): Promise<void> {
  try {
    const settingsPath = join(process.cwd(), "opencode.json")

    // Read or create settings - OpenCode uses "mcp" not "mcpServers"
    let settings: {
      mcp?: Record<
        string,
        {
          type?: "local" | "remote"
          command?: string[]
          url?: string
          oauth?: Record<string, unknown>
          enabled?: boolean
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

    let changed = false

    // Always update dev3000 MCP server config to ensure correct format
    // Try simple remote type first - no OAuth needed for local dev3000
    const expectedDev3000Config = {
      type: "remote" as const,
      url: `http://localhost:${mcpPort}/mcp`,
      enabled: true
    }
    const currentDev3000 = settings.mcp[MCP_NAMES.DEV3000]
    if (
      !currentDev3000 ||
      currentDev3000.type !== expectedDev3000Config.type ||
      currentDev3000.url !== expectedDev3000Config.url
    ) {
      settings.mcp[MCP_NAMES.DEV3000] = expectedDev3000Config
      changed = true
    }

    // Always update Vercel MCP if this is a Vercel project (.vercel directory exists)
    // Vercel MCP requires OAuth, so use OpenCode's native remote type with oauth: {}
    // This triggers OpenCode's built-in OAuth flow instead of mcp-remote
    // See: https://github.com/sst/opencode/issues/5444
    if (hasVercelProject()) {
      const expectedVercelConfig = {
        type: "remote" as const,
        url: VERCEL_MCP_URL,
        oauth: {},
        enabled: true
      }
      const currentVercel = settings.mcp[MCP_NAMES.VERCEL]
      if (
        !currentVercel ||
        currentVercel.type !== expectedVercelConfig.type ||
        currentVercel.url !== expectedVercelConfig.url ||
        !currentVercel.oauth
      ) {
        settings.mcp[MCP_NAMES.VERCEL] = expectedVercelConfig
        changed = true
      }
    }

    // Write if we changed anything
    if (changed) {
      writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf-8")
    }
  } catch (_error) {
    // Ignore errors - settings file manipulation is optional
  }
}

/**
 * Ensure d3k skill is installed in project's .claude/skills/d3k/
 * This provides Claude with context about how to use d3k's MCP tools
 */
async function ensureD3kSkill(): Promise<void> {
  try {
    const skillDir = join(process.cwd(), ".claude", "skills", "d3k")
    const skillPath = join(skillDir, "SKILL.md")

    // Skip if skill already exists
    if (existsSync(skillPath)) {
      return
    }

    // Find the bundled skill file
    const __filename = fileURLToPath(import.meta.url)
    const __dirname = dirname(__filename)
    const bundledSkillPath = join(__dirname, "skills", "d3k", "SKILL.md")

    // Check if bundled skill exists
    if (!existsSync(bundledSkillPath)) {
      return // Skill not bundled, skip silently
    }

    // Create skill directory
    if (!existsSync(skillDir)) {
      mkdirSync(skillDir, { recursive: true })
    }

    // Copy skill file to project
    copyFileSync(bundledSkillPath, skillPath)
  } catch (_error) {
    // Ignore errors - skill installation is optional
  }
}

// REMOVED: cleanup functions are no longer needed
// MCP config files are now kept persistent across dev3000 restarts

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

// Write session info for MCP server to discover
function writeSessionInfo(
  projectName: string,
  logFilePath: string,
  appPort: string,
  mcpPort?: string,
  cdpUrl?: string | null,
  chromePids?: number[],
  serverCommand?: string,
  framework?: "nextjs" | "svelte" | "other",
  serverPid?: number
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
      mcpPort: mcpPort || null,
      cdpUrl: cdpUrl || null,
      startTime: new Date().toISOString(),
      pid: process.pid,
      cwd: process.cwd(),
      chromePids: chromePids || [],
      serverCommand: serverCommand || null,
      framework: framework || null,
      serverPid: serverPid || null
    }

    // Write session file in project directory
    const sessionFile = join(projectDir, "session.json")
    writeFileSync(sessionFile, JSON.stringify(sessionInfo, null, 2))
  } catch (error) {
    // Non-fatal - just log a warning
    console.warn(chalk.yellow(`⚠️ Could not write session info: ${error}`))
  }
}

// Get Chrome PIDs for this instance
function getSessionChromePids(projectName: string): number[] {
  const sessionFile = join(homedir(), ".d3k", projectName, "session.json")

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

// Get server PID for this instance
function getSessionServerPid(projectName: string): number | null {
  const sessionFile = join(homedir(), ".d3k", projectName, "session.json")

  try {
    if (existsSync(sessionFile)) {
      const sessionInfo = JSON.parse(readFileSync(sessionFile, "utf8"))
      return sessionInfo.serverPid || null
    }
  } catch (_error) {
    // Non-fatal - return null
  }
  return null
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
  private mcpServerProcess: ChildProcess | null = null
  private cdpMonitor: CDPMonitor | null = null
  private screencastManager: ScreencastManager | null = null
  private logger: Logger
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
  private chromeDevtoolsSupported: boolean = false
  private portDetected: boolean = false
  private serverUsesHttps: boolean = false
  private disabledMcpConfigSet: Set<McpConfigTarget>

  /** Returns "https" or "http" based on detected server protocol */
  private get serverProtocol(): "http" | "https" {
    return this.serverUsesHttps ? "https" : "http"
  }

  constructor(options: DevEnvironmentOptions) {
    // Handle portMcp vs mcpPort naming
    this.options = {
      ...options,
      mcpPort: options.portMcp || options.mcpPort || "3684",
      disabledMcpConfigs: options.disabledMcpConfigs || []
    }
    this.disabledMcpConfigSet = new Set(this.options.disabledMcpConfigs)
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

    // Always use MCP server's public directory for screenshots to ensure they're web-accessible
    // and avoid permission issues with /var/log paths
    this.screenshotDir = join(packageRoot, "mcp-server", "public", "screenshots")
    // Use project-specific PID and lock files to allow multiple projects to run simultaneously
    const projectName = getProjectName()
    this.pidFile = join(tmpdir(), `dev3000-${projectName}.pid`)
    this.lockFile = join(tmpdir(), `dev3000-${projectName}.lock`)
    this.mcpPublicDir = join(packageRoot, "mcp-server", "public", "screenshots")

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
    // Clean up orphaned Playwright/Chrome processes from previous crashed sessions
    // This prevents "kill EPERM" errors when MCP tries to spawn new browsers
    await cleanupOrphanedPlaywrightProcesses((msg) => this.debugLog(msg))

    // Always kill any existing MCP server to ensure clean state
    // We ALWAYS try to kill, even if port appears free - there can be race conditions
    if (this.options.mcpPort) {
      this.debugLog(`Ensuring port ${this.options.mcpPort} is free (always kill)`)
      await this.killMcpServer()
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
    // In sandbox environments, skip lsof-based process cleanup
    if (isInSandbox()) {
      this.debugLog("killMcpServer skipped: Running in sandbox environment")
      return
    }

    // Retry loop to ensure port is fully released
    const maxRetries = 5
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // First, get the PIDs
        const getPidsProcess = spawn("lsof", ["-ti", `:${this.options.mcpPort}`], {
          stdio: "pipe"
        })

        const pids = await new Promise<string>((resolve, reject) => {
          let output = ""
          getPidsProcess.stdout?.on("data", (data) => {
            output += data.toString()
          })
          getPidsProcess.on("error", (err) => reject(err))
          getPidsProcess.on("exit", () => resolve(output.trim()))
        })

        if (!pids) {
          this.debugLog(`Port ${this.options.mcpPort} is free (attempt ${attempt})`)
          return // Port is already free
        }

        this.debugLog(`Found MCP server processes (attempt ${attempt}): ${pids}`)

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

        // Give it time to fully release the port (longer waits, macOS can be slow)
        const waitTime = 1000 * attempt
        this.debugLog(`Waiting ${waitTime}ms for port ${this.options.mcpPort} to be released...`)
        await new Promise((resolve) => setTimeout(resolve, waitTime))

        // Check if port is now free
        const available = await isPortAvailable(this.options.mcpPort?.toString() ?? "")
        if (available) {
          this.debugLog(`Port ${this.options.mcpPort} released successfully`)
          return
        }
      } catch (error) {
        this.debugLog(`Error killing MCP server (attempt ${attempt}): ${error}`)
      }
    }

    this.debugLog(`Warning: Port ${this.options.mcpPort} may still be in use after ${maxRetries} attempts`)
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
      const ports = [this.options.port, this.options.mcpPort]

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

  private async configureMcpConfigs(): Promise<void> {
    const enabledTargets = MCP_CONFIG_TARGETS.filter((target) => !this.disabledMcpConfigSet.has(target))

    if (enabledTargets.length === 0) {
      this.logD3K(
        "AI CLI Integration: MCP config generation disabled via --disable-mcp-configs/DEV3000_DISABLE_MCP_CONFIGS"
      )
      return
    }

    const configuredTargets: McpConfigTarget[] = []

    if (enabledTargets.includes("claude")) {
      await ensureMcpServers(this.options.mcpPort || "3684", this.options.port, this.chromeDevtoolsSupported)
      await ensureD3kSkill() // Install d3k skill for Claude Code
      configuredTargets.push("claude")
    }

    if (enabledTargets.includes("cursor")) {
      await ensureCursorMcpServers(this.options.mcpPort || "3684", this.options.port, this.chromeDevtoolsSupported)
      configuredTargets.push("cursor")
    }

    if (enabledTargets.includes("opencode")) {
      await ensureOpenCodeMcpServers(this.options.mcpPort || "3684", this.options.port, this.chromeDevtoolsSupported)
      configuredTargets.push("opencode")
    }

    if (configuredTargets.length > 0) {
      this.logD3K(`AI CLI Integration: Configured MCP servers in ${formatMcpConfigTargets(configuredTargets)}`)
    } else {
      this.logD3K("AI CLI Integration: MCP configs already up to date")
    }
  }

  async start() {
    // Check if another instance is already running for this project
    if (!this.acquireLock()) {
      console.error(chalk.red(`\n❌ Another dev3000 instance is already running for this project.`))
      console.error(chalk.yellow(`   If you're sure no other instance is running, remove: ${this.lockFile}`))
      process.exit(1)
    }

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
        mcpPort: this.options.mcpPort || "3684",
        logFile: this.options.logFile,
        commandName: this.options.commandName,
        serversOnly: this.options.serversOnly,
        version: this.version,
        projectName: projectDisplayName,
        updateInfo: null // Will be updated async after auto-upgrade
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
        console.error(chalk.yellow(`Check the logs at ~/.d3k/${getProjectName()}/logs/ for errors.`))
        console.error(chalk.yellow("Exiting without launching browser."))
        process.exit(1)
      }

      // Update TUI with confirmed port (may have changed during server startup)
      this.tui.updateAppPort(this.options.port)

      await this.tui.updateStatus(`Waiting for ${this.options.commandName} MCP server...`)
      await this.waitForMcpServer()

      // Configure AI CLI integrations (both dev3000 and chrome-devtools MCPs)
      if (!this.options.serversOnly) {
        await this.tui.updateStatus("Configuring AI CLI integrations...")

        // Check if Chrome version supports chrome-devtools MCP
        if (this.options.chromeDevtoolsMcp !== false) {
          this.chromeDevtoolsSupported = await isChromeDevtoolsMcpSupported()
          if (!this.chromeDevtoolsSupported) {
            this.logD3K("Chrome version < 140.0.7339.214 detected - chrome-devtools MCP will be skipped")
          }
        }

        // Ensure MCP server configurations in project settings files (instant, local)
        await this.configureMcpConfigs()
      }

      // Start CDP monitoring only if server started successfully and not in servers-only mode
      if (!this.options.serversOnly && serverStarted) {
        await this.tui.updateStatus(`Starting ${this.options.commandName} browser...`)
        await this.startCDPMonitoringSync()
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
        this.options.serverCommand,
        this.options.framework,
        this.serverProcess?.pid
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
        console.error(chalk.yellow(`Check the logs at ~/.d3k/${getProjectName()}/logs/ for errors.`))
        console.error(chalk.yellow("Exiting without launching browser."))
        process.exit(1)
      }

      this.spinner.text = `Waiting for ${this.options.commandName} MCP server...`
      await this.waitForMcpServer()

      // Configure AI CLI integrations (both dev3000 and chrome-devtools MCPs)
      if (!this.options.serversOnly) {
        this.spinner.text = "Configuring AI CLI integrations..."

        // Check if Chrome version supports chrome-devtools MCP
        if (this.options.chromeDevtoolsMcp !== false) {
          this.chromeDevtoolsSupported = await isChromeDevtoolsMcpSupported()
          if (!this.chromeDevtoolsSupported) {
            this.logD3K("Chrome version < 140.0.7339.214 detected - chrome-devtools MCP will be skipped")
          }
        }

        // Ensure MCP server configurations in project settings files (instant, local)
        await this.configureMcpConfigs()
      }

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
      writeSessionInfo(
        projectName,
        this.options.logFile,
        this.options.port,
        this.options.mcpPort,
        cdpUrl,
        chromePids,
        this.options.serverCommand,
        this.options.framework,
        this.serverProcess?.pid
      )

      // Complete startup with success message only in non-TUI mode
      this.spinner.succeed("Development environment ready!")

      // Regular console output (when TUI is disabled with --no-tui)
      console.log(chalk.cyan(`Logs: ${this.options.logFile}`))
      console.log(chalk.cyan("☝️ Give this to an AI to auto debug and fix your app\n"))
      console.log(chalk.cyan(`🌐 Your App: ${this.serverProtocol}://localhost:${this.options.port}`))
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
        writeSessionInfo(
          projectName,
          this.options.logFile,
          this.options.port,
          this.options.mcpPort,
          cdpUrl || undefined,
          chromePids,
          this.options.serverCommand,
          this.options.framework,
          this.serverProcess?.pid
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

  private async startMcpServer() {
    this.debugLog("Starting MCP server setup")

    // Note: MCP server cleanup now happens earlier in checkPortsAvailable()
    // to ensure the port is free before we check availability

    // Get the path to our bundled MCP server
    // Handle both normal npm install and compiled binary cases
    let mcpServerPath: string

    // Check if we're running from a compiled binary
    // Compiled binaries have process.execPath pointing to the binary itself
    const execPath = process.execPath
    const isCompiledBinary =
      execPath.includes("@d3k/darwin-") || execPath.includes("d3k-darwin-") || execPath.endsWith("/dev3000")

    if (isCompiledBinary) {
      // For compiled binaries, mcp-server is a sibling to the bin directory
      // Structure: packages/d3k-darwin-arm64/bin/dev3000 -> packages/d3k-darwin-arm64/mcp-server
      const binDir = dirname(execPath)
      const packageDir = dirname(binDir)
      mcpServerPath = join(packageDir, "mcp-server")
      this.debugLog(`Compiled binary detected, MCP server path: ${mcpServerPath}`)
    } else {
      // Normal npm install - mcp-server is in the package root
      const currentFile = fileURLToPath(import.meta.url)
      const packageRoot = dirname(dirname(currentFile)) // Go up from dist/ to package root
      mcpServerPath = join(packageRoot, "mcp-server")
      this.debugLog(`Standard install detected, MCP server path: ${mcpServerPath}`)
    }

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
    // Detect global install by checking if the mcp-server path is outside the current working directory
    // This handles both pnpm (.pnpm) and npm (/lib/node_modules/) global installs
    const isGlobalInstall =
      mcpServerPath.includes(".pnpm") ||
      mcpServerPath.includes("/lib/node_modules/") ||
      !mcpServerPath.startsWith(process.cwd())
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
        // Check for start-production.mjs script
        const startProdScript = join(mcpServerPath, "start-production.mjs")

        if (existsSync(startProdScript)) {
          // Use the production script
          this.debugLog(`Global install with start-production.mjs script`)
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

    // Get CDP URL for MCP orchestration
    const cdpUrl = this.cdpMonitor?.getCdpUrl() || null

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
        SCREENSHOT_DIR: this.screenshotDir, // Pass screenshot directory for global installs
        CDP_URL: cdpUrl || "" // Pass CDP URL for chrome-devtools MCP orchestration
      }
    })

    // Unref the process so it continues running after parent exits
    this.mcpServerProcess.unref()

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
        this.logger.log("server", `MCP server process exited with code ${code}`)
      }
    })

    this.debugLog("MCP server event handlers setup complete")
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
      // Detect global install by checking if the path is outside the current working directory
      const isGlobalInstall =
        mcpServerPath.includes(".pnpm") ||
        mcpServerPath.includes("/lib/node_modules/") ||
        !mcpServerPath.startsWith(process.cwd())

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

  private logD3K(message: string) {
    // Write [D3K] logs to project-specific dev3000 debug log, NOT to main project log
    // This prevents Claude from thinking dev3000's orchestration logic needs to be "fixed"
    const timestamp = formatTimestamp(new Date(), this.options.dateTimeFormat || "local")
    const logEntry = `[${timestamp}] [D3K] ${message}\n`

    try {
      const projectDir = getProjectDir()
      if (!existsSync(projectDir)) {
        mkdirSync(projectDir, { recursive: true })
      }

      const d3kLogFile = join(projectDir, "d3k.log")
      appendFileSync(d3kLogFile, logEntry)
    } catch {
      // Ignore D3K log write errors - non-critical
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

    // Initialize CDP monitor with enhanced logging - use MCP public directory for screenshots
    this.cdpMonitor = new CDPMonitor(
      this.options.profileDir,
      this.mcpPublicDir,
      (_source: string, message: string) => {
        this.logger.log("browser", message)
      },
      this.options.debug,
      this.options.browser,
      this.options.pluginReactScan,
      this.options.port, // App server port to monitor
      this.options.mcpPort, // MCP server port to ignore
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
        this.options.mcpPort,
        cdpUrl || undefined,
        chromePids,
        this.options.serverCommand,
        this.options.framework,
        this.serverProcess?.pid
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

    // Read server PID from session file BEFORE deleting it (needed for cleanup)
    const projectName = getProjectName()
    const savedServerPid = getSessionServerPid(projectName)

    // Clean up session file
    try {
      const sessionFile = join(homedir(), ".d3k", projectName, "session.json")
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

    // Kill app server only (MCP server remains as singleton)
    console.log(chalk.cyan("🔄 Killing app server..."))
    await killPortProcess(this.options.port, "your app server")

    // Kill server process and its children using the saved PID (from before session file was deleted)
    if (!isInSandbox() && savedServerPid) {
      try {
        const { spawnSync } = await import("child_process")
        // Kill all child processes of the server
        spawnSync("pkill", ["-P", savedServerPid.toString()], { stdio: "ignore" })
        // Kill the server process itself
        try {
          process.kill(savedServerPid, "SIGKILL")
        } catch {
          // Process may already be dead
        }
      } catch {
        // Ignore pkill errors
      }
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

    // Handle SIGHUP (sent by tmux when session/pane is killed)
    process.on("SIGHUP", () => {
      this.debugLog("SIGHUP received (tmux session closing)")
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

    // Read server PID from session file BEFORE deleting it (needed for cleanup)
    const projectName = getProjectName()
    const savedServerPid = getSessionServerPid(projectName)

    // Clean up session file
    try {
      const sessionFile = join(homedir(), ".d3k", projectName, "session.json")
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
    // Now we keep .mcp.json, .cursor/mcp.json, and opencode.json configured
    // for the next dev3000 run, providing a better developer experience

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

    // Kill app server (MCP server remains as singleton)
    if (!this.options.tui) {
      console.log(chalk.yellow("🔄 Killing app server..."))
    }

    // First, try to kill the process group if we have the server process reference
    // This is important because the server is spawned with detached: true, which creates
    // its own process group. Killing the entire group ensures child processes (like
    // Next.js's next-server and webpack workers) are also killed.
    if (this.serverProcess?.pid) {
      try {
        // Use graceful kill: SIGTERM first, wait, then SIGKILL if needed
        // This allows Next.js to clean up .next/dev/lock before terminating
        const result = await gracefulKillProcess({
          pid: this.serverProcess.pid,
          debugLog: (msg) => this.debugLog(msg)
        })

        if (!this.options.tui && result.terminated) {
          const method = result.graceful ? "gracefully" : "forcefully"
          console.log(chalk.green(`✅ Killed server process group ${method} (PID: ${this.serverProcess.pid})`))
        }
      } catch (error) {
        // Process group may already be dead or may not exist
        this.debugLog(`Could not kill process group: ${error}`)
      }
    }

    // Fallback: kill any remaining processes on the port
    await killPortProcess(this.options.port, "your app server")

    // Add a small delay to let the kill process complete
    await new Promise((resolve) => setTimeout(resolve, 100))

    // Double-check: try to kill any remaining processes on the app port
    try {
      const { spawnSync } = await import("child_process")
      // Kill by port
      spawnSync("sh", ["-c", `pkill -f ":${this.options.port}"`], { stdio: "ignore" })
      this.debugLog(`Sent pkill signal for port ${this.options.port}`)

      // Kill server process and its children using the saved PID (from before session file was deleted)
      if (savedServerPid) {
        // Kill all child processes of the server
        spawnSync("pkill", ["-P", savedServerPid.toString()], { stdio: "ignore" })
        this.debugLog(`Killed children of server PID ${savedServerPid}`)
        // Kill the server process itself
        try {
          process.kill(savedServerPid, "SIGKILL")
          this.debugLog(`Killed server PID ${savedServerPid}`)
        } catch {
          // Process may already be dead
        }
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
