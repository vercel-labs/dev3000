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

    // Start d3k in detached mode
    await sandbox.runCommand({
      cmd: "sh",
      args: ["-c", `cd ${sandboxCwd} && MCP_SKIP_PERMISSIONS=true d3k --no-tui --debug > /tmp/d3k.log 2>&1`],
      detached: true
    })

    // Give d3k a moment to start writing logs
    await new Promise((resolve) => setTimeout(resolve, 3000))

    // Read initial d3k logs to verify it started
    if (debug) console.log("  📋 Reading initial d3k logs...")
    try {
      const initialLogsResult = await sandbox.runCommand({
        cmd: "tail",
        args: ["-n", "50", "/tmp/d3k.log"]
      })
      if (initialLogsResult.exitCode === 0 && initialLogsResult.stdout) {
        try {
          const stdout =
            typeof initialLogsResult.stdout === "string"
              ? initialLogsResult.stdout
              : typeof initialLogsResult.stdout === "function"
                ? await initialLogsResult.stdout()
                : String(initialLogsResult.stdout || "")

          console.log("  📋 d3k initial output (first 50 lines):")
          console.log(stdout)
        } catch (stdoutError) {
          console.log(
            `  ⚠️ Error reading initial d3k logs stdout: ${stdoutError instanceof Error ? stdoutError.message : String(stdoutError)}`
          )
        }
      } else if (initialLogsResult.exitCode === 0) {
        console.log("  ⚠️ Could not read initial d3k logs (stdout is undefined)")
      }
    } catch (error) {
      console.log(`  ⚠️ Could not read initial d3k logs: ${error instanceof Error ? error.message : String(error)}`)
    }

    // Wait for dev server to be ready
    if (debug) console.log("  ⏳ Waiting for dev server on port 3000...")
    await waitForServer(sandbox, 3000, 120000) // 2 minutes for d3k to start everything

    const devUrl = sandbox.domain(3000)
    if (debug) console.log(`  ✅ Dev server ready: ${devUrl}`)

    // Wait for MCP server to be ready (d3k starts it automatically)
    if (debug) console.log("  ⏳ Waiting for MCP server...")
    await waitForServer(sandbox, 3684, 60000)

    const mcpUrl = sandbox.domain(3684)
    if (debug) console.log(`  ✅ MCP server ready: ${mcpUrl}`)

    // Give d3k a bit more time to fully initialize MCPs and browser
    if (debug) console.log("  ⏳ Waiting for d3k to initialize MCPs and browser...")
    await new Promise((resolve) => setTimeout(resolve, 10000))

    // Check d3k logs for any errors
    console.log("  📋 Checking d3k logs for errors and startup status...")
    const logsResult = await sandbox.runCommand({
      cmd: "tail",
      args: ["-n", "200", "/tmp/d3k.log"]
    })
    if (logsResult.exitCode === 0 && logsResult.stdout) {
      try {
        // stdout might be a string or need to be read
        const stdoutRaw = logsResult.stdout
        const stdout =
          typeof stdoutRaw === "string"
            ? stdoutRaw
            : typeof stdoutRaw === "function"
              ? await stdoutRaw()
              : String(stdoutRaw || "")

        console.log("  📋 d3k log (last 200 lines):")
        console.log(stdout)

        // Check for common error patterns
        const hasErrors = stdout.toLowerCase().includes("error") || stdout.toLowerCase().includes("failed")
        const hasDevServer = stdout.includes("ready") || stdout.includes("listening") || stdout.includes("started")

        if (hasErrors) {
          console.log("  ⚠️ WARNING: d3k logs contain errors")
        }
        if (hasDevServer) {
          console.log("  ✅ Dev server appears to have started successfully")
        } else {
          console.log("  ⚠️ WARNING: Could not confirm dev server started from logs")
        }
      } catch (stdoutError) {
        console.log(
          `  ⚠️ Error reading d3k logs stdout: ${stdoutError instanceof Error ? stdoutError.message : String(stdoutError)}`
        )
      }
    } else if (logsResult.exitCode !== 0) {
      console.log(`  ⚠️ Could not read d3k logs (exit code: ${logsResult.exitCode})`)
      const stderr =
        typeof logsResult.stderr === "string"
          ? logsResult.stderr
          : typeof logsResult.stderr === "function"
            ? await logsResult.stderr()
            : String(logsResult.stderr || "")

      if (stderr) {
        console.log(`  ⚠️ stderr: ${stderr}`)
      }
    } else {
      console.log("  ⚠️ WARNING: Could not read d3k logs (stdout is undefined)")
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
      mcpUrl,
      projectName,
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
async function waitForServer(sandbox: Sandbox, port: number, timeoutMs: number): Promise<void> {
  const startTime = Date.now()
  const url = sandbox.domain(port)

  while (Date.now() - startTime < timeoutMs) {
    try {
      const response = await fetch(url, { method: "HEAD" })
      if (response.ok || response.status === 404) {
        return
      }
    } catch {
      // Not ready yet
    }

    await new Promise((resolve) => setTimeout(resolve, 1000))
  }

  throw new Error(`Server on port ${port} did not become ready within ${timeoutMs}ms`)
}
