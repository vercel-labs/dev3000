import { head, put } from "@vercel/blob"
import { Sandbox, Snapshot } from "@vercel/sandbox"
import ms, { type StringValue } from "ms"
import { SandboxChrome } from "./sandbox-chrome"

// Re-export Snapshot for consumers
export { Snapshot }

// ============================================================
// TIMING UTILITIES
// ============================================================

/**
 * Timing data for sandbox creation steps
 */
export interface SandboxTimingData {
  totalMs: number
  steps: {
    name: string
    durationMs: number
    startedAt: string
  }[]
}

/**
 * Simple timer for measuring step durations
 */
export class StepTimer {
  private steps: { name: string; durationMs: number; startedAt: string }[] = []
  private currentStep: { name: string; start: number; startedAt: string } | null = null
  private totalStart: number

  constructor() {
    this.totalStart = Date.now()
  }

  start(name: string): void {
    // End previous step if any
    if (this.currentStep) {
      this.steps.push({
        name: this.currentStep.name,
        durationMs: Date.now() - this.currentStep.start,
        startedAt: this.currentStep.startedAt
      })
    }
    this.currentStep = { name, start: Date.now(), startedAt: new Date().toISOString() }
  }

  end(): void {
    if (this.currentStep) {
      this.steps.push({
        name: this.currentStep.name,
        durationMs: Date.now() - this.currentStep.start,
        startedAt: this.currentStep.startedAt
      })
      this.currentStep = null
    }
  }

  getData(): SandboxTimingData {
    this.end() // Ensure last step is recorded
    return {
      totalMs: Date.now() - this.totalStart,
      steps: this.steps
    }
  }

  log(prefix = ""): void {
    const data = this.getData()
    console.log(`${prefix}⏱️ TIMING BREAKDOWN (total: ${(data.totalMs / 1000).toFixed(1)}s)`)
    for (const step of data.steps) {
      const secs = (step.durationMs / 1000).toFixed(1)
      const pct = ((step.durationMs / data.totalMs) * 100).toFixed(0)
      console.log(`${prefix}  ${step.name}: ${secs}s (${pct}%)`)
    }
  }
}

// ============================================================
// BASE SNAPSHOT STORAGE (Blob Store)
// ============================================================
//
// We use a SINGLE "base" snapshot that has Chrome + d3k pre-installed.
// This snapshot is shared across ALL repos/projects for maximum reuse.
// After restoring from base snapshot, we clone the repo and install deps.

const BASE_SNAPSHOT_KEY = "d3k-snapshots/base-snapshot.json"

/**
 * Metadata stored for the base snapshot
 */
export interface BaseSnapshotMetadata {
  snapshotId: string
  createdAt: string
  d3kVersion?: string
  description: string
}

/**
 * Save the base snapshot ID to blob store
 */
export async function saveBaseSnapshotId(snapshotId: string, debug = false): Promise<string> {
  const metadata: BaseSnapshotMetadata = {
    snapshotId,
    createdAt: new Date().toISOString(),
    description: "Base d3k snapshot with Chrome system deps and d3k globally installed"
  }

  if (debug) {
    console.log(`  💾 Saving base snapshot ID to blob store: ${BASE_SNAPSHOT_KEY}`)
  }

  const blob = await put(BASE_SNAPSHOT_KEY, JSON.stringify(metadata, null, 2), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true
  })

  if (debug) {
    console.log(`  ✅ Base snapshot ID saved: ${blob.url}`)
  }

  return blob.url
}

/**
 * Load the base snapshot ID from blob store
 */
export async function loadBaseSnapshotId(debug = false): Promise<BaseSnapshotMetadata | null> {
  if (debug) {
    console.log(`  🔍 Looking for base snapshot in blob store: ${BASE_SNAPSHOT_KEY}`)
  }

  try {
    const blobInfo = await head(BASE_SNAPSHOT_KEY)
    if (!blobInfo) {
      if (debug) console.log("  ℹ️ No base snapshot found in blob store")
      return null
    }

    const response = await fetch(blobInfo.url)
    if (!response.ok) {
      if (debug) console.log(`  ⚠️ Failed to fetch base snapshot metadata: ${response.status}`)
      return null
    }

    const metadata = (await response.json()) as BaseSnapshotMetadata

    if (debug) {
      console.log(`  ✅ Found base snapshot: ${metadata.snapshotId}`)
      console.log(`  📅 Created: ${metadata.createdAt}`)
    }

    return metadata
  } catch (error) {
    if (debug) {
      console.log(`  ℹ️ No base snapshot found: ${error instanceof Error ? error.message : String(error)}`)
    }
    return null
  }
}

/**
 * Check if a snapshot is still valid (exists and can be used)
 */
export async function isSnapshotValid(snapshotId: string, debug = false): Promise<boolean> {
  try {
    if (debug) console.log(`  🔍 Checking if snapshot ${snapshotId} is valid...`)
    const snapshot = await Snapshot.get({ snapshotId })
    // Snapshot statuses: "created" (valid), "deleted", "failed"
    const isValid = snapshot.status === "created"
    if (debug) console.log(`  ${isValid ? "✅" : "❌"} Snapshot status: ${snapshot.status}`)
    return isValid
  } catch (error) {
    if (debug) {
      console.log(`  ❌ Snapshot not found or invalid: ${error instanceof Error ? error.message : String(error)}`)
    }
    return false
  }
}

// Legacy exports for backwards compatibility (can be removed later)
export async function saveSnapshotId(
  snapshotId: string,
  _repoUrl: string,
  _branch: string,
  debug = false
): Promise<string> {
  // Now just saves as base snapshot
  return saveBaseSnapshotId(snapshotId, debug)
}

export interface D3kSandboxConfig {
  repoUrl: string
  branch?: string
  timeout?: StringValue
  projectDir?: string
  framework?: string
  packageManager?: "pnpm" | "npm" | "yarn"
  devCommand?: string
  debug?: boolean
}

export interface D3kSandboxResult {
  sandbox: Sandbox
  devUrl: string
  projectName: string
  cleanup: () => Promise<void>
  // TODO: Add bypassToken support
  // The @vercel/sandbox SDK does not currently expose protection bypass tokens.
  // These tokens are needed for headless browser automation to access protected sandboxes.
  // Potential solutions:
  // 1. Extract from response headers (x-vercel-protection-bypass)
  // 2. Use Vercel API to get deployment protection bypass tokens
  // 3. Pass as environment variable if available
  // For now, workflows without bypass tokens will fail when accessing protected sandboxes.
  bypassToken?: string
}

