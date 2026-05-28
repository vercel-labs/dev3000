#!/usr/bin/env bun

import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { SKILL_RUNNER_WORKER_REPO, SKILL_RUNNER_WORKER_ROOT_DIRECTORY } from "../www/lib/skill-runner-config"
import { resolveSkillRunnerShellSource, uploadSkillRunnerShellSourceFiles } from "../www/lib/skill-runner-shell-source"

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
    latestDeploymentId?: string
    latestDeploymentGitSha?: string
    latestDeploymentUrl?: string
    desiredWorkerBranch?: string
    desiredWorkerGitSha?: string
    workerShellVersion?: string
    workerReportedBranch?: string
    runtimeManifestVersion?: string
    shellVersionStatus?: "current" | "outdated" | "unknown"
  }
  settings?: {
    workerStatus?: string
    workerBaseUrl?: string
    workerProjectId?: string
  }
}

interface WorkerInstallProgressSnapshot {
  phase: string
  message: string
  elapsedMs?: number
}

interface WorkerInstallResult {
  status: number
  data: WorkerInstallResponse
  progress: WorkerInstallProgressSnapshot[]
  durationMs: number
}

interface TimingEntry {
  name: string
  durationMs: number
}

interface RawVercelTeam {
  id?: string
  slug?: string
  name?: string
  plan?: string
  billing?: {
    plan?: string
  }
}

interface RawVercelUser {
  uid?: string
  id?: string
  username?: string
  name?: string
  email?: string
  plan?: string
  billing?: {
    plan?: string
  }
}

interface VercelTeam {
  id: string
  slug: string
  name: string
  isPersonal: boolean
  planLabel?: string
}

interface VercelProject {
  id?: string
  name?: string
}

interface VercelProjectListResponse {
  projects?: VercelProject[]
}

interface VercelBlobStore {
  id?: string
  name?: string
}

interface VercelBlobStoreListResponse {
  stores?: VercelBlobStore[]
}

interface CleanupSummary {
  phase: "before" | "after" | "only"
  durationMs: number
  timings: TimingEntry[]
  team: VercelTeam
  deletedProjects: Array<{ id: string; name: string }>
  deletedBlobStores: Array<{ id: string; name: string }>
  resetStatus: number
  resetInstalled: boolean
  remainingProjects: Array<{ id: string; name: string }>
  remainingBlobStores: Array<{ id: string; name: string }>
}

interface AutoUpdateSummary {
  staleSha: string
  durationMs: number
  timings: TimingEntry[]
  initial: {
    status: number
    projectId?: string
    deploymentId?: string
    shellVersionStatus?: string
    workerShellVersion?: string
    durationMs?: number
    progress?: WorkerInstallProgressSnapshot[]
  }
  stale: {
    deploymentId: string
    status: number
    shellVersionStatus?: string
    workerShellVersion?: string
    latestDeploymentReadyState?: string
    detectionDurationMs?: number
  }
  update: {
    status: number
    projectId?: string
    deploymentId?: string
    shellVersionStatus?: string
    workerShellVersion?: string
    durationMs?: number
    progress?: WorkerInstallProgressSnapshot[]
  }
  updated: boolean
}

interface RunnerSnapshot {
  status: number
  projectId?: string
  deploymentId?: string
  workerStatus?: string
  workerShellVersion?: string
  shellVersionStatus?: string
}

interface SmokeSuiteStep {
  name: string
  success: boolean
  durationMs: number
  details?: unknown
  error?: string
}

interface SmokeSuiteSummary {
  success: boolean
  error?: string
  steps: SmokeSuiteStep[]
}

interface SmokeOptions {
  autoUpdate: boolean
  baseUrl: string
  cleanupAfter: boolean
  cleanupOnly: boolean
  freshInstall: boolean
  json: boolean
  staleSha?: string
  suite: boolean
  team?: string
  validateOnly: boolean
}

const RUNNER_PROJECT_NAME = "d3k-skill-runner"
const PRO_WORKER_START_MAX_DURATION_SECONDS = 600
const PRO_WORKER_STEP_MAX_DURATION_SECONDS = 800
const HOBBY_WORKER_MAX_DURATION_SECONDS = 300

