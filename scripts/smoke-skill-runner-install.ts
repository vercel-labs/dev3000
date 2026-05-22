#!/usr/bin/env bun

import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

interface VercelCliAuth {
  token?: string
  expiresAt?: number
}

interface WorkerInstallResponse {
  success?: boolean
  installed?: boolean
  error?: string
  code?: string
  actionLabel?: string
  actionUrl?: string
  deploymentUrl?: string
  details?: string
  projectName?: string
  expectedProjectName?: string
  message?: string
  project?: {
    projectId?: string
    projectName?: string
    workerBaseUrl?: string
    dashboardUrl?: string
    missingEnvKeys?: string[]
    latestDeploymentReadyState?: string
    shellVersionStatus?: "current" | "outdated" | "unknown"
  }
  settings?: {
    workerStatus?: string
    workerBaseUrl?: string
    workerProjectId?: string
  }
}

interface SmokeOptions {
  baseUrl: string
  json: boolean
  team?: string
  validateOnly: boolean
}

function parseArgs(argv: string[]): SmokeOptions {
  const options: SmokeOptions = {
    baseUrl: process.env.D3K_SMOKE_BASE_URL || "https://dev3000.ai",
    json: false,
    team: process.env.D3K_SMOKE_TEAM,
    validateOnly: false
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--team" || arg === "-t") {
      options.team = argv[++index]
    } else if (arg === "--base-url") {
      options.baseUrl = argv[++index] || options.baseUrl
    } else if (arg === "--json") {
      options.json = true
    } else if (arg === "--validate-only") {
      options.validateOnly = true
    } else if (arg === "--help" || arg === "-h") {
      printUsage()
      process.exit(0)
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  if (!options.team?.trim()) {
    throw new Error("Missing team. Pass --team <team-slug-or-id> or set D3K_SMOKE_TEAM.")
  }

  return {
    ...options,
    baseUrl: normalizeBaseUrl(options.baseUrl),
    team: options.team.trim()
  }
}

function printUsage() {
  console.log(`Usage: bun run scripts/smoke-skill-runner-install.ts --team <team-slug-or-id> [options]

Options:
  --team, -t <team>     Vercel team slug or ID. Can also use D3K_SMOKE_TEAM.
  --base-url <url>      dev3000 URL. Defaults to D3K_SMOKE_BASE_URL or https://dev3000.ai.
  --validate-only       Use GET to validate the existing runner without installing or repairing.
  --json                Print machine-readable output.

Auth:
  Uses VERCEL_TOKEN first, then local Vercel CLI auth from vercel login.
`)
}

function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "")
  if (!trimmed) return "https://dev3000.ai"
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed
  return `https://${trimmed}`
}

function readVercelTokenFromCliAuth(): string | null {
  const homeDirectory = homedir()
  const xdgDataHome = process.env.XDG_DATA_HOME || join(homeDirectory, ".local", "share")
  const candidates = [
    join(xdgDataHome, "com.vercel.cli", "auth.json"),
    join(homeDirectory, "Library", "Application Support", "com.vercel.cli", "auth.json"),
    join(homeDirectory, ".now", "auth.json"),
    join(homeDirectory, ".vercel", "auth.json")
  ]

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(readFileSync(candidate, "utf8")) as VercelCliAuth
      const token = parsed.token?.trim()
      const expiresAt = typeof parsed.expiresAt === "number" ? parsed.expiresAt : null
      if (token && (!expiresAt || expiresAt > Math.floor(Date.now() / 1000) + 60)) {
        return token
      }
    } catch {
      // Try the next known Vercel CLI auth location.
    }
  }

  return null
}

function resolveVercelToken(): string {
  const explicitToken = process.env.VERCEL_TOKEN?.trim()
  if (explicitToken) return explicitToken

  const cliToken = readVercelTokenFromCliAuth()
  if (cliToken) return cliToken

  throw new Error("No Vercel token found. Set VERCEL_TOKEN or run vercel login.")
}

function isReadyResponse(data: WorkerInstallResponse): boolean {
  const workerStatus = data.settings?.workerStatus
  return Boolean(
    data.success &&
      data.installed &&
      (data.project?.workerBaseUrl || data.settings?.workerBaseUrl) &&
      !data.project?.missingEnvKeys?.length &&
      data.project?.shellVersionStatus !== "outdated" &&
      workerStatus === "ready"
  )
}

async function requestWorkerInstall(
  options: SmokeOptions,
  token: string
): Promise<{ status: number; data: WorkerInstallResponse }> {
  const url = new URL("/api/skill-runner-teams/worker", options.baseUrl)
  if (!options.team) {
    throw new Error("Missing team.")
  }
  url.searchParams.set("team", options.team)

  const response = await fetch(url, {
    method: options.validateOnly ? "GET" : "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: options.validateOnly ? undefined : JSON.stringify({ team: options.team })
  })
  const text = await response.text()
  let data: WorkerInstallResponse
  try {
    data = JSON.parse(text) as WorkerInstallResponse
  } catch {
    data = {
      success: false,
      error: `Non-JSON response (${response.status}): ${text.slice(0, 300)}`
    }
  }

  return {
    status: response.status,
    data
  }
}

function printHumanSummary(options: SmokeOptions, status: number, data: WorkerInstallResponse) {
  const mode = options.validateOnly ? "validation" : "install/repair"
  console.log(`Skill runner ${mode} smoke: ${data.success ? "response ok" : "response failed"} (${status})`)
  console.log(`Team: ${options.team}`)
  console.log(`Base URL: ${options.baseUrl}`)

  if (data.project?.projectName || data.projectName) {
    console.log(`Runner project: ${data.project?.projectName || data.projectName}`)
  }
  if (data.settings?.workerStatus) {
    console.log(`Worker status: ${data.settings.workerStatus}`)
  }
  if (data.project?.latestDeploymentReadyState) {
    console.log(`Latest deployment: ${data.project.latestDeploymentReadyState}`)
  }
  if (data.project?.workerBaseUrl || data.settings?.workerBaseUrl) {
    console.log(`Worker URL: ${data.project?.workerBaseUrl || data.settings?.workerBaseUrl}`)
  }
  if (data.project?.dashboardUrl) {
    console.log(`Dashboard: ${data.project.dashboardUrl}`)
  }
  if (data.deploymentUrl) {
    console.log(`Failed deployment: ${data.deploymentUrl}`)
  }
  if (data.error) {
    console.error(`Error: ${data.error}`)
  }
  if (data.details) {
    console.error(data.details)
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const token = resolveVercelToken()
  const { status, data } = await requestWorkerInstall(options, token)
  const ready = isReadyResponse(data)

  if (options.json) {
    console.log(JSON.stringify({ ready, status, ...data }, null, 2))
  } else {
    printHumanSummary(options, status, data)
    console.log(ready ? "Result: ready" : "Result: not ready")
  }

  if (!ready) {
    process.exit(1)
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