/**
 * Create a Vercel Sandbox with d3k pre-configured and running
 *
 * This sets up a complete d3k environment in the cloud:
 * 1. Creates sandbox from git repo
 * 2. Installs project dependencies
 * 3. Installs d3k globally (pnpm i -g dev3000)
 * 4. Starts d3k (which starts browser + logging)
 * 5. Returns sandbox with devUrl
 */
export async function createD3kSandbox(config: D3kSandboxConfig): Promise<D3kSandboxResult> {
  const {
    repoUrl,
    branch = "main",
    timeout = "30m",
    projectDir = "",
    framework = "Next.js",
    packageManager = "pnpm",
    debug = false
  } = config

  const projectName = projectDir || repoUrl.split("/").pop()?.replace(".git", "") || "app"

  if (debug) {
    console.log("🚀 Creating d3k sandbox...")
    console.log(`  Repository: ${repoUrl}`)
    console.log(`  Branch/SHA: ${branch}${branch.length === 40 ? " (git commit SHA)" : " (branch name)"}`)
    console.log(`  Project: ${projectName}`)
    console.log(`  Framework: ${framework}`)
  }

  // Check for required credentials
  const token = process.env.VERCEL_TOKEN || process.env.VERCEL_OIDC_TOKEN
  if (!token) {
    throw new Error(
      "Missing VERCEL_TOKEN or VERCEL_OIDC_TOKEN environment variable. " +
        "Vercel AI Workflows should automatically provide VERCEL_OIDC_TOKEN. " +
        "Check your workflow configuration and ensure it has access to Vercel API credentials."
    )
  }

  if (debug) {
    console.log(`  Token type: ${process.env.VERCEL_OIDC_TOKEN ? "OIDC" : "static"}`)
  }

  // Helper function to run commands and collect output properly
  async function runCommandWithLogs(
    sandbox: Sandbox,
    options: Parameters<Sandbox["runCommand"]>[0]
  ): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    const result = await sandbox.runCommand(options)

    let stdout = ""
    let stderr = ""
    for await (const log of result.logs()) {
      if (log.stream === "stdout") {
        stdout += log.data
        if (debug && options.stdout !== process.stdout) console.log(log.data)
      } else {
        stderr += log.data
        if (debug && options.stderr !== process.stderr) console.debug(log.data)
      }
    }

    await result.wait()

    return {
      exitCode: result.exitCode,
      stdout,
      stderr
    }
  }

  // Create sandbox WITHOUT source parameter
  // We'll manually clone the repo after sandbox creation for better control
  const timeoutMs = ms(timeout)
  if (typeof timeoutMs !== "number") {
    throw new Error(`Invalid timeout value: ${timeout}`)
  }
  const sandbox = await Sandbox.create({
    resources: { vcpus: 8 },
    timeout: timeoutMs,
    ports: [3000], // App port
    runtime: "node22"
  })

  if (debug) console.log("  ✅ Sandbox created")

  try {
    const sandboxCwd = projectDir ? `/vercel/sandbox/${projectDir}` : "/vercel/sandbox"

    // Manually clone the repository
    if (debug) console.log(`  📦 Cloning repository: ${repoUrl}`)

    // Create the target directory
    const mkdirResult = await runCommandWithLogs(sandbox, {
      cmd: "mkdir",
      args: ["-p", sandboxCwd]
    })

    if (mkdirResult.exitCode !== 0) {
      throw new Error(`Failed to create directory ${sandboxCwd}: ${mkdirResult.stderr}`)
    }

    // Clone the repository
    const gitArgs = ["clone"]
    const repoUrlWithGit = repoUrl.endsWith(".git") ? repoUrl : `${repoUrl}.git`
    const isCommitSha = /^[0-9a-f]{40}$/i.test(branch)

    if (!isCommitSha) {
      // Shallow clone and target the requested branch when we're not pinning a commit
      gitArgs.push("--depth", "1")
      if (branch) {
        gitArgs.push("--branch", branch)
      }
    } else if (debug) {
      console.log("  ⚠️ Provided branch is a commit SHA - performing full clone to allow checkout")
    }

    gitArgs.push(repoUrlWithGit, sandboxCwd)

    const gitClone = await runCommandWithLogs(sandbox, {
      cmd: "git",
      args: gitArgs,
      env: {
        GIT_TERMINAL_PROMPT: "0"
      }
    })

    if (gitClone.exitCode !== 0) {
      throw new Error(`Git clone failed with exit code: ${gitClone.exitCode}. Error: ${gitClone.stderr}`)
    }

    // Ensure we are on the requested branch or commit (commit SHA requires checkout after full clone)
    if (branch) {
      if (debug) console.log(`  🔀 Checking out ref: ${branch}`)
      const gitCheckout = await runCommandWithLogs(sandbox, {
        cmd: "git",
        args: ["checkout", branch],
        cwd: sandboxCwd,
        env: {
          GIT_TERMINAL_PROMPT: "0"
        }
      })

      if (gitCheckout.exitCode !== 0) {
        throw new Error(`Git checkout failed with exit code: ${gitCheckout.exitCode}. Error: ${gitCheckout.stderr}`)
      }
    }

    if (debug) console.log("  ✅ Repository cloned")

    // Verify sandbox directory contents
    if (debug) console.log("  📂 Checking sandbox directory contents...")
    try {
      const lsResult = await runCommandWithLogs(sandbox, {
        cmd: "ls",
        args: ["-la", sandboxCwd]
      })
      if (lsResult.exitCode === 0) {
        console.log(`  📂 Contents of ${sandboxCwd}:`)
        console.log(lsResult.stdout)
      } else {
        console.log("  ⚠️ Could not read directory listing")
      }
    } catch (error) {
      console.log(`  ⚠️ Could not list directory: ${error instanceof Error ? error.message : String(error)}`)
    }

    // Check for package.json
    if (debug) console.log("  📄 Verifying package.json exists...")
    try {
      const pkgCheck = await runCommandWithLogs(sandbox, {
        cmd: "test",
        args: ["-f", `${sandboxCwd}/package.json`]
      })
      if (pkgCheck.exitCode === 0) {
        console.log("  ✅ package.json found")
      } else {
        console.log("  ⚠️ WARNING: package.json not found in sandbox directory")
      }
    } catch (error) {
      console.log(`  ⚠️ Could not check for package.json: ${error instanceof Error ? error.message : String(error)}`)
    }

    // Install project dependencies
    if (debug) console.log("  📦 Installing project dependencies...")
    const installResult = await runCommandWithLogs(sandbox, {
      cmd: packageManager,
      args: ["install"],
      cwd: sandboxCwd,
      stdout: debug ? process.stdout : undefined,
      stderr: debug ? process.stderr : undefined
    })

    if (installResult.exitCode !== 0) {
      throw new Error(`Project dependency installation failed with exit code ${installResult.exitCode}`)
    }

    if (debug) console.log("  ✅ Project dependencies installed")

    // Install Chrome/Chromium using the SandboxChrome module
    // This handles system dependencies, @sparticuz/chromium installation, and path extraction
    if (debug) console.log("  🔧 Setting up Chrome using SandboxChrome module...")

    await SandboxChrome.installSystemDependencies(sandbox, { debug })
    if (debug) console.log("  ✅ System dependencies installed")

    await SandboxChrome.installChromium(sandbox, { cwd: sandboxCwd, packageManager, debug })
    if (debug) console.log("  ✅ @sparticuz/chromium installed")

    let chromiumPath: string
    try {
      chromiumPath = await SandboxChrome.getExecutablePath(sandbox, { cwd: sandboxCwd, debug })
      if (debug) console.log(`  ✅ Chromium path: ${chromiumPath}`)
    } catch (error) {
      console.log(
        `  ⚠️ Could not get Chromium path, using fallback: ${error instanceof Error ? error.message : String(error)}`
      )
      chromiumPath = "/usr/bin/chromium" // fallback
    }

    // Run Chrome diagnostic test using SandboxChrome module
    if (debug) {
      console.log("  🔍 ===== CHROMIUM DIAGNOSTIC TEST =====")
      const diagnostic = await SandboxChrome.runDiagnostic(sandbox, chromiumPath, { debug })
      console.log(`  📋 Diagnostic result:`)
      console.log(`     Path: ${diagnostic.chromePath}`)
      console.log(`     Version: ${diagnostic.version || "unknown"}`)
      console.log(`     CDP works: ${diagnostic.cdpWorks ? "✅ Yes" : "❌ No"}`)
      if (diagnostic.error) console.log(`     Error: ${diagnostic.error}`)
      console.log("  🔍 ===== END CHROMIUM DIAGNOSTIC TEST =====")
    }

    // Install d3k globally from npm (always use latest)
    if (debug) console.log("  📦 Installing d3k globally from npm (dev3000@latest)")
    const d3kInstallResult = await runCommandWithLogs(sandbox, {
      cmd: "pnpm",
      args: ["i", "-g", "dev3000@latest"],
      stdout: debug ? process.stdout : undefined,
      stderr: debug ? process.stderr : undefined
    })

    if (d3kInstallResult.exitCode !== 0) {
      throw new Error(`d3k installation failed with exit code ${d3kInstallResult.exitCode}`)
    }

    if (debug) console.log("  ✅ d3k installed globally")

    // Start d3k (which starts browser + logging)
    if (debug) console.log("  🚀 Starting d3k...")
    if (debug) console.log(`  📂 Working directory: ${sandboxCwd}`)

    // Use chromium path from @sparticuz/chromium (or fallback)
    if (debug)
      console.log(
        `  🔧 Command: cd ${sandboxCwd} && d3k --no-tui --debug --headless --auto-skills --agent-name codex --browser ${chromiumPath}`
      )

    // Start d3k in detached mode with --headless flag
    // This tells d3k to launch Chrome in headless mode, which works in serverless environments
    // We explicitly pass --browser with the path from @sparticuz/chromium
    // Logs are written to /home/vercel-sandbox/.d3k/logs/ and can be read later.
    // IMPORTANT: Do NOT start infinite log streaming loops here - they prevent
    // the workflow step function from completing properly.
    // DIAGNOSTIC: Also capture stdout/stderr to d3k-startup.log for debugging
    const d3kStartupLog = "/home/vercel-sandbox/.d3k/logs/d3k-startup.log"
    await sandbox.runCommand({
      cmd: "sh",
      args: [
        "-c",
        `mkdir -p /home/vercel-sandbox/.d3k/logs && cd ${sandboxCwd} && d3k --no-tui --debug --headless --auto-skills --agent-name codex --browser ${chromiumPath} > ${d3kStartupLog} 2>&1`
      ],
      detached: true
    })

    if (debug) console.log("  ✅ d3k started in detached mode (headless)")

    // Give d3k a moment to start and create log files
    if (debug) console.log("  ⏳ Waiting for d3k to start...")
    await new Promise((resolve) => setTimeout(resolve, 5000))

    // Debug: Check d3k process and log files
    if (debug) {
      console.log("  🔍 Checking d3k process status...")
      const psCheck = await runCommandWithLogs(sandbox, {
        cmd: "sh",
        args: ["-c", "ps aux | grep -E '(d3k|pnpm|next)' | grep -v grep || echo 'No d3k/pnpm/next processes found'"]
      })
      console.log(`  📋 Process list:\n${psCheck.stdout}`)

      console.log("  🔍 Checking for d3k log files...")
      const logsCheck = await runCommandWithLogs(sandbox, {
        cmd: "sh",
        args: ["-c", "ls -lah /home/vercel-sandbox/.d3k/logs/ 2>/dev/null || echo 'No .d3k/logs directory found'"]
      })
      console.log(`  📋 Log files:\n${logsCheck.stdout}`)

      // Check ALL d3k log files for initial content
      const allLogsCheck = await runCommandWithLogs(sandbox, {
        cmd: "sh",
        args: [
          "-c",
          'for log in /home/vercel-sandbox/.d3k/logs/*.log; do [ -f "$log" ] && echo "=== $log ===" && head -50 "$log" || true; done 2>/dev/null || true'
        ]
      })
      console.log(`  📋 Initial log content:\n${allLogsCheck.stdout}`)
    }

    // Note: We do NOT start infinite log streaming loops here because they prevent
    // the workflow step function from completing. Logs are written to files and can
    // be read synchronously when needed (see checks above).

    // Wait for dev server to be ready
    if (debug) console.log("  ⏳ Waiting for dev server on port 3000...")
    try {
      await waitForServer(sandbox, 3000, 120000, debug) // 2 minutes for d3k to start everything
    } catch (error) {
      // If dev server didn't start, try to get diagnostic info
      console.log(`  ⚠️ Dev server failed to start: ${error instanceof Error ? error.message : String(error)}`)
      console.log("  🔍 Checking d3k logs for errors...")

      try {
        // d3k creates log files with pattern: {projectName}-{timestamp}.log
        // Use cat with wildcard to capture all log files
        const logsCheck = await runCommandWithLogs(sandbox, {
          cmd: "sh",
          args: ["-c", "cat /home/vercel-sandbox/.d3k/logs/*.log 2>/dev/null || echo 'No log files found'"]
        })
        if (logsCheck.exitCode === 0) {
          console.log("  📋 All d3k logs:")
          console.log(logsCheck.stdout)
        }
      } catch (logError) {
        console.log(`  ⚠️ Could not read d3k logs: ${logError instanceof Error ? logError.message : String(logError)}`)
      }

      throw error
    }

    const devUrl = sandbox.domain(3000)
    if (debug) console.log(`  ✅ Dev server ready: ${devUrl}`)

    // Wait for CDP URL to be available (needed for browser automation)
    // This is more reliable than a fixed timeout because it actually waits for
    // d3k to connect to Chrome and write the CDP URL to the session file
    if (debug) console.log("  ⏳ Waiting for d3k to initialize Chrome and populate CDP URL...")
    const cdpUrl = await waitForCdpUrl(sandbox, 30000, debug) // 30 second timeout
    if (cdpUrl) {
      if (debug) console.log(`  ✅ CDP URL ready: ${cdpUrl}`)

      // CRITICAL: Wait for d3k to complete navigation to the app
      // d3k writes session info BEFORE navigating, so CDP URL being ready doesn't
      // mean the page has loaded. We need to wait for navigation to complete.
      if (debug) console.log("  ⏳ Waiting for d3k to complete page navigation...")
      await waitForPageNavigation(sandbox, 30000, debug)
    } else {
      console.log("  ⚠️ CDP URL not found - browser automation features may not work")
      // DIAGNOSTIC: Dump all logs immediately when CDP fails - this is critical for debugging
      console.log("  📋 === d3k LOG DUMP (CDP URL not found) ===")
      try {
        const cdpFailLogs = await runCommandWithLogs(sandbox, {
          cmd: "sh",
          args: [
            "-c",
            'for log in /home/vercel-sandbox/.d3k/logs/*.log; do [ -f "$log" ] && echo "\\n=== $log ===" && cat "$log" || true; done 2>/dev/null || echo "No log files found"'
          ]
        })
        console.log(cdpFailLogs.stdout)
      } catch (logErr) {
        console.log(`  ⚠️ Could not read logs: ${logErr instanceof Error ? logErr.message : String(logErr)}`)
      }
      console.log("  📋 === END d3k LOG DUMP ===")
    }

    // Dump ALL d3k logs after initialization for debugging
    // This is critical for understanding what d3k is doing in the sandbox
    if (debug) {
      console.log("  📋 === d3k FULL LOG DUMP (after initialization) ===")
      const fullLogsCheck = await runCommandWithLogs(sandbox, {
        cmd: "sh",
        args: [
          "-c",
          'for log in /home/vercel-sandbox/.d3k/logs/*.log; do [ -f "$log" ] && echo "\\n=== $log ===" && cat "$log" || true; done 2>/dev/null || echo "No log files found"'
        ]
      })
      console.log(fullLogsCheck.stdout)
      console.log("  📋 === END d3k LOG DUMP ===")
    }

    // Verify we can actually fetch the dev server URL
    console.log(`  🔍 Testing dev server accessibility at ${devUrl}...`)
    try {
      const testResponse = await fetch(devUrl, {
        method: "GET",
        redirect: "manual" // Don't follow redirects
      })
      console.log(`  ✅ Dev server responded with status: ${testResponse.status} ${testResponse.statusText}`)

      if (testResponse.status === 308 || testResponse.status === 401) {
        console.log(
          `  ℹ️ Dev server returned ${testResponse.status}, this is expected for protected deployments (use bypass token)`
        )
      }
    } catch (error) {
      console.log(`  ⚠️ WARNING: Could not fetch dev server: ${error instanceof Error ? error.message : String(error)}`)
    }

    if (debug) console.log("  ✅ d3k sandbox ready!")

    return {
      sandbox,
      devUrl,
      projectName,
      // TODO: Implement bypass token extraction
      // The @vercel/sandbox SDK doesn't expose bypass tokens.
      // Until this is implemented, protected sandboxes will fail in headless browser automation.
      bypassToken: undefined,
      cleanup: async () => {
        if (debug) console.log("  🧹 Cleaning up sandbox...")
        await sandbox.stop()
        if (debug) console.log("  ✅ Sandbox stopped")
      }
    }
  } catch (error) {
    // Clean up on error
    try {
      await sandbox.stop()
    } catch {
      // Ignore cleanup errors
    }
    throw error
  }
}

