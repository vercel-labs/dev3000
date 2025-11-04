import { Sandbox } from "@vercel/sandbox"
import ms from "ms"
import { detectProject } from "../utils/project-detector.js"

export interface CloudFixOptions {
  debug?: boolean
  timeout?: string
}

/**
 * Cloud Fix Command
 *
 * Analyzes and fixes issues in a project using Vercel Sandbox + MCP tools
 */
export async function cloudFix(options: CloudFixOptions = {}): Promise<void> {
  const { debug = false, timeout = "30m" } = options

  console.log("🔍 Detecting project...")

  // Detect project information
  const project = await detectProject()

  console.log(`  Repository: ${project.repoUrl}`)
  console.log(`  Branch: ${project.branch}`)
  console.log(`  Framework: ${project.framework || "Unknown"}`)
  console.log(`  Dev command: ${project.packageManager} run ${project.devCommand}`)
  console.log()

  console.log("🚀 Creating Vercel Sandbox...")

  // Create sandbox
  // biome-ignore lint/suspicious/noExplicitAny: ms type inference issue
  const timeoutMs = ms(timeout as any) as unknown as number
  const sandbox = await Sandbox.create({
    source: {
      url: `${project.repoUrl}.git`,
      type: "git"
    },
    resources: { vcpus: 4 },
    timeout: timeoutMs,
    ports: [3000, 3684], // App port + MCP server port
    runtime: "node22"
  })

  console.log("  Sandbox created successfully")

  try {
    // Install dependencies
    console.log("  Installing dependencies...")
    const installCmd = project.packageManager === "pnpm" ? "pnpm" : project.packageManager
    const installResult = await sandbox.runCommand({
      cmd: installCmd,
      args: ["install"],
      stdout: debug ? process.stdout : undefined,
      stderr: debug ? process.stderr : undefined
    })

    if (installResult.exitCode !== 0) {
      throw new Error(`Dependency installation failed with exit code ${installResult.exitCode}`)
    }

    // Start dev server
    console.log("  Starting dev server...")
    await sandbox.runCommand({
      cmd: installCmd,
      args: ["run", project.devCommand],
      detached: true,
      stdout: debug ? process.stdout : undefined,
      stderr: debug ? process.stderr : undefined
    })

    // Wait for server to be ready
    console.log("  Waiting for dev server...")
    await waitForServer(sandbox, 3000, 60000)

    const devUrl = sandbox.domain(3000)
    console.log(`  ✅ Dev server ready: ${devUrl}`)
    console.log()

    // The dev server is already running - just report success
    console.log("✅ Development environment ready in sandbox!")
    console.log(`  Dev server: ${devUrl}`)
    console.log()

    // TODO Phase 2: Actually use MCP tools to crawl and analyze
    console.log("📊 Analysis:")
    console.log("  App is running and accessible")
    console.log("  Ready for MCP tool integration")
    console.log()

    // Try a simple HTTP check to verify the site is working
    console.log("🔍 Verifying site accessibility...")
    try {
      const response = await fetch(devUrl)
      console.log(`  Status: ${response.status} ${response.statusText}`)
      console.log("  ✅ Site is accessible")
    } catch (err) {
      console.log(`  ⚠️  Error accessing site: ${err}`)
    }
    console.log()

    // TODO: Run fix_my_app tool
    console.log("🔧 Running fix_my_app tool...")
    console.log("  (TODO: Implement fix_my_app integration)")
    console.log()

    // TODO: Extract changes and create PR
    console.log("📤 Creating pull request...")
    console.log("  (TODO: Implement PR creation)")
    console.log()

    console.log("✅ Analysis complete!")
    console.log(`\nYou can view the app at: ${devUrl}`)
    console.log("\nNext steps:")
    console.log("  1. Integrate fix_my_app tool to generate fixes")
    console.log("  2. Extract changed files from sandbox")
    console.log("  3. Create PR with fixes")
  } finally {
    console.log("\n🧹 Cleaning up sandbox...")
    await sandbox.stop()
    console.log("✅ Sandbox stopped")
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