function parseArgs(argv: string[]): SmokeOptions {
  const options: SmokeOptions = {
    autoUpdate: false,
    baseUrl: process.env.D3K_SMOKE_BASE_URL || "https://dev3000.ai",
    cleanupAfter: false,
    cleanupOnly: false,
    freshInstall: false,
    json: false,
    staleSha: process.env.D3K_SMOKE_STALE_SHA,
    suite: false,
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
    } else if (arg === "--fresh-install") {
      options.freshInstall = true
    } else if (arg === "--cleanup-after") {
      options.cleanupAfter = true
    } else if (arg === "--cleanup-only") {
      options.cleanupOnly = true
    } else if (arg === "--auto-update") {
      options.autoUpdate = true
    } else if (arg === "--stale-sha") {
      options.staleSha = argv[++index]
    } else if (arg === "--suite") {
      options.suite = true
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
  if (options.validateOnly && options.freshInstall) {
    throw new Error("--fresh-install cannot be combined with --validate-only.")
  }
  if (
    options.cleanupOnly &&
    (options.validateOnly || options.freshInstall || options.cleanupAfter || options.autoUpdate)
  ) {
    throw new Error("--cleanup-only cannot be combined with install or validation modes.")
  }
  if (options.autoUpdate && options.validateOnly) {
    throw new Error("--auto-update cannot be combined with --validate-only.")
  }
  if (
    options.suite &&
    (options.validateOnly || options.cleanupOnly || options.freshInstall || options.cleanupAfter || options.autoUpdate)
  ) {
    throw new Error("--suite cannot be combined with other mode flags.")
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
  --fresh-install       Delete the existing runner project/store before installing.
  --cleanup-after       Delete the runner project/store after the smoke test, even on failure.
  --cleanup-only        Delete the runner project/store and reset dev3000 settings, then exit.
  --auto-update         Install, seed a stale runner deployment, then verify install repairs it.
  --stale-sha <sha>     Commit to deploy as the stale runner shell. Defaults to previous main commit.
  --suite               Run cleanup, fresh install, validation, auto-update, and final cleanup.
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

function normalizePlanLabel(value: string | undefined, fallback?: string): string | undefined {
  const normalized = value?.trim().toLowerCase()
  if (!normalized) return fallback
  if (normalized === "hobby") return "Hobby"
  if (normalized === "pro") return "Pro"
  if (normalized === "enterprise") return "Enterprise"
  return normalized.charAt(0).toUpperCase() + normalized.slice(1)
}

async function readJsonResponse<T>(response: Response): Promise<T> {
  const text = await response.text()
  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error(`Non-JSON response (${response.status}): ${text.slice(0, 300)}`)
  }
}

async function fetchVercelApi<T>(url: URL, token: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url.toString(), {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.headers || {})
    },
    cache: "no-store"
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Vercel API request failed: ${response.status} ${errorText}`)
  }

  return readJsonResponse<T>(response)
}

async function fetchAllTeams(token: string): Promise<RawVercelTeam[]> {
  const teams: RawVercelTeam[] = []
  let until: string | null = null

  for (let page = 0; page < 20; page += 1) {
    const url = new URL("https://api.vercel.com/v2/teams")
    url.searchParams.set("limit", "100")
    if (until) url.searchParams.set("until", until)

    const data = await fetchVercelApi<{ teams?: RawVercelTeam[]; pagination?: { next?: number } }>(url, token)
    const pageTeams = Array.isArray(data.teams) ? data.teams : []
    teams.push(...pageTeams)

    const next = data.pagination?.next
    if (!next || pageTeams.length === 0) break
    until = String(next)
  }

  return teams
}

function normalizePersonalTeam(user: RawVercelUser | undefined): VercelTeam | null {
  const id = user?.uid || user?.id || user?.username
  const slug = user?.username
  if (!id || !slug) return null

  return {
    id,
    slug,
    name: user.name || user.username || user.email || "Personal Account",
    isPersonal: true,
    planLabel: normalizePlanLabel(user.plan || user.billing?.plan, "Personal")
  }
}

async function resolveVercelTeam(token: string, teamParam: string): Promise<VercelTeam> {
  const [userData, rawTeams] = await Promise.all([
    fetchVercelApi<{ user?: RawVercelUser }>(new URL("https://api.vercel.com/v2/user"), token),
    fetchAllTeams(token)
  ])
  const teams = rawTeams
    .filter((team) => team.id && team.slug && team.name)
    .map(
      (team): VercelTeam => ({
        id: team.id || "",
        slug: team.slug || "",
        name: team.name || "",
        isPersonal: false,
        planLabel: normalizePlanLabel(team.plan || team.billing?.plan)
      })
    )

  const personalTeam = normalizePersonalTeam(userData.user)
  if (personalTeam) {
    teams.push(personalTeam)
  }

  const normalized = teamParam.trim().toLowerCase()
  const match =
    teams.find((team) => team.id.toLowerCase() === normalized) ||
    teams.find((team) => !team.isPersonal && team.slug.toLowerCase() === normalized) ||
    teams.find((team) => team.slug.toLowerCase() === normalized)

  if (!match) {
    throw new Error(`Could not resolve Vercel team "${teamParam}".`)
  }

  return match
}

function sanitizeBlobStoreNameSegment(value: string): string {
  const sanitized = value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
  return sanitized || "team"
}

function getRunnerBlobStoreName(team: VercelTeam): string {
  const suffix = sanitizeBlobStoreNameSegment(team.slug).slice(0, 32)
  return `${RUNNER_PROJECT_NAME}-${suffix}-private`.slice(0, 63)
}

async function findRunnerProjects(token: string, team: VercelTeam): Promise<Array<{ id: string; name: string }>> {
  const url = new URL("https://api.vercel.com/v10/projects")
  url.searchParams.set("teamId", team.id)
  url.searchParams.set("limit", "100")
  url.searchParams.set("search", RUNNER_PROJECT_NAME)

  const data = await fetchVercelApi<VercelProjectListResponse>(url, token)
  const projects = Array.isArray(data.projects) ? data.projects : []
  const seen = new Set<string>()
  return projects
    .filter((project) => project.id && project.name === RUNNER_PROJECT_NAME)
    .map((project) => ({ id: project.id || "", name: project.name || "" }))
    .filter((project) => {
      if (seen.has(project.id)) return false
      seen.add(project.id)
      return true
    })
}

async function deleteRunnerProject(token: string, team: VercelTeam, projectId: string): Promise<void> {
  const url = new URL(`https://api.vercel.com/v9/projects/${encodeURIComponent(projectId)}`)
  url.searchParams.set("teamId", team.id)

  const response = await fetch(url.toString(), {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${token}`
    },
    cache: "no-store"
  })

  if (response.ok || response.status === 404) return
  const errorText = await response.text()
  throw new Error(`Failed to delete runner project ${projectId}: ${response.status} ${errorText}`)
}

async function findRunnerBlobStores(token: string, team: VercelTeam): Promise<Array<{ id: string; name: string }>> {
  const url = new URL("https://api.vercel.com/v1/storage/stores")
  url.searchParams.set("teamId", team.id)

  const data = await fetchVercelApi<VercelBlobStoreListResponse>(url, token)
  const storeName = getRunnerBlobStoreName(team)
  return (Array.isArray(data.stores) ? data.stores : [])
    .filter((store) => store.id && store.name === storeName)
    .map((store) => ({ id: store.id || "", name: store.name || "" }))
}

async function deleteRunnerBlobStore(token: string, team: VercelTeam, storeId: string): Promise<void> {
  const params = new URLSearchParams({ teamId: team.id })
  const connectionsUrl = new URL(`https://api.vercel.com/v1/storage/stores/${encodeURIComponent(storeId)}/connections`)
  connectionsUrl.search = params.toString()
  const connectionsResponse = await fetch(connectionsUrl.toString(), {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${token}`
    },
    cache: "no-store"
  })

  if (!connectionsResponse.ok && connectionsResponse.status !== 404) {
    const errorText = await connectionsResponse.text()
    throw new Error(`Failed to disconnect Blob store ${storeId}: ${connectionsResponse.status} ${errorText}`)
  }

  const storeUrl = new URL(`https://api.vercel.com/v1/storage/stores/blob/${encodeURIComponent(storeId)}`)
  storeUrl.search = params.toString()
  const storeResponse = await fetch(storeUrl.toString(), {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${token}`
    },
    cache: "no-store"
  })

  if (storeResponse.ok || storeResponse.status === 404) return
  const errorText = await storeResponse.text()
  throw new Error(`Failed to delete Blob store ${storeId}: ${storeResponse.status} ${errorText}`)
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

function formatDuration(ms: number | undefined): string {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return "unknown"
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const minutes = Math.floor(ms / 60_000)
  const seconds = Math.round((ms % 60_000) / 1000)
  return `${minutes}m ${seconds}s`
}

async function recordTiming<T>(timings: TimingEntry[], name: string, run: () => Promise<T>): Promise<T> {
  const start = Date.now()
  try {
    return await run()
  } finally {
    timings.push({
      name,
      durationMs: Date.now() - start
    })
  }
}

async function waitForRunnerProjectsDeleted(token: string, team: VercelTeam) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const remainingProjects = await findRunnerProjects(token, team)
    if (remainingProjects.length === 0) return remainingProjects
    await sleep(1000)
  }
  return findRunnerProjects(token, team)
}

async function cleanupRunnerResources(
  options: SmokeOptions,
  token: string,
  phase: CleanupSummary["phase"]
): Promise<CleanupSummary> {
  const start = Date.now()
  const timings: TimingEntry[] = []
  if (!options.team) {
    throw new Error("Missing team.")
  }

  const team = await recordTiming(timings, "resolve-team", () => resolveVercelTeam(token, options.team || ""))
  const projects = await recordTiming(timings, "find-runner-projects", () => findRunnerProjects(token, team))
  const blobStores = await recordTiming(timings, "find-runner-blob-stores", () => findRunnerBlobStores(token, team))

  await recordTiming(timings, "delete-runner-projects", async () => {
    for (const project of projects) {
      await deleteRunnerProject(token, team, project.id)
    }
  })

  const remainingProjectsAfterDelete = await recordTiming(timings, "wait-for-project-deletion", () =>
    waitForRunnerProjectsDeleted(token, team)
  )

  await recordTiming(timings, "delete-runner-blob-stores", async () => {
    for (const store of blobStores) {
      await deleteRunnerBlobStore(token, team, store.id)
    }
  })

  const remainingBlobStores = await recordTiming(timings, "verify-blob-store-deletion", () =>
    findRunnerBlobStores(token, team)
  )
  const resetResponse = await recordTiming(timings, "reset-runner-settings", () =>
    requestWorkerInstall({ ...options, validateOnly: true }, token)
  )

  return {
    phase,
    durationMs: Date.now() - start,
    timings,
    team,
    deletedProjects: projects,
    deletedBlobStores: blobStores,
    resetStatus: resetResponse.status,
    resetInstalled: Boolean(resetResponse.data.installed),
    remainingProjects: remainingProjectsAfterDelete,
    remainingBlobStores
  }
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

function isCleanedUp(summary: CleanupSummary): boolean {
  return (
    summary.remainingProjects.length === 0 &&
    summary.remainingBlobStores.length === 0 &&
    summary.resetStatus < 400 &&
    !summary.resetInstalled
  )
}

function isAutoUpdated(summary: AutoUpdateSummary): boolean {
  return Boolean(
    summary.updated &&
      summary.update.projectId &&
      summary.initial.projectId === summary.update.projectId &&
      summary.stale.deploymentId !== summary.update.deploymentId &&
      summary.update.shellVersionStatus === "current" &&
      summary.update.workerShellVersion &&
      summary.update.workerShellVersion !== summary.staleSha
  )
}

function toRunnerSnapshot(status: number, data: WorkerInstallResponse): RunnerSnapshot {
  return {
    status,
    projectId: data.project?.projectId,
    deploymentId: data.project?.latestDeploymentId,
    workerStatus: data.settings?.workerStatus,
    workerShellVersion: data.project?.workerShellVersion,
    shellVersionStatus: data.project?.shellVersionStatus
  }
}

async function readWorkerInstallJsonResponse(
  response: Response,
  start: number,
  progress: WorkerInstallProgressSnapshot[] = []
): Promise<WorkerInstallResult> {
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
    data,
    progress,
    durationMs: Date.now() - start
  }
}

async function readWorkerInstallStreamResponse(response: Response, start: number): Promise<WorkerInstallResult> {
  const reader = response.body?.getReader()
  if (!reader) {
    return readWorkerInstallJsonResponse(response, start)
  }

  const decoder = new TextDecoder()
  const progress: WorkerInstallProgressSnapshot[] = []
  let buffer = ""
  let status = response.status
  let data: WorkerInstallResponse | undefined

  const consumeLine = (line: string) => {
    const trimmed = line.trim()
    if (!trimmed) return
    const payload = JSON.parse(trimmed) as {
      type?: "progress" | "result" | "error"
      status?: number
      data?: WorkerInstallResponse
      phase?: string
      message?: string
      elapsedMs?: number
    }

    if (payload.type === "progress") {
      progress.push({
        phase: payload.phase || "unknown",
        message: payload.message || "",
        elapsedMs: payload.elapsedMs
      })
      return
    }

    if (payload.type === "result" || payload.type === "error") {
      status = payload.status || status
      data = payload.data || {}
    }
  }

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split("\n")
    buffer = lines.pop() || ""
    for (const line of lines) {
      consumeLine(line)
    }
  }

  buffer += decoder.decode()
  consumeLine(buffer)

  return {
    status,
    data: data || {
      success: false,
      error: "Installer stream ended without a result."
    },
    progress,
    durationMs: Date.now() - start
  }
}

async function requestWorkerInstall(options: SmokeOptions, token: string): Promise<WorkerInstallResult> {
  const start = Date.now()
  const url = new URL("/api/skill-runner-teams/worker", options.baseUrl)
  if (!options.team) {
    throw new Error("Missing team.")
  }
  url.searchParams.set("team", options.team)
  if (!options.validateOnly) {
    url.searchParams.set("stream", "1")
  }

  const response = await fetch(url, {
    method: options.validateOnly ? "GET" : "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: options.validateOnly ? undefined : JSON.stringify({ team: options.team })
  })

  const contentType = response.headers.get("content-type") || ""
  if (!options.validateOnly && contentType.includes("application/x-ndjson")) {
    return readWorkerInstallStreamResponse(response, start)
  }

  return readWorkerInstallJsonResponse(response, start)
}

function isHobbyWorkerTeam(team: VercelTeam): boolean {
  return team.isPersonal || team.planLabel === "Hobby"
}

function resolveWorkerDurationConfig(team: VercelTeam): {
  maxFunctionDurationSeconds: number
  maxWorkflowStepDurationSeconds: number
} {
  if (isHobbyWorkerTeam(team)) {
    return {
      maxFunctionDurationSeconds: HOBBY_WORKER_MAX_DURATION_SECONDS,
      maxWorkflowStepDurationSeconds: HOBBY_WORKER_MAX_DURATION_SECONDS
    }
  }

  return {
    maxFunctionDurationSeconds: PRO_WORKER_START_MAX_DURATION_SECONDS,
    maxWorkflowStepDurationSeconds: PRO_WORKER_STEP_MAX_DURATION_SECONDS
  }
}

function resolveDefaultStaleSha(currentSha: string | undefined): string {
  const candidates = [currentSha ? `${currentSha}^` : undefined, "origin/main^", "HEAD^"].filter(
    (candidate): candidate is string => Boolean(candidate)
  )

  for (const candidate of candidates) {
    try {
      const sha = execFileSync("git", ["rev-parse", candidate], {
        cwd: process.cwd(),
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"]
      }).trim()
      if (sha && sha !== currentSha) return sha
    } catch {
      // Try the next local revision candidate.
    }
  }

  throw new Error("Could not resolve a stale runner shell commit. Pass --stale-sha <sha>.")
}

async function createRunnerShellDeployment({
  projectId,
  projectName,
  sourceSha,
  team,
  timings,
  token
}: {
  projectId: string
  projectName: string
  sourceSha: string
  team: VercelTeam
  timings?: TimingEntry[]
  token: string
}): Promise<string> {
  const localTimings = timings || []
  const source = await recordTiming(localTimings, "resolve-stale-runner-source", () =>
    resolveSkillRunnerShellSource(sourceSha, sourceSha)
  )
  const files = await recordTiming(localTimings, "upload-stale-runner-source", () =>
    uploadSkillRunnerShellSourceFiles({
      accessToken: token,
      ...resolveWorkerDurationConfig(team),
      source,
      teamId: team.id
    })
  )
  const apiUrl = new URL("https://api.vercel.com/v13/deployments")
  apiUrl.searchParams.set("teamId", team.id)
  apiUrl.searchParams.set("forceNew", "1")
  apiUrl.searchParams.set("skipAutoDetectionConfirmation", "1")

  const response = await recordTiming(localTimings, "create-stale-runner-deployment", () =>
    fetch(apiUrl.toString(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        name: projectName,
        project: projectId,
        target: "production",
        files,
        gitMetadata: {
          commitMessage: `Deploy stale d3k skill runner shell ${sourceSha}`,
          commitRef: "main",
          commitSha: sourceSha,
          dirty: false,
          remoteUrl: `https://github.com/${SKILL_RUNNER_WORKER_REPO}.git`
        },
        meta: {
          d3kSkillRunnerShellCommit: sourceSha,
          d3kSkillRunnerShellVersion: sourceSha,
          d3kSkillRunnerSource: "auto-update-smoke"
        },
        projectSettings: {
          framework: "nextjs",
          rootDirectory: SKILL_RUNNER_WORKER_ROOT_DIRECTORY,
          nodeVersion: "24.x",
          sourceFilesOutsideRootDirectory: true
        }
      }),
      cache: "no-store"
    })
  )

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Failed to create stale runner deployment: ${response.status} ${errorText}`)
  }

  const data = (await response.json()) as { id?: string; uid?: string }
  const deploymentId = data.id?.trim() || data.uid?.trim()
  if (!deploymentId) {
    throw new Error("Stale runner deployment was started but no deployment id was returned.")
  }

  return deploymentId
}

async function waitForWorkerProject(
  options: SmokeOptions,
  token: string,
  predicate: (data: WorkerInstallResponse) => boolean,
  failureMessage: string
): Promise<WorkerInstallResult> {
  let lastResponse: WorkerInstallResult | undefined
  for (let attempt = 0; attempt < 50; attempt += 1) {
    lastResponse = await requestWorkerInstall({ ...options, validateOnly: true }, token)
    if (predicate(lastResponse.data)) return lastResponse
    await sleep(3000)
  }

  throw new Error(`${failureMessage} Last response: ${JSON.stringify(lastResponse?.data || {})}`)
}

async function runAutoUpdateSmoke(
  options: SmokeOptions,
  token: string
): Promise<{
  status: number
  data: WorkerInstallResponse
  summary: AutoUpdateSummary
}> {
  const start = Date.now()
  const timings: TimingEntry[] = []
  if (!options.team) {
    throw new Error("Missing team.")
  }

  const team = await recordTiming(timings, "resolve-team", () => resolveVercelTeam(token, options.team || ""))
  const initial = await recordTiming(timings, "initial-install", () =>
    requestWorkerInstall({ ...options, validateOnly: false }, token)
  )
  if (!isReadyResponse(initial.data)) {
    throw new Error(`Initial runner install was not ready: ${JSON.stringify(initial.data)}`)
  }

  const projectId = initial.data.project?.projectId
  const projectName = initial.data.project?.projectName
  if (!projectId || !projectName) {
    throw new Error("Initial runner install did not return a project id and name.")
  }

  const staleSha = options.staleSha?.trim() || resolveDefaultStaleSha(initial.data.project?.desiredWorkerGitSha)
  const staleDeploymentId = await recordTiming(timings, "seed-stale-runner-deployment", () =>
    createRunnerShellDeployment({
      projectId,
      projectName,
      sourceSha: staleSha,
      team,
      timings,
      token
    })
  )
  const staleDetectionStart = Date.now()
  const stale = await recordTiming(timings, "wait-for-outdated-stale-runner", () =>
    waitForWorkerProject(
      options,
      token,
      (data) =>
        data.project?.latestDeploymentId === staleDeploymentId &&
        data.project?.latestDeploymentReadyState === "READY" &&
        data.project?.shellVersionStatus === "outdated",
      "Stale runner deployment did not become visible as outdated."
    )
  )
  const staleDetectionDurationMs = Date.now() - staleDetectionStart
  const update = await recordTiming(timings, "repair-install", () =>
    requestWorkerInstall({ ...options, validateOnly: false }, token)
  )
  const summary: AutoUpdateSummary = {
    staleSha,
    durationMs: Date.now() - start,
    timings,
    initial: {
      status: initial.status,
      projectId: initial.data.project?.projectId,
      deploymentId: initial.data.project?.latestDeploymentId,
      shellVersionStatus: initial.data.project?.shellVersionStatus,
      workerShellVersion: initial.data.project?.workerShellVersion,
      durationMs: initial.durationMs,
      progress: initial.progress
    },
    stale: {
      deploymentId: staleDeploymentId,
      status: stale.status,
      shellVersionStatus: stale.data.project?.shellVersionStatus,
      workerShellVersion: stale.data.project?.workerShellVersion,
      latestDeploymentReadyState: stale.data.project?.latestDeploymentReadyState,
      detectionDurationMs: staleDetectionDurationMs
    },
    update: {
      status: update.status,
      projectId: update.data.project?.projectId,
      deploymentId: update.data.project?.latestDeploymentId,
      shellVersionStatus: update.data.project?.shellVersionStatus,
      workerShellVersion: update.data.project?.workerShellVersion,
      durationMs: update.durationMs,
      progress: update.progress
    },
    updated: isReadyResponse(update.data)
  }

  if (!isAutoUpdated(summary)) {
    throw new Error(`Auto-update smoke did not repair the stale runner: ${JSON.stringify(summary)}`)
  }

  return {
    status: update.status,
    data: update.data,
    summary
  }
}

async function runSmokeSuite(options: SmokeOptions, token: string): Promise<SmokeSuiteSummary> {
  const steps: SmokeSuiteStep[] = []
  let failedError: string | undefined

  async function record<T>(name: string, run: () => Promise<T>): Promise<T> {
    const start = Date.now()
    try {
      const details = await run()
      steps.push({ name, success: true, durationMs: Date.now() - start, details })
      return details
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      steps.push({ name, success: false, durationMs: Date.now() - start, error: message })
      throw error
    }
  }

  try {
    await record("initial-cleanup", async () => {
      const cleanup = await cleanupRunnerResources(options, token, "only")
      if (!isCleanedUp(cleanup)) {
        throw new Error("Initial cleanup did not fully complete.")
      }
      return cleanup
    })

    const freshInstall = await record("fresh-install", async () => {
      const response = await requestWorkerInstall(options, token)
      if (!isReadyResponse(response.data)) {
        throw new Error(`Fresh install was not ready: ${JSON.stringify(response.data)}`)
      }
      return {
        ...toRunnerSnapshot(response.status, response.data),
        durationMs: response.durationMs,
        progress: response.progress,
        workerBaseUrl: response.data.project?.workerBaseUrl || response.data.settings?.workerBaseUrl
      }
    })

    await record("validate-existing", async () => {
      const response = await requestWorkerInstall({ ...options, validateOnly: true }, token)
      if (!isReadyResponse(response.data)) {
        throw new Error(`Existing runner validation was not ready: ${JSON.stringify(response.data)}`)
      }
      const snapshot = toRunnerSnapshot(response.status, response.data)
      if (snapshot.projectId !== freshInstall.projectId) {
        throw new Error(
          `Validation returned a different runner project: ${snapshot.projectId || "missing"} !== ${
            freshInstall.projectId || "missing"
          }`
        )
      }
      return {
        ...snapshot,
        durationMs: response.durationMs
      }
    })

    await record("post-install-cleanup", async () => {
      const cleanup = await cleanupRunnerResources(options, token, "only")
      if (!isCleanedUp(cleanup)) {
        throw new Error("Post-install cleanup did not fully complete.")
      }
      return cleanup
    })

    await record("auto-update", async () => {
      const result = await runAutoUpdateSmoke(options, token)
      return result.summary
    })
  } catch (error) {
    failedError = error instanceof Error ? error.message : String(error)
  } finally {
    const cleanupStart = Date.now()
    try {
      const cleanup = await cleanupRunnerResources(options, token, "only")
      const cleaned = isCleanedUp(cleanup)
      steps.push({
        name: "final-cleanup",
        success: cleaned,
        durationMs: cleanup.durationMs,
        details: cleanup,
        error: cleaned ? undefined : "Final cleanup did not fully complete."
      })
    } catch (cleanupError) {
      steps.push({
        name: "final-cleanup",
        success: false,
        durationMs: Date.now() - cleanupStart,
        error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
      })
    }
  }

  return {
    success: !failedError && steps.every((step) => step.success),
    error: failedError,
    steps
  }
}

function printCleanupSummary(summary: CleanupSummary) {
  console.log(`Cleanup (${summary.phase}): ${isCleanedUp(summary) ? "complete" : "incomplete"}`)
  console.log(`Duration: ${formatDuration(summary.durationMs)}`)
  printTimingEntries(summary.timings, "  ")
  console.log(`Resolved team: ${summary.team.name} (${summary.team.slug}, id: ${summary.team.id})`)
  console.log(`Deleted projects: ${summary.deletedProjects.length}`)
  for (const project of summary.deletedProjects) {
    console.log(`  - ${project.name} (${project.id})`)
  }
  console.log(`Deleted Blob stores: ${summary.deletedBlobStores.length}`)
  for (const store of summary.deletedBlobStores) {
    console.log(`  - ${store.name} (${store.id})`)
  }
  console.log(`Settings reset: ${summary.resetStatus}, installed=${summary.resetInstalled ? "yes" : "no"}`)
  if (summary.remainingProjects.length > 0) {
    console.log(`Remaining projects: ${summary.remainingProjects.map((project) => project.name).join(", ")}`)
  }
  if (summary.remainingBlobStores.length > 0) {
    console.log(`Remaining Blob stores: ${summary.remainingBlobStores.map((store) => store.name).join(", ")}`)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}

function readTimingEntries(value: unknown): TimingEntry[] {
  if (!Array.isArray(value)) return []
  return value.filter(
    (entry): entry is TimingEntry =>
      isRecord(entry) && typeof entry.name === "string" && typeof entry.durationMs === "number"
  )
}

function readProgressEntries(value: unknown): WorkerInstallProgressSnapshot[] {
  if (!Array.isArray(value)) return []
  return value.filter(
    (entry): entry is WorkerInstallProgressSnapshot =>
      isRecord(entry) && typeof entry.phase === "string" && typeof entry.message === "string"
  )
}

function printTimingEntries(timings: TimingEntry[], indent = "") {
  if (timings.length === 0) return
  console.log(`${indent}timings:`)
  for (const timing of timings) {
    console.log(`${indent}  ${timing.name}: ${formatDuration(timing.durationMs)}`)
  }
}

function printProgressEntries(progress: WorkerInstallProgressSnapshot[], indent = "") {
  if (progress.length === 0) return
  console.log(`${indent}installer progress:`)
  for (const entry of progress) {
    const elapsed = typeof entry.elapsedMs === "number" ? formatDuration(entry.elapsedMs) : "unknown"
    console.log(`${indent}  ${elapsed} ${entry.phase}: ${entry.message}`)
  }
}

function printStepDetails(details: unknown) {
  if (!isRecord(details)) return

  const timings = readTimingEntries(details.timings)
  printTimingEntries(timings, "  ")

  const progress = readProgressEntries(details.progress)
  printProgressEntries(progress, "  ")

  const initial = isRecord(details.initial) ? details.initial : undefined
  if (initial) {
    const initialProgress = readProgressEntries(initial.progress)
    if (initialProgress.length > 0) {
      console.log("  initial install:")
      printProgressEntries(initialProgress, "    ")
    }
  }

  const update = isRecord(details.update) ? details.update : undefined
  if (update) {
    const updateProgress = readProgressEntries(update.progress)
    if (updateProgress.length > 0) {
      console.log("  repair install:")
      printProgressEntries(updateProgress, "    ")
    }
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

function printSuiteSummary(summary: SmokeSuiteSummary) {
  console.log(`Skill runner smoke suite: ${summary.success ? "passed" : "failed"}`)
  for (const step of summary.steps) {
    console.log(`- ${step.name}: ${step.success ? "passed" : "failed"} (${formatDuration(step.durationMs)})`)
    if (step.error) {
      console.log(`  ${step.error}`)
    }
    printStepDetails(step.details)
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const token = resolveVercelToken()
  let preCleanup: CleanupSummary | undefined
  let postCleanup: CleanupSummary | undefined
  let status = 0
  let data: WorkerInstallResponse = {}
  let durationMs = 0
  let progress: WorkerInstallProgressSnapshot[] = []
  let ready = false
  let autoUpdate: AutoUpdateSummary | undefined
  let smokeError: unknown

  if (options.suite) {
    const suite = await runSmokeSuite(options, token)
    if (options.json) {
      console.log(JSON.stringify({ suite }, null, 2))
    } else {
      printSuiteSummary(suite)
    }
    if (!suite.success) {
      process.exit(1)
    }
    return
  }

  if (options.cleanupOnly) {
    const cleanup = await cleanupRunnerResources(options, token, "only")
    if (options.json) {
      console.log(JSON.stringify({ cleaned: isCleanedUp(cleanup), cleanup }, null, 2))
    } else {
      printCleanupSummary(cleanup)
      console.log(isCleanedUp(cleanup) ? "Result: cleaned" : "Result: cleanup incomplete")
    }
    if (!isCleanedUp(cleanup)) {
      process.exit(1)
    }
    return
  }

  try {
    if (options.freshInstall) {
      preCleanup = await cleanupRunnerResources(options, token, "before")
      if (!isCleanedUp(preCleanup)) {
        throw new Error("Pre-install cleanup did not fully complete.")
      }
    }

    const response = options.autoUpdate
      ? await runAutoUpdateSmoke(options, token).then((result) => {
          autoUpdate = result.summary
          return {
            status: result.status,
            data: result.data,
            durationMs: result.summary.durationMs,
            progress: result.summary.update.progress || []
          }
        })
      : await requestWorkerInstall(options, token)
    status = response.status
    data = response.data
    durationMs = response.durationMs
    progress = response.progress
    ready = isReadyResponse(data)
  } catch (error) {
    smokeError = error
  } finally {
    if (options.cleanupAfter) {
      postCleanup = await cleanupRunnerResources(options, token, "after")
    }
  }

  const cleanedAfter = postCleanup ? isCleanedUp(postCleanup) : undefined
  if (options.json) {
    console.log(
      JSON.stringify(
        {
          ready,
          status,
          durationMs,
          progress,
          error: smokeError instanceof Error ? smokeError.message : smokeError ? String(smokeError) : undefined,
          preCleanup,
          postCleanup,
          autoUpdate,
          cleanedAfter,
          ...data
        },
        null,
        2
      )
    )
  } else {
    if (preCleanup) printCleanupSummary(preCleanup)
    if (smokeError) {
      console.error(smokeError instanceof Error ? smokeError.message : String(smokeError))
    } else {
      printHumanSummary(options, status, data)
      console.log(`Duration: ${formatDuration(durationMs)}`)
      printProgressEntries(progress)
      if (autoUpdate) {
        printTimingEntries(autoUpdate.timings)
        console.log(
          `Auto-update: ${isAutoUpdated(autoUpdate) ? "passed" : "failed"} (${autoUpdate.staleSha.slice(0, 8)} -> ${autoUpdate.update.workerShellVersion?.slice(0, 8) || "unknown"})`
        )
      }
      console.log(ready ? "Result: ready" : "Result: not ready")
    }
    if (postCleanup) printCleanupSummary(postCleanup)
  }

  if (smokeError || !ready || cleanedAfter === false) {
    process.exit(1)
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
