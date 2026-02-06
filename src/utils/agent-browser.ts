/**
 * Wrapper for agent-browser CLI
 *
 * Provides a TypeScript interface to agent-browser commands for browser automation.
 * Uses the CLI approach for reliability and to leverage agent-browser's daemon architecture.
 */

import { execSync, spawn } from "child_process"
import { existsSync, mkdirSync } from "fs"
import { homedir } from "os"
import { dirname, join } from "path"
import { fileURLToPath } from "url"

// Find the agent-browser binary in node_modules
function getAgentBrowserPath(): string {
  // 1. Check environment variable first (set by d3k when starting tools service)
  if (process.env.AGENT_BROWSER_PATH && existsSync(process.env.AGENT_BROWSER_PATH)) {
    return process.env.AGENT_BROWSER_PATH
  }

  // Build search paths from multiple starting points
  const searchPaths: string[] = []

  // 2. Try import.meta.url-based paths (works in dev, may not work in Next.js bundle)
  try {
    const currentFile = fileURLToPath(import.meta.url)
    const currentDir = dirname(currentFile)

    // Only use these paths if currentDir looks like a real filesystem path
    // (Next.js/Turbopack rewrites import.meta.url to virtual paths like "src/utils/...")
    if (currentDir.startsWith("/") || currentDir.match(/^[A-Z]:\\/i)) {
      searchPaths.push(
        // Relative to src/utils/ or dist/utils/
        join(dirname(dirname(currentDir)), "node_modules", ".bin", "agent-browser"),
        join(currentDir, "..", "..", "node_modules", ".bin", "agent-browser")
      )
    }
  } catch {
    // import.meta.url not available or invalid, skip these paths
  }

  // 3. Bun global install (dev3000 dependency)
  searchPaths.push(
    join(homedir(), ".bun", "install", "global", "node_modules", "dev3000", "node_modules", ".bin", "agent-browser"),
    join(homedir(), ".bun", "install", "global", "node_modules", ".bin", "agent-browser"),
    join(homedir(), ".bun", "install", "global", "node_modules", "agent-browser", "bin", "agent-browser")
  )

  // 4. Use process.cwd() as fallback - essential for Next.js bundled code
  // When running in a bundled environment, cwd may vary, so include common local paths
  const cwd = process.cwd()
  searchPaths.push(
    // Direct node_modules
    join(cwd, "node_modules", ".bin", "agent-browser"),
    join(cwd, "node_modules", "agent-browser", "bin", "agent-browser"),
    // Parent node_modules (when cwd is nested)
    join(cwd, "..", "node_modules", ".bin", "agent-browser"),
    join(cwd, "..", "node_modules", "agent-browser", "bin", "agent-browser")
  )

  // 5. npm/pnpm/yarn global install locations (best-effort)
  const globalNodeModules = [
    join("/usr", "local", "lib", "node_modules"),
    join("/opt", "homebrew", "lib", "node_modules")
  ]
  for (const root of globalNodeModules) {
    searchPaths.push(join(root, "dev3000", "node_modules", ".bin", "agent-browser"))
    searchPaths.push(join(root, "agent-browser", "bin", "agent-browser"))
  }

  for (const searchPath of searchPaths) {
    if (existsSync(searchPath)) {
      return searchPath
    }
  }

  // Fallback to global command (may work if installed globally)
  return "agent-browser"
}

export interface AgentBrowserOptions {
  /** Run in headed mode (visible browser window) */
  headed?: boolean
  /** Connect to existing browser via CDP port */
  cdpPort?: number
  /** Session name for isolation */
  session?: string
  /** Timeout in milliseconds */
  timeout?: number
  /** Path to persistent browser profile directory (stores cookies, localStorage, etc.) */
  profile?: string
}

export interface SnapshotElement {
  ref: string
  role: string
  name?: string
  text?: string
}

export interface SnapshotResult {
  elements: SnapshotElement[]
  raw: string
}

export interface ScreenshotResult {
  success: boolean
  path?: string
  error?: string
}

