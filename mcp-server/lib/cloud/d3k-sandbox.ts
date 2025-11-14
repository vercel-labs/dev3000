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
    console.log(`  Branch: ${branch}`)
    console.log(`  Project: ${projectName}`)
    console.log(`  Framework: ${framework}`)
  }

  // Create sandbox
  // biome-ignore lint/suspicious/noExplicitAny: ms type inference issue
  const timeoutMs = ms(timeout as any) as unknown as number
  const sandbox = await Sandbox.create({
    teamId: process.env.VERCEL_TEAM_ID || "team_nLlpyC6REAqxydlFKbrMDlud",
    projectId: process.env.VERCEL_PROJECT_ID || "prj_21F00Vr3bXzc1VSC8D9j2YJUzd0Q",
    token: process.env.VERCEL_TOKEN || process.env.VERCEL_OIDC_TOKEN,
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

    // Install d3k globally
    if (debug) console.log("  📦 Installing d3k globally (pnpm i -g dev3000)...")
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
    await sandbox.runCommand({
      cmd: "sh",
      args: [
        "-c",
        `cd ${sandboxCwd} && MCP_SKIP_PERMISSIONS=true d3k start --disable-tui --debug > /tmp/d3k.log 2>&1`
      ],
      detached: true
    })

    // Wait for dev server to be ready
    if (debug) console.log("  ⏳ Waiting for dev server...")
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
