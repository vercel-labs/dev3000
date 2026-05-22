import { execFileSync } from "node:child_process"
import {
  SKILL_RUNNER_RUNTIME_MANIFEST_VERSION,
  SKILL_RUNNER_WORKER_PROJECT_NAME,
  SKILL_RUNNER_WORKER_REPO,
  SKILL_RUNNER_WORKER_ROOT_DIRECTORY,
  type SkillRunnerWorkerStatus,
  type SkillRunnerWorkerVersionPayload
} from "@/lib/skill-runner-config"
import { resolveSkillRunnerShellSource, uploadSkillRunnerShellSourceFiles } from "@/lib/skill-runner-shell-source"
import type { VercelTeam } from "@/lib/vercel-teams"

export type SkillRunnerWorkerSetupErrorCode =
  | "github_integration_required"
  | "initial_deployment_missing"
  | "initial_deployment_failed"
  | "blob_store_limit_reached"
  | "project_scope_required"
  | "project_env_vars_forbidden"
  | "unknown"

export interface SkillRunnerWorkerSetupRequirement {
  code: SkillRunnerWorkerSetupErrorCode
  actionLabel?: string
  actionUrl?: string
  deploymentUrl?: string
  details?: string
  projectName?: string
  repo?: string
}

export class SkillRunnerWorkerSetupError extends Error {
  readonly code: SkillRunnerWorkerSetupErrorCode
  readonly actionLabel?: string
  readonly actionUrl?: string
  readonly deploymentUrl?: string
  readonly details?: string
  readonly projectName?: string
  readonly repo?: string

  constructor(message: string, requirement?: SkillRunnerWorkerSetupRequirement) {
    super(message)
    this.name = "SkillRunnerWorkerSetupError"
    this.code = requirement?.code || "unknown"
    this.actionLabel = requirement?.actionLabel
    this.actionUrl = requirement?.actionUrl
    this.deploymentUrl = requirement?.deploymentUrl
    this.details = requirement?.details
    this.projectName = requirement?.projectName
    this.repo = requirement?.repo
  }
}

class VercelProjectNotFoundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "VercelProjectNotFoundError"
  }
}

class BlobStoreLimitReachedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "BlobStoreLimitReachedError"
  }
}

interface VercelProjectLookupResponse {
  projects?: Array<{
    id?: string
    name?: string
    alias?: string[] | string
    targets?: {
      production?: {
        alias?: string[] | string
      }
    }
    latestDeployments?: Array<{
      id?: string
      url?: string
      state?: string
      readyState?: string
      createdAt?: number
    }>
  }>
  pagination?: {
    next?: number | string | null
  }
}

type VercelProjectLookupProject = NonNullable<VercelProjectLookupResponse["projects"]>[number]
type VercelProjectLookupDeployment = NonNullable<VercelProjectLookupProject["latestDeployments"]>[number]

interface VercelProjectCreateResponse {
  id?: string
  name?: string
}

interface VercelDeploymentDetailsResponse {
  id?: string
  readyState?: string
  state?: string
  url?: string
  meta?: {
    githubCommitSha?: string
    gitCommitSha?: string
    d3kSkillRunnerShellCommit?: string
    d3kSkillRunnerShellVersion?: string
    githubCommitRef?: string
    gitCommitRef?: string
  }
}

interface VercelDeploymentCreateResponse {
  id?: string
  uid?: string
}

interface VercelApiErrorPayload {
  error?: {
    code?: string
    message?: string
    action?: string
    link?: string
    repo?: string
    resource?: string
  }
}

interface VercelProjectEnvListResponse {
  envs?: Array<{
    createdAt?: number
    id?: string
    key?: string
    target?: Array<"production" | "preview" | "development">
    updatedAt?: number
    contentHint?: {
      type?: string
      storeId?: string
    }
  }>
}

interface VercelBlobStoreListResponse {
  stores?: Array<{
    access?: "public" | "private"
    id?: string
    name?: string
    projectsMetadata?: Array<{
      envVarPrefix?: string
      environments?: Array<"production" | "preview" | "development">
      latestDeployment?: string
      projectId?: string
      name?: string
      environmentVariables?: string[]
    }>
  }>
}

interface VercelBlobStoreConnectionsResponse {
  connections?: Array<{
    id?: string
    projectId?: string
  }>
}

interface VercelBlobStoreCreateResponse {
  store?: {
    id?: string
    name?: string
  }
}

type VercelBlobStore = NonNullable<VercelBlobStoreListResponse["stores"]>[number]
type VercelBlobStoreProjectMetadata = NonNullable<VercelBlobStore["projectsMetadata"]>[number]

const LEGACY_WORKER_METADATA_ENV_KEYS = new Set(["SKILL_RUNNER_WORKER_MODE", "SKILL_RUNNER_WORKER_SHELL_VERSION"])
const REQUIRED_SELF_HOSTED_WORKER_ENV_KEYS = ["BLOB_READ_WRITE_TOKEN"] as const
const PRO_WORKER_START_MAX_DURATION_SECONDS = 600
const PRO_WORKER_STEP_MAX_DURATION_SECONDS = 800
const HOBBY_WORKER_MAX_DURATION_SECONDS = 300
const SELF_HOSTED_BLOB_STORE_REGION = "iad1"
const SELF_HOSTED_BLOB_ENVIRONMENTS = ["production", "preview", "development"] as const
const INITIAL_DEPLOYMENT_POLL_ATTEMPTS = 8
const INITIAL_DEPLOYMENT_POLL_INTERVAL_MS = 3000
const PROJECT_ENV_LIST_NOT_FOUND_ATTEMPTS = 12
const PROJECT_ENV_LIST_NOT_FOUND_INTERVAL_MS = 1000

export interface SkillRunnerWorkerProject {
  projectId: string
  projectName: string
  workerBaseUrl?: string
  dashboardUrl: string
  missingEnvKeys?: string[]
  latestDeploymentId?: string
  latestDeploymentUrl?: string
  latestDeploymentReadyState?: string
  latestDeploymentCreatedAt?: number
  latestDeploymentGitSha?: string
  latestDeploymentGitBranch?: string
  desiredWorkerBranch?: string
  desiredWorkerGitSha?: string
  workerShellVersion?: string
  workerReportedBranch?: string
  runtimeManifestVersion?: string
  shellVersionStatus?: "current" | "outdated" | "unknown"
}

let desiredWorkerVersionCache:
  | {
      branch: string
      sha?: string
      checkedAt: number
    }
  | undefined

function normalizeHost(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  if (!trimmed) return undefined
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed.replace(/\/$/, "")
  }
  return `https://${trimmed.replace(/\/$/, "")}`
}

function pickFirstAlias(value: string[] | string | undefined): string | undefined {
  if (Array.isArray(value)) return value[0]
  if (typeof value === "string") return value
  return undefined
}

