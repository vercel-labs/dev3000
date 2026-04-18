import { Sandbox, Snapshot } from "@vercel/sandbox"
import ms, { type StringValue } from "ms"
import { putBlobAndBuildUrl, readBlobJson } from "@/lib/blob-store"
import {
  inferDevServerCommandFromPackageJson,
  NO_DEV_SERVER_COMMAND,
  type SupportedPackageManager
} from "@/lib/dev-server-command"
import { SandboxChrome } from "./sandbox-chrome"

// Re-export Snapshot for consumers
export { Snapshot }

const SANDBOX_D3K_TOP_LEVEL_LOG_DIR = "/home/vercel-sandbox/.d3k/logs"
const SANDBOX_D3K_LOG_GLOB = "/home/vercel-sandbox/.d3k/*/logs/*.log /home/vercel-sandbox/.d3k/logs/*.log"
const SANDBOX_D3K_LOG_DIR_GLOB = "/home/vercel-sandbox/.d3k/*/logs /home/vercel-sandbox/.d3k/logs"
const DEFAULT_SANDBOX_TIMEOUT = "60m" as const
const CLAUDE_CODE_PACKAGE = "@anthropic-ai/claude-code"
const VERCEL_PLUGIN_INSTALL_ARG = "vercel/vercel-plugin"
const D3K_SKILL_INSTALL_ARG = "vercel-labs/dev3000@d3k"

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
const BASE_SNAPSHOT_VERSION = "2026-04-03-agent-runtime"

/**
 * Metadata stored for the base snapshot
 */
export interface BaseSnapshotMetadata {
  snapshotId: string
  createdAt: string
  version: string
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
    version: BASE_SNAPSHOT_VERSION,
    description: "Base d3k snapshot with Chrome system deps, bun, and d3k globally installed"
  }

  if (debug) {
    console.log(`  💾 Saving base snapshot ID to blob store: ${BASE_SNAPSHOT_KEY}`)
  }

  const blob = await putBlobAndBuildUrl(BASE_SNAPSHOT_KEY, JSON.stringify(metadata, null, 2), {
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true
  })

  if (debug) {
    console.log(`  ✅ Base snapshot ID saved: ${blob.appUrl}`)
  }

  return blob.appUrl
}

/**
 * Load the base snapshot ID from blob store
 */