export interface ActionResult {
  success: boolean
  output?: string
  error?: string
}

/**
 * Build CLI args from options
 */
function buildArgs(options: AgentBrowserOptions): string[] {
  const args: string[] = []

  if (options.headed) {
    args.push("--headed")
  }

  if (options.cdpPort) {
    args.push("--cdp", String(options.cdpPort))
  }

  if (options.session) {
    args.push("--session", options.session)
  }

  // NOTE: --profile flag is not yet supported by agent-browser CLI
  // Keeping the option in the interface for future compatibility
  // if (options.profile) {
  //   args.push("--profile", options.profile)
  // }

  // Always use JSON output for parsing
  args.push("--json")

  return args
}

/**
 * Execute an agent-browser command
 */
async function execAgentBrowser(command: string[], options: AgentBrowserOptions = {}): Promise<string> {
  const args = [...buildArgs(options), ...command]
  const timeout = options.timeout || 30000
  const agentBrowserPath = getAgentBrowserPath()

  return new Promise((resolve, reject) => {
    const proc = spawn(agentBrowserPath, args, {
      stdio: ["pipe", "pipe", "pipe"],
      timeout
    })

    let stdout = ""
    let stderr = ""

    proc.stdout?.on("data", (data) => {
      stdout += data.toString()
    })

    proc.stderr?.on("data", (data) => {
      stderr += data.toString()
    })

    proc.on("close", (code) => {
      if (code === 0) {
        resolve(stdout)
      } else {
        reject(new Error(`agent-browser failed (code ${code}): ${stderr || stdout}`))
      }
    })

    proc.on("error", (err) => {
      reject(new Error(`agent-browser spawn error: ${err.message}`))
    })
  })
}

/**
 * Open a URL in the browser
 */