/**
 * Wait for a port to become available on the sandbox
 */
async function waitForServer(sandbox: Sandbox, port: number, timeoutMs: number, debug = false): Promise<void> {
  const startTime = Date.now()
  const url = sandbox.domain(port)
  let lastError: string | undefined
  let lastStatus: number | undefined

  while (Date.now() - startTime < timeoutMs) {
    try {
      const response = await fetch(url, { method: "HEAD", redirect: "manual" })
      lastStatus = response.status

      if (debug && response.status !== lastStatus) {
        console.log(`  🔍 Port ${port} check: status ${response.status} ${response.statusText}`)
      }

      // Consider server ready if:
      // - 2xx (ok)
      // - 404 (server responding but route not found)
      // - 308 (redirect - sandbox protection)
      // - 401 (auth required - sandbox protection)
      if (response.ok || response.status === 404 || response.status === 308 || response.status === 401) {
        if (debug) console.log(`  ✅ Port ${port} is ready (status ${response.status})`)
        return
      }

      // Log unexpected status codes
      if (response.status >= 400 && response.status !== 404) {
        lastError = `HTTP ${response.status} ${response.statusText}`
        if (debug) console.log(`  ⚠️ Port ${port} returned ${lastError}`)
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      if (lastError !== errorMsg) {
        lastError = errorMsg
        if (debug) console.log(`  ⚠️ Port ${port} check failed: ${errorMsg}`)
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 1000))
  }

  throw new Error(
    `Server on port ${port} did not become ready within ${timeoutMs}ms. ` +
      `Last status: ${lastStatus ?? "no response"}, Last error: ${lastError ?? "none"}`
  )
}

/**
 * Wait for d3k to populate the CDP URL in its session file
 * This is necessary because d3k writes the session file before Chrome is fully connected,
 * and we need the CDP URL to be available before using browser automation.
 */
async function waitForCdpUrl(sandbox: Sandbox, timeoutMs: number, debug = false): Promise<string | null> {
  const startTime = Date.now()
  let cdpUrl: string | null = null

  while (Date.now() - startTime < timeoutMs) {
    try {
      // Read the session files from ~/.d3k/ in the sandbox
      const cmdResult = await sandbox.runCommand({
        cmd: "sh",
        args: [
          "-c",
          'for f in /home/vercel-sandbox/.d3k/*.json; do [ -f "$f" ] && cat "$f" 2>/dev/null && echo ""; done'
        ]
      })

      // Collect logs from the command
      let stdout = ""
      for await (const log of cmdResult.logs()) {
        if (log.stream === "stdout") {
          stdout += log.data
        }
      }
      await cmdResult.wait()

      const result = { exitCode: cmdResult.exitCode, stdout }

      if (result.exitCode === 0 && result.stdout.trim()) {
        // Parse each JSON object (one per line)
        const lines = result.stdout.trim().split("\n")
        for (const line of lines) {
          if (line.trim().startsWith("{")) {
            try {
              const sessionData = JSON.parse(line)
              if (sessionData.cdpUrl?.startsWith("ws://")) {
                cdpUrl = sessionData.cdpUrl
                if (debug) {
                  console.log(`  ✅ CDP URL found: ${cdpUrl}`)
                }
                return cdpUrl
              }
            } catch {
              // Skip invalid JSON lines
            }
          }
        }
      }

      if (debug && (Date.now() - startTime) % 5000 < 1000) {
        console.log(`  ⏳ Waiting for CDP URL... (${Math.round((Date.now() - startTime) / 1000)}s)`)
      }
    } catch (error) {
      if (debug) {
        console.log(`  ⚠️ Error checking CDP URL: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 1000))
  }

  if (debug) {
    console.log(`  ⚠️ CDP URL not available after ${timeoutMs}ms - browser automation may not work`)
  }
  return null
}

/**
 * Wait for d3k to complete navigation to the app page
 * d3k logs "[CDP] Navigated to http://localhost:PORT" when navigation is initiated.
 * We look for evidence in logs that the page has started loading.
 */
async function waitForPageNavigation(sandbox: Sandbox, timeoutMs: number, debug = false): Promise<boolean> {
  const startTime = Date.now()

  // Helper function to run commands and collect output
  async function runCommandWithLogs(
    sandbox: Sandbox,
    options: Parameters<Sandbox["runCommand"]>[0]
  ): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    const result = await sandbox.runCommand(options)
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
    return { exitCode: result.exitCode, stdout, stderr }
  }

  while (Date.now() - startTime < timeoutMs) {
    try {
      // Check d3k logs for evidence of navigation
      // d3k logs "[CDP] Navigated to http://localhost:PORT" after Page.navigate
      const logsResult = await runCommandWithLogs(sandbox, {
        cmd: "sh",
        args: [
          "-c",
          'grep -r "Navigated to http://localhost" /home/vercel-sandbox/.d3k/logs/*.log 2>/dev/null | head -1 || true'
        ]
      })

      if (logsResult.stdout.includes("Navigated to http://localhost")) {
        if (debug) {
          console.log(`  ✅ d3k has navigated to the app (detected in logs)`)
        }

        // Wait an additional 3 seconds for the page to fully load and settle
        // This gives time for JavaScript to execute and CLS metrics to be captured
        if (debug) {
          console.log(`  ⏳ Waiting 3 more seconds for page to fully load...`)
        }
        await new Promise((resolve) => setTimeout(resolve, 3000))

        return true
      }

      if (debug && (Date.now() - startTime) % 5000 < 1000) {
        console.log(`  ⏳ Waiting for page navigation... (${Math.round((Date.now() - startTime) / 1000)}s)`)
      }
    } catch (error) {
      if (debug) {
        console.log(`  ⚠️ Error checking for navigation: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 1000))
  }

  // If we didn't detect navigation in logs, still wait a bit as a fallback
  // The page might have loaded but logging might not have captured it
  if (debug) {
    console.log(`  ⚠️ Did not detect navigation in logs after ${timeoutMs}ms, waiting 5s as fallback...`)
  }
  await new Promise((resolve) => setTimeout(resolve, 5000))
  return false
}

// ============================================================
// SNAPSHOTTING SUPPORT
// ============================================================

/**
 * Configuration for creating a sandbox from a snapshot
 */
export interface D3kSandboxFromSnapshotConfig {
  snapshotId: string
  timeout?: StringValue
  debug?: boolean
}

/**
 * Create a d3k sandbox from an existing snapshot
 *
 * This is much faster than creating from scratch because all dependencies,
 * Chrome, and d3k are already installed in the snapshot.
 *
 * NOTE: The snapshot must have been created from a d3k sandbox that was
 * fully initialized (dependencies installed, d3k installed, Chrome installed).
 * The snapshot does NOT include the running d3k process - you need to start it
 * after creating from snapshot.
 *
 * @param config - Configuration for snapshot-based sandbox creation
 * @returns D3kSandboxResult with sandbox and URLs
 */
export async function createD3kSandboxFromSnapshot(config: D3kSandboxFromSnapshotConfig): Promise<D3kSandboxResult> {
  const { snapshotId, timeout = "30m", debug = false } = config

  if (debug) {
    console.log("🚀 Creating d3k sandbox from snapshot...")
    console.log(`  Snapshot ID: ${snapshotId}`)
  }

  // Check for required credentials
  const token = process.env.VERCEL_TOKEN || process.env.VERCEL_OIDC_TOKEN
  if (!token) {
    throw new Error(
      "Missing VERCEL_TOKEN or VERCEL_OIDC_TOKEN environment variable. " +
        "Vercel AI Workflows should automatically provide VERCEL_OIDC_TOKEN. " +
        "Check your workflow configuration and ensure it has access to Vercel API credentials."
    )
  }

  const timeoutMs = ms(timeout)
  if (typeof timeoutMs !== "number") {
    throw new Error(`Invalid timeout value: ${timeout}`)
  }

  // Create sandbox from snapshot - this is the key speedup!
  // The snapshot already has dependencies installed, Chrome ready, etc.
  const sandbox = await Sandbox.create({
    source: {
      type: "snapshot",
      snapshotId
    },
    timeout: timeoutMs,
    ports: [3000] // App port
  })

  if (debug) console.log(`  ✅ Sandbox created from snapshot: ${sandbox.sandboxId}`)

  const sandboxCwd = "/vercel/sandbox"

  // Helper function to run commands and collect output properly
  async function runCommandWithLogs(
    sandbox: Sandbox,
    options: Parameters<Sandbox["runCommand"]>[0]
  ): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    const result = await sandbox.runCommand(options)

    let stdout = ""
    let stderr = ""
    for await (const log of result.logs()) {
      if (log.stream === "stdout") {
        stdout += log.data
        if (debug && options.stdout !== process.stdout) console.log(log.data)
      } else {
        stderr += log.data
        if (debug && options.stderr !== process.stderr) console.debug(log.data)
      }
    }

    await result.wait()

    return {
      exitCode: result.exitCode,
      stdout,
      stderr
    }
  }

  try {
    // Get chromium path - it should already be installed in the snapshot
    let chromiumPath: string
    try {
      chromiumPath = await SandboxChrome.getExecutablePath(sandbox, { cwd: sandboxCwd, debug })
      if (debug) console.log(`  ✅ Chromium path: ${chromiumPath}`)
    } catch (error) {
      console.log(
        `  ⚠️ Could not get Chromium path, using fallback: ${error instanceof Error ? error.message : String(error)}`
      )
      chromiumPath = "/usr/bin/chromium" // fallback
    }

    // Start d3k (it should already be installed in the snapshot)
    if (debug) console.log("  🚀 Starting d3k...")
    const d3kStartupLog = "/home/vercel-sandbox/.d3k/logs/d3k-startup.log"
    await sandbox.runCommand({
      cmd: "sh",
      args: [
        "-c",
        `mkdir -p /home/vercel-sandbox/.d3k/logs && cd ${sandboxCwd} && d3k --no-tui --debug --headless --browser ${chromiumPath} > ${d3kStartupLog} 2>&1`
      ],
      detached: true
    })

    if (debug) console.log("  ✅ d3k started in detached mode (headless)")

    // Wait for d3k to start
    if (debug) console.log("  ⏳ Waiting for d3k to start...")
    await new Promise((resolve) => setTimeout(resolve, 5000))

    // Wait for dev server
    if (debug) console.log("  ⏳ Waiting for dev server on port 3000...")
    await waitForServer(sandbox, 3000, 120000, debug)

    const devUrl = sandbox.domain(3000)
    if (debug) console.log(`  ✅ Dev server ready: ${devUrl}`)

    // Wait for CDP URL
    if (debug) console.log("  ⏳ Waiting for d3k to initialize Chrome...")
    const cdpUrl = await waitForCdpUrl(sandbox, 30000, debug)
    if (cdpUrl) {
      if (debug) console.log(`  ✅ CDP URL ready: ${cdpUrl}`)
      await waitForPageNavigation(sandbox, 30000, debug)
    } else {
      console.log("  ⚠️ CDP URL not found - browser automation features may not work")
    }

    // Extract project name from the sandbox directory
    const projectNameResult = await runCommandWithLogs(sandbox, {
      cmd: "sh",
      args: ["-c", `cd ${sandboxCwd} && basename $(pwd)`]
    })
    const projectName = projectNameResult.stdout.trim() || "app"

    if (debug) console.log("  ✅ d3k sandbox from snapshot ready!")

    return {
      sandbox,
      devUrl,
      projectName,
      bypassToken: undefined,
      cleanup: async () => {
        if (debug) console.log("  🧹 Cleaning up sandbox...")
        await sandbox.stop()
        if (debug) console.log("  ✅ Sandbox stopped")
      }
    }
  } catch (error) {
    try {
      await sandbox.stop()
    } catch {
      // Ignore cleanup errors
    }
    throw error
  }
}

/**
 * Create a snapshot from an existing d3k sandbox
 *
 * This is useful for creating a "base" snapshot that can be reused for
 * future workflows. The snapshot captures the state of the sandbox including:
 * - Installed dependencies
 * - Chrome/Chromium installation
 * - d3k global installation
 * - Any files in /vercel/sandbox
 *
 * NOTE: Creating a snapshot STOPS the sandbox. Plan accordingly.
 *
 * @param sandbox - The sandbox to snapshot
 * @param debug - Whether to log debug info
 * @returns The created Snapshot object
 */
export async function createSnapshotFromSandbox(sandbox: Sandbox, debug = false): Promise<Snapshot> {
  if (debug) {
    console.log(`  📸 Creating snapshot from sandbox ${sandbox.sandboxId}...`)
    console.log("  ⚠️ Note: This will stop the sandbox")
  }

  const snapshot = await sandbox.snapshot()

  if (debug) {
    console.log(`  ✅ Snapshot created: ${snapshot.snapshotId}`)
    console.log(`  Source sandbox: ${snapshot.sourceSandboxId}`)
    console.log(`  Status: ${snapshot.status}`)
  }

  return snapshot
}

/**
 * Get an existing snapshot by ID
 *
 * @param snapshotId - The snapshot ID to retrieve
 * @returns The Snapshot object
 */
export async function getSnapshot(snapshotId: string): Promise<Snapshot> {
  return Snapshot.get({ snapshotId })
}

/**
 * Delete a snapshot
 *
 * @param snapshotId - The snapshot ID to delete
 * @param debug - Whether to log debug info
 */
export async function deleteSnapshot(snapshotId: string, debug = false): Promise<void> {
  if (debug) {
    console.log(`  🗑️ Deleting snapshot ${snapshotId}...`)
  }

  const snapshot = await Snapshot.get({ snapshotId })
  await snapshot.delete()

  if (debug) {
    console.log("  ✅ Snapshot deleted")
  }
}

// ============================================================
// SMART SANDBOX CREATION (with automatic base snapshot management)
// ============================================================
//
// Uses a SINGLE shared "base" snapshot with Chrome + d3k pre-installed.
// This base snapshot is shared across ALL repos/projects for maximum reuse.
// After restoring from base snapshot, we clone the repo and install deps.

/**
 * Extended result that includes snapshot info and timing
 */
export interface D3kSandboxResultWithSnapshot extends D3kSandboxResult {
  /** Whether this sandbox was created from a base snapshot */
  fromSnapshot: boolean
  /** The base snapshot ID used */
  snapshotId?: string
  /** Timing data for each step */
  timing: SandboxTimingData
}

/**
 * Create a base snapshot with Chrome system deps + d3k installed.
 * This is a one-time operation - the snapshot is reused across all projects.
 */
async function createAndSaveBaseSnapshot(timeoutMs: number, debug = false): Promise<string> {
  if (debug) {
    console.log("  📦 Creating base snapshot (Chrome + d3k)...")
    console.log("  ⚠️ This is a one-time operation for initial setup")
  }

  // Create empty sandbox for base snapshot
  const baseSandbox = await Sandbox.create({
    resources: { vcpus: 8 },
    timeout: timeoutMs,
    ports: [3000],
    runtime: "node22"
  })

  if (debug) console.log(`  ✅ Base sandbox created: ${baseSandbox.sandboxId}`)

  // Helper to run commands
  async function runCmd(
    cmd: string,
    args: string[],
    opts?: { cwd?: string }
  ): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    const result = await baseSandbox.runCommand({ cmd, args, cwd: opts?.cwd })
    let stdout = ""
    let stderr = ""
    for await (const log of result.logs()) {
      if (log.stream === "stdout") {
        stdout += log.data
        if (debug) console.log(log.data)
      } else {
        stderr += log.data
        if (debug) console.debug(log.data)
      }
    }
    await result.wait()
    return { exitCode: result.exitCode, stdout, stderr }
  }

  try {
    // Install Chrome system dependencies
    if (debug) console.log("  🔧 Installing Chrome system dependencies...")
    await SandboxChrome.installSystemDependencies(baseSandbox, { debug })
    if (debug) console.log("  ✅ Chrome system dependencies installed")

    // Install d3k globally
    if (debug) console.log("  📦 Installing d3k globally...")
    const d3kInstall = await runCmd("pnpm", ["i", "-g", "dev3000@latest"])
    if (d3kInstall.exitCode !== 0) {
      throw new Error(`d3k installation failed: ${d3kInstall.stderr}`)
    }
    if (debug) console.log("  ✅ d3k installed globally")

    // Install agent-browser globally for CLI browser automation
    if (debug) console.log("  📦 Installing agent-browser globally...")
    const agentBrowserInstall = await runCmd("pnpm", ["i", "-g", "agent-browser@latest"])
    if (agentBrowserInstall.exitCode !== 0) {
      // Don't fail - agent-browser is optional, workflow can run without it
      if (debug) console.log(`  ⚠️ agent-browser install warning: ${agentBrowserInstall.stderr}`)
    } else {
      if (debug) console.log("  ✅ agent-browser installed globally")
      // Run agent-browser install to set up Playwright browsers
      if (debug) console.log("  🔧 Running agent-browser install (Playwright setup)...")
      const playwrightInstall = await runCmd("npx", ["agent-browser", "install"])
      if (playwrightInstall.exitCode !== 0) {
        if (debug) console.log(`  ⚠️ Playwright browser install warning: ${playwrightInstall.stderr}`)
      } else {
        if (debug) console.log("  ✅ Playwright browsers installed")
      }
    }

    // Create snapshot (this stops the sandbox)
    if (debug) console.log("  📸 Creating snapshot...")
    const snapshot = await baseSandbox.snapshot()
    if (debug) console.log(`  ✅ Base snapshot created: ${snapshot.snapshotId}`)

    // Save to blob store
    await saveBaseSnapshotId(snapshot.snapshotId, debug)

    return snapshot.snapshotId
  } catch (error) {
    // Clean up on failure
    try {
      await baseSandbox.stop()
    } catch {
      // Ignore cleanup errors
    }
    throw error
  }
}

