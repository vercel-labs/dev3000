/**
 * Sandbox Agent-Browser - Utilities for browser automation in Vercel Sandbox
 *
 * Uses agent-browser CLI for reliable browser automation in sandbox environments.
 * Preferred over raw CDP for cloud workflows due to better reliability and
 * simpler error handling.
 *
 * Usage:
 *   import { SandboxAgentBrowser } from '@/lib/cloud/sandbox-agent-browser';
 *
 *   const browser = await SandboxAgentBrowser.create(sandbox, { profile: '/tmp/browser-profile' });
 *   await browser.open('https://localhost:3000');
 *   const snapshot = await browser.snapshot();
 *   await browser.screenshot('/tmp/screenshot.png');
 *   await browser.close();
 */

import type { Sandbox } from "@vercel/sandbox"

export interface SandboxAgentBrowserOptions {
  /** Path to persistent browser profile directory */
  profile?: string
  /** Run in headed mode (not supported in sandbox, but kept for API compatibility) */
  headed?: boolean
  /** Session name for isolation */
  session?: string
  /** Working directory for npm commands (default: /vercel/sandbox) */
  cwd?: string
  /** Package manager to use (default: pnpm) */
  packageManager?: "bun" | "pnpm" | "npm" | "yarn"
  /** Enable debug logging (default: false) */
  debug?: boolean
  /** Timeout for commands in milliseconds (default: 30000) */
  timeout?: number
}

