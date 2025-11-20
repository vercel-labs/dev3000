import { Sandbox } from "@vercel/sandbox"
import ms from "ms"

export interface D3kSandboxConfig {
  repoUrl: string
  branch?: string
  timeout?: string
  projectDir?: string
  framework?: string
  packageManager?: "pnpm" | "npm" | "yarn"
  devCommand?: string
  debug?: boolean
}

export interface D3kSandboxResult {
  sandbox: Sandbox
  devUrl: string
  mcpUrl: string
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
 * 4. Starts d3k (which auto-configures MCPs and starts browser)
 * 5. Returns sandbox with devUrl and mcpUrl
 *
 * The d3k MCP server will have all tools auto-configured:
 * - fix_my_app (with browser automation)
 * - nextjs-dev MCP tools
 * - chrome-devtools MCP tools
 * - browser_eval (Playwright)
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

  // Create sandbox
  // biome-ignore lint/suspicious/noExplicitAny: ms type inference issue
  const timeoutMs = ms(timeout as any) as unknown as number
  const sandbox = await Sandbox.create({
    teamId: process.env.VERCEL_TEAM_ID || "team_nLlpyC6REAqxydlFKbrMDlud",
    projectId: process.env.VERCEL_PROJECT_ID || "prj_21F00Vr3bXzc1VSC8D9j2YJUzd0Q",
    token,
    source: {
      url: `${repoUrl}.git`,
      type: "git",
      ...(branch ? { revision: branch } : {})
    },
    resources: { vcpus: 4 },
    timeout: timeoutMs,
    ports: [3000, 3684], // App port + MCP server port
    runtime: "node22"
  })

  if (debug) console.log("  ✅ Sandbox created")

