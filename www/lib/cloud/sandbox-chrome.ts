/**
 * Sandbox Chrome - Utilities for running Chrome/Chromium in Vercel Sandbox
 *
 * This module handles the complexity of getting a headless Chrome browser
 * running in the Vercel Sandbox environment (Amazon Linux 2023).
 *
 * Usage:
 *   import { SandboxChrome } from '@/lib/cloud/sandbox-chrome';
 *
 *   const chrome = await SandboxChrome.create(sandbox, { port: 9222 });
 *   console.log(chrome.cdpUrl);  // ws://127.0.0.1:9222/devtools/browser/...
 *   await chrome.close();
 */

import type { Sandbox } from "@vercel/sandbox"

export interface SandboxChromeOptions {
  /** CDP debugging port (default: 9222) */
  port?: number
  /** Run in headless mode (default: true) */
  headless?: boolean
  /** User data directory for Chrome profile (default: /tmp/chrome-profile) */
  userDataDir?: string
  /** Timeout in ms to wait for CDP to be ready (default: 30000) */
  timeout?: number
  /** Working directory for npm commands (default: /vercel/sandbox) */
  cwd?: string
  /** Package manager to use (default: pnpm) */
  packageManager?: "bun" | "pnpm" | "npm" | "yarn"
  /** Enable debug logging (default: false) */
  debug?: boolean
}

export interface SandboxChromeInstance {
  /** The CDP WebSocket URL for connecting to Chrome */
  cdpUrl: string
  /** The path to the Chromium executable */
  executablePath: string
  /** The CDP port */
  port: number
  /** Close the Chrome process */
  close: () => Promise<void>
}

/** Result from running a command in the sandbox */
interface CommandResult {
  exitCode: number
  stdout: string
  stderr: string
}

/**
 * System dependencies required for Chromium on Amazon Linux 2023
 * These provide shared libraries that Chromium needs (nspr, nss, GTK, etc.)
 */
const SYSTEM_DEPENDENCIES = [
  "nspr",
  "nss",
  "atk",
  "at-spi2-atk",
  "cups-libs",
  "libdrm",
  "libxkbcommon",
  "libXcomposite",
  "libXdamage",
  "libXfixes",
  "libXrandr",
  "mesa-libgbm",
  "alsa-lib",
  "cairo",
  "pango",
  "glib2",
  "gtk3",
  "libX11",
  "libXext",
  "libXcursor",
  "libXi",
  "libXtst"
]

/**
 * Chrome flags optimized for serverless/containerized environments
 */
const CHROME_FLAGS = [
  "--headless=new",
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-gpu",
  "--disable-dev-shm-usage",
  "--no-first-run",
  "--disable-background-networking",
  "--disable-default-apps",
  "--disable-extensions",
  "--disable-sync",
  "--disable-translate",
  "--metrics-recording-only",
  "--mute-audio",
  "--no-default-browser-check",
  "--safebrowsing-disable-auto-update"
]

/**
 * Helper to run commands in sandbox and collect output
 */