export async function loadBaseSnapshotId(debug = false): Promise<BaseSnapshotMetadata | null> {
  if (debug) {
    console.log(`  🔍 Looking for base snapshot in blob store: ${BASE_SNAPSHOT_KEY}`)
  }

  try {
    const metadata = await readBlobJson<BaseSnapshotMetadata>(BASE_SNAPSHOT_KEY)
    if (!metadata) {
      if (debug) console.log("  ℹ️ No base snapshot found in blob store")
      return null
    }

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
export async function isSnapshotValid(
  metadata: BaseSnapshotMetadata,
  expectedVersion: string,
  debug = false
): Promise<boolean> {
  try {
    if (metadata.version !== expectedVersion) {
      if (debug) {
        console.log(
          `  ❌ Snapshot version mismatch: found ${metadata.version || "unknown"}, expected ${expectedVersion}`
        )
      }
      return false
    }

    if (debug) console.log(`  🔍 Checking if snapshot ${metadata.snapshotId} is valid...`)
    const snapshot = await Snapshot.get({ snapshotId: metadata.snapshotId })
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
  githubPat?: string
  projectId?: string
  teamId?: string
  vercelToken?: string
  sourceTarballUrl?: string
  sourceLabel?: string
  npmToken?: string
  projectEnv?: Record<string, string>
  timeout?: StringValue
  skipD3kSetup?: boolean
  onProgress?: (message: string) => void | Promise<void>
  projectDir?: string
  framework?: string
  packageManager?: "bun" | "pnpm" | "npm" | "yarn"
  devCommand?: string
  preStartCommands?: string[]
  preStartBackgroundCommand?: string
  preStartWaitPort?: number
  debug?: boolean
}

type PackageManager = "bun" | "pnpm" | "npm" | "yarn"

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

function looksLikeD3kCommand(command: string): boolean {
  const trimmed = command.trim()
  if (!trimmed) return false
  const [binary] = trimmed.split(/\s+/, 1)
  return binary === "d3k"
}

function isNoDevServerCommand(command: string): boolean {
  return command.trim().toLowerCase() === NO_DEV_SERVER_COMMAND
}

function buildD3kLaunchCommand(command: string, browserPath: string): string {
  let resolved = command.trim() || "d3k"

  if (!/\s--no-tui(?:\s|$)|^d3k --no-tui(?:\s|$)/.test(resolved)) {
    resolved += " --no-tui"
  }
  if (!/\s--no-agent(?:\s|$)|^d3k --no-agent(?:\s|$)/.test(resolved)) {
    resolved += " --no-agent"
  }
  if (!/\s--debug(?:\s|$)|^d3k --debug(?:\s|$)/.test(resolved)) {
    resolved += " --debug"
  }
  if (!/\s--headless(?:\s|$)|^d3k --headless(?:\s|$)/.test(resolved)) {
    resolved += " --headless"
  }
  if (!/\s--browser(?:\s|$)|^d3k --browser(?:\s|$)/.test(resolved)) {
    resolved += ` --browser ${shellQuote(browserPath)}`
  }

  return resolved
}

async function getBrowserBinarySummary(sandbox: Sandbox, browserPath: string): Promise<string> {
  const result = await sandbox.runCommand({
    cmd: "sh",
    args: [
      "-lc",
      `BROWSER=${shellQuote(browserPath)}; if [ -x "$BROWSER" ]; then VERSION=$("$BROWSER" --version 2>/dev/null | head -1); if [ -z "$VERSION" ]; then VERSION=unknown; fi; printf 'path=%s exists=yes version=%s' "$BROWSER" "$VERSION"; else printf 'path=%s exists=no' "$BROWSER"; fi`
    ]
  })

  let stdout = ""
  let stderr = ""
  for await (const log of result.logs()) {
    if (log.stream === "stdout") stdout += log.data
    else stderr += log.data
  }
  await result.wait()

  const summary = stdout.trim() || stderr.trim()
  return summary || `path=${browserPath} exists=unknown`
}

async function verifyInstalledD3kBinary(
  sandbox: Sandbox,
  options?: { cwd?: string; debug?: boolean }
): Promise<{ ok: boolean; detail: string }> {
  const result = await sandbox.runCommand({
    cmd: "sh",
    args: ["-c", "export PATH=$HOME/.bun/bin:/usr/local/bin:$PATH; d3k --version"],
    cwd: options?.cwd
  })

  let stdout = ""
  let stderr = ""
  for await (const log of result.logs()) {
    if (log.stream === "stdout") {
      stdout += log.data
      if (options?.debug) process.stdout.write(log.data)
    } else {
      stderr += log.data
      if (options?.debug) process.stderr.write(log.data)
    }
  }
  const finished = await result.wait()
  const exitCode = finished.exitCode

  const combinedOutput = `${stdout}\n${stderr}`.trim()
  const missingBinary = combinedOutput.includes("Could not find @d3k/linux-x64 binary")

  return {
    ok: exitCode === 0 && !missingBinary,
    detail: combinedOutput.slice(-500) || `exit=${exitCode}`
  }
}

async function detectProjectDevCommand(
  runCommand: (
    cmd: string,
    args: string[],
    cwd?: string
  ) => Promise<{ exitCode: number; stdout: string; stderr: string }>,
  cwd: string,
  packageManager: SupportedPackageManager,
  debug = false
): Promise<string | undefined> {
  const result = await runCommand("sh", ["-lc", "test -f package.json && cat package.json || true"], cwd)

  if (result.exitCode !== 0 || !result.stdout.trim()) {
    if (debug) {
      console.log(`  ℹ️ Could not infer dev server command from package.json at ${cwd}`)
    }
    return undefined
  }

  try {
    const rawPackageJson = JSON.parse(result.stdout) as { packageManager?: unknown; scripts?: unknown }
    const packageJson = {
      packageManager: typeof rawPackageJson.packageManager === "string" ? rawPackageJson.packageManager : undefined,
      scripts:
        rawPackageJson.scripts && typeof rawPackageJson.scripts === "object"
          ? (rawPackageJson.scripts as Record<string, string>)
          : undefined
    }
    return inferDevServerCommandFromPackageJson(packageJson, packageManager)
  } catch (error) {
    if (debug) {
      console.log(
        `  ⚠️ Failed to parse package.json for dev command: ${error instanceof Error ? error.message : String(error)}`
      )
    }
    return undefined
  }
}

function resolveNpmTokenValue(
  explicitToken: string | undefined,
  projectEnv: Record<string, string> | undefined
): string | undefined {
  if (explicitToken) return explicitToken
  const envToken =
    projectEnv?.NPM_TOKEN || projectEnv?.NODE_AUTH_TOKEN || process.env.NPM_TOKEN || process.env.NODE_AUTH_TOKEN
  return envToken || undefined
}

function parseRequiredNodeMajor(rawVersion: string): string | null {
  const trimmed = rawVersion.trim()
  if (!trimmed) return null
  const match = trimmed.match(/(\d{1,2})/)
  if (!match) return null
  const major = Number.parseInt(match[1], 10)
  if (!Number.isFinite(major) || major <= 0) return null
  return String(major)
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

async function detectProjectPackageManager(
  run: (cmd: string, args: string[], cwd?: string) => Promise<{ exitCode: number; stdout: string; stderr: string }>,
  sandboxCwd: string,
  debug = false
): Promise<PackageManager> {
  const detectScript = `
if [ -f bun.lockb ] || [ -f bun.lock ]; then
  echo bun
elif [ -f pnpm-lock.yaml ]; then
  echo pnpm
elif [ -f yarn.lock ]; then
  echo yarn
elif [ -f package-lock.json ]; then
  echo npm
else
  PM=$(node -e "try{const pkg=require('./package.json');const pm=(pkg.packageManager||'').split('@')[0];process.stdout.write(pm)}catch{}" 2>/dev/null)
  if [ -n "$PM" ]; then
    echo "$PM"
  else
    echo pnpm
  fi
fi
`.trim()

  const result = await run("sh", ["-c", detectScript], sandboxCwd)
  const detected = result.stdout.trim() as PackageManager
  const validManagers: PackageManager[] = ["bun", "pnpm", "npm", "yarn"]
  if (validManagers.includes(detected)) {
    if (debug) console.log(`  ✅ Detected package manager: ${detected}`)
    return detected
  }
  if (debug) console.log(`  ⚠️ Failed to detect package manager, defaulting to pnpm`)
  return "pnpm"
}

async function detectRequiredNodeMajor(
  run: (cmd: string, args: string[], cwd?: string) => Promise<{ exitCode: number; stdout: string; stderr: string }>,
  sandboxCwd: string,
  debug = false
): Promise<string | null> {
  const detectScript = `
if [ -f .nvmrc ]; then
  tr -d '[:space:]' < .nvmrc
  exit 0
fi
if [ -f .node-version ]; then
  tr -d '[:space:]' < .node-version
  exit 0
fi
node -e "try{const pkg=require('./package.json');process.stdout.write(pkg?.engines?.node||'')}catch{}" 2>/dev/null
`.trim()

  const result = await run("sh", ["-c", detectScript], sandboxCwd)
  const major = parseRequiredNodeMajor(result.stdout)
  if (debug) {
    if (major) {
      console.log(`  ✅ Detected required Node major: ${major} (raw: "${result.stdout.trim()}")`)
    } else {
      console.log(`  ℹ️ No explicit Node version requirement detected`)
    }
  }
  return major
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
    githubPat,
    projectId,
    teamId,
    vercelToken,
    sourceTarballUrl,
    sourceLabel,
    npmToken,
    projectEnv = {},
    timeout = DEFAULT_SANDBOX_TIMEOUT,
    skipD3kSetup = false,
    onProgress,
    projectDir = "",
    framework = "Next.js",
    packageManager,
    devCommand,
    preStartCommands = [],
    preStartBackgroundCommand,
    preStartWaitPort,
    debug = false
  } = config

  const normalizedProjectDir = projectDir.replace(/^\/+|\/+$/g, "")
  const projectName = normalizedProjectDir || sourceLabel || repoUrl.split("/").pop()?.replace(".git", "") || "app"

  if (debug) {
    console.log("🚀 Creating d3k sandbox...")
    console.log(`  Repository: ${repoUrl}`)
    console.log(`  Branch/SHA: ${branch}${branch.length === 40 ? " (git commit SHA)" : " (branch name)"}`)
    console.log(`  Project: ${projectName}`)
    console.log(`  Framework: ${framework}`)
  }
  const reportProgress = async (message: string) => {
    if (!onProgress) return
    try {
      await onProgress(message)
    } catch {
      // Don't fail workflow progress updates.
    }
  }

  // Check for required credentials
  const token = vercelToken || process.env.VERCEL_TOKEN || process.env.VERCEL_OIDC_TOKEN
  if (!token) {
    throw new Error(
      "Missing VERCEL_TOKEN or VERCEL_OIDC_TOKEN environment variable. " +
        "Vercel AI Workflows should automatically provide VERCEL_OIDC_TOKEN. " +
        "Check your workflow configuration and ensure it has access to Vercel API credentials."
    )
  }

  const sandboxCredentials = projectId && teamId ? { token, projectId, teamId } : {}

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

    try {
      await result.wait()
    } catch (error) {
      const cmd = `${options.cmd} ${options.args?.join(" ") || ""}`.trim()
      const errMessage = error instanceof Error ? error.message : String(error)
      const stderrTail = stderr.slice(-500)
      const stdoutTail = stdout.slice(-500)
      throw new Error(
        `Command wait failed: ${cmd}\nError: ${errMessage}\nStderr: ${stderrTail || "(empty)"}\nStdout: ${stdoutTail || "(empty)"}`
      )
    }

    return {
      exitCode: result.exitCode,
      stdout,
      stderr
    }
  }

  async function ensureBunInstalled(sandbox: Sandbox): Promise<void> {
    const whichResult = await runCommandWithLogs(sandbox, {
      cmd: "sh",
      args: ["-c", "export PATH=$HOME/.bun/bin:/usr/local/bin:$PATH; command -v bun || true"]
    })

    if (whichResult.stdout.trim()) {
      if (debug) console.log(`  ✅ bun found at ${whichResult.stdout.trim()}`)
      return
    }

    if (debug) console.log("  📦 bun not found, installing...")
    const installResult = await runCommandWithLogs(sandbox, {
      cmd: "sh",
      args: ["-c", "curl -fsSL https://bun.sh/install | bash"]
    })

    if (installResult.exitCode !== 0) {
      throw new Error(`bun installation failed: ${installResult.stderr}`)
    }

    await runCommandWithLogs(sandbox, {
      cmd: "sh",
      args: [
        "-c",
        "mkdir -p /usr/local/bin && ln -sf ~/.bun/bin/bun /usr/local/bin/bun && ln -sf ~/.bun/bin/bunx /usr/local/bin/bunx"
      ]
    })

    if (debug) console.log("  ✅ bun installed")
  }

  const parseGitHubRepo = (url: string): { owner: string; repo: string } | null => {
    const normalized = url.replace(/\.git$/i, "")
    const match = normalized.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)$/i)
    if (!match) return null
    return { owner: match[1], repo: match[2] }
  }

  const validateGithubPatAccess = async (url: string, pat: string): Promise<void> => {
    const repo = parseGitHubRepo(url)
    if (!repo) return

    const response = await fetch(`https://api.github.com/repos/${repo.owner}/${repo.repo}`, {
      headers: {
        Authorization: `Bearer ${pat}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "dev3000-workflow"
      }
    })

    if (response.status === 200) return

    if (response.status === 401) {
      throw new Error(
        `GitHub PAT authentication failed for ${repo.owner}/${repo.repo}. Verify the token is valid and not expired/revoked.`
      )
    }

    if (response.status === 403 || response.status === 404) {
      throw new Error(
        `GitHub PAT does not have access to ${repo.owner}/${repo.repo} (HTTP ${response.status}). Grant repository read access to this token.`
      )
    }
  }

  // Create sandbox from git source so Vercel handles repo auth consistently.
  const timeoutMs = ms(timeout)
  if (typeof timeoutMs !== "number") {
    throw new Error(`Invalid timeout value: ${timeout}`)
  }
  const repoUrlWithGit = repoUrl.endsWith(".git") ? repoUrl : `${repoUrl}.git`
  if (!sourceTarballUrl && githubPat && repoUrlWithGit.includes("github.com/")) {
    await reportProgress("Validating GitHub PAT access...")
    await validateGithubPatAccess(repoUrlWithGit, githubPat)
  }
  const isCommitSha = /^[0-9a-f]{40}$/i.test(branch)
  const source = sourceTarballUrl
    ? {
        type: "tarball" as const,
        url: sourceTarballUrl
      }
    : githubPat
      ? {
          type: "git" as const,
          url: repoUrlWithGit,
          revision: branch,
          ...(isCommitSha ? {} : { depth: 1 }),
          username: "x-access-token",
          password: githubPat
        }
      : {
          type: "git" as const,
          url: repoUrlWithGit,
          revision: branch,
          ...(isCommitSha ? {} : { depth: 1 })
        }
  let sandbox: Sandbox
  try {
    await reportProgress("Creating sandbox instance...")
    sandbox = await Sandbox.create({
      ...sandboxCredentials,
      source,
      resources: { vcpus: 8 },
      timeout: timeoutMs,
      ports: [3000], // App port
      runtime: "node22"
    })
  } catch (error) {
    const apiError = error as {
      message?: string
      response?: { status?: number; statusText?: string; url?: string }
      text?: string
      json?: unknown
      sandboxId?: string
    }
    const responsePayload =
      apiError?.json && typeof apiError.json === "object" && "error" in apiError.json
        ? (
            apiError.json as {
              error?: { code?: string; message?: string; exitCode?: number; sandboxId?: string }
            }
          ).error
        : undefined
    const status = apiError?.response?.status
    const code = responsePayload?.code
    const message = responsePayload?.message || apiError?.message || String(error)
    const sandboxId = responsePayload?.sandboxId || apiError?.sandboxId
    const exitCode = responsePayload?.exitCode

    console.error("[Sandbox Create] Failed", {
      repoUrl: repoUrlWithGit,
      branch,
      isCommitSha,
      hasGithubPat: Boolean(githubPat),
      message,
      status,
      statusText: apiError?.response?.statusText,
      responseUrl: apiError?.response?.url,
      sandboxId,
      code,
      exitCode,
      responseText: apiError?.text,
      responseJson: apiError?.json
    })

    if (status === 400 && code === "bad_request" && message.toLowerCase().includes("git clone failed")) {
      const authHint = githubPat
        ? "The provided GitHub PAT could not clone the repository. Verify token validity and repo access."
        : "No GitHub PAT was provided. For private repos, provide a PAT with read access."
      const enriched = `Sandbox git source clone failed (${repoUrlWithGit}@${branch}). ${authHint} API code=${code} status=${status} exitCode=${exitCode ?? "unknown"} sandboxId=${sandboxId ?? "unknown"}`
      await reportProgress(enriched)
      throw new Error(enriched)
    }

    const generic = `Sandbox creation failed: ${message} (status=${status ?? "unknown"}, code=${code ?? "unknown"}, sandboxId=${sandboxId ?? "unknown"})`
    await reportProgress(generic)
    throw new Error(generic)
  }

  if (debug) console.log("  ✅ Sandbox created")
  await reportProgress("Sandbox instance created")

  try {
    let effectiveProjectDir = normalizedProjectDir
    if (sourceTarballUrl && effectiveProjectDir) {
      const projectDirCheck = await runCommandWithLogs(sandbox, {
        cmd: "test",
        args: ["-d", `/vercel/sandbox/${effectiveProjectDir}`]
      })
      if (projectDirCheck.exitCode !== 0) {
        if (debug) {
          console.log(
            `  ℹ️ Tarball source did not include ${effectiveProjectDir}; falling back to /vercel/sandbox for setup`
          )
        }
        effectiveProjectDir = ""
      }
    }

    const sandboxCwd = effectiveProjectDir ? `/vercel/sandbox/${effectiveProjectDir}` : "/vercel/sandbox"

    if (Object.keys(projectEnv).length > 0) {
      await reportProgress(`Writing ${Object.keys(projectEnv).length} development env var(s) to sandbox`)
      const envWriteResult = await runCommandWithLogs(sandbox, {
        cmd: "node",
        args: [
          "-e",
          `const fs=require("fs");
const env=JSON.parse(process.env.PROJECT_ENV_JSON||"{}");
const lines=Object.entries(env).map(([k,v])=>\`\${k}=\${JSON.stringify(String(v ?? ""))}\`).join("\\n");
fs.writeFileSync(".env.local", lines + (lines ? "\\n" : ""));
fs.writeFileSync(".env.development.local", lines + (lines ? "\\n" : ""));
console.log("wrote .env.local and .env.development.local");`
        ],
        cwd: sandboxCwd,
        env: {
          PROJECT_ENV_JSON: JSON.stringify(projectEnv)
        }
      })
      if (envWriteResult.exitCode !== 0) {
        throw new Error(
          `Failed to write development env files: ${envWriteResult.stderr || envWriteResult.stdout || "unknown error"}`
        )
      }
    }
    if (sourceTarballUrl) {
      await reportProgress("Initializing git baseline for tarball source")
      const gitInitResult = await runCommandWithLogs(sandbox, {
        cmd: "bash",
        args: [
          "-lc",
          `cd ${sandboxCwd} && git init && git config user.email "dev3000@local" && git config user.name "Dev3000" && git add . && git commit -m "Initial V0 source snapshot" || true`
        ]
      })
      if (debug && gitInitResult.exitCode !== 0) {
        console.log(`  ⚠️ git baseline init exited with code ${gitInitResult.exitCode}`)
      }
    }
    if (debug) {
      console.log(
        `  ✅ Repository initialized from source: ${sourceTarballUrl ? sourceTarballUrl : `${repoUrlWithGit}@${branch}`}`
      )
    }

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

    const resolvedPackageManager =
      packageManager ||
      (await detectProjectPackageManager(
        async (cmd, args, cwd) => runCommandWithLogs(sandbox, { cmd, args, cwd }),
        sandboxCwd,
        debug
      ))
    await reportProgress(`Detected package manager: ${resolvedPackageManager}`)

    const requiredNodeMajor = await detectRequiredNodeMajor(
      async (cmd, args, cwd) => runCommandWithLogs(sandbox, { cmd, args, cwd }),
      sandboxCwd,
      debug
    )
    if (requiredNodeMajor) {
      await reportProgress(`Detected Node requirement: ${requiredNodeMajor}.x`)
      const nodeSetupResult = await runCommandWithLogs(sandbox, {
        cmd: "bash",
        args: [
          "-lc",
          `
set -euo pipefail
if [ ! -x "$HOME/.fnm/fnm" ] && [ ! -x "$HOME/.local/share/fnm/fnm" ]; then
  curl -fsSL https://fnm.vercel.app/install | bash -s -- --skip-shell
fi
if [ -x "$HOME/.fnm/fnm" ]; then
  FNM_BIN="$HOME/.fnm/fnm"
elif [ -x "$HOME/.local/share/fnm/fnm" ]; then
  FNM_BIN="$HOME/.local/share/fnm/fnm"
else
  echo "fnm binary not found after install" >&2
  exit 1
fi
export PATH="$(dirname "$FNM_BIN"):$PATH"
eval "$("$FNM_BIN" env --shell bash)"
"$FNM_BIN" install ${requiredNodeMajor}
"$FNM_BIN" use ${requiredNodeMajor}
NODE_BIN="$(command -v node)"
[ -n "$NODE_BIN" ] || { echo "node not found after fnm use" >&2; exit 1; }
node -v
`.trim()
        ],
        cwd: sandboxCwd,
        stdout: debug ? process.stdout : undefined,
        stderr: debug ? process.stderr : undefined
      })
      if (nodeSetupResult.exitCode !== 0) {
        throw new Error(
          `Node version setup failed: ${nodeSetupResult.stderr || nodeSetupResult.stdout || "unknown error"}`
        )
      }
      await reportProgress(`Using Node ${requiredNodeMajor}.x in sandbox`)
    }

    if (resolvedPackageManager === "bun") {
      await ensureBunInstalled(sandbox)
    }

    const resolvedNpmToken = resolveNpmTokenValue(npmToken, projectEnv)
    if (resolvedNpmToken) {
      await reportProgress("Configuring npm auth token for private packages")
      const npmAuthSetup = await runCommandWithLogs(sandbox, {
        cmd: "bash",
        args: [
          "-lc",
          `cat > "$HOME/.npmrc" <<EOF
registry=https://registry.npmjs.org/
//registry.npmjs.org/:_authToken=$NPM_TOKEN
always-auth=true
EOF
cat > ".npmrc" <<EOF
registry=https://registry.npmjs.org/
//registry.npmjs.org/:_authToken=$NPM_TOKEN
always-auth=true
EOF
chmod 0600 "$HOME/.npmrc" ".npmrc"`
        ],
        cwd: sandboxCwd,
        env: { NPM_TOKEN: resolvedNpmToken }
      })
      if (npmAuthSetup.exitCode !== 0) {
        throw new Error(`Failed to configure npm auth token: ${npmAuthSetup.stderr || npmAuthSetup.stdout}`)
      }

      await reportProgress("Validating npm auth token")
      const npmAuthCheck = await runCommandWithLogs(sandbox, {
        cmd: "bash",
        args: ["-lc", "npm whoami --registry=https://registry.npmjs.org/"],
        cwd: sandboxCwd,
        env: { NPM_TOKEN: resolvedNpmToken, NODE_AUTH_TOKEN: resolvedNpmToken }
      })
      if (npmAuthCheck.exitCode !== 0) {
        throw new Error(`NPM token authentication failed: ${npmAuthCheck.stderr || npmAuthCheck.stdout}`)
      }
    }

    // Install project dependencies
    if (debug) console.log("  📦 Installing project dependencies...")
    await reportProgress("Installing project dependencies...")
    let installResult: { exitCode: number; stdout: string; stderr: string }
    try {
      const installCommand =
        resolvedPackageManager === "bun"
          ? "bun install"
          : resolvedPackageManager === "pnpm"
            ? normalizedProjectDir
              ? `corepack pnpm -C ${sandboxCwd} install --filter .`
              : "corepack pnpm install"
            : resolvedPackageManager === "yarn"
              ? "corepack yarn install"
              : "npm install"

      const nodePrefix = requiredNodeMajor
        ? `if [ -x "$HOME/.fnm/fnm" ]; then FNM_BIN="$HOME/.fnm/fnm"; elif [ -x "$HOME/.local/share/fnm/fnm" ]; then FNM_BIN="$HOME/.local/share/fnm/fnm"; fi; if [ -n "\${FNM_BIN:-}" ]; then export PATH="$(dirname "$FNM_BIN"):$PATH"; eval "$("$FNM_BIN" env --shell bash)"; "$FNM_BIN" use ${requiredNodeMajor} >/dev/null 2>&1 || true; fi;`
        : ""

      installResult = await runCommandWithLogs(sandbox, {
        cmd: "bash",
        args: ["-lc", `${nodePrefix} export PATH=$HOME/.bun/bin:/usr/local/bin:$PATH; ${installCommand}`],
        cwd: sandboxCwd,
        env: resolvedNpmToken ? { NPM_TOKEN: resolvedNpmToken, NODE_AUTH_TOKEN: resolvedNpmToken } : undefined,
        stdout: debug ? process.stdout : undefined,
        stderr: debug ? process.stderr : undefined
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await reportProgress(`Dependency install command error: ${message.slice(0, 240)}`)
      throw error
    }

    if (installResult.exitCode !== 0) {
      const stderrTail = installResult.stderr.slice(-1000)
      const stdoutTail = installResult.stdout.slice(-500)
      await reportProgress(`Dependency install failed (exit ${installResult.exitCode})`)
      throw new Error(
        `Project dependency installation failed with exit code ${installResult.exitCode}\nStderr: ${stderrTail || "(empty)"}\nStdout: ${stdoutTail || "(empty)"}`
      )
    }

    if (debug) console.log("  ✅ Project dependencies installed")
    await reportProgress("Project dependencies installed")

    if (skipD3kSetup) {
      if (debug) console.log("  ⏩ Analyzer-only mode: skipping d3k/chrome installation and startup")
      await reportProgress("Skipping d3k/chrome setup (analyzer-only mode)")
      const devUrl = ""
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
    }

    // Install Chrome/Chromium using the SandboxChrome module
    // This handles system dependencies, @sparticuz/chromium installation, and path extraction
    if (debug) console.log("  🔧 Setting up Chrome using SandboxChrome module...")

    await SandboxChrome.installSystemDependencies(sandbox, { debug })
    if (debug) console.log("  ✅ System dependencies installed")

    await SandboxChrome.installChromium(sandbox, { cwd: sandboxCwd, packageManager: resolvedPackageManager, debug })
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
    await reportProgress(`[Sandbox] Chromium binary: ${await getBrowserBinarySummary(sandbox, chromiumPath)}`)

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

    // Prefer the preinstalled d3k from the shared snapshot. Only reinstall if that
    // binary is missing or invalid.
    let d3kVerification = await verifyInstalledD3kBinary(sandbox, { cwd: sandboxCwd, debug })
    let d3kInstallResult = { exitCode: 0, stdout: "", stderr: "" }

    if (d3kVerification.ok) {
      if (debug) console.log("  ✅ Using preinstalled d3k from shared snapshot")
      await reportProgress("[Sandbox] Using preinstalled d3k from shared snapshot")
    } else {
      if (debug) {
        console.log(`  ⚠️ Preinstalled d3k failed validation, attempting repo install: ${d3kVerification.detail}`)
      }

      // Install d3k from the checked-out repo first so sandbox runs use the current commit.
      if (debug) console.log("  📦 Installing d3k globally from repo checkout (/vercel/sandbox)")
      d3kInstallResult =
        resolvedPackageManager === "bun"
          ? await runCommandWithLogs(sandbox, {
              cmd: "sh",
              args: [
                "-c",
                "export PATH=$HOME/.bun/bin:/usr/local/bin:$PATH; bun add -g /vercel/sandbox /vercel/sandbox/packages/d3k-linux-x64"
              ],
              stdout: debug ? process.stdout : undefined,
              stderr: debug ? process.stderr : undefined
            })
          : await runCommandWithLogs(sandbox, {
              cmd: "pnpm",
              args: ["i", "-g", "/vercel/sandbox", "/vercel/sandbox/packages/d3k-linux-x64"],
              stdout: debug ? process.stdout : undefined,
              stderr: debug ? process.stderr : undefined
            })

      d3kVerification =
        d3kInstallResult.exitCode === 0
          ? await verifyInstalledD3kBinary(sandbox, { cwd: sandboxCwd, debug })
          : { ok: false, detail: d3kInstallResult.stderr || d3kInstallResult.stdout || "install failed" }

      if (!d3kVerification.ok) {
        if (debug) {
          console.log(
            `  ⚠️ Local d3k install failed validation, falling back to npm (dev3000@latest): ${d3kVerification.detail}`
          )
        }
        await reportProgress("[Sandbox] Local d3k install unusable, falling back to published package")
        d3kInstallResult =
          resolvedPackageManager === "bun"
            ? await runCommandWithLogs(sandbox, {
                cmd: "sh",
                args: [
                  "-c",
                  "export PATH=$HOME/.bun/bin:/usr/local/bin:$PATH; bun add -g dev3000@latest @d3k/linux-x64@latest"
                ],
                stdout: debug ? process.stdout : undefined,
                stderr: debug ? process.stderr : undefined
              })
            : await runCommandWithLogs(sandbox, {
                cmd: "pnpm",
                args: ["i", "-g", "dev3000@latest", "@d3k/linux-x64@latest"],
                stdout: debug ? process.stdout : undefined,
                stderr: debug ? process.stderr : undefined
              })
      }

      if (d3kInstallResult.exitCode !== 0) {
        throw new Error(`d3k installation failed with exit code ${d3kInstallResult.exitCode}`)
      }

      d3kVerification = await verifyInstalledD3kBinary(sandbox, { cwd: sandboxCwd, debug })
    }
    if (!d3kVerification.ok) {
      throw new Error(`d3k installed but is not runnable: ${d3kVerification.detail}`)
    }

    if (debug) console.log("  ✅ d3k installed globally")

    const inferredDevCommand = await detectProjectDevCommand(
      async (cmd, args, cwd) => runCommandWithLogs(sandbox, { cmd, args, cwd }),
      sandboxCwd,
      resolvedPackageManager,
      debug
    )
    const resolvedDevCommand =
      devCommand?.trim() || inferredDevCommand || inferDevServerCommandFromPackageJson(null, resolvedPackageManager)
    const usesD3kRuntime = looksLikeD3kCommand(resolvedDevCommand)
    const skipsDevServerStartup = isNoDevServerCommand(resolvedDevCommand)

    if (preStartCommands.length > 0) {
      for (const preStartCommand of preStartCommands) {
        const resolvedPreStartCommand = preStartCommand.replace(/\$\{packageManager\}/g, resolvedPackageManager)
        if (debug) console.log(`  🧪 Running pre-start command: ${preStartCommand}`)
        const preStartResult = await runCommandWithLogs(sandbox, {
          cmd: "sh",
          args: [
            "-c",
            `export PATH=$HOME/.bun/bin:/usr/local/bin:$PATH; cd ${sandboxCwd} && ${resolvedPreStartCommand}`
          ],
          stdout: debug ? process.stdout : undefined,
          stderr: debug ? process.stderr : undefined
        })
        if (preStartResult.exitCode !== 0) {
          throw new Error(`Pre-start command failed (${resolvedPreStartCommand}): ${preStartResult.stderr}`)
        }
      }
      if (debug) console.log("  ✅ Pre-start commands completed")
    }

    if (preStartBackgroundCommand) {
      const resolvedPreStartBackgroundCommand = preStartBackgroundCommand.replace(
        /\$\{packageManager\}/g,
        resolvedPackageManager
      )
      if (debug) console.log(`  🧪 Starting pre-start background command: ${resolvedPreStartBackgroundCommand}`)
      await sandbox.runCommand({
        cmd: "sh",
        args: [
          "-c",
          `mkdir -p /home/vercel-sandbox/.d3k/logs && export PATH=$HOME/.bun/bin:/usr/local/bin:$PATH; cd ${sandboxCwd} && ${resolvedPreStartBackgroundCommand} > /home/vercel-sandbox/.d3k/logs/pre-start-background.log 2>&1`
        ],
        detached: true
      })
      if (preStartWaitPort) {
        if (debug) console.log(`  ⏳ Waiting for pre-start server on port ${preStartWaitPort}...`)
        await waitForServer(sandbox, preStartWaitPort, 120000, debug)
      }
      if (debug) console.log("  ✅ Pre-start background command ready")
    }

    if (!skipsDevServerStartup) {
      await reportProgress(`Starting ${usesD3kRuntime ? "d3k runtime" : "dev server"}...`)
      if (debug) console.log(`  🚀 Starting dev server with: ${resolvedDevCommand}`)
      if (debug) console.log(`  📂 Working directory: ${sandboxCwd}`)

      const startupCommand = usesD3kRuntime
        ? buildD3kLaunchCommand(resolvedDevCommand, chromiumPath)
        : resolvedDevCommand
      if (debug) {
        console.log(
          `  🔧 Command: export PATH=$HOME/.bun/bin:/usr/local/bin:$PATH; cd ${sandboxCwd} && ${startupCommand}`
        )
      }

      const d3kStartupLog = `${SANDBOX_D3K_TOP_LEVEL_LOG_DIR}/d3k-startup.log`
      await sandbox.runCommand({
        cmd: "sh",
        args: [
          "-c",
          `mkdir -p ${SANDBOX_D3K_TOP_LEVEL_LOG_DIR} && export PATH=$HOME/.bun/bin:/usr/local/bin:$PATH; cd ${sandboxCwd} && ${startupCommand} > ${d3kStartupLog} 2>&1`
        ],
        detached: true
      })

      if (debug) {
        console.log(`  ✅ ${usesD3kRuntime ? "d3k runtime" : "custom dev server"} started in detached mode`)
      }

      await reportProgress("Waiting for dev server on port 3000...")
      if (debug) console.log("  ⏳ Waiting for d3k to start...")
      await new Promise((resolve) => setTimeout(resolve, 5000))

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
          args: ["-c", `ls -lah ${SANDBOX_D3K_LOG_DIR_GLOB} 2>/dev/null || echo 'No d3k log directories found'`]
        })
        console.log(`  📋 Log files:\n${logsCheck.stdout}`)

        const allLogsCheck = await runCommandWithLogs(sandbox, {
          cmd: "sh",
          args: [
            "-c",
            `for log in ${SANDBOX_D3K_LOG_GLOB}; do [ -f "$log" ] && echo "=== $log ===" && head -50 "$log" || true; done 2>/dev/null || true`
          ]
        })
        console.log(`  📋 Initial log content:\n${allLogsCheck.stdout}`)
      }

      if (debug) console.log("  ⏳ Waiting for dev server on port 3000...")
      try {
        await waitForServer(sandbox, 3000, 120000, debug)
      } catch (error) {
        console.log(`  ⚠️ Dev server failed to start: ${error instanceof Error ? error.message : String(error)}`)
        console.log("  🔍 Checking d3k logs for errors...")

        try {
          const logsCheck = await runCommandWithLogs(sandbox, {
            cmd: "sh",
            args: [
              "-c",
              `for log in ${SANDBOX_D3K_LOG_GLOB}; do [ -f "$log" ] && cat "$log" || true; done 2>/dev/null || echo 'No log files found'`
            ]
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
    } else {
      await reportProgress("Skipping dev server startup (Start Dev Server = none)")
      if (debug) console.log("  ⏭️ Skipping dev server startup because Start Dev Server is set to none")
    }

    const devUrl = skipsDevServerStartup ? "" : sandbox.domain(3000)
    if (!skipsDevServerStartup && debug) console.log(`  ✅ Dev server ready: ${devUrl}`)
    if (!skipsDevServerStartup) {
      await reportProgress("Dev server responded on port 3000")
    }

    if (!skipsDevServerStartup && usesD3kRuntime) {
      const browserSessionWaitStartedAt = Date.now()
      await reportProgress("Waiting for d3k browser session (CDP URL)...")
      if (debug) console.log("  ⏳ Waiting for d3k to initialize Chrome and populate CDP URL...")
      const cdpUrl = await waitForCdpUrl(sandbox, 30000, debug)
      if (cdpUrl) {
        if (debug) console.log(`  ✅ CDP URL ready: ${cdpUrl}`)
        await reportProgress(
          `d3k browser session ready (${Math.round((Date.now() - browserSessionWaitStartedAt) / 1000)}s to CDP)`
        )
        const pageNavigationWaitStartedAt = Date.now()
        await reportProgress("Waiting for initial page navigation...")
        if (debug) console.log("  ⏳ Waiting for d3k to complete page navigation...")
        await waitForPageNavigation(sandbox, 30000, debug)
        await reportProgress(
          `Initial page navigation complete (${Math.round((Date.now() - pageNavigationWaitStartedAt) / 1000)}s)`
        )
      } else {
        console.log("  ⚠️ CDP URL not found - browser automation features may not work")
        console.log("  📋 === d3k LOG DUMP (CDP URL not found) ===")
        try {
          const cdpFailLogs = await runCommandWithLogs(sandbox, {
            cmd: "sh",
            args: [
              "-c",
              `for log in ${SANDBOX_D3K_LOG_GLOB}; do [ -f "$log" ] && echo "\\n=== $log ===" && cat "$log" || true; done 2>/dev/null || echo "No log files found"`
            ]
          })
          console.log(cdpFailLogs.stdout)
        } catch (logErr) {
          console.log(`  ⚠️ Could not read logs: ${logErr instanceof Error ? logErr.message : String(logErr)}`)
        }
        console.log("  📋 === END d3k LOG DUMP ===")
      }
    } else if (!skipsDevServerStartup && debug) {
      console.log("  ℹ️ Custom dev server command selected; skipping d3k CDP/session wait")
    }

    // Dump ALL d3k logs after initialization for debugging
    // This is critical for understanding what d3k is doing in the sandbox
    if (debug) {
      console.log("  📋 === d3k FULL LOG DUMP (after initialization) ===")
      const fullLogsCheck = await runCommandWithLogs(sandbox, {
        cmd: "sh",
        args: [
          "-c",
          `for log in ${SANDBOX_D3K_LOG_GLOB}; do [ -f "$log" ] && echo "\\n=== $log ===" && cat "$log" || true; done 2>/dev/null || echo "No log files found"`
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
    await reportProgress(
      `Sandbox setup failed: ${error instanceof Error ? error.message.slice(0, 280) : String(error).slice(0, 280)}`
    )
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
  let lastLoggedStatus: number | undefined
  let sameStatusCount = 0
  let consecutiveServerErrors = 0

  while (Date.now() - startTime < timeoutMs) {
    try {
      const response = await fetch(url, { method: "HEAD", redirect: "manual" })
      const currentStatus = response.status
      if (lastStatus === currentStatus) {
        sameStatusCount += 1
      } else {
        sameStatusCount = 1
      }
      lastStatus = currentStatus

      if (debug && currentStatus !== lastLoggedStatus) {
        console.log(`  🔍 Port ${port} check: status ${response.status} ${response.statusText}`)
        lastLoggedStatus = currentStatus
      }

      // Consider server ready if:
      // - 2xx (ok)
      // - 3xx (redirect - app/auth/protection is responding)
      // - 404 (server responding but route not found)
      // - 401/403 (auth/protection challenge is responding)
      if (
        response.ok ||
        (response.status >= 300 && response.status < 400) ||
        response.status === 404 ||
        response.status === 401 ||
        response.status === 403
      ) {
        if (debug) console.log(`  ✅ Port ${port} is ready (status ${response.status})`)
        return
      }

      // Log unexpected status codes
      if (response.status >= 400 && response.status !== 404) {
        if (response.status >= 500) {
          consecutiveServerErrors += 1
        } else {
          consecutiveServerErrors = 0
        }
        lastError = `HTTP ${response.status} ${response.statusText}`
        if (debug && (sameStatusCount === 1 || sameStatusCount % 10 === 0)) {
          console.log(`  ⚠️ Port ${port} returned ${lastError} (${sameStatusCount} consecutive checks)`)
        }
        if (consecutiveServerErrors >= 30) {
          throw new Error(
            `Server on port ${port} is persistently returning ${lastError} (${consecutiveServerErrors} consecutive checks). ` +
              "This usually means the app booted but is failing at runtime (often missing required env vars/services)."
          )
        }
      } else {
        consecutiveServerErrors = 0
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
  const isCdpUrl = (value: unknown): value is string =>
    typeof value === "string" && /^wss?:\/\/.+\/devtools\/browser\//.test(value)

  const extractCdpUrl = (value: unknown): string | null => {
    if (isCdpUrl(value)) {
      return value
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = extractCdpUrl(item)
        if (found) return found
      }
      return null
    }
    if (value && typeof value === "object") {
      for (const nested of Object.values(value)) {
        const found = extractCdpUrl(nested)
        if (found) return found
      }
    }
    return null
  }

  const startTime = Date.now()
  let cdpUrl: string | null = null

  while (Date.now() - startTime < timeoutMs) {
    try {
      // Read both legacy and current session file locations from ~/.d3k/
      const cmdResult = await sandbox.runCommand({
        cmd: "sh",
        args: [
          "-c",
          `
files="$(ls -1 /home/vercel-sandbox/.d3k/*.json /home/vercel-sandbox/.d3k/*/session.json 2>/dev/null || true)"
for f in $files; do
  [ -f "$f" ] || continue
  echo "__SESSION_FILE__:$f"
  cat "$f" 2>/dev/null || true
  echo
done
          `.trim()
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
        const chunks = result.stdout
          .split("__SESSION_FILE__:")
          .map((chunk) => chunk.trim())
          .filter(Boolean)

        for (const chunk of chunks) {
          const newlineIndex = chunk.indexOf("\n")
          const filePath = newlineIndex === -1 ? chunk : chunk.slice(0, newlineIndex).trim()
          const payload = newlineIndex === -1 ? "" : chunk.slice(newlineIndex + 1).trim()
          if (!payload) continue

          try {
            const sessionData = JSON.parse(payload)
            const found = extractCdpUrl(sessionData)
            if (found) {
              cdpUrl = found
              if (debug) {
                console.log(`  ✅ CDP URL found in ${filePath}: ${cdpUrl}`)
              }
              return cdpUrl
            }
          } catch {
            // Ignore malformed file content and continue polling.
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
        args: ["-c", `grep -h "Navigated to http://localhost" ${SANDBOX_D3K_LOG_GLOB} 2>/dev/null | head -1 || true`]
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
  const { snapshotId, timeout = DEFAULT_SANDBOX_TIMEOUT, debug = false } = config

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
    if (debug) {
      console.log(`  🔎 Chromium binary: ${await getBrowserBinarySummary(sandbox, chromiumPath)}`)
    }

    // Start d3k (it should already be installed in the snapshot)
    if (debug) console.log("  🚀 Starting d3k...")
    const d3kStartupLog = `${SANDBOX_D3K_TOP_LEVEL_LOG_DIR}/d3k-startup.log`
    await sandbox.runCommand({
      cmd: "sh",
      args: [
        "-c",
        `mkdir -p ${SANDBOX_D3K_TOP_LEVEL_LOG_DIR} && export PATH=$HOME/.bun/bin:/usr/local/bin:$PATH; cd ${sandboxCwd} && d3k --no-tui --debug --headless --browser ${chromiumPath} > ${d3kStartupLog} 2>&1`
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
async function createAndSaveBaseSnapshot(
  timeoutMs: number,
  debug = false,
  onProgress?: (message: string) => void | Promise<void>
): Promise<string> {
  const reportProgress = async (message: string) => {
    if (!onProgress) return
    try {
      await onProgress(message)
    } catch {
      // Ignore progress reporting failures.
    }
  }

  if (debug) {
    console.log("  📦 Creating base snapshot (Chrome + d3k)...")
    console.log("  ⚠️ This is a one-time operation for initial setup")
  }
  await reportProgress("Rebuilding shared base snapshot...")

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
    opts?: { cwd?: string; env?: Record<string, string> }
  ): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    const result = await baseSandbox.runCommand({ cmd, args, cwd: opts?.cwd, env: opts?.env })
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
    await reportProgress("Installing Chrome system dependencies into shared snapshot...")
    await SandboxChrome.installSystemDependencies(baseSandbox, { debug })
    if (debug) console.log("  ✅ Chrome system dependencies installed")

    // Ensure bun is available in the base snapshot (projects may use bun run dev)
    if (debug) console.log("  📦 Ensuring bun is available...")
    await reportProgress("Ensuring bun is available in shared snapshot...")
    const bunWhich = await runCmd("sh", [
      "-c",
      "export PATH=$HOME/.bun/bin:/usr/local/bin:$PATH; command -v bun || true"
    ])
    if (!bunWhich.stdout.trim()) {
      const bunInstall = await runCmd("sh", ["-c", "curl -fsSL https://bun.sh/install | bash"])
      if (bunInstall.exitCode !== 0) {
        throw new Error(`bun installation failed: ${bunInstall.stderr}`)
      }
      await runCmd("sh", [
        "-c",
        "mkdir -p /usr/local/bin && ln -sf ~/.bun/bin/bun /usr/local/bin/bun && ln -sf ~/.bun/bin/bunx /usr/local/bin/bunx"
      ])
      if (debug) console.log("  ✅ bun installed")
    } else if (debug) {
      console.log(`  ✅ bun found at ${bunWhich.stdout.trim()}`)
    }

    // Install d3k globally from the checked-out repo first so sandbox runs use the current commit.
    if (debug) console.log("  📦 Installing d3k globally from repo checkout...")
    await reportProgress("Installing d3k in shared snapshot...")
    let d3kInstall = await runCmd("pnpm", ["i", "-g", "/vercel/sandbox", "/vercel/sandbox/packages/d3k-linux-x64"])
    let d3kVerify =
      d3kInstall.exitCode === 0
        ? await runCmd("sh", ["-c", "export PATH=$HOME/.bun/bin:/usr/local/bin:$PATH; d3k --version"])
        : d3kInstall
    const localD3kMissingBinary = `${d3kVerify.stdout}\n${d3kVerify.stderr}`.includes(
      "Could not find @d3k/linux-x64 binary"
    )
    if (d3kInstall.exitCode !== 0 || d3kVerify.exitCode !== 0 || localD3kMissingBinary) {
      if (debug) {
        console.log(
          `  ⚠️ Local d3k install failed validation, falling back to npm (dev3000@latest): ${(d3kVerify.stderr || d3kVerify.stdout || d3kInstall.stderr).slice(-400)}`
        )
      }
      d3kInstall = await runCmd("pnpm", ["i", "-g", "dev3000@latest", "@d3k/linux-x64@latest"])
    }
    if (d3kInstall.exitCode !== 0) {
      throw new Error(`d3k installation failed: ${d3kInstall.stderr}`)
    }
    d3kVerify = await runCmd("sh", ["-c", "export PATH=$HOME/.bun/bin:/usr/local/bin:$PATH; d3k --version"])
    const publishedD3kMissingBinary = `${d3kVerify.stdout}\n${d3kVerify.stderr}`.includes(
      "Could not find @d3k/linux-x64 binary"
    )
    if (d3kVerify.exitCode !== 0 || publishedD3kMissingBinary) {
      throw new Error(`d3k install is not runnable: ${d3kVerify.stderr || d3kVerify.stdout}`)
    }
    if (debug) console.log("  ✅ d3k installed globally")

    // Install agent-browser globally for CLI browser automation
    if (debug) console.log("  📦 Installing agent-browser globally...")
    await reportProgress("Installing agent-browser in shared snapshot...")
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

    // Install the shared Claude agent runtime into the base snapshot so
    // workflow sandboxes do not pay this bootstrap cost on every run.
    if (debug) console.log("  📦 Installing shared Claude agent runtime...")
    await reportProgress("Installing Claude Code and shared skills in shared snapshot...")
    const sharedHomeEnv = {
      PATH: "/home/vercel-sandbox/.bun/bin:/home/vercel-sandbox/.local/bin:/usr/local/bin:/usr/bin:/bin",
      HOME: "/home/vercel-sandbox"
    }
    const claudeInstallRoot = "/home/vercel-sandbox/.claude-code"
    const localClaudeCli = `${claudeInstallRoot}/node_modules/@anthropic-ai/claude-code/cli.js`
    const ensureNodeShim = [
      "if ! command -v node >/dev/null 2>&1; then",
      "  if command -v nodejs >/dev/null 2>&1; then",
      '    ln -sf "$(command -v nodejs)" /home/vercel-sandbox/.local/bin/node',
      "  else",
      '    ln -sf "$(command -v bun)" /home/vercel-sandbox/.local/bin/node',
      "  fi",
      "fi"
    ].join(" ")
    const sharedRuntimeInstall = await runCmd(
      "sh",
      [
        "-lc",
        [
          "mkdir -p /home/vercel-sandbox/.local/bin",
          `mkdir -p "${claudeInstallRoot}"`,
          `cd "${claudeInstallRoot}"`,
          `node -e 'const fs=require("fs"); if (!fs.existsSync("package.json")) fs.writeFileSync("package.json", JSON.stringify({ name: "claude-code-runtime", private: true }))'`,
          `bun add ${CLAUDE_CODE_PACKAGE}`,
          ensureNodeShim,
          `test -f "${localClaudeCli}"`,
          `chmod +x "${localClaudeCli}"`,
          `ln -sf "${localClaudeCli}" /home/vercel-sandbox/.local/bin/claude`,
          `bunx --bun skills@latest add ${VERCEL_PLUGIN_INSTALL_ARG} --agent claude-code --skill '*' -y`,
          `bunx --bun skills@latest add ${D3K_SKILL_INSTALL_ARG.split("@")[0]} --skill d3k --agent claude-code -y`,
          "command -v claude",
          `node "${localClaudeCli}" --version`
        ].join(" && ")
      ],
      { env: sharedHomeEnv }
    )
    if (sharedRuntimeInstall.exitCode !== 0) {
      throw new Error(
        `shared Claude agent runtime installation failed: ${sharedRuntimeInstall.stderr || sharedRuntimeInstall.stdout}`
      )
    }
    if (debug) console.log("  ✅ Shared Claude agent runtime installed")

    // Create snapshot (this stops the sandbox)
    if (debug) console.log("  📸 Creating snapshot...")
    await reportProgress("Saving shared base snapshot...")
    const snapshot = await baseSandbox.snapshot()
    if (debug) console.log(`  ✅ Base snapshot created: ${snapshot.snapshotId}`)

    // Save to blob store
    await saveBaseSnapshotId(snapshot.snapshotId, debug)
    await reportProgress("Shared base snapshot ready")

    return snapshot.snapshotId
  } catch (error) {
    await reportProgress(
      `Shared base snapshot rebuild failed: ${error instanceof Error ? error.message : String(error)}`
    )
    // Clean up on failure
    try {
      await baseSandbox.stop()
    } catch {
      // Ignore cleanup errors
    }
    throw error
  }
}

function getRepoUrlForClone(repoUrl: string, githubPat?: string): string {
  const repoUrlWithGit = repoUrl.endsWith(".git") ? repoUrl : `${repoUrl}.git`
  if (!githubPat || !repoUrlWithGit.includes("github.com/")) return repoUrlWithGit
  try {
    const parsed = new URL(repoUrlWithGit)
    parsed.username = "x-access-token"
    parsed.password = githubPat
    return parsed.toString()
  } catch {
    return repoUrlWithGit
  }
}

async function createD3kSandboxFromBaseSnapshot(
  config: D3kSandboxConfig,
  snapshotId: string
): Promise<D3kSandboxResult> {
  const {
    repoUrl,
    branch = "main",
    githubPat,
    npmToken,
    projectEnv = {},
    timeout = DEFAULT_SANDBOX_TIMEOUT,
    skipD3kSetup = false,
    onProgress,
    projectDir = "",
    packageManager,
    devCommand,
    preStartCommands = [],
    preStartBackgroundCommand,
    preStartWaitPort,
    debug = false
  } = config

  const reportProgress = async (message: string) => {
    if (!onProgress) return
    try {
      await onProgress(message)
    } catch {
      // Don't fail workflow progress updates.
    }
  }

  const timeoutMs = ms(timeout)
  if (typeof timeoutMs !== "number") {
    throw new Error(`Invalid timeout value: ${timeout}`)
  }

  const sandbox = await Sandbox.create({
    source: {
      type: "snapshot",
      snapshotId
    },
    resources: { vcpus: 8 },
    timeout: timeoutMs,
    ports: [3000],
    runtime: "node22"
  })

  async function runCommandWithLogs(
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

  const normalizedProjectDir = projectDir.replace(/^\/+|\/+$/g, "")
  const repoName =
    repoUrl
      .split("/")
      .pop()
      ?.replace(/\.git$/i, "") || "app"
  const repoCloneUrl = getRepoUrlForClone(repoUrl, githubPat)

  try {
    await reportProgress("Restoring project source from Git...")
    const cloneScript = `
set -euo pipefail
rm -rf /vercel/sandbox
mkdir -p /vercel
if [[ "$REVISION" =~ ^[0-9a-fA-F]{40}$ ]]; then
  git clone "$REPO_URL" /vercel/sandbox
  cd /vercel/sandbox
  git checkout "$REVISION"
else
  git clone --depth 1 --branch "$REVISION" "$REPO_URL" /vercel/sandbox
fi
`
    const cloneResult = await runCommandWithLogs({
      cmd: "bash",
      args: ["-lc", cloneScript],
      env: {
        REPO_URL: repoCloneUrl,
        REVISION: branch
      }
    })
    if (cloneResult.exitCode !== 0) {
      throw new Error(`Failed to clone repository in snapshot sandbox: ${cloneResult.stderr || cloneResult.stdout}`)
    }

    const sandboxCwd = normalizedProjectDir ? `/vercel/sandbox/${normalizedProjectDir}` : "/vercel/sandbox"

    if (Object.keys(projectEnv).length > 0) {
      await reportProgress(`Writing ${Object.keys(projectEnv).length} development env var(s) to sandbox`)
      const envWriteResult = await runCommandWithLogs({
        cmd: "node",
        args: [
          "-e",
          `const fs=require("fs");
const env=JSON.parse(process.env.PROJECT_ENV_JSON||"{}");
const lines=Object.entries(env).map(([k,v])=>\`\${k}=\${JSON.stringify(String(v ?? ""))}\`).join("\\n");
fs.writeFileSync(".env.local", lines + (lines ? "\\n" : ""));
fs.writeFileSync(".env.development.local", lines + (lines ? "\\n" : ""));
console.log("wrote .env.local and .env.development.local");`
        ],
        cwd: sandboxCwd,
        env: {
          PROJECT_ENV_JSON: JSON.stringify(projectEnv)
        }
      })
      if (envWriteResult.exitCode !== 0) {
        throw new Error(
          `Failed to write development env files: ${envWriteResult.stderr || envWriteResult.stdout || "unknown error"}`
        )
      }
    }

    const detectedPm = await runCommandWithLogs({
      cmd: "bash",
      args: [
        "-lc",
        "if [ -f bun.lockb ] || [ -f bun.lock ]; then echo bun; elif [ -f pnpm-lock.yaml ]; then echo pnpm; elif [ -f yarn.lock ]; then echo yarn; else echo npm; fi"
      ],
      cwd: sandboxCwd
    })
    const resolvedPackageManager = (packageManager || detectedPm.stdout.trim() || "npm") as
      | "bun"
      | "pnpm"
      | "npm"
      | "yarn"
    await reportProgress(`Detected package manager: ${resolvedPackageManager}`)
    const inferredDevCommand = await detectProjectDevCommand(
      async (cmd, args, cwd) => runCommandWithLogs({ cmd, args, cwd }),
      sandboxCwd,
      resolvedPackageManager,
      debug
    )
    const resolvedDevCommand =
      devCommand?.trim() || inferredDevCommand || inferDevServerCommandFromPackageJson(null, resolvedPackageManager)
    const usesD3kRuntime = looksLikeD3kCommand(resolvedDevCommand)
    const skipsDevServerStartup = isNoDevServerCommand(resolvedDevCommand)

    const resolvedNpmToken = resolveNpmTokenValue(npmToken, projectEnv)
    if (resolvedNpmToken) {
      await reportProgress("Configuring npm auth token for private packages")
      const npmAuthSetup = await runCommandWithLogs({
        cmd: "bash",
        args: [
          "-lc",
          `cat > "$HOME/.npmrc" <<EOF
registry=https://registry.npmjs.org/
//registry.npmjs.org/:_authToken=$NPM_TOKEN
always-auth=true
EOF
cat > ".npmrc" <<EOF
registry=https://registry.npmjs.org/
//registry.npmjs.org/:_authToken=$NPM_TOKEN
always-auth=true
EOF
chmod 0600 "$HOME/.npmrc" ".npmrc"`
        ],
        cwd: sandboxCwd,
        env: { NPM_TOKEN: resolvedNpmToken }
      })
      if (npmAuthSetup.exitCode !== 0) {
        throw new Error(`Failed to configure npm auth token: ${npmAuthSetup.stderr || npmAuthSetup.stdout}`)
      }
    }

    await reportProgress("Installing project dependencies...")
    const installCommand =
      resolvedPackageManager === "bun"
        ? "bun install"
        : resolvedPackageManager === "pnpm"
          ? normalizedProjectDir
            ? `corepack pnpm -C ${sandboxCwd} install --filter .`
            : "corepack pnpm install"
          : resolvedPackageManager === "yarn"
            ? "corepack yarn install"
            : "npm install"

    const installResult = await runCommandWithLogs({
      cmd: "bash",
      args: ["-lc", `export PATH=$HOME/.bun/bin:/usr/local/bin:$PATH; ${installCommand}`],
      cwd: sandboxCwd,
      env: resolvedNpmToken ? { NPM_TOKEN: resolvedNpmToken, NODE_AUTH_TOKEN: resolvedNpmToken } : undefined,
      stdout: debug ? process.stdout : undefined,
      stderr: debug ? process.stderr : undefined
    })
    if (installResult.exitCode !== 0) {
      const stderrTail = installResult.stderr.slice(-1000)
      const stdoutTail = installResult.stdout.slice(-500)
      throw new Error(
        `Project dependency installation failed with exit code ${installResult.exitCode}\nStderr: ${stderrTail || "(empty)"}\nStdout: ${stdoutTail || "(empty)"}`
      )
    }
    await reportProgress("Project dependencies installed")
    await reportProgress("[Sandbox] Dependency install complete; evaluating pre-start hooks")

    if (preStartCommands.length > 0) {
      await reportProgress(`[Sandbox] Running ${preStartCommands.length} pre-start command(s)...`)
      for (const preStartCommand of preStartCommands) {
        const resolvedPreStartCommand = preStartCommand.replace(/\$\{packageManager\}/g, resolvedPackageManager)
        await reportProgress(`[Sandbox] Pre-start command: ${resolvedPreStartCommand}`)
        const preStartResult = await runCommandWithLogs({
          cmd: "sh",
          args: [
            "-c",
            `export PATH=$HOME/.bun/bin:/usr/local/bin:$PATH; cd ${sandboxCwd} && ${resolvedPreStartCommand}`
          ],
          stdout: debug ? process.stdout : undefined,
          stderr: debug ? process.stderr : undefined
        })
        if (preStartResult.exitCode !== 0) {
          throw new Error(`Pre-start command failed (${resolvedPreStartCommand}): ${preStartResult.stderr}`)
        }
      }
      await reportProgress("[Sandbox] Pre-start commands finished")
    }

    if (preStartBackgroundCommand) {
      const resolvedPreStartBackgroundCommand = preStartBackgroundCommand.replace(
        /\$\{packageManager\}/g,
        resolvedPackageManager
      )
      await reportProgress(`[Sandbox] Launching pre-start background command: ${resolvedPreStartBackgroundCommand}`)
      await sandbox.runCommand({
        cmd: "sh",
        args: [
          "-c",
          `mkdir -p /home/vercel-sandbox/.d3k/logs && export PATH=$HOME/.bun/bin:/usr/local/bin:$PATH; cd ${sandboxCwd} && ${resolvedPreStartBackgroundCommand} > /home/vercel-sandbox/.d3k/logs/pre-start-background.log 2>&1`
        ],
        detached: true
      })
      if (preStartWaitPort) {
        await reportProgress(`[Sandbox] Waiting for pre-start background port ${preStartWaitPort}...`)
        await waitForServer(sandbox, preStartWaitPort, 120000, debug)
        await reportProgress(`[Sandbox] Pre-start background port ${preStartWaitPort} is ready`)
      }
    }

    if (skipD3kSetup) {
      const devUrl = ""
      return {
        sandbox,
        devUrl,
        projectName: normalizedProjectDir || repoName,
        bypassToken: undefined,
        cleanup: async () => {
          await sandbox.stop()
        }
      }
    }

    if (!skipsDevServerStartup) {
      await reportProgress(`[Sandbox] Resolved dev command: ${resolvedDevCommand}`)
      await reportProgress(`Starting ${usesD3kRuntime ? "d3k runtime" : "dev server"}...`)
      let chromiumPath = "/usr/bin/chromium"
      if (usesD3kRuntime) {
        try {
          chromiumPath = await SandboxChrome.getExecutablePath(sandbox, { cwd: sandboxCwd, debug })
        } catch (error) {
          if (debug) {
            console.log(
              `  ⚠️ Could not resolve Chromium path in snapshot sandbox, using fallback ${chromiumPath}: ${error instanceof Error ? error.message : String(error)}`
            )
          }
        }
        await reportProgress(`[Sandbox] Chromium binary: ${await getBrowserBinarySummary(sandbox, chromiumPath)}`)
      }
      const startupCommand = usesD3kRuntime
        ? buildD3kLaunchCommand(resolvedDevCommand, chromiumPath)
        : resolvedDevCommand
      const d3kStartupLog = `${SANDBOX_D3K_TOP_LEVEL_LOG_DIR}/d3k-startup.log`
      await sandbox.runCommand({
        cmd: "sh",
        args: [
          "-c",
          `mkdir -p ${SANDBOX_D3K_TOP_LEVEL_LOG_DIR} && export PATH=$HOME/.bun/bin:/usr/local/bin:$PATH; cd ${sandboxCwd} && ${startupCommand} > ${d3kStartupLog} 2>&1`
        ],
        detached: true
      })

      await reportProgress("Waiting for dev server on port 3000...")
      await new Promise((resolve) => setTimeout(resolve, 5000))
      await waitForServer(sandbox, 3000, 120000, debug)

      await reportProgress("Dev server responded on port 3000")
      if (usesD3kRuntime) {
        await reportProgress("Waiting for d3k browser session...")
        const cdpUrl = await waitForCdpUrl(sandbox, 30000, debug)
        if (cdpUrl) {
          await reportProgress("d3k browser session ready")
          await waitForPageNavigation(sandbox, 30000, debug)
        }
      }
    } else {
      await reportProgress("Skipping dev server startup (Start Dev Server = none)")
    }

    const devUrl = skipsDevServerStartup ? "" : sandbox.domain(3000)
    return {
      sandbox,
      devUrl,
      projectName: normalizedProjectDir || repoName,
      bypassToken: undefined,
      cleanup: async () => {
        await sandbox.stop()
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
  const timer = new StepTimer()
  const debug = config.debug ?? false
  const timeoutMs = ms(config.timeout || DEFAULT_SANDBOX_TIMEOUT)
  if (typeof timeoutMs !== "number") {
    throw new Error(`Invalid timeout value: ${config.timeout}`)
  }

  if (config.sourceTarballUrl) {
    timer.start("Create sandbox from tarball source")
    const result = await createD3kSandbox(config)
    timer.end()
    return {
      ...result,
      fromSnapshot: false,
      snapshotId: undefined,
      timing: timer.getData()
    }
  }

  timer.start("Load base snapshot metadata")
  const metadata = await loadBaseSnapshotId(debug)
  timer.end()

  let snapshotIdToUse: string | undefined
  if (metadata) {
    timer.start("Validate base snapshot")
    const valid = await isSnapshotValid(metadata, BASE_SNAPSHOT_VERSION, debug)
    timer.end()
    if (valid) {
      snapshotIdToUse = metadata.snapshotId
    }
  }

  if (!snapshotIdToUse) {
    timer.start("Create base snapshot")
    try {
      snapshotIdToUse = await createAndSaveBaseSnapshot(timeoutMs, debug, config.onProgress)
    } catch (error) {
      if (debug) {
        console.log(
          `  ⚠️ Base snapshot creation failed, falling back to fresh sandbox: ${error instanceof Error ? error.message : String(error)}`
        )
      }
      if (config.onProgress) {
        await config.onProgress("Shared base snapshot unavailable, falling back to fresh sandbox...")
      }
    } finally {
      timer.end()
    }
  }

  if (snapshotIdToUse) {
    timer.start("Create sandbox from base snapshot")
    try {
      const result = await createD3kSandboxFromBaseSnapshot(config, snapshotIdToUse)
      timer.end()
      return {
        ...result,
        fromSnapshot: true,
        snapshotId: snapshotIdToUse,
        timing: timer.getData()
      }
    } catch (error) {
      timer.end()
      if (debug) {
        console.log(
          `  ⚠️ Snapshot sandbox path failed, falling back to git source: ${error instanceof Error ? error.message : String(error)}`
        )
      }
    }
  }

  timer.start("Create sandbox from git source")
  const fallback = await createD3kSandbox(config)
  timer.end()
  return {
    ...fallback,
    fromSnapshot: false,
    snapshotId: undefined,
    timing: timer.getData()
  }
}