/**
 * Get or create a d3k sandbox with automatic base snapshot management
 *
 * This is the recommended way to create sandboxes for workflows:
 * 1. Checks blob store for a shared "base" snapshot (Chrome + d3k installed)
 * 2. If no base snapshot exists, creates one (one-time setup)
 * 3. Creates sandbox from base snapshot (fast!)
 * 4. Clones repo and installs project dependencies
 * 5. Starts d3k
 *
 * The base snapshot is shared across ALL repos/projects, so subsequent runs
 * of ANY project will be fast after the first-ever run.
 *
 * @param config - Same config as createD3kSandbox
 * @returns D3kSandboxResultWithSnapshot with sandbox, URLs, and snapshot info
 */
export async function getOrCreateD3kSandbox(config: D3kSandboxConfig): Promise<D3kSandboxResultWithSnapshot> {
  const { repoUrl, branch = "main", timeout = "30m", projectDir = "", packageManager = "pnpm", debug = false } = config

  // Start timing
  const timer = new StepTimer()

  const timeoutMs = ms(timeout)
  if (typeof timeoutMs !== "number") {
    throw new Error(`Invalid timeout value: ${timeout}`)
  }

  if (debug) {
    console.log("🔄 getOrCreateD3kSandbox: Checking for base snapshot...")
  }

  // Step 1: Check for base snapshot
  timer.start("Check for base snapshot")
  let baseSnapshotId: string | null = null
  const storedSnapshot = await loadBaseSnapshotId(debug)

  if (storedSnapshot) {
    const isValid = await isSnapshotValid(storedSnapshot.snapshotId, debug)
    if (isValid) {
      baseSnapshotId = storedSnapshot.snapshotId
      if (debug) console.log(`  ✅ Found valid base snapshot: ${baseSnapshotId}`)
    } else if (debug) {
      console.log("  ⚠️ Stored base snapshot is no longer valid")
    }
  }

  // Step 2: Create base snapshot if needed
  if (!baseSnapshotId) {
    timer.start("Create base snapshot (one-time)")
    if (debug) console.log("  ℹ️ No base snapshot found, creating one...")
    try {
      baseSnapshotId = await createAndSaveBaseSnapshot(timeoutMs, debug)
    } catch (error) {
      if (debug) {
        console.log(`  ⚠️ Failed to create base snapshot: ${error instanceof Error ? error.message : String(error)}`)
        console.log("  🔄 Falling back to creating sandbox from scratch...")
      }
      // Fall back to full createD3kSandbox
      const result = await createD3kSandbox(config)
      timer.end()
      return {
        ...result,
        fromSnapshot: false,
        snapshotId: undefined,
        timing: timer.getData()
      }
    }
  }

  // Step 3: Create sandbox from base snapshot
  timer.start("Create sandbox from snapshot")
  if (debug) console.log(`  🚀 Creating sandbox from base snapshot: ${baseSnapshotId}`)

  const sandbox = await Sandbox.create({
    source: {
      type: "snapshot",
      snapshotId: baseSnapshotId
    },
    timeout: timeoutMs,
    ports: [3000]
  })

  if (debug) console.log(`  ✅ Sandbox created from snapshot: ${sandbox.sandboxId}`)

  // Helper to run commands
  async function runCommandWithLogs(
    options: Parameters<Sandbox["runCommand"]>[0]
  ): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    const result = await sandbox.runCommand(options)
    let stdout = ""
    let stderr = ""
    for await (const log of result.logs()) {
      if (log.stream === "stdout") {
        stdout += log.data
        if (debug) console.log(log.data)
      } else {
        stderr += log.data
        if (debug) console.debug(log.data)
      }
    }
    await result.wait()
    return { exitCode: result.exitCode, stdout, stderr }
  }

  try {
    const sandboxCwd = projectDir ? `/vercel/sandbox/${projectDir}` : "/vercel/sandbox"

    // Step 4: Clone repository
    timer.start("Git clone repository")
    if (debug) console.log(`  📦 Cloning repository: ${repoUrl}`)

    await runCommandWithLogs({ cmd: "mkdir", args: ["-p", sandboxCwd] })

    const gitArgs = ["clone"]
    const repoUrlWithGit = repoUrl.endsWith(".git") ? repoUrl : `${repoUrl}.git`
    const isCommitSha = /^[0-9a-f]{40}$/i.test(branch)

    if (!isCommitSha) {
      gitArgs.push("--depth", "1")
      if (branch) gitArgs.push("--branch", branch)
    }
    gitArgs.push(repoUrlWithGit, sandboxCwd)

    const gitClone = await runCommandWithLogs({
      cmd: "git",
      args: gitArgs,
      env: { GIT_TERMINAL_PROMPT: "0" }
    })

    if (gitClone.exitCode !== 0) {
      throw new Error(`Git clone failed: ${gitClone.stderr}`)
    }

    if (branch) {
      await runCommandWithLogs({
        cmd: "git",
        args: ["checkout", branch],
        cwd: sandboxCwd,
        env: { GIT_TERMINAL_PROMPT: "0" }
      })
    }

    if (debug) console.log("  ✅ Repository cloned")

    // Step 5: Install project dependencies
    timer.start("Install project dependencies")
    if (debug) console.log("  📦 Installing project dependencies...")
    const installResult = await runCommandWithLogs({
      cmd: packageManager,
      args: ["install"],
      cwd: sandboxCwd
    })

    if (installResult.exitCode !== 0) {
      throw new Error(`Dependency installation failed: ${installResult.stderr}`)
    }
    if (debug) console.log("  ✅ Project dependencies installed")

    // Step 6: Install @sparticuz/chromium for this project
    timer.start("Install @sparticuz/chromium")
    if (debug) console.log("  🔧 Installing @sparticuz/chromium...")
    await SandboxChrome.installChromium(sandbox, { cwd: sandboxCwd, packageManager, debug })
    if (debug) console.log("  ✅ @sparticuz/chromium installed")

    // Get chromium path
    let chromiumPath: string
    try {
      chromiumPath = await SandboxChrome.getExecutablePath(sandbox, { cwd: sandboxCwd, debug })
      if (debug) console.log(`  ✅ Chromium path: ${chromiumPath}`)
    } catch {
      chromiumPath = "/usr/bin/chromium"
      if (debug) console.log(`  ⚠️ Using fallback chromium path: ${chromiumPath}`)
    }

    // Step 7: Start d3k
    timer.start("Start d3k process")
    if (debug) console.log("  🚀 Starting d3k...")
    const d3kStartupLog = "/home/vercel-sandbox/.d3k/logs/d3k-startup.log"
    await sandbox.runCommand({
      cmd: "sh",
      args: [
        "-c",
        `mkdir -p /home/vercel-sandbox/.d3k/logs && cd ${sandboxCwd} && d3k --no-tui --debug --headless --browser ${chromiumPath} > ${d3kStartupLog} 2>&1`
      ],
      detached: true
    })

    if (debug) console.log("  ✅ d3k started in detached mode")

    // Wait for services
    timer.start("Wait for dev server (port 3000)")
    if (debug) console.log("  ⏳ Waiting for d3k to start...")
    await new Promise((resolve) => setTimeout(resolve, 5000))

    if (debug) console.log("  ⏳ Waiting for dev server on port 3000...")
    await waitForServer(sandbox, 3000, 120000, debug)
    const devUrl = sandbox.domain(3000)
    if (debug) console.log(`  ✅ Dev server ready: ${devUrl}`)

    // Wait for CDP URL
    timer.start("Wait for CDP/Chrome ready")
    if (debug) console.log("  ⏳ Waiting for CDP URL...")
    const cdpUrl = await waitForCdpUrl(sandbox, 30000, debug)
    if (cdpUrl) {
      if (debug) console.log(`  ✅ CDP URL ready: ${cdpUrl}`)
      await waitForPageNavigation(sandbox, 30000, debug)
    } else {
      console.log("  ⚠️ CDP URL not found - browser automation features may not work")
    }

    timer.end()
    const projectName = projectDir || repoUrl.split("/").pop()?.replace(".git", "") || "app"

    // Log timing breakdown
    timer.log("  ")
    if (debug) console.log(`  ✅ d3k sandbox ready! (from base snapshot)`)

    return {
      sandbox,
      devUrl,
      projectName,
      bypassToken: undefined,
      cleanup: async () => {
        if (debug) console.log("  🧹 Stopping sandbox...")
        await sandbox.stop()
        if (debug) console.log("  ✅ Sandbox stopped")
      },
      fromSnapshot: true,
      snapshotId: baseSnapshotId,
      timing: timer.getData()
    }
  } catch (error) {
    try {
      await sandbox.stop()
    } catch {
      // Ignore cleanup errors
    }
    throw error
  }
}