export interface AgentBrowserResult {
  success: boolean
  data?: unknown
  error?: string
  stdout: string
  stderr: string
  exitCode: number
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

/** Result from running a command in the sandbox */
interface CommandResult {
  exitCode: number
  stdout: string
  stderr: string
}

/**
 * Helper to run commands in sandbox and collect output
 */
async function runCommand(
  sandbox: Sandbox,
  cmd: string,
  args: string[],
  options?: { cwd?: string; timeout?: number }
): Promise<CommandResult> {
  const result = await sandbox.runCommand({
    cmd,
    args,
    cwd: options?.cwd
  })

  let stdout = ""
  let stderr = ""
  for await (const log of result.logs()) {
    if (log.stream === "stdout") {
      stdout += log.data
    } else {
      stderr += log.data
    }
  }

  await result.wait()

  return {
    exitCode: result.exitCode,
    stdout,
    stderr
  }
}

function shellEscape(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`
}

async function ensureBunInstalled(sandbox: Sandbox, debug = false): Promise<void> {
  const whichResult = await runCommand(sandbox, "sh", ["-c", "command -v bun || true"])
  if (whichResult.stdout.trim()) {
    if (debug) console.log(`[SandboxAgentBrowser] bun found at ${whichResult.stdout.trim()}`)
    return
  }

  if (debug) console.log("[SandboxAgentBrowser] bun not found, installing...")
  const installResult = await runCommand(sandbox, "sh", ["-c", "curl -fsSL https://bun.sh/install | bash"])
  if (installResult.exitCode !== 0) {
    throw new Error(`bun installation failed: ${installResult.stderr}`)
  }

  await runCommand(sandbox, "sh", [
    "-c",
    "mkdir -p /usr/local/bin && ln -sf ~/.bun/bin/bun /usr/local/bin/bun && ln -sf ~/.bun/bin/bunx /usr/local/bin/bunx"
  ])

  if (debug) console.log("[SandboxAgentBrowser] bun installed")
}

/**
 * SandboxAgentBrowser - Browser automation via agent-browser CLI in Vercel Sandbox
 */
export class SandboxAgentBrowser {
  private sandbox: Sandbox
  private options: Required<Pick<SandboxAgentBrowserOptions, "cwd" | "packageManager" | "debug" | "timeout">> &
    SandboxAgentBrowserOptions
  private isInstalled = false

  private constructor(sandbox: Sandbox, options: SandboxAgentBrowserOptions) {
    this.sandbox = sandbox
    this.options = {
      cwd: options.cwd ?? "/vercel/sandbox",
      packageManager: options.packageManager ?? "pnpm",
      debug: options.debug ?? false,
      timeout: options.timeout ?? 30000,
      ...options
    }
  }

  private log(message: string) {
    if (this.options.debug) {
      console.log(`[SandboxAgentBrowser] ${message}`)
    }
  }

  /**
   * Create a new SandboxAgentBrowser instance
   * Installs agent-browser if not already installed
   */
  static async create(sandbox: Sandbox, options: SandboxAgentBrowserOptions = {}): Promise<SandboxAgentBrowser> {
    const instance = new SandboxAgentBrowser(sandbox, options)
    await instance.ensureInstalled()
    return instance
  }

  /**
   * Ensure agent-browser is installed in the sandbox
   */
  async ensureInstalled(): Promise<void> {
    if (this.isInstalled) return

    this.log("Installing agent-browser...")

    const { packageManager, cwd } = this.options
    const addCmd = "add"

    if (packageManager === "bun") {
      await ensureBunInstalled(this.sandbox, this.options.debug)
    }

    const result =
      packageManager === "bun"
        ? await runCommand(
            this.sandbox,
            "sh",
            [
              "-c",
              `export PATH=/usr/local/bin:$PATH; bun ${[addCmd, "agent-browser@latest"].map(shellEscape).join(" ")}`
            ],
            { cwd }
          )
        : await runCommand(this.sandbox, packageManager, [addCmd, "agent-browser@latest"], { cwd })

    if (result.exitCode !== 0) {
      this.log(`Install stderr: ${result.stderr}`)
      throw new Error(`Failed to install agent-browser: exit code ${result.exitCode}`)
    }

    // Run agent-browser install to set up Playwright browsers
    this.log("Running agent-browser install...")
    const installResult =
      packageManager === "bun"
        ? await runCommand(this.sandbox, "sh", ["-c", "export PATH=/usr/local/bin:$PATH; bunx agent-browser install"], {
            cwd
          })
        : await runCommand(this.sandbox, "npx", ["agent-browser", "install"], { cwd })

    if (installResult.exitCode !== 0) {
      this.log(`agent-browser install stderr: ${installResult.stderr}`)
      // Don't throw - install might partially succeed
      this.log("Warning: agent-browser install had issues, continuing anyway")
    }

    this.isInstalled = true
    this.log("agent-browser installed successfully")
  }

  /**
   * Build common CLI arguments
   */
  private buildArgs(): string[] {
    const args: string[] = []

    if (this.options.profile) {
      args.push("--profile", this.options.profile)
    }

    if (this.options.session) {
      args.push("--session", this.options.session)
    }

    // Always use JSON output for parsing
    args.push("--json")

    return args
  }

  /**
   * Execute an agent-browser command
   */
  private async exec(command: string[]): Promise<AgentBrowserResult> {
    const args = [...this.buildArgs(), ...command]
    const fullCommand =
      this.options.packageManager === "bun"
        ? `bunx agent-browser ${args.join(" ")}`
        : `npx agent-browser ${args.join(" ")}`

    this.log(`Executing: ${fullCommand}`)

    const result =
      this.options.packageManager === "bun"
        ? await runCommand(
            this.sandbox,
            "sh",
            ["-c", `export PATH=/usr/local/bin:$PATH; bunx agent-browser ${args.map(shellEscape).join(" ")}`],
            { cwd: this.options.cwd, timeout: this.options.timeout }
          )
        : await runCommand(this.sandbox, "npx", ["agent-browser", ...args], {
            cwd: this.options.cwd,
            timeout: this.options.timeout
          })

    this.log(`Exit code: ${result.exitCode}`)
    if (result.stdout) this.log(`stdout: ${result.stdout.substring(0, 500)}`)
    if (result.stderr) this.log(`stderr: ${result.stderr.substring(0, 500)}`)

    // Try to parse JSON response
    let data: unknown
    try {
      if (result.stdout.trim()) {
        data = JSON.parse(result.stdout.trim())
      }
    } catch {
      // Not JSON, that's ok
    }

    return {
      success: result.exitCode === 0,
      data,
      error: result.exitCode !== 0 ? result.stderr || result.stdout : undefined,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode
    }
  }

  /**
   * Open a URL in the browser
   */
  async open(url: string): Promise<AgentBrowserResult> {
    return this.exec(["open", url])
  }

  /**
   * Take a snapshot of the current page (accessibility tree with refs)
   */
  async snapshot(options: { interactive?: boolean; compact?: boolean } = {}): Promise<SnapshotResult> {
    const args = ["snapshot"]

    if (options.interactive !== false) {
      args.push("-i")
    }

    if (options.compact) {
      args.push("-c")
    }

    const result = await this.exec(args)
    const elements: SnapshotElement[] = []

    try {
      if (result.data && typeof result.data === "object") {
        const parsed = result.data as {
          success?: boolean
          data?: { refs?: Record<string, unknown>; snapshot?: string }
        }
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
        return { elements, raw: parsed.data?.snapshot || result.stdout }
      }
    } catch {
      // Fallback to text parsing
    }

    // Fallback: parse text output
    const refPattern = /@(\w+)\s+(\w+)(?:\s+"([^"]*)")?/g
    const matches = result.stdout.matchAll(refPattern)

    for (const match of matches) {
      elements.push({
        ref: `@${match[1]}`,
        role: match[2],
        name: match[3]
      })
    }

    return { elements, raw: result.stdout }
  }

  /**
   * Click an element by ref or selector
   */
  async click(target: string): Promise<AgentBrowserResult> {
    return this.exec(["click", target])
  }

  /**
   * Type text into the focused element
   */
  async type(text: string): Promise<AgentBrowserResult> {
    return this.exec(["type", text])
  }

  /**
   * Fill an input field
   */
  async fill(target: string, value: string): Promise<AgentBrowserResult> {
    return this.exec(["fill", target, value])
  }

  /**
   * Scroll the page
   */
  async scroll(direction: "up" | "down" | "left" | "right", amount?: number): Promise<AgentBrowserResult> {
    const args = ["scroll", direction]
    if (amount) {
      args.push(String(amount))
    }
    return this.exec(args)
  }

  /**
   * Take a screenshot
   */
  async screenshot(outputPath: string, options: { fullPage?: boolean } = {}): Promise<AgentBrowserResult> {
    const args = ["screenshot", outputPath]
    if (options.fullPage) {
      args.push("--full-page")
    }
    return this.exec(args)
  }

  /**
   * Evaluate JavaScript in the browser
   */
  async evaluate(expression: string): Promise<AgentBrowserResult> {
    return this.exec(["eval", expression])
  }

  /**
   * Get the current URL
   */
  async getCurrentUrl(): Promise<string | null> {
    const result = await this.exec(["url"])
    if (result.success && result.stdout) {
      return result.stdout.trim()
    }
    return null
  }

  /**
   * Get page title
   */
  async getTitle(): Promise<string | null> {
    const result = await this.exec(["title"])
    if (result.success && result.stdout) {
      return result.stdout.trim()
    }
    return null
  }

  /**
   * Reload the page
   */
  async reload(): Promise<AgentBrowserResult> {
    return this.exec(["reload"])
  }

  /**
   * Navigate back
   */
  async back(): Promise<AgentBrowserResult> {
    return this.exec(["back"])
  }

  /**
   * Navigate forward
   */
  async forward(): Promise<AgentBrowserResult> {
    return this.exec(["forward"])
  }

  /**
   * Wait for an element
   */
  async waitFor(selector: string, timeout?: number): Promise<AgentBrowserResult> {
    const args = ["wait", selector]
    if (timeout) {
      args.push("--timeout", String(timeout))
    }
    return this.exec(args)
  }

  /**
   * Close the browser
   */
  async close(): Promise<AgentBrowserResult> {
    return this.exec(["close"])
  }

  /**
   * Get console messages
   */
  async getConsoleMessages(): Promise<string[]> {
    const result = await this.exec(["console"])
    try {
      if (result.data && Array.isArray(result.data)) {
        return result.data as string[]
      }
    } catch {
      // ignore
    }
    return []
  }

  /**
   * Get page errors
   */
  async getErrors(): Promise<string[]> {
    const result = await this.exec(["errors"])
    try {
      if (result.data && Array.isArray(result.data)) {
        return result.data as string[]
      }
    } catch {
      // ignore
    }
    return []
  }
}

// Export convenience functions
export const createSandboxAgentBrowser = SandboxAgentBrowser.create.bind(SandboxAgentBrowser)