async function runCommand(
  sandbox: Sandbox,
  cmd: string,
  args: string[],
  options?: { cwd?: string }
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

/**
 * SandboxChrome - Main class for Chrome management in Vercel Sandbox
 */
export class SandboxChrome {
  private constructor() {}

  /**
   * Create and launch a Chrome instance in the sandbox
   *
   * This is the high-level API that handles everything:
   * 1. Installs system dependencies (if needed)
   * 2. Installs @sparticuz/chromium (if needed)
   * 3. Launches Chrome with serverless-optimized flags
   * 4. Waits for CDP to be ready
   *
   * @example
   * const chrome = await SandboxChrome.create(sandbox);
   * console.log(chrome.cdpUrl); // ws://127.0.0.1:9222/devtools/browser/...
   * await chrome.close();
   */
  static async create(sandbox: Sandbox, options: SandboxChromeOptions = {}): Promise<SandboxChromeInstance> {
    const {
      port = 9222,
      headless = true,
      userDataDir = "/tmp/chrome-profile",
      timeout = 30000,
      cwd = "/vercel/sandbox",
      packageManager = "pnpm",
      debug = false
    } = options

    const log = debug ? console.log.bind(console) : () => {}

    // Step 1: Install system dependencies
    log("[SandboxChrome] Installing system dependencies...")
    await SandboxChrome.installSystemDependencies(sandbox, { debug })

    // Step 2: Install @sparticuz/chromium
    log("[SandboxChrome] Installing @sparticuz/chromium...")
    await SandboxChrome.installChromium(sandbox, { cwd, packageManager, debug })

    // Step 3: Get executable path
    log("[SandboxChrome] Getting Chromium executable path...")
    const executablePath = await SandboxChrome.getExecutablePath(sandbox, { cwd, debug })
    log(`[SandboxChrome] Chromium path: ${executablePath}`)

    // Step 4: Launch Chrome
    log("[SandboxChrome] Launching Chrome...")
    const cdpUrl = await SandboxChrome.launch(sandbox, executablePath, {
      port,
      headless,
      userDataDir,
      timeout,
      debug
    })
    log(`[SandboxChrome] CDP URL: ${cdpUrl}`)

    return {
      cdpUrl,
      executablePath,
      port,
      close: async () => {
        log("[SandboxChrome] Closing Chrome...")
        await runCommand(sandbox, "sh", ["-c", `pkill -f "remote-debugging-port=${port}" || true`])
      }
    }
  }

  /**
   * Install system dependencies required for Chromium
   * Uses dnf on Amazon Linux 2023 (the Vercel Sandbox OS)
   */
  static async installSystemDependencies(sandbox: Sandbox, options: { debug?: boolean } = {}): Promise<void> {
    const { debug = false } = options
    const log = debug ? console.log.bind(console) : () => {}

    const depsString = SYSTEM_DEPENDENCIES.join(" ")
    const result = await runCommand(sandbox, "sh", [
      "-c",
      `sudo dnf install -y ${depsString} > /tmp/chrome-deps.log 2>&1`
    ])

    if (result.exitCode !== 0) {
      // Try to get the log for debugging
      const logResult = await runCommand(sandbox, "sh", ["-c", "cat /tmp/chrome-deps.log 2>&1 | tail -20"])
      log(`[SandboxChrome] System deps install log: ${logResult.stdout}`)

      // Don't throw - some deps might already be installed or unavailable
      log(`[SandboxChrome] Warning: System dependencies install exited with code ${result.exitCode}`)
    }
  }

  /**
   * Install @sparticuz/chromium package
   * This provides a pre-compiled Chromium binary designed for serverless environments
   */
  static async installChromium(
    sandbox: Sandbox,
    options: { cwd?: string; packageManager?: "bun" | "pnpm" | "npm" | "yarn"; debug?: boolean } = {}
  ): Promise<void> {
    const { cwd = "/vercel/sandbox", packageManager = "pnpm", debug = false } = options
    const log = debug ? console.log.bind(console) : () => {}

    const addCmd = "add"
    const result = await runCommand(sandbox, packageManager, [addCmd, "@sparticuz/chromium", "puppeteer-core"], { cwd })

    if (result.exitCode !== 0) {
      log(`[SandboxChrome] Chromium install stderr: ${result.stderr}`)
      throw new Error(`Failed to install @sparticuz/chromium: exit code ${result.exitCode}`)
    }
  }

  /**
   * Get the path to the Chromium executable from @sparticuz/chromium
   */
  static async getExecutablePath(sandbox: Sandbox, options: { cwd?: string; debug?: boolean } = {}): Promise<string> {
    const { cwd = "/vercel/sandbox", debug = false } = options
    const log = debug ? console.log.bind(console) : () => {}

    const result = await runCommand(
      sandbox,
      "node",
      ["-e", "require('@sparticuz/chromium').executablePath().then(p => console.log(p))"],
      { cwd }
    )

    if (result.exitCode !== 0 || !result.stdout.trim()) {
      log(`[SandboxChrome] Failed to get executable path: ${result.stderr}`)
      throw new Error(`Failed to get Chromium executable path: ${result.stderr || "no output"}`)
    }

    return result.stdout.trim()
  }

  /**
   * Launch Chrome with CDP enabled
   *
   * @returns The CDP WebSocket URL
   */
  static async launch(
    sandbox: Sandbox,
    executablePath: string,
    options: {
      port?: number
      headless?: boolean
      userDataDir?: string
      timeout?: number
      debug?: boolean
    } = {}
  ): Promise<string> {
    const {
      port = 9222,
      headless = true,
      userDataDir = "/tmp/chrome-profile",
      timeout = 30000,
      debug = false
    } = options
    const log = debug ? console.log.bind(console) : () => {}

    // Build Chrome flags
    const flags = [
      `--remote-debugging-port=${port}`,
      "--remote-debugging-address=127.0.0.1",
      `--user-data-dir=${userDataDir}`
    ]

    if (headless) {
      flags.push("--headless=new")
    }

    // Add serverless-optimized flags
    flags.push(...CHROME_FLAGS.filter((f) => !f.startsWith("--headless")))

    // Launch Chrome in background
    const chromeCmd = `"${executablePath}" ${flags.join(" ")} about:blank &`
    log(`[SandboxChrome] Launch command: ${chromeCmd}`)

    await runCommand(sandbox, "sh", ["-c", chromeCmd])

    // Wait for CDP to be ready
    const cdpUrl = await SandboxChrome.waitForCdp(sandbox, port, timeout, debug)

    return cdpUrl
  }

  /**
   * Wait for Chrome CDP endpoint to be available
   *
   * @returns The CDP WebSocket URL
   */
  static async waitForCdp(sandbox: Sandbox, port: number, timeout: number, debug = false): Promise<string> {
    const log = debug ? console.log.bind(console) : () => {}
    const startTime = Date.now()

    while (Date.now() - startTime < timeout) {
      try {
        const result = await runCommand(sandbox, "sh", [
          "-c",
          `curl -s --max-time 2 http://127.0.0.1:${port}/json/version 2>/dev/null || echo ""`
        ])

        if (result.stdout.trim() && result.stdout.includes("webSocketDebuggerUrl")) {
          const versionInfo = JSON.parse(result.stdout.trim())
          const cdpUrl = versionInfo.webSocketDebuggerUrl as string
          log(`[SandboxChrome] CDP ready: ${cdpUrl}`)
          return cdpUrl
        }
      } catch {
        // CDP not ready yet
      }

      if (debug && (Date.now() - startTime) % 5000 < 1000) {
        log(`[SandboxChrome] Waiting for CDP... (${Math.round((Date.now() - startTime) / 1000)}s)`)
      }

      await new Promise((resolve) => setTimeout(resolve, 500))
    }

    throw new Error(`Chrome CDP not available after ${timeout}ms on port ${port}`)
  }

  /**
   * Run a diagnostic test to verify Chrome can run in the sandbox
   * Useful for debugging Chrome issues
   */
  static async runDiagnostic(
    sandbox: Sandbox,
    executablePath: string,
    options: { debug?: boolean } = {}
  ): Promise<{
    success: boolean
    chromePath: string
    version: string | null
    cdpWorks: boolean
    error: string | null
  }> {
    const { debug = false } = options
    const log = debug ? console.log.bind(console) : () => {}

    const result = {
      success: false,
      chromePath: executablePath,
      version: null as string | null,
      cdpWorks: false,
      error: null as string | null
    }

    try {
      // Test 1: Check if file exists
      log("[SandboxChrome Diagnostic] Checking if Chromium exists...")
      const existsResult = await runCommand(sandbox, "sh", ["-c", `test -f "${executablePath}" && echo "exists"`])
      if (!existsResult.stdout.includes("exists")) {
        result.error = `Chromium not found at ${executablePath}`
        return result
      }

      // Test 2: Get version
      log("[SandboxChrome Diagnostic] Getting Chrome version...")
      const versionResult = await runCommand(sandbox, "sh", ["-c", `"${executablePath}" --version 2>&1`])
      if (versionResult.exitCode === 0) {
        result.version = versionResult.stdout.trim()
        log(`[SandboxChrome Diagnostic] Version: ${result.version}`)
      }

      // Test 3: Test CDP
      log("[SandboxChrome Diagnostic] Testing CDP...")
      const testPort = 9333 // Use different port to avoid conflicts
      const testScript = `
        "${executablePath}" --headless=new --no-sandbox --disable-setuid-sandbox --disable-gpu \\
          --disable-dev-shm-usage --remote-debugging-port=${testPort} \\
          --remote-debugging-address=127.0.0.1 about:blank &
        PID=$!
        sleep 2
        RESULT=$(curl -s --max-time 2 http://127.0.0.1:${testPort}/json/version 2>/dev/null || echo "")
        kill $PID 2>/dev/null
        echo "$RESULT"
      `
      const cdpResult = await runCommand(sandbox, "sh", ["-c", testScript])
      if (cdpResult.stdout.includes("webSocketDebuggerUrl")) {
        result.cdpWorks = true
        log("[SandboxChrome Diagnostic] CDP works!")
      } else {
        result.error = "CDP endpoint not responding"
        log(`[SandboxChrome Diagnostic] CDP test output: ${cdpResult.stdout}`)
      }

      result.success = result.cdpWorks
    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error)
    }

    return result
  }
}

// Also export individual functions for flexibility
export const installSystemDependencies = SandboxChrome.installSystemDependencies.bind(SandboxChrome)
export const installChromium = SandboxChrome.installChromium.bind(SandboxChrome)
export const getExecutablePath = SandboxChrome.getExecutablePath.bind(SandboxChrome)
export const launchChrome = SandboxChrome.launch.bind(SandboxChrome)
export const waitForCdp = SandboxChrome.waitForCdp.bind(SandboxChrome)
export const runChromeDiagnostic = SandboxChrome.runDiagnostic.bind(SandboxChrome)