  try {
    const sandboxCwd = projectDir ? `/vercel/sandbox/${projectDir}` : "/vercel/sandbox"

    // Verify sandbox directory contents
    if (debug) console.log("  📂 Checking sandbox directory contents...")
    try {
      const lsResult = await sandbox.runCommand({
        cmd: "ls",
        args: ["-la", sandboxCwd]
      })
      if (lsResult.exitCode === 0 && lsResult.stdout) {
        try {
          const stdout =
            typeof lsResult.stdout === "string"
              ? lsResult.stdout
              : typeof lsResult.stdout === "function"
                ? await lsResult.stdout()
                : String(lsResult.stdout || "")

          console.log(`  📂 Contents of ${sandboxCwd}:`)
          console.log(stdout)
        } catch (stdoutError) {
          console.log(
            `  ⚠️ Could not read directory listing stdout: ${stdoutError instanceof Error ? stdoutError.message : String(stdoutError)}`
          )
        }
      } else {
        console.log("  ⚠️ Could not read directory listing (stdout is undefined)")
      }
    } catch (error) {
      console.log(`  ⚠️ Could not list directory: ${error instanceof Error ? error.message : String(error)}`)
    }

    // Check for package.json
    if (debug) console.log("  📄 Verifying package.json exists...")
    try {
      const pkgCheck = await sandbox.runCommand({
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
    const installResult = await sandbox.runCommand({
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

    // Install d3k globally from npm
    if (debug) console.log("  📦 Installing d3k globally from npm...")
    const d3kInstallResult = await sandbox.runCommand({
      cmd: "pnpm",
      args: ["i", "-g", "dev3000"],
      stdout: debug ? process.stdout : undefined,
      stderr: debug ? process.stderr : undefined
    })

    if (d3kInstallResult.exitCode !== 0) {
      throw new Error(`d3k installation failed with exit code ${d3kInstallResult.exitCode}`)
    }

    if (debug) console.log("  ✅ d3k installed globally")

    // Start d3k (which will auto-configure MCPs and start browser)
    if (debug) console.log("  🚀 Starting d3k...")
    if (debug) console.log(`  📂 Working directory: ${sandboxCwd}`)
    if (debug) console.log(`  🔧 Command: cd ${sandboxCwd} && MCP_SKIP_PERMISSIONS=true d3k --no-tui --debug`)

    // Start d3k in detached mode and capture the Command object
    // Even though it's detached, we can still read logs from it
    const d3kCmd = await sandbox.runCommand({
      cmd: "sh",
      args: ["-c", `cd ${sandboxCwd} && MCP_SKIP_PERMISSIONS=true d3k --no-tui --debug`],
      detached: true
    })

    // Stream d3k logs in the background
    if (debug) {
      // Don't await this - let it run in background
      ;(async () => {
        try {
          for await (const log of d3kCmd.logs()) {
            if (log.stream === "stdout") {
              console.log(log.data)
            } else if (log.stream === "stderr") {
              console.error(log.data)
            }
          }
        } catch (e) {
          console.error(`Error reading d3k logs: ${e instanceof Error ? e.message : String(e)}`)
        }
      })()
    }

    // Give d3k a moment to start and create log files
    if (debug) console.log("  ⏳ Waiting for d3k to start...")
    await new Promise((resolve) => setTimeout(resolve, 5000))

    // Debug: Check d3k process and log files
    if (debug) {
      console.log("  🔍 Checking d3k process status...")
      const psCheck = await sandbox.runCommand({
        cmd: "sh",
        args: ["-c", "ps aux | grep -E '(d3k|pnpm|next)' | grep -v grep || echo 'No d3k/pnpm/next processes found'"]
      })
      if (psCheck.stdout) {
        const stdout =
          typeof psCheck.stdout === "string"
            ? psCheck.stdout
            : typeof psCheck.stdout === "function"
              ? await psCheck.stdout()
              : String(psCheck.stdout || "")
        console.log(`  📋 Process list:\n${stdout}`)
      }

      console.log("  🔍 Checking for d3k log files...")
      const logsCheck = await sandbox.runCommand({
        cmd: "sh",
        args: ["-c", "ls -lah /home/vercel-sandbox/.d3k/logs/ 2>/dev/null || echo 'No .d3k/logs directory found'"]
      })
      if (logsCheck.stdout) {
        const stdout =
          typeof logsCheck.stdout === "string"
            ? logsCheck.stdout
            : typeof logsCheck.stdout === "function"
              ? await logsCheck.stdout()
              : String(logsCheck.stdout || "")
        console.log(`  📋 Log files:\n${stdout}`)
      }

      // Check ALL d3k log files for initial content
      const allLogsCheck = await sandbox.runCommand({
        cmd: "sh",
        args: [
          "-c",
          'for log in /home/vercel-sandbox/.d3k/logs/*.log 2>/dev/null; do echo "=== $log ==="  && head -50 "$log" || true; done'
        ]
      })
      if (allLogsCheck.stdout) {
        const stdout =
          typeof allLogsCheck.stdout === "string"
            ? allLogsCheck.stdout
            : typeof allLogsCheck.stdout === "function"
              ? await allLogsCheck.stdout()
              : String(allLogsCheck.stdout || "")
        console.log(`  📋 Initial log content:\n${stdout}`)
      }
    }

    // Stream ALL d3k log files in the background
    // This ensures we capture d3k's main logs + server logs + any other logs
    if (debug) {
      console.log("  📋 Starting comprehensive log stream...")
      const tailCmd = await sandbox.runCommand({
        cmd: "sh",
        args: ["-c", "tail -f /home/vercel-sandbox/.d3k/logs/*.log 2>/dev/null || true"],
        detached: true
      })

      // Stream all logs in the background
      ;(async () => {
        try {
          for await (const log of tailCmd.logs()) {
            if (log.stream === "stdout") {
              console.log(`[D3K-LOGS] ${log.data}`)
            } else if (log.stream === "stderr") {
              console.error(`[D3K-LOGS] ${log.data}`)
            }
          }
        } catch (e) {
          console.error(`Error reading d3k logs: ${e instanceof Error ? e.message : String(e)}`)
        }
      })()
    }

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
        const logsCheck = await sandbox.runCommand({
          cmd: "sh",
          args: ["-c", "cat /home/vercel-sandbox/.d3k/logs/*.log 2>/dev/null || echo 'No log files found'"]
        })
        if (logsCheck.exitCode === 0 && logsCheck.stdout) {
          const stdout =
            typeof logsCheck.stdout === "string"
              ? logsCheck.stdout
              : typeof logsCheck.stdout === "function"
                ? await logsCheck.stdout()
                : String(logsCheck.stdout || "")
          console.log("  📋 All d3k logs:")
          console.log(stdout)
        }
      } catch (logError) {
        console.log(`  ⚠️ Could not read d3k logs: ${logError instanceof Error ? logError.message : String(logError)}`)
      }

      throw error
    }

    const devUrl = sandbox.domain(3000)
    if (debug) console.log(`  ✅ Dev server ready: ${devUrl}`)

    // Wait for MCP server to be ready (d3k starts it automatically)
    if (debug) console.log("  ⏳ Waiting for MCP server...")
    await waitForServer(sandbox, 3684, 60000, debug)

    const mcpUrl = sandbox.domain(3684)
    if (debug) console.log(`  ✅ MCP server ready: ${mcpUrl}`)

    // Give d3k a bit more time to fully initialize MCPs and browser
    // Logs are now streaming to the workflow output instead of being written to a file
    if (debug) console.log("  ⏳ Waiting for d3k to initialize MCPs and browser...")
    await new Promise((resolve) => setTimeout(resolve, 10000))

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
      mcpUrl,
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