function resolveWorkerBaseUrl(project: VercelProjectLookupProject): string | undefined {
  const productionAlias = pickFirstAlias(project.targets?.production?.alias)
  if (productionAlias) return normalizeHost(productionAlias)

  const directAlias = pickFirstAlias(project.alias)
  if (directAlias) return normalizeHost(directAlias)

  const readyDeployment = project.latestDeployments?.find(
    (deployment) => deployment.readyState === "READY" || deployment.state === "READY"
  )
  if (readyDeployment?.url) return normalizeHost(readyDeployment.url)

  return undefined
}

function resolveLatestDeployment(project: VercelProjectLookupProject): VercelProjectLookupDeployment | undefined {
  if (!Array.isArray(project.latestDeployments) || project.latestDeployments.length === 0) {
    return undefined
  }

  return [...project.latestDeployments].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0]
}

function buildDashboardUrl(team: VercelTeam, projectName: string): string {
  return `https://vercel.com/${encodeURIComponent(team.slug)}/${encodeURIComponent(projectName)}`
}

function normalizeProjectName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
}

function buildWorkerProjectCreateName(): string {
  return SKILL_RUNNER_WORKER_PROJECT_NAME
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

function getWorkerProjectNames(_team: VercelTeam): string[] {
  return [SKILL_RUNNER_WORKER_PROJECT_NAME]
}

function isSkillRunnerWorkerProjectName(name: string | undefined, team: VercelTeam): boolean {
  const normalizedName = normalizeProjectName(name || "")
  const legacyNames = getWorkerProjectNames(team)
  return legacyNames.some((projectName) => normalizedName === projectName)
}

function sanitizeBlobStoreNameSegment(value: string): string {
  const sanitized = value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
  return sanitized || "team"
}

function buildWorkerBlobStoreName(team: VercelTeam): string {
  const suffix = sanitizeBlobStoreNameSegment(team.slug).slice(0, 32)
  return `d3k-skill-runner-${suffix}-private`.slice(0, 63)
}

function buildTeamBlobStoresUrl(team: VercelTeam): string {
  return `https://vercel.com/${team.slug}/~/stores/blob`
}

function parseVercelApiErrorPayload(value: string): VercelApiErrorPayload | null {
  try {
    return JSON.parse(value) as VercelApiErrorPayload
  } catch {
    return null
  }
}

function isVercelProjectNotFoundError(error: unknown): boolean {
  return error instanceof VercelProjectNotFoundError
}

function isProjectNotFoundApiResponse(status: number, errorText: string): boolean {
  if (status !== 404) return false

  const payload = parseVercelApiErrorPayload(errorText)
  const code = payload?.error?.code?.trim().toLowerCase()
  const message = payload?.error?.message?.trim()
  return code === "not_found" && (!message || /project not found/i.test(message))
}

function isMaxBlobStoreCountApiResponse(status: number, errorText: string): boolean {
  if (status !== 400 && status !== 403) return false

  const payload = parseVercelApiErrorPayload(errorText)
  const code = payload?.error?.code?.trim().toLowerCase()
  const message = payload?.error?.message?.trim()
  return (
    code === "max_store_count_reached" || /max(?:imum)? .*blob stores|cannot create more/i.test(message || errorText)
  )
}

function isProjectEnvVarsForbiddenApiResponse(status: number, errorText: string): boolean {
  if (status !== 403) return false

  const payload = parseVercelApiErrorPayload(errorText)
  const code = payload?.error?.code?.trim().toLowerCase()
  const message = payload?.error?.message?.trim()
  const action = payload?.error?.action?.trim().toLowerCase()
  const resource = payload?.error?.resource?.trim().toLowerCase()
  return (
    code === "forbidden" &&
    (resource === "projectenvvars" ||
      action === "create" ||
      /project environment variable|project env var|environment variable/i.test(message || errorText))
  )
}

function isProjectScopeRequiredApiResponse(status: number, errorText: string): boolean {
  if (status !== 403) return false

  const payload = parseVercelApiErrorPayload(errorText)
  const code = payload?.error?.code?.trim().toLowerCase()
  const message = payload?.error?.message?.trim()
  const resource = payload?.error?.resource?.trim().toLowerCase()
  return (
    code === "forbidden" &&
    (resource === "project" ||
      resource === "projects" ||
      resource === "projectenvvars" ||
      /project|environment variable|env var|permission/i.test(message || errorText))
  )
}

function buildBlobStoreLimitError(team: VercelTeam): SkillRunnerWorkerSetupError {
  return new SkillRunnerWorkerSetupError(
    `${team.name} already has the maximum number of Vercel Blob stores. Delete an unused Blob store, then retry runner setup.`,
    {
      code: "blob_store_limit_reached",
      actionLabel: "Open Blob Stores",
      actionUrl: buildTeamBlobStoresUrl(team)
    }
  )
}

function buildProjectScopeRequiredError(team: VercelTeam): SkillRunnerWorkerSetupError {
  return new SkillRunnerWorkerSetupError(
    `dev3000 needs Vercel access to all projects in ${team.name} to create and configure the new d3k-skill-runner project. Reconnect Vercel and choose all projects in this team, then retry setup.`,
    {
      code: "project_scope_required",
      actionLabel: "Reconnect Vercel",
      actionUrl: `/api/auth/authorize?next=${encodeURIComponent(`/${team.slug}/skill-runner`)}`
    }
  )
}

function getStoreProjectConnection(
  store: VercelBlobStore | undefined,
  projectId: string
): VercelBlobStoreProjectMetadata | undefined {
  return store?.projectsMetadata?.find((metadata) => metadata.projectId === projectId)
}

function findWorkerConnectedBlobStore(
  stores: VercelBlobStore[],
  projectId: string,
  preferredStoreName: string
): { store: VercelBlobStore; connection: VercelBlobStoreProjectMetadata } | null {
  const connectedPrivateStores = stores
    .filter((store) => store.id && store.access === "private")
    .map((store) => ({ store, connection: getStoreProjectConnection(store, projectId) }))
    .filter((entry): entry is { store: VercelBlobStore; connection: VercelBlobStoreProjectMetadata } =>
      Boolean(entry.connection)
    )

  return (
    connectedPrivateStores.find((entry) => entry.store.name === preferredStoreName) ||
    connectedPrivateStores.find((entry) => entry.store.name?.startsWith(`${SKILL_RUNNER_WORKER_PROJECT_NAME}-`)) ||
    connectedPrivateStores[0] ||
    null
  )
}

function findReusablePrivateBlobStore(stores: VercelBlobStore[], preferredStoreName: string): VercelBlobStore | null {
  return (
    stores.find((store) => store.id && store.access === "private" && store.name === preferredStoreName) ||
    stores.find(
      (store) =>
        store.id &&
        store.access === "private" &&
        store.name?.startsWith(`${SKILL_RUNNER_WORKER_PROJECT_NAME}-`) &&
        (!store.projectsMetadata || store.projectsMetadata.length === 0)
    ) ||
    stores.find(
      (store) =>
        store.id && store.access === "private" && (!store.projectsMetadata || store.projectsMetadata.length === 0)
    ) ||
    null
  )
}

function buildWorkerProjectCreateError(status: number, errorText: string): Error {
  const payload = parseVercelApiErrorPayload(errorText)
  const vercelError = payload?.error
  const message = vercelError?.message?.trim()
  const action = vercelError?.action?.trim()
  const actionUrl = vercelError?.link?.trim()
  const repo = vercelError?.repo?.trim()

  if (
    status === 400 &&
    ((action && /install github app/i.test(action)) || (message && /github integration/i.test(message)))
  ) {
    return new SkillRunnerWorkerSetupError(
      message || "This team must install the Vercel GitHub integration before the runner project can be created.",
      {
        code: "github_integration_required",
        actionLabel: "Install GitHub Integration",
        actionUrl,
        repo
      }
    )
  }

  return new Error(`Failed to install runner project: ${status} ${errorText}`)
}

function buildInitialDeploymentCreateError(
  status: number,
  errorText: string,
  project: SkillRunnerWorkerProject
): Error {
  const payload = parseVercelApiErrorPayload(errorText)
  const vercelError = payload?.error
  const message = vercelError?.message?.trim()
  const action = vercelError?.action?.trim()
  const actionUrl = vercelError?.link?.trim()
  const repo = vercelError?.repo?.trim()
  const errorCode = vercelError?.code?.trim()
  const searchableText = [errorCode, message, action, errorText].filter(Boolean).join("\n")

  if (
    (status === 400 || status === 403 || status === 404) &&
    /github|git|repository|repo|source|access|permission|not authorized|not found|integration/i.test(searchableText)
  ) {
    return new SkillRunnerWorkerSetupError(
      message ||
        `The runner project "${project.projectName}" exists, but Vercel could not start its deployment. Retry setup to redeploy it automatically.`,
      {
        code: /install github app|github integration/i.test(searchableText)
          ? "github_integration_required"
          : "initial_deployment_missing",
        actionLabel: actionUrl ? "Open Vercel Setup" : "Open Runner Project",
        actionUrl: actionUrl || project.dashboardUrl,
        projectName: project.projectName,
        repo: repo || SKILL_RUNNER_WORKER_REPO
      }
    )
  }

  return new Error(`Failed to start runner project source deployment: ${status} ${errorText}`)
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

function resolveWorkerGitBranch(): string {
  if (process.env.VERCEL_GIT_COMMIT_REF?.trim()) {
    return process.env.VERCEL_GIT_COMMIT_REF.trim()
  }

  try {
    const branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim()
    return branch || "main"
  } catch {
    return "main"
  }
}

function normalizeGitSha(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed || undefined
}

async function resolveDesiredWorkerGitSha(branch: string): Promise<string | undefined> {
  const now = Date.now()
  if (
    desiredWorkerVersionCache &&
    desiredWorkerVersionCache.branch === branch &&
    now - desiredWorkerVersionCache.checkedAt < 30_000
  ) {
    return desiredWorkerVersionCache.sha
  }

  const envSha = process.env.VERCEL_GIT_COMMIT_SHA?.trim() || undefined
  if (envSha && (!process.env.VERCEL_GIT_COMMIT_REF || process.env.VERCEL_GIT_COMMIT_REF.trim() === branch)) {
    desiredWorkerVersionCache = {
      branch,
      sha: envSha,
      checkedAt: now
    }
    return envSha
  }

  try {
    const remote = execFileSync("git", ["ls-remote", "origin", `refs/heads/${branch}`], {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim()
    const sha = remote.split(/\s+/)[0]?.trim() || undefined
    desiredWorkerVersionCache = {
      branch,
      sha,
      checkedAt: now
    }
    return sha
  } catch {
    desiredWorkerVersionCache = {
      branch,
      sha: undefined,
      checkedAt: now
    }
    return undefined
  }
}

async function getDeploymentDetails(
  accessToken: string,
  team: VercelTeam,
  deploymentId: string
): Promise<VercelDeploymentDetailsResponse | null> {
  const apiUrl = new URL(`https://api.vercel.com/v13/deployments/${deploymentId}`)
  apiUrl.searchParams.set("teamId", team.id)

  const response = await fetch(apiUrl.toString(), {
    headers: {
      Authorization: `Bearer ${accessToken}`
    },
    cache: "no-store"
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Failed to inspect runner deployment: ${response.status} ${errorText}`)
  }

  return (await response.json()) as VercelDeploymentDetailsResponse
}

interface VercelDeploymentEventLine {
  text?: string
}

const ANSI_ESCAPE_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, "g")

function cleanDeploymentLogLine(value: string): string {
  return value
    .replace(ANSI_ESCAPE_PATTERN, "")
    .replace(/\[now-builder-debug\]\s*/g, "")
    .trim()
}

function summarizeDeploymentFailureLines(lines: string[]): string | undefined {
  const important = lines
    .map(cleanDeploymentLogLine)
    .filter(Boolean)
    .filter((line) =>
      /Build error occurred|Module not found|Can't resolve|Type error|Failed to compile|Cannot find module|ENOENT|SyntaxError|ReferenceError|error: script|Command ".*" exited with/i.test(
        line
      )
    )

  const deduped: string[] = []
  for (const line of important) {
    if (!deduped.includes(line)) {
      deduped.push(line)
    }
    if (deduped.length >= 5) break
  }

  return deduped.length > 0 ? deduped.join("\n") : undefined
}

async function getDeploymentFailureSummary(
  accessToken: string,
  team: VercelTeam,
  deploymentId: string
): Promise<string | undefined> {
  const apiUrl = new URL(`https://api.vercel.com/v3/now/deployments/${encodeURIComponent(deploymentId)}/events`)
  apiUrl.searchParams.set("teamId", team.id)
  apiUrl.searchParams.set("direction", "forward")
  apiUrl.searchParams.set("follow", "")
  apiUrl.searchParams.set("format", "lines")
  apiUrl.searchParams.set("limit", "200")

  const response = await fetch(apiUrl.toString(), {
    headers: {
      Authorization: `Bearer ${accessToken}`
    },
    cache: "no-store"
  })

  if (!response.ok) {
    return undefined
  }

  const body = await response.text()
  const lines = body
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        const event = JSON.parse(line) as VercelDeploymentEventLine
        return event.text || ""
      } catch {
        return ""
      }
    })

  return summarizeDeploymentFailureLines(lines)
}

function buildDeploymentLogsUrl(deploymentUrl: string | undefined): string | undefined {
  const normalized = normalizeHost(deploymentUrl)
  return normalized ? `${normalized}/_logs` : undefined
}

async function fetchWorkerVersionPayload(workerBaseUrl: string): Promise<SkillRunnerWorkerVersionPayload | null> {
  try {
    const response = await fetch(new URL("/api/skill-runner-worker/version", workerBaseUrl).toString(), {
      cache: "no-store"
    })
    if (!response.ok) {
      return null
    }

    const data = (await response.json()) as Partial<SkillRunnerWorkerVersionPayload>
    return {
      workerMode: data.workerMode === "self-hosted-worker" ? "self-hosted-worker" : "control-plane",
      workerShellVersion: normalizeGitSha(data.workerShellVersion),
      workerBranch: data.workerBranch?.trim() || undefined,
      runtimeManifestVersion: typeof data.runtimeManifestVersion === "string" ? data.runtimeManifestVersion : ""
    }
  } catch {
    return null
  }
}

function resolveShellVersionStatus({
  desiredGitSha,
  deployedGitSha,
  reportedGitSha,
  runtimeManifestVersion
}: {
  desiredGitSha?: string
  deployedGitSha?: string
  reportedGitSha?: string
  runtimeManifestVersion?: string
}): "current" | "outdated" | "unknown" {
  if (runtimeManifestVersion && runtimeManifestVersion !== SKILL_RUNNER_RUNTIME_MANIFEST_VERSION) {
    return "outdated"
  }

  if (desiredGitSha && reportedGitSha) {
    return desiredGitSha === reportedGitSha ? "current" : "outdated"
  }

  if (desiredGitSha && deployedGitSha) {
    return desiredGitSha === deployedGitSha ? "current" : "outdated"
  }

  return "unknown"
}

export function resolveSkillRunnerWorkerStatus(
  project: Pick<
    SkillRunnerWorkerProject,
    "workerBaseUrl" | "missingEnvKeys" | "latestDeploymentReadyState" | "shellVersionStatus"
  > | null
): SkillRunnerWorkerStatus {
  if (!project) return "unconfigured"
  if (!project.workerBaseUrl) return "provisioning"
  if (project.missingEnvKeys && project.missingEnvKeys.length > 0) return "error"
  if (isFailedDeploymentState(project.latestDeploymentReadyState)) return "error"
  if (project.latestDeploymentReadyState && project.latestDeploymentReadyState !== "READY") return "provisioning"
  if (project.shellVersionStatus === "outdated") return "outdated"
  return "ready"
}

function isFailedDeploymentState(state: string | undefined): boolean {
  const normalizedState = state?.trim().toUpperCase()
  return normalizedState === "ERROR" || normalizedState === "FAILED" || normalizedState === "CANCELED"
}

async function listTeamBlobStores(accessToken: string, team: VercelTeam) {
  const apiUrl = new URL("https://api.vercel.com/v1/storage/stores")
  apiUrl.searchParams.set("teamId", team.id)

  const response = await fetch(apiUrl.toString(), {
    headers: {
      Authorization: `Bearer ${accessToken}`
    },
    cache: "no-store"
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Failed to list Blob stores: ${response.status} ${errorText}`)
  }

  const data = (await response.json()) as VercelBlobStoreListResponse
  return Array.isArray(data.stores) ? data.stores : []
}

async function createTeamBlobStore(
  accessToken: string,
  team: VercelTeam,
  name: string
): Promise<{ storeId: string; created: boolean }> {
  const apiUrl = new URL("https://api.vercel.com/v1/storage/stores/blob")
  apiUrl.searchParams.set("teamId", team.id)

  const response = await fetch(apiUrl.toString(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      access: "private",
      name,
      region: SELF_HOSTED_BLOB_STORE_REGION
    }),
    cache: "no-store"
  })

  if (!response.ok) {
    const errorText = await response.text()
    if (response.status === 409) {
      const existingStore = (await listTeamBlobStores(accessToken, team)).find(
        (store) => store.name === name && store.id
      )
      if (existingStore?.id) {
        return { storeId: existingStore.id, created: false }
      }
    }
    if (isMaxBlobStoreCountApiResponse(response.status, errorText)) {
      throw new BlobStoreLimitReachedError(errorText)
    }
    throw new Error(`Failed to create Blob store: ${response.status} ${errorText}`)
  }

  const data = (await response.json()) as VercelBlobStoreCreateResponse
  const storeId = data.store?.id?.trim()
  if (!storeId) {
    throw new Error("Blob store creation succeeded but no store id was returned.")
  }

  return { storeId, created: true }
}

async function deleteTeamBlobStore(accessToken: string, team: VercelTeam, storeId: string): Promise<void> {
  const baseParams = new URLSearchParams({ teamId: team.id })

  const connectionsUrl = new URL(`https://api.vercel.com/v1/storage/stores/${storeId}/connections`)
  connectionsUrl.search = baseParams.toString()
  const deleteConnectionsResponse = await fetch(connectionsUrl.toString(), {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${accessToken}`
    },
    cache: "no-store"
  })

  if (!deleteConnectionsResponse.ok && deleteConnectionsResponse.status !== 404) {
    const errorText = await deleteConnectionsResponse.text()
    throw new Error(`Failed to disconnect created Blob store: ${deleteConnectionsResponse.status} ${errorText}`)
  }

  const storeUrl = new URL(`https://api.vercel.com/v1/storage/stores/blob/${storeId}`)
  storeUrl.search = baseParams.toString()
  const deleteStoreResponse = await fetch(storeUrl.toString(), {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${accessToken}`
    },
    cache: "no-store"
  })

  if (!deleteStoreResponse.ok && deleteStoreResponse.status !== 404) {
    const errorText = await deleteStoreResponse.text()
    throw new Error(`Failed to delete created Blob store: ${deleteStoreResponse.status} ${errorText}`)
  }
}

async function connectBlobStoreToProject(
  accessToken: string,
  team: VercelTeam,
  storeId: string,
  projectId: string
): Promise<void> {
  const apiUrl = new URL(`https://api.vercel.com/v1/storage/stores/${storeId}/connections`)
  apiUrl.searchParams.set("teamId", team.id)

  for (let attempt = 0; attempt < PROJECT_ENV_LIST_NOT_FOUND_ATTEMPTS; attempt += 1) {
    const response = await fetch(apiUrl.toString(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        envVarEnvironments: SELF_HOSTED_BLOB_ENVIRONMENTS,
        projectId,
        type: "integration"
      }),
      cache: "no-store"
    })

    if (response.ok) return

    const errorText = await response.text()
    if (response.status === 409 || /already connected|already exists|duplicate/i.test(errorText)) {
      return
    }

    if (isProjectNotFoundApiResponse(response.status, errorText)) {
      if (attempt < PROJECT_ENV_LIST_NOT_FOUND_ATTEMPTS - 1) {
        await sleep(PROJECT_ENV_LIST_NOT_FOUND_INTERVAL_MS)
        continue
      }
      throw new VercelProjectNotFoundError(
        "Vercel reported that the runner project no longer exists while dev3000 was connecting Blob storage."
      )
    }

    if (
      isProjectEnvVarsForbiddenApiResponse(response.status, errorText) ||
      isProjectScopeRequiredApiResponse(response.status, errorText)
    ) {
      throw buildProjectScopeRequiredError(team)
    }

    throw new Error(`Failed to connect Blob store to runner project: ${response.status} ${errorText}`)
  }

  throw new VercelProjectNotFoundError(
    "Vercel reported that the runner project no longer exists while dev3000 was connecting Blob storage."
  )
}

async function listBlobStoreConnections(accessToken: string, team: VercelTeam, storeId: string) {
  const apiUrl = new URL(`https://api.vercel.com/v1/storage/stores/${storeId}/connections`)
  apiUrl.searchParams.set("teamId", team.id)

  const response = await fetch(apiUrl.toString(), {
    headers: {
      Authorization: `Bearer ${accessToken}`
    },
    cache: "no-store"
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Failed to inspect Blob store connections: ${response.status} ${errorText}`)
  }

  const data = (await response.json()) as VercelBlobStoreConnectionsResponse
  return Array.isArray(data.connections) ? data.connections : []
}

async function disconnectBlobStoreConnection(
  accessToken: string,
  team: VercelTeam,
  storeId: string,
  connectionId: string
): Promise<void> {
  const apiUrl = new URL(`https://api.vercel.com/v1/storage/stores/${storeId}/connections/${connectionId}`)
  apiUrl.searchParams.set("teamId", team.id)

  const response = await fetch(apiUrl.toString(), {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${accessToken}`
    },
    cache: "no-store"
  })

  if (response.ok || response.status === 404) return

  const errorText = await response.text()
  throw new Error(`Failed to disconnect Blob store from runner project: ${response.status} ${errorText}`)
}

async function removeProjectEnvVar(
  accessToken: string,
  team: VercelTeam,
  projectId: string,
  envId: string
): Promise<void> {
  const unlinkUrl = new URL(`https://api.vercel.com/v1/env/${envId}/unlink/${projectId}`)
  unlinkUrl.searchParams.set("teamId", team.id)

  const unlinkResponse = await fetch(unlinkUrl.toString(), {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${accessToken}`
    },
    cache: "no-store"
  })

  if (unlinkResponse.ok || unlinkResponse.status === 404) return

  const apiUrl = new URL(`https://api.vercel.com/v9/projects/${projectId}/env/${envId}`)
  apiUrl.searchParams.set("teamId", team.id)

  const response = await fetch(apiUrl.toString(), {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${accessToken}`
    },
    cache: "no-store"
  })

  if (response.ok || response.status === 404) return

  const errorText = await response.text()
  throw new Error(`Failed to remove stale worker env var: ${response.status} ${errorText}`)
}

async function listProjectEnvVars(accessToken: string, team: VercelTeam, projectId: string) {
  const apiUrl = new URL(`https://api.vercel.com/v10/projects/${projectId}/env`)
  apiUrl.searchParams.set("teamId", team.id)

  for (let attempt = 0; attempt < PROJECT_ENV_LIST_NOT_FOUND_ATTEMPTS; attempt += 1) {
    const response = await fetch(apiUrl.toString(), {
      headers: {
        Authorization: `Bearer ${accessToken}`
      },
      cache: "no-store"
    })

    if (response.ok) {
      const data = (await response.json()) as VercelProjectEnvListResponse
      return Array.isArray(data.envs) ? data.envs : []
    }

    const errorText = await response.text()
    if (
      isProjectEnvVarsForbiddenApiResponse(response.status, errorText) ||
      isProjectScopeRequiredApiResponse(response.status, errorText)
    ) {
      throw buildProjectScopeRequiredError(team)
    }

    if (!isProjectNotFoundApiResponse(response.status, errorText)) {
      throw new Error(`Failed to inspect runner project env vars: ${response.status} ${errorText}`)
    }

    if (attempt < PROJECT_ENV_LIST_NOT_FOUND_ATTEMPTS - 1) {
      await sleep(PROJECT_ENV_LIST_NOT_FOUND_INTERVAL_MS)
      continue
    }

    throw new VercelProjectNotFoundError(
      "Vercel reported that the runner project no longer exists while dev3000 was inspecting its environment variables."
    )
  }

  return []
}

async function assertWorkerProjectIncludedInOauthGrant(
  accessToken: string,
  team: VercelTeam,
  projectId: string
): Promise<void> {
  const apiUrl = new URL(`https://api.vercel.com/v9/projects/${encodeURIComponent(projectId)}`)
  apiUrl.searchParams.set("teamId", team.id)

  for (let attempt = 0; attempt < PROJECT_ENV_LIST_NOT_FOUND_ATTEMPTS; attempt += 1) {
    const response = await fetch(apiUrl.toString(), {
      headers: {
        Authorization: `Bearer ${accessToken}`
      },
      cache: "no-store"
    })

    if (response.ok) {
      await listProjectEnvVars(accessToken, team, projectId)
      return
    }

    const errorText = await response.text()
    if (isProjectScopeRequiredApiResponse(response.status, errorText)) {
      throw buildProjectScopeRequiredError(team)
    }

    if (isProjectNotFoundApiResponse(response.status, errorText)) {
      if (attempt < PROJECT_ENV_LIST_NOT_FOUND_ATTEMPTS - 1) {
        await sleep(PROJECT_ENV_LIST_NOT_FOUND_INTERVAL_MS)
        continue
      }
      throw new VercelProjectNotFoundError(
        "Vercel reported that the runner project no longer exists while dev3000 was verifying project access."
      )
    }

    throw new Error(`Failed to verify runner project access: ${response.status} ${errorText}`)
  }
}

async function removeWorkerBlobEnvBindings(accessToken: string, team: VercelTeam, projectId: string): Promise<void> {
  const envVars = await listProjectEnvVars(accessToken, team, projectId)
  const blobEnvVars = envVars.filter((envItem) => envItem.key?.trim() === "BLOB_READ_WRITE_TOKEN" && envItem.id?.trim())

  for (const envVar of blobEnvVars) {
    const envId = envVar.id?.trim()
    if (!envId) continue
    await removeProjectEnvVar(accessToken, team, projectId, envId)
  }
}

async function removeWorkerMetadataEnvVars(accessToken: string, team: VercelTeam, projectId: string): Promise<void> {
  const envVars = await listProjectEnvVars(accessToken, team, projectId)
  const staleEnvVars = envVars.filter((envItem) => {
    const key = envItem.key?.trim()
    return key && LEGACY_WORKER_METADATA_ENV_KEYS.has(key) && envItem.id?.trim()
  })

  for (const envVar of staleEnvVars) {
    const envId = envVar.id?.trim()
    if (!envId) continue
    await removeProjectEnvVar(accessToken, team, projectId, envId)
  }
}

async function disconnectWorkerBlobStoreConnections(
  accessToken: string,
  team: VercelTeam,
  projectId: string,
  stores: Awaited<ReturnType<typeof listTeamBlobStores>>
): Promise<void> {
  for (const store of stores) {
    const storeId = store.id?.trim()
    if (!storeId) continue

    const connections = await listBlobStoreConnections(accessToken, team, storeId)
    for (const connection of connections) {
      const connectionId = connection.id?.trim()
      if (!connectionId || connection.projectId !== projectId) continue
      await disconnectBlobStoreConnection(accessToken, team, storeId, connectionId)
    }
  }
}

async function ensureWorkerBlobStore(
  accessToken: string,
  team: VercelTeam,
  project: SkillRunnerWorkerProject,
  options: {
    skipExistingCleanup?: boolean
  } = {}
): Promise<void> {
  const stores = await listTeamBlobStores(accessToken, team)
  const desiredStoreName = buildWorkerBlobStoreName(team)
  const existingStore = stores.find((store) => store.name === desiredStoreName)
  let storeId = existingStore?.id
  let createdStoreId: string | undefined
  if (!storeId) {
    try {
      const createdStore = await createTeamBlobStore(accessToken, team, desiredStoreName)
      storeId = createdStore.storeId
      createdStoreId = createdStore.created ? createdStore.storeId : undefined
    } catch (error) {
      if (!(error instanceof BlobStoreLimitReachedError)) {
        throw error
      }

      const reusableStore = findReusablePrivateBlobStore(stores, desiredStoreName)
      if (!reusableStore?.id) {
        throw buildBlobStoreLimitError(team)
      }
      storeId = reusableStore.id
    }
  }

  try {
    if (!options.skipExistingCleanup) {
      await disconnectWorkerBlobStoreConnections(accessToken, team, project.projectId, stores)
      await removeWorkerBlobEnvBindings(accessToken, team, project.projectId)
    }
    await connectBlobStoreToProject(accessToken, team, storeId, project.projectId)
  } catch (error) {
    if (createdStoreId) {
      await deleteTeamBlobStore(accessToken, team, createdStoreId).catch((cleanupError: unknown) => {
        console.warn(
          "[Skill Runner Worker] Failed to clean up Blob store after setup failure:",
          cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
        )
      })
    }
    throw error
  }
}

async function deleteWorkerProject(accessToken: string, team: VercelTeam, projectId: string): Promise<void> {
  const apiUrl = new URL(`https://api.vercel.com/v9/projects/${encodeURIComponent(projectId)}`)
  apiUrl.searchParams.set("teamId", team.id)

  const response = await fetch(apiUrl.toString(), {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${accessToken}`
    },
    cache: "no-store"
  })

  if (response.ok || response.status === 404) return

  const errorText = await response.text()
  throw new Error(`Failed to delete created runner project: ${response.status} ${errorText}`)
}

async function redeployWorkerProject(
  accessToken: string,
  team: VercelTeam,
  project: SkillRunnerWorkerProject
): Promise<string | null> {
  return createInitialWorkerDeployment(accessToken, team, project)
}

async function createInitialWorkerDeployment(
  accessToken: string,
  team: VercelTeam,
  project: SkillRunnerWorkerProject
): Promise<string> {
  const workerShellVersion = project.desiredWorkerGitSha || (await resolveDesiredWorkerGitSha(resolveWorkerGitBranch()))
  if (!workerShellVersion) {
    throw new Error("Could not resolve the desired runner shell source version.")
  }

  const source = await resolveSkillRunnerShellSource(workerShellVersion, workerShellVersion)
  const durationConfig = resolveWorkerDurationConfig(team)
  const files = await uploadSkillRunnerShellSourceFiles({
    accessToken,
    ...durationConfig,
    source,
    teamId: team.id
  })
  const apiUrl = new URL("https://api.vercel.com/v13/deployments")
  apiUrl.searchParams.set("teamId", team.id)
  apiUrl.searchParams.set("forceNew", "1")
  apiUrl.searchParams.set("skipAutoDetectionConfirmation", "1")

  const response = await fetch(apiUrl.toString(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      name: project.projectName,
      project: project.projectId,
      target: "production",
      files,
      gitMetadata: {
        commitMessage: `Deploy d3k skill runner shell ${source.version}`,
        commitRef: project.desiredWorkerBranch || resolveWorkerGitBranch(),
        commitSha: source.commit,
        dirty: false,
        remoteUrl: `https://github.com/${SKILL_RUNNER_WORKER_REPO}.git`
      },
      meta: {
        d3kSkillRunnerShellCommit: source.commit,
        d3kSkillRunnerShellVersion: source.version,
        d3kSkillRunnerMaxFunctionDuration: String(durationConfig.maxFunctionDurationSeconds),
        d3kSkillRunnerMaxWorkflowStepDuration: String(durationConfig.maxWorkflowStepDurationSeconds),
        d3kSkillRunnerSource: "deployment-files"
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

  if (!response.ok) {
    const errorText = await response.text()
    throw buildInitialDeploymentCreateError(response.status, errorText, project)
  }

  const data = (await response.json()) as VercelDeploymentCreateResponse
  const deploymentId = data.id?.trim() || data.uid?.trim()
  if (!deploymentId) {
    throw new Error("Runner project deployment was started but the response was incomplete.")
  }

  return deploymentId
}

async function getWorkerProjectMissingEnvKeys(
  accessToken: string,
  team: VercelTeam,
  projectId: string,
  latestDeploymentId?: string,
  latestDeploymentCreatedAt?: number
): Promise<string[]> {
  const envVars = await listProjectEnvVars(accessToken, team, projectId)
  const envKeys = new Set(envVars.map((envItem) => envItem.key?.trim()).filter((key): key is string => Boolean(key)))
  const missing = REQUIRED_SELF_HOSTED_WORKER_ENV_KEYS.filter((key) => !envKeys.has(key))
  const desiredStoreName = buildWorkerBlobStoreName(team)
  const stores = await listTeamBlobStores(accessToken, team)
  const workerBlobStoreConnection = findWorkerConnectedBlobStore(stores, projectId, desiredStoreName)
  if (!workerBlobStoreConnection) {
    return ["BLOB_READ_WRITE_TOKEN"]
  }
  const storeConnection = workerBlobStoreConnection.connection

  const hasExpectedEnvironments = SELF_HOSTED_BLOB_ENVIRONMENTS.every((environment) =>
    storeConnection.environments?.includes(environment)
  )
  if (!hasExpectedEnvironments) {
    return ["BLOB_READ_WRITE_TOKEN"]
  }

  if (!latestDeploymentId || storeConnection.latestDeployment !== latestDeploymentId) {
    return ["BLOB_READ_WRITE_TOKEN"]
  }

  if (missing.length === 0) {
    const blobEnvVar = envVars.find((envItem) => envItem.key?.trim() === "BLOB_READ_WRITE_TOKEN")
    const blobEnvUpdatedAt = blobEnvVar?.updatedAt || blobEnvVar?.createdAt || 0
    if (blobEnvUpdatedAt > 0 && latestDeploymentCreatedAt && latestDeploymentCreatedAt < blobEnvUpdatedAt) {
      return ["BLOB_READ_WRITE_TOKEN"]
    }
  }

  return []
}

async function resolveSkillRunnerWorkerProjectFromLookupProject(
  accessToken: string,
  team: VercelTeam,
  project: VercelProjectLookupProject
): Promise<SkillRunnerWorkerProject | null> {
  const hasAcceptedProjectName = isSkillRunnerWorkerProjectName(project.name, team)

  if (!project.id || typeof project.name !== "string" || !hasAcceptedProjectName) {
    return null
  }

  const projectName = project.name
  const latestDeployment = resolveLatestDeployment(project)
  const desiredWorkerBranch = resolveWorkerGitBranch()
  const desiredWorkerGitSha = await resolveDesiredWorkerGitSha(desiredWorkerBranch)
  const latestDeploymentDetails =
    latestDeployment?.id && latestDeployment.readyState === "READY"
      ? await getDeploymentDetails(accessToken, team, latestDeployment.id)
      : latestDeployment?.id
        ? await getDeploymentDetails(accessToken, team, latestDeployment.id)
        : null
  const latestDeploymentGitSha = normalizeGitSha(
    latestDeploymentDetails?.meta?.d3kSkillRunnerShellCommit ||
      latestDeploymentDetails?.meta?.d3kSkillRunnerShellVersion ||
      latestDeploymentDetails?.meta?.githubCommitSha ||
      latestDeploymentDetails?.meta?.gitCommitSha
  )
  const latestDeploymentGitBranch =
    latestDeploymentDetails?.meta?.githubCommitRef?.trim() || latestDeploymentDetails?.meta?.gitCommitRef?.trim()
  const latestDeploymentUrl = normalizeHost(latestDeployment?.url)
  const workerBaseUrl = resolveWorkerBaseUrl(project)
  const workerVersion =
    workerBaseUrl && (latestDeployment?.readyState === "READY" || latestDeployment?.state === "READY")
      ? await fetchWorkerVersionPayload(workerBaseUrl)
      : null
  const missingEnvKeys = await getWorkerProjectMissingEnvKeys(
    accessToken,
    team,
    project.id,
    latestDeployment?.id,
    latestDeployment?.createdAt
  ).catch((error: unknown) => {
    if (isVercelProjectNotFoundError(error)) return null
    throw error
  })
  if (!missingEnvKeys) {
    return null
  }
  const shellVersionStatus = resolveShellVersionStatus({
    desiredGitSha: desiredWorkerGitSha,
    deployedGitSha: latestDeploymentGitSha,
    reportedGitSha: workerVersion?.workerShellVersion,
    runtimeManifestVersion: workerVersion?.runtimeManifestVersion
  })

  return {
    projectId: project.id,
    projectName,
    workerBaseUrl,
    dashboardUrl: buildDashboardUrl(team, projectName),
    missingEnvKeys,
    latestDeploymentId: latestDeployment?.id,
    latestDeploymentUrl,
    latestDeploymentReadyState: latestDeployment?.readyState || latestDeployment?.state,
    latestDeploymentCreatedAt: latestDeployment?.createdAt,
    latestDeploymentGitSha,
    latestDeploymentGitBranch,
    desiredWorkerBranch,
    desiredWorkerGitSha,
    workerShellVersion: workerVersion?.workerShellVersion || latestDeploymentGitSha,
    workerReportedBranch: workerVersion?.workerBranch,
    runtimeManifestVersion: workerVersion?.runtimeManifestVersion,
    shellVersionStatus
  }
}

async function findSkillRunnerWorkerProjectFromProjectList(
  accessToken: string,
  team: VercelTeam,
  options: {
    maxPages: number
    search?: string
  }
): Promise<SkillRunnerWorkerProject | null> {
  let from: number | string | undefined

  for (let page = 0; page < options.maxPages; page += 1) {
    const apiUrl = new URL("https://api.vercel.com/v10/projects")
    apiUrl.searchParams.set("teamId", team.id)
    apiUrl.searchParams.set("limit", "100")
    if (options.search) {
      apiUrl.searchParams.set("search", options.search)
    }
    if (from !== undefined) {
      apiUrl.searchParams.set("from", String(from))
    }

    const response = await fetch(apiUrl.toString(), {
      headers: {
        Authorization: `Bearer ${accessToken}`
      },
      cache: "no-store"
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Failed to validate runner install: ${response.status} ${errorText}`)
    }

    const data = (await response.json()) as VercelProjectLookupResponse
    const projects = Array.isArray(data.projects) ? data.projects : []
    const exactMatch = projects.find((project) => isSkillRunnerWorkerProjectName(project.name, team))

    if (exactMatch?.id && exactMatch.name) {
      return resolveSkillRunnerWorkerProjectFromLookupProject(accessToken, team, exactMatch)
    }

    const next = data.pagination?.next
    if (next === undefined || next === null) {
      return null
    }
    from = next
  }

  return null
}

async function getSkillRunnerWorkerProjectByIdOrName(
  accessToken: string,
  team: VercelTeam,
  idOrName: string
): Promise<SkillRunnerWorkerProject | null> {
  const apiUrl = new URL(`https://api.vercel.com/v9/projects/${encodeURIComponent(idOrName)}`)
  apiUrl.searchParams.set("teamId", team.id)

  const response = await fetch(apiUrl.toString(), {
    headers: {
      Authorization: `Bearer ${accessToken}`
    },
    cache: "no-store"
  })

  if (response.status === 404) {
    return null
  }

  if (!response.ok) {
    const errorText = await response.text()
    if (isProjectScopeRequiredApiResponse(response.status, errorText)) {
      throw buildProjectScopeRequiredError(team)
    }
    throw new Error(`Failed to inspect existing runner project: ${response.status} ${errorText}`)
  }

  const project = (await response.json()) as VercelProjectLookupProject
  return resolveSkillRunnerWorkerProjectFromLookupProject(accessToken, team, project)
}

export async function findSkillRunnerWorkerProject(
  accessToken: string,
  team: VercelTeam,
  preferredProjectId?: string
): Promise<SkillRunnerWorkerProject | null> {
  const normalizedPreferredProjectId = preferredProjectId?.trim()
  if (normalizedPreferredProjectId) {
    const preferredProject = await getSkillRunnerWorkerProjectByIdOrName(
      accessToken,
      team,
      normalizedPreferredProjectId
    )
    if (preferredProject) return preferredProject
  }

  for (const projectName of getWorkerProjectNames(team)) {
    const searchMatch = await findSkillRunnerWorkerProjectFromProjectList(accessToken, team, {
      maxPages: 2,
      search: projectName
    })
    if (searchMatch) return searchMatch
  }

  for (const projectName of getWorkerProjectNames(team)) {
    const directMatch = await getSkillRunnerWorkerProjectByIdOrName(accessToken, team, projectName)
    if (directMatch) return directMatch
  }

  return findSkillRunnerWorkerProjectFromProjectList(accessToken, team, {
    maxPages: 5
  })
}

async function findExistingWorkerProjectAfterCreateConflict(
  accessToken: string,
  team: VercelTeam,
  preferredProjectId?: string
): Promise<SkillRunnerWorkerProject | null> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const existingProject = await findSkillRunnerWorkerProject(accessToken, team, preferredProjectId).catch(
      (error: unknown) => {
        if (isVercelProjectNotFoundError(error)) return null
        throw error
      }
    )
    if (existingProject) {
      return existingProject
    }
    await sleep(1000)
  }

  return null
}

export async function installSkillRunnerWorkerProject(
  accessToken: string,
  team: VercelTeam,
  preferredProjectId?: string
): Promise<SkillRunnerWorkerProject> {
  let existing = await findSkillRunnerWorkerProject(accessToken, team, preferredProjectId).catch((error: unknown) => {
    if (isVercelProjectNotFoundError(error)) return null
    throw error
  })
  if (existing) {
    await removeWorkerMetadataEnvVars(accessToken, team, existing.projectId).catch((error: unknown) => {
      if (isVercelProjectNotFoundError(error)) {
        existing = null
        return
      }
      throw error
    })
  }

  if (
    existing?.workerBaseUrl &&
    (!existing.missingEnvKeys || existing.missingEnvKeys.length === 0) &&
    existing.latestDeploymentReadyState === "READY" &&
    existing.shellVersionStatus !== "outdated"
  ) {
    return existing
  }

  let project = existing
  let createdProject = false
  if (!project) {
    const createResult = await createWorkerProject(accessToken, team, preferredProjectId)
    project = createResult.project
    createdProject = createResult.created
  }

  try {
    if (createdProject) {
      await assertWorkerProjectIncludedInOauthGrant(accessToken, team, project.projectId)
    }
    await ensureWorkerBlobStore(accessToken, team, project, {
      skipExistingCleanup: createdProject
    })
  } catch (error: unknown) {
    if (createdProject) {
      await deleteWorkerProject(accessToken, team, project.projectId).catch((cleanupError: unknown) => {
        console.warn(
          "[Skill Runner Worker] Failed to clean up runner project after setup failure:",
          cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
        )
      })
    }

    if (!isVercelProjectNotFoundError(error)) {
      throw error
    }
    throw new SkillRunnerWorkerSetupError(
      `Vercel reported that the runner project "${project.projectName}" no longer exists while dev3000 was preparing its Blob storage. Retry setup so dev3000 can recreate the runner project.`,
      {
        code: "unknown",
        actionLabel: "Open Vercel Projects",
        actionUrl: `https://vercel.com/${team.slug}`,
        projectName: project.projectName
      }
    )
  }

  let deploymentId = project.latestDeploymentId || null
  let createdInitialDeployment = false
  if (!deploymentId && !createdProject) {
    for (let attempt = 0; attempt < INITIAL_DEPLOYMENT_POLL_ATTEMPTS; attempt += 1) {
      const resolved = await findSkillRunnerWorkerProject(accessToken, team, project.projectId)
      if (resolved?.latestDeploymentId) {
        deploymentId = resolved.latestDeploymentId
        break
      }
      await sleep(INITIAL_DEPLOYMENT_POLL_INTERVAL_MS)
    }
  }

  if (!deploymentId) {
    deploymentId = await createInitialWorkerDeployment(accessToken, team, project)
    createdInitialDeployment = true
  }

  const redeployProject = {
    ...project,
    latestDeploymentId: deploymentId
  }
  const redeployedId = createdInitialDeployment
    ? deploymentId
    : await redeployWorkerProject(accessToken, team, redeployProject)

  if (redeployedId) {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const resolved = await findSkillRunnerWorkerProject(accessToken, team, project.projectId)
      if (resolved && isFailedDeploymentState(resolved.latestDeploymentReadyState)) {
        const details = resolved.latestDeploymentId
          ? await getDeploymentFailureSummary(accessToken, team, resolved.latestDeploymentId).catch(() => undefined)
          : undefined
        const deploymentLogsUrl = buildDeploymentLogsUrl(resolved.latestDeploymentUrl)
        throw new SkillRunnerWorkerSetupError(
          `Vercel build failed before the runner project "${resolved.projectName}" became ready.`,
          {
            code: "initial_deployment_failed",
            actionLabel: deploymentLogsUrl ? "Open Failed Deployment Logs" : "Open Runner Project",
            actionUrl: deploymentLogsUrl || resolved.dashboardUrl,
            deploymentUrl: resolved.latestDeploymentUrl,
            details,
            projectName: resolved.projectName
          }
        )
      }
      if (
        resolved?.workerBaseUrl &&
        (!resolved.missingEnvKeys || resolved.missingEnvKeys.length === 0) &&
        resolved.latestDeploymentId === redeployedId &&
        resolved.latestDeploymentReadyState === "READY" &&
        resolved.shellVersionStatus !== "outdated"
      ) {
        return resolved
      }
      await sleep(3000)
    }

    return (await findSkillRunnerWorkerProject(accessToken, team, project.projectId)) || project
  }

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const resolved = await findSkillRunnerWorkerProject(accessToken, team, project.projectId)
    if (resolved?.workerBaseUrl && (!resolved.missingEnvKeys || resolved.missingEnvKeys.length === 0)) {
      return resolved
    }
    await sleep(3000)
  }

  return (await findSkillRunnerWorkerProject(accessToken, team, project.projectId)) || project
}

async function createWorkerProject(
  accessToken: string,
  team: VercelTeam,
  preferredProjectId?: string
): Promise<{ project: SkillRunnerWorkerProject; created: boolean }> {
  const projectName = buildWorkerProjectCreateName()
  const apiUrl = new URL("https://api.vercel.com/v11/projects")
  apiUrl.searchParams.set("teamId", team.id)

  const response = await fetch(apiUrl.toString(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      name: projectName,
      framework: "nextjs",
      rootDirectory: SKILL_RUNNER_WORKER_ROOT_DIRECTORY,
      skipGitConnectDuringLink: true
    }),
    cache: "no-store"
  })

  if (response.ok) {
    const created = (await response.json()) as VercelProjectCreateResponse
    if (!created.id || !created.name) {
      throw new Error("Runner project was created but the response was incomplete.")
    }

    return {
      project: {
        projectId: created.id,
        projectName: created.name,
        dashboardUrl: buildDashboardUrl(team, created.name)
      },
      created: true
    }
  }

  const errorText = await response.text()
  if (response.status === 409 || /already exists|conflict/i.test(errorText)) {
    const existing = await findExistingWorkerProjectAfterCreateConflict(accessToken, team, preferredProjectId)
    if (existing) return { project: existing, created: false }

    throw new SkillRunnerWorkerSetupError(
      `Vercel says ${SKILL_RUNNER_WORKER_PROJECT_NAME} already exists for ${team.name}, but this Sign in with Vercel grant cannot inspect it. Reconnect Vercel and choose all projects in this team, then retry setup.`,
      {
        code: "project_scope_required",
        actionLabel: "Reconnect Vercel",
        actionUrl: `/api/auth/authorize?next=${encodeURIComponent(`/${team.slug}/skill-runner`)}`
      }
    )
  }

  throw buildWorkerProjectCreateError(response.status, errorText)
}