export async function openUrl(url: string, options: AgentBrowserOptions = {}): Promise<ActionResult> {
  try {
    const output = await execAgentBrowser(["open", url], options)
    return { success: true, output }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

/**
 * Take a snapshot of the current page (accessibility tree with refs)
 */
export async function snapshot(
  options: AgentBrowserOptions & { interactive?: boolean; compact?: boolean } = {}
): Promise<SnapshotResult> {
  const args = ["snapshot"]

  // -i for interactive elements only (reduces tokens)
  if (options.interactive !== false) {
    args.push("-i")
  }

  // -c for compact output
  if (options.compact) {
    args.push("-c")
  }

  const output = await execAgentBrowser(args, options)

  // Parse the JSON output to extract elements
  const elements: SnapshotElement[] = []

  try {
    const parsed = JSON.parse(output)
    if (parsed.success && parsed.data?.refs) {
      for (const [ref, info] of Object.entries(parsed.data.refs)) {
        const refInfo = info as { name?: string; role?: string; text?: string }
        elements.push({
          ref: `@${ref}`,
          role: refInfo.role || "unknown",
          name: refInfo.name,
          text: refInfo.text
        })
      }
    }
    return { elements, raw: parsed.data?.snapshot || output }
  } catch {
    // Fallback to text parsing if JSON fails
    const refPattern = /@(\w+)\s+(\w+)(?:\s+"([^"]*)")?/g
    const matches = output.matchAll(refPattern)

    for (const match of matches) {
      elements.push({
        ref: `@${match[1]}`,
        role: match[2],
        name: match[3]
      })
    }

    return { elements, raw: output }
  }
}

/**
 * Click an element by ref or selector
 */
export async function click(target: string, options: AgentBrowserOptions = {}): Promise<ActionResult> {
  try {
    const output = await execAgentBrowser(["click", target], options)
    return { success: true, output }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

/**
 * Type text into the focused element
 */
export async function type(text: string, options: AgentBrowserOptions = {}): Promise<ActionResult> {
  try {
    const output = await execAgentBrowser(["type", text], options)
    return { success: true, output }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

/**
 * Fill an input field (by ref or selector)
 */
export async function fill(target: string, value: string, options: AgentBrowserOptions = {}): Promise<ActionResult> {
  try {
    const output = await execAgentBrowser(["fill", target, value], options)
    return { success: true, output }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

/**
 * Scroll the page
 */
export async function scroll(
  direction: "up" | "down" | "left" | "right",
  amount?: number,
  options: AgentBrowserOptions = {}
): Promise<ActionResult> {
  try {
    const args = ["scroll", direction]
    if (amount) {
      args.push(String(amount))
    }
    const output = await execAgentBrowser(args, options)
    return { success: true, output }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

/**
 * Take a screenshot
 */
export async function screenshot(
  outputPath: string,
  options: AgentBrowserOptions & { fullPage?: boolean } = {}
): Promise<ScreenshotResult> {
  try {
    // Ensure output directory exists
    const dir = dirname(outputPath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }

    const args = ["screenshot", outputPath]
    if (options.fullPage) {
      args.push("--full-page")
    }

    await execAgentBrowser(args, options)
    return { success: true, path: outputPath }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

/**
 * Get console messages from the browser
 */
export async function getConsoleMessages(options: AgentBrowserOptions = {}): Promise<string[]> {
  try {
    const output = await execAgentBrowser(["console"], options)
    // Parse JSON output
    const parsed = JSON.parse(output)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/**
 * Get page errors
 */
export async function getErrors(options: AgentBrowserOptions = {}): Promise<string[]> {
  try {
    const output = await execAgentBrowser(["errors"], options)
    const parsed = JSON.parse(output)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/**
 * Navigate back
 */
export async function back(options: AgentBrowserOptions = {}): Promise<ActionResult> {
  try {
    const output = await execAgentBrowser(["back"], options)
    return { success: true, output }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

/**
 * Navigate forward
 */
export async function forward(options: AgentBrowserOptions = {}): Promise<ActionResult> {
  try {
    const output = await execAgentBrowser(["forward"], options)
    return { success: true, output }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

/**
 * Reload the page
 */
export async function reload(options: AgentBrowserOptions = {}): Promise<ActionResult> {
  try {
    const output = await execAgentBrowser(["reload"], options)
    return { success: true, output }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

/**
 * Close the browser
 */
export async function close(options: AgentBrowserOptions = {}): Promise<ActionResult> {
  try {
    const output = await execAgentBrowser(["close"], options)
    return { success: true, output }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

/**
 * Get the current URL
 */
export async function getCurrentUrl(options: AgentBrowserOptions = {}): Promise<string | null> {
  try {
    const output = await execAgentBrowser(["url"], options)
    return output.trim()
  } catch {
    return null
  }
}

/**
 * Get page title
 */
export async function getTitle(options: AgentBrowserOptions = {}): Promise<string | null> {
  try {
    const output = await execAgentBrowser(["title"], options)
    return output.trim()
  } catch {
    return null
  }
}

/**
 * Evaluate JavaScript in the browser
 */
export async function evaluate(expression: string, options: AgentBrowserOptions = {}): Promise<ActionResult> {
  try {
    const output = await execAgentBrowser(["evaluate", expression], options)
    return { success: true, output }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

/**
 * Wait for an element to appear
 */
export async function waitFor(
  selector: string,
  options: AgentBrowserOptions & { timeout?: number } = {}
): Promise<ActionResult> {
  try {
    const args = ["wait", selector]
    if (options.timeout) {
      args.push("--timeout", String(options.timeout))
    }
    const output = await execAgentBrowser(args, options)
    return { success: true, output }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

/**
 * Check if agent-browser is installed and accessible
 */
export function isAgentBrowserAvailable(): boolean {
  try {
    const agentBrowserPath = getAgentBrowserPath()
    // agent-browser doesn't have --version, just check if the binary exists and responds to --help
    execSync(`"${agentBrowserPath}" --help`, { stdio: "pipe" })
    return true
  } catch {
    return false
  }
}

/**
 * Get agent-browser path for debugging
 */
export function getAgentBrowserBinaryPath(): string {
  return getAgentBrowserPath()
}
