import { Sandbox } from "@vercel/sandbox"
import ms from "ms"
import type { ProductionError } from "./types"

export interface SandboxReproductionResult {
  success: boolean
  logs: string
  screenshots?: string[]
  analysis?: string
  error?: string
  duration: number
}

export interface SandboxConfig {
  repoUrl: string
  branch?: string
  timeout?: string
}

/**
 * SandboxManager handles error reproduction in isolated Vercel Sandbox environments
 *
 * This manager:
 * 1. Creates an isolated sandbox from the repository
 * 2. Installs dependencies
 * 3. Starts the dev server
 * 4. Runs d3k to reproduce the error
 * 5. Collects logs and analysis
 */
export class SandboxManager {
  private config: SandboxConfig

  constructor(config: SandboxConfig) {
    this.config = {
      branch: "main",
      timeout: "10m",
      ...config
    }
  }

  /**
   * Reproduce an error in a sandbox environment
   */
  async reproduceError(error: ProductionError): Promise<SandboxReproductionResult> {
    const startTime = Date.now()
    const logs: string[] = []

    let sandbox: Sandbox | null = null

    try {
      // Create sandbox from repository
      logs.push(`Creating sandbox from ${this.config.repoUrl}...`)
      sandbox = await Sandbox.create({
        source: {
          url: this.config.repoUrl,
          type: "git"
        },
        resources: { vcpus: 4 },
        timeout: ms(this.config.timeout || "10m"),
        ports: [3000, 3684], // App port + MCP server port
        runtime: "node22"
      })

      logs.push(`Sandbox created: ${sandbox.id}`)

      // Install dependencies
      logs.push("Installing dependencies...")
      const install = await sandbox.runCommand({
        cmd: "pnpm",
        args: ["install"],
        stdout: (chunk) => logs.push(chunk.toString()),
        stderr: (chunk) => logs.push(`[stderr] ${chunk.toString()}`)
      })

      if (install.exitCode !== 0) {
        throw new Error(`Dependency installation failed with exit code ${install.exitCode}`)
      }

      logs.push("Dependencies installed successfully")

      // Start dev server in detached mode
      logs.push("Starting dev server...")
      await sandbox.runCommand({
        cmd: "pnpm",
        args: ["run", "dev"],
        detached: true,
        stdout: (chunk) => logs.push(chunk.toString()),
        stderr: (chunk) => logs.push(`[stderr] ${chunk.toString()}`)
      })

      // Wait for server to be ready
      logs.push("Waiting for dev server to be ready...")
      await this.waitForServer(sandbox, 3000, 30000)
      logs.push(`Dev server ready at ${sandbox.domain(3000)}`)

      // Run d3k to reproduce the error
      logs.push("Running d3k to reproduce error...")
      const d3kResult = await this.runD3k(sandbox, error)
      logs.push(...d3kResult.logs)

      const duration = Date.now() - startTime

      return {
        success: true,
        logs: logs.join("\n"),
        analysis: d3kResult.analysis,
        screenshots: d3kResult.screenshots,
        duration
      }
    } catch (err) {
      const duration = Date.now() - startTime
      logs.push(`Error: ${err instanceof Error ? err.message : String(err)}`)

      return {
        success: false,
        logs: logs.join("\n"),
        error: err instanceof Error ? err.message : String(err),
        duration
      }
    } finally {
      // Clean up sandbox
      if (sandbox) {
        logs.push("Stopping sandbox...")
        try {
          await sandbox.stop()
          logs.push("Sandbox stopped")
        } catch (err) {
          logs.push(`Failed to stop sandbox: ${err}`)
        }
      }
    }
  }

  /**
   * Wait for a port to become available
   */
  private async waitForServer(sandbox: Sandbox, port: number, timeoutMs: number): Promise<void> {
    const startTime = Date.now()
    const url = sandbox.domain(port)

    while (Date.now() - startTime < timeoutMs) {
      try {
        const response = await fetch(url, { method: "HEAD" })
        if (response.ok || response.status === 404) {
          // Server is responding
          return
        }
      } catch {
        // Server not ready yet, continue waiting
      }

      // Wait 1 second before retrying
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }

    throw new Error(`Server on port ${port} did not become ready within ${timeoutMs}ms`)
  }

  /**
   * Run d3k to reproduce the error
   */
  private async runD3k(
    sandbox: Sandbox,
    error: ProductionError
  ): Promise<{ logs: string[]; analysis?: string; screenshots?: string[] }> {
    const logs: string[] = []

    try {
      // Build d3k command with error context
      const args = [
        "tsx",
        "src/cli.ts",
        "start",
        "--url",
        error.url,
        "--disable-tui", // Disable TUI in sandbox
        "--debug"
      ]

      // Add user interactions if available
      if (error.interactions && error.interactions.length > 0) {
        logs.push(`Reproducing with interactions: ${error.interactions.join(", ")}`)
      }

      logs.push(`Running: npx ${args.join(" ")}`)

      const result = await sandbox.runCommand({
        cmd: "npx",
        args,
        stdout: (chunk) => logs.push(chunk.toString()),
        stderr: (chunk) => logs.push(`[stderr] ${chunk.toString()}`)
      })

      logs.push(`d3k exited with code ${result.exitCode}`)

      // Check if error was reproduced by looking for error message in logs
      const fullLog = logs.join("\n")
      const errorReproduced = fullLog.includes(error.message)

      let analysis = `Error reproduction attempt completed with exit code ${result.exitCode}.`
      if (errorReproduced) {
        analysis += ` Successfully reproduced error: "${error.message}"`
      } else {
        analysis += ` Error message not found in logs. The error may not be reproducible or requires different conditions.`
      }

      // TODO: Fetch screenshots from MCP server logs
      // We would need to expose the log/screenshot directories or use the MCP server API

      return {
        logs,
        analysis
      }
    } catch (err) {
      logs.push(`Failed to run d3k: ${err}`)
      return {
        logs,
        analysis: `Failed to execute d3k: ${err instanceof Error ? err.message : String(err)}`
      }
    }
  }
}

/**
 * Create a SandboxManager instance with configuration from environment
 */
export function createSandboxManager(): SandboxManager {
  const repoUrl = process.env.REPO_URL
  if (!repoUrl) {
    throw new Error("REPO_URL environment variable is required")
  }

  return new SandboxManager({
    repoUrl,
    branch: process.env.REPO_BRANCH || "main",
    timeout: process.env.SANDBOX_TIMEOUT || "10m"
  })
}
