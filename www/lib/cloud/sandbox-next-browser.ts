import { dirname } from "node:path"
import type { Sandbox } from "@vercel/sandbox"

export interface SandboxNextBrowserOptions {
  /** Home directory used to isolate daemon socket state */
  homeDir?: string
  /** Working directory for package installs and CLI commands */
  cwd?: string
  /** Package manager to use for local install */
  packageManager?: "bun" | "pnpm" | "npm" | "yarn"
  /** Enable verbose debug logging */
  debug?: boolean
  /** Command timeout in milliseconds */
  timeout?: number
}

export interface NextBrowserResult {
  success: boolean
  data?: unknown
  error?: string
  stdout: string
  stderr: string
  exitCode: number
}

interface CommandResult {
  exitCode: number
  stdout: string
  stderr: string
}

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
  const whichResult = await runCommand(sandbox, "sh", [
    "-c",
    "export PATH=$HOME/.bun/bin:/usr/local/bin:$PATH; command -v bun || true"
  ])
  if (whichResult.stdout.trim()) {
    if (debug) console.log(`[SandboxNextBrowser] bun found at ${whichResult.stdout.trim()}`)
    return
  }

  if (debug) console.log("[SandboxNextBrowser] bun not found, installing...")
  const installResult = await runCommand(sandbox, "sh", ["-c", "curl -fsSL https://bun.sh/install | bash"])
  if (installResult.exitCode !== 0) {
    throw new Error(`bun installation failed: ${installResult.stderr}`)
  }

  await runCommand(sandbox, "sh", [
    "-c",
    "mkdir -p /usr/local/bin && ln -sf ~/.bun/bin/bun /usr/local/bin/bun && ln -sf ~/.bun/bin/bunx /usr/local/bin/bunx"
  ])

  if (debug) console.log("[SandboxNextBrowser] bun installed")
}

function getInstallCommand(packageManager: NonNullable<SandboxNextBrowserOptions["packageManager"]>): string {
  const packages = "@vercel/next-browser@latest playwright @playwright/browser-chromium"
  switch (packageManager) {
    case "bun":
      return `bun add ${packages}`
    case "npm":
      return `npm install ${packages}`
    case "yarn":
      return `yarn add ${packages}`
    default:
      return `pnpm add ${packages}`
  }
}

export class SandboxNextBrowser {
  private sandbox: Sandbox
  private options: Required<Pick<SandboxNextBrowserOptions, "homeDir" | "cwd" | "packageManager" | "debug" | "timeout">>
  private isInstalled = false

  private constructor(sandbox: Sandbox, options: SandboxNextBrowserOptions) {
    this.sandbox = sandbox
    this.options = {
      homeDir: options.homeDir ?? "/tmp/next-browser-home",
      cwd: options.cwd ?? "/vercel/sandbox",
      packageManager: options.packageManager ?? "pnpm",
      debug: options.debug ?? false,
      timeout: options.timeout ?? 30000
    }
  }

  private log(message: string) {
    if (this.options.debug) {
      console.log(`[SandboxNextBrowser] ${message}`)
    }
  }

  static async create(sandbox: Sandbox, options: SandboxNextBrowserOptions = {}): Promise<SandboxNextBrowser> {
    const instance = new SandboxNextBrowser(sandbox, options)
    await instance.ensureInstalled()
    return instance
  }

  async ensureInstalled(): Promise<void> {
    if (this.isInstalled) return

    if (this.options.packageManager === "bun") {
      await ensureBunInstalled(this.sandbox, this.options.debug)
    }

    const installResult = await runCommand(
      this.sandbox,
      "sh",
      [
        "-c",
        [
          "export PATH=$HOME/.bun/bin:/usr/local/bin:$PATH",
          `mkdir -p ${shellEscape(this.options.homeDir)}`,
          `export HOME=${shellEscape(this.options.homeDir)}`,
          `cd ${shellEscape(this.options.cwd)}`,
          getInstallCommand(this.options.packageManager)
        ].join(" && ")
      ],
      { cwd: this.options.cwd, timeout: this.options.timeout }
    )

    if (installResult.exitCode !== 0) {
      this.log(`Install stderr: ${installResult.stderr}`)
      throw new Error(`Failed to install next-browser: exit code ${installResult.exitCode}`)
    }

    this.isInstalled = true
    this.log("next-browser installed successfully")
  }

  private async exec(command: string[]): Promise<NextBrowserResult> {
    const result = await runCommand(
      this.sandbox,
      "sh",
      [
        "-c",
        [
          "export PATH=$HOME/.bun/bin:/usr/local/bin:$PATH",
          `mkdir -p ${shellEscape(this.options.homeDir)}`,
          `export HOME=${shellEscape(this.options.homeDir)}`,
          `cd ${shellEscape(this.options.cwd)}`,
          `${
            this.options.packageManager === "bun"
              ? `bunx next-browser ${command.map(shellEscape).join(" ")}`
              : `npx next-browser ${command.map(shellEscape).join(" ")}`
          }`
        ].join(" && ")
      ],
      { cwd: this.options.cwd, timeout: this.options.timeout }
    )

    let data: unknown
    const trimmedStdout = result.stdout.trim()
    if (trimmedStdout) {
      try {
        data = JSON.parse(trimmedStdout)
      } catch {
        data = trimmedStdout
      }
    }

    this.log(`Executed next-browser ${command.join(" ")} -> ${result.exitCode}`)
    if (result.stderr) this.log(`stderr: ${result.stderr.substring(0, 500)}`)

    return {
      success: result.exitCode === 0,
      data,
      error: result.exitCode !== 0 ? result.stderr || result.stdout : undefined,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode
    }
  }

  async open(url: string): Promise<NextBrowserResult> {
    return this.exec(["open", url])
  }

  async goto(url: string): Promise<NextBrowserResult> {
    return this.exec(["goto", url])
  }

  async reload(): Promise<NextBrowserResult> {
    return this.exec(["reload"])
  }

  async evaluate(expression: string): Promise<NextBrowserResult> {
    return this.exec(["eval", expression])
  }

  async tree(nodeId?: number): Promise<NextBrowserResult> {
    return this.exec(nodeId === undefined ? ["tree"] : ["tree", String(nodeId)])
  }

  async screenshot(outputPath: string): Promise<NextBrowserResult> {
    const screenshotResult = await this.exec(["screenshot"])
    if (!screenshotResult.success) {
      return screenshotResult
    }

    const sourcePath = screenshotResult.stdout.trim().split("\n").pop()?.trim()
    if (!sourcePath) {
      return {
        ...screenshotResult,
        success: false,
        error: "next-browser did not return a screenshot path"
      }
    }

    const copyResult = await runCommand(this.sandbox, "sh", [
      "-c",
      `mkdir -p ${shellEscape(dirname(outputPath))} && cp ${shellEscape(sourcePath)} ${shellEscape(outputPath)}`
    ])

    if (copyResult.exitCode !== 0) {
      return {
        success: false,
        error: copyResult.stderr || copyResult.stdout || "failed to copy next-browser screenshot",
        stdout: copyResult.stdout,
        stderr: copyResult.stderr,
        exitCode: copyResult.exitCode
      }
    }

    return {
      ...screenshotResult,
      data: outputPath
    }
  }

  async close(): Promise<NextBrowserResult> {
    return this.exec(["close"])
  }
}

export const createSandboxNextBrowser = SandboxNextBrowser.create.bind(SandboxNextBrowser)
