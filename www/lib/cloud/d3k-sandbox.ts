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
const BASE_SNAPSHOT_VERSION = "2026-02-11-bun"

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
    npmToken,
    projectEnv = {},
    timeout = "30m",
    skipD3kSetup = false,
    onProgress,
    projectDir = "",
    framework = "Next.js",
    packageManager,
    preStartCommands = [],
    preStartBackgroundCommand,
    preStartWaitPort,
    debug = false
  } = config

  const normalizedProjectDir = projectDir.replace(/^\/+|\/+$/g, "")
  const projectName = normalizedProjectDir || repoUrl.split("/").pop()?.replace(".git", "") || "app"

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
  if (githubPat && repoUrlWithGit.includes("github.com/")) {
    await reportProgress("Validating GitHub PAT access...")
    await validateGithubPatAccess(repoUrlWithGit, githubPat)
  }
  const isCommitSha = /^[0-9a-f]{40}$/i.test(branch)
  const source = githubPat
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
    const sandboxCwd = normalizedProjectDir ? `/vercel/sandbox/${normalizedProjectDir}` : "/vercel/sandbox"

    if (Object.keys(projectEnv).length > 0) {
      await reportProgress(`Writing ${Object.keys(projectEnv).length} development env var(s) to sandbox`)
      const envWriteResult = await runCommandWithLogs(sandbox, {
        cmd: "node",
        args: [
          "-e",
          `const fs=require("fs");
const env=JSON.parse(process.env.PROJECT_ENV_JSON||"{}");
const lines=Object.entries(env).map(([k,v])=>\`\${k}=\${JSON.stringify(String(v ?? ""))}\`).join("\\n");
fs.writeFileSync(".env.development.local", lines + (lines ? "\\n" : ""));
console.log("wrote .env.development.local");`
        ],
        cwd: sandboxCwd,
        env: {
          PROJECT_ENV_JSON: JSON.stringify(projectEnv)
        }
      })
      if (envWriteResult.exitCode !== 0) {
        throw new Error(
          `Failed to write .env.development.local: ${envWriteResult.stderr || envWriteResult.stdout || "unknown error"}`
        )
      }
    }
    if (debug) console.log(`  ✅ Repository initialized from source: ${repoUrlWithGit}@${branch}`)

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

    const resolvedNpmToken = npmToken || process.env.NPM_TOKEN
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
EOF`
        ],
        cwd: sandboxCwd,
        env: { NPM_TOKEN: resolvedNpmToken }
      })
      if (npmAuthSetup.exitCode !== 0) {
        throw new Error(`Failed to configure npm auth token: ${npmAuthSetup.stderr || npmAuthSetup.stdout}`)
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
      const devUrl = sandbox.domain(3000)
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
    const d3kInstallResult =
      resolvedPackageManager === "bun"
        ? await runCommandWithLogs(sandbox, {
            cmd: "sh",
            args: ["-c", "export PATH=$HOME/.bun/bin:/usr/local/bin:$PATH; bun add -g dev3000@latest"],
            stdout: debug ? process.stdout : undefined,
            stderr: debug ? process.stderr : undefined
          })
        : await runCommandWithLogs(sandbox, {
            cmd: "pnpm",
            args: ["i", "-g", "dev3000@latest"],
            stdout: debug ? process.stdout : undefined,
            stderr: debug ? process.stderr : undefined
          })

    if (d3kInstallResult.exitCode !== 0) {
      throw new Error(`d3k installation failed with exit code ${d3kInstallResult.exitCode}`)
    }

    if (debug) console.log("  ✅ d3k installed globally")

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

    // Start d3k (which starts browser + logging)
    if (debug) console.log("  🚀 Starting d3k...")
    if (debug) console.log(`  📂 Working directory: ${sandboxCwd}`)

    // Use chromium path from @sparticuz/chromium (or fallback)
    if (debug)
      console.log(
        `  🔧 Command: export PATH=$HOME/.bun/bin:/usr/local/bin:$PATH; cd ${sandboxCwd} && d3k --no-tui --debug --headless --auto-skills --agent-name codex --browser ${chromiumPath}`
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
        `mkdir -p /home/vercel-sandbox/.d3k/logs && export PATH=$HOME/.bun/bin:/usr/local/bin:$PATH; cd ${sandboxCwd} && d3k --no-tui --debug --headless --auto-skills --agent-name codex --browser ${chromiumPath} > ${d3kStartupLog} 2>&1`
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
        `mkdir -p /home/vercel-sandbox/.d3k/logs && export PATH=$HOME/.bun/bin:/usr/local/bin:$PATH; cd ${sandboxCwd} && d3k --no-tui --debug --headless --browser ${chromiumPath} > ${d3kStartupLog} 2>&1`
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

    // Ensure bun is available in the base snapshot (projects may use bun run dev)
    if (debug) console.log("  📦 Ensuring bun is available...")
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
  const timer = new StepTimer()
  timer.start("Create sandbox from git source")
  const result = await createD3kSandbox(config)
  timer.end()
  return {
    ...result,
    fromSnapshot: false,
    snapshotId: undefined,
    timing: timer.getData()
  }
}
