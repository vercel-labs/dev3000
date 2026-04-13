import { execFileSync } from "node:child_process"
import {
  SKILL_RUNNER_WORKER_MODE_ENV,
  SKILL_RUNNER_WORKER_PROJECT_NAME,
  SKILL_RUNNER_WORKER_REPO,
  SKILL_RUNNER_WORKER_ROOT_DIRECTORY
} from "@/lib/skill-runner-config"
import type { VercelTeam } from "@/lib/vercel-teams"

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
      url?: string
      state?: string
      readyState?: string
    }>
  }>
}

interface VercelProjectCreateResponse {
  id?: string
  name?: string
}

interface VercelProjectEnvInput {
  key: string
  value: string
  type: "encrypted"
  target: Array<"production" | "preview" | "development">
}

interface VercelProjectEnvListResponse {
  envs?: Array<{
    key?: string
    target?: Array<"production" | "preview" | "development">
  }>
}

interface VercelBlobStoreListResponse {
  stores?: Array<{
    id?: string
    name?: string
    projectsMetadata?: Array<{
      projectId?: string
      name?: string
      environmentVariables?: string[]
    }>
  }>
}

interface VercelBlobStoreCreateResponse {
  store?: {
    id?: string
    name?: string
  }
}

const ALLOWED_WORKER_ENV_KEYS = [SKILL_RUNNER_WORKER_MODE_ENV] as const
const REQUIRED_SELF_HOSTED_WORKER_ENV_KEYS = ["BLOB_READ_WRITE_TOKEN"] as const
const SELF_HOSTED_BLOB_STORE_REGION = "iad1"
const SELF_HOSTED_BLOB_ENVIRONMENTS = ["production", "preview", "development"] as const

export interface SkillRunnerWorkerProject {
  projectId: string
  projectName: string
  workerBaseUrl?: string
  dashboardUrl: string
  missingEnvKeys?: string[]
}

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

function resolveWorkerBaseUrl(
  project: NonNullable<VercelProjectLookupResponse["projects"]>[number]
): string | undefined {
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

function buildDashboardUrl(team: VercelTeam, projectName: string): string {
  return `https://vercel.com/${encodeURIComponent(team.slug)}/${encodeURIComponent(projectName)}`
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
  return `d3k-skill-runner-${suffix}`.slice(0, 63)
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

function buildWorkerEnvInputs(): VercelProjectEnvInput[] {
  return [
    {
      key: SKILL_RUNNER_WORKER_MODE_ENV,
      value: "1",
      type: "encrypted",
      target: ["production", "preview", "development"]
    }
  ]
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

async function createTeamBlobStore(accessToken: string, team: VercelTeam, name: string): Promise<string> {
  const apiUrl = new URL("https://api.vercel.com/v1/storage/stores/blob")
  apiUrl.searchParams.set("teamId", team.id)

  const response = await fetch(apiUrl.toString(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
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
        return existingStore.id
      }
    }
    throw new Error(`Failed to create Blob store: ${response.status} ${errorText}`)
  }

  const data = (await response.json()) as VercelBlobStoreCreateResponse
  const storeId = data.store?.id?.trim()
  if (!storeId) {
    throw new Error("Blob store creation succeeded but no store id was returned.")
  }

  return storeId
}

async function connectBlobStoreToProject(
  accessToken: string,
  team: VercelTeam,
  storeId: string,
  projectId: string
): Promise<void> {
  const apiUrl = new URL(`https://api.vercel.com/v1/storage/stores/${storeId}/connections`)
  apiUrl.searchParams.set("teamId", team.id)

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

  throw new Error(`Failed to connect Blob store to runner project: ${response.status} ${errorText}`)
}

async function ensureWorkerBlobStore(
  accessToken: string,
  team: VercelTeam,
  project: SkillRunnerWorkerProject
): Promise<void> {
  const stores = await listTeamBlobStores(accessToken, team)
  const connectedStore = stores.find(
    (store) =>
      Array.isArray(store.projectsMetadata) &&
      store.projectsMetadata.some((metadata) => metadata.projectId === project.projectId)
  )
  if (connectedStore?.id) {
    await connectBlobStoreToProject(accessToken, team, connectedStore.id, project.projectId)
    return
  }

  const desiredStoreName = buildWorkerBlobStoreName(team)
  const existingStore = stores.find((store) => store.name === desiredStoreName)
  const storeId = existingStore?.id || (await createTeamBlobStore(accessToken, team, desiredStoreName))
  await connectBlobStoreToProject(accessToken, team, storeId, project.projectId)
}

async function upsertWorkerProjectEnv(
  accessToken: string,
  team: VercelTeam,
  project: SkillRunnerWorkerProject,
  envInputs: VercelProjectEnvInput[]
): Promise<void> {
  if (envInputs.length === 0) return
  if (project.projectName !== SKILL_RUNNER_WORKER_PROJECT_NAME) {
    throw new Error(`Refusing to write env vars to unexpected project: ${project.projectName}`)
  }

  const disallowedEnvKeys = envInputs
    .map((envInput) => envInput.key)
    .filter((key) => !ALLOWED_WORKER_ENV_KEYS.includes(key as (typeof ALLOWED_WORKER_ENV_KEYS)[number]))
  if (disallowedEnvKeys.length > 0) {
    throw new Error(`Refusing to write disallowed runner env vars: ${disallowedEnvKeys.join(", ")}`)
  }

  const apiUrl = new URL(`https://api.vercel.com/v10/projects/${project.projectId}/env`)
  apiUrl.searchParams.set("teamId", team.id)
  apiUrl.searchParams.set("upsert", "true")

  const response = await fetch(apiUrl.toString(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(envInputs),
    cache: "no-store"
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Failed to configure runner project env vars: ${response.status} ${errorText}`)
  }
}

async function getWorkerProjectMissingEnvKeys(
  accessToken: string,
  team: VercelTeam,
  projectId: string
): Promise<string[]> {
  const apiUrl = new URL(`https://api.vercel.com/v10/projects/${projectId}/env`)
  apiUrl.searchParams.set("teamId", team.id)

  const response = await fetch(apiUrl.toString(), {
    headers: {
      Authorization: `Bearer ${accessToken}`
    },
    cache: "no-store"
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Failed to inspect runner project env vars: ${response.status} ${errorText}`)
  }

  const data = (await response.json()) as VercelProjectEnvListResponse
  const envKeys = new Set(
    (Array.isArray(data.envs) ? data.envs : [])
      .map((envItem) => envItem.key?.trim())
      .filter((key): key is string => Boolean(key))
  )

  return REQUIRED_SELF_HOSTED_WORKER_ENV_KEYS.filter((key) => !envKeys.has(key))
}

export async function findSkillRunnerWorkerProject(
  accessToken: string,
  team: VercelTeam
): Promise<SkillRunnerWorkerProject | null> {
  const apiUrl = new URL("https://api.vercel.com/v9/projects")
  apiUrl.searchParams.set("teamId", team.id)
  apiUrl.searchParams.set("search", SKILL_RUNNER_WORKER_PROJECT_NAME)
  apiUrl.searchParams.set("limit", "20")

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
  const exactMatch =
    projects.find((project) => project.name === SKILL_RUNNER_WORKER_PROJECT_NAME) ||
    projects.find((project) => project.name?.toLowerCase() === SKILL_RUNNER_WORKER_PROJECT_NAME)

  if (!exactMatch?.id || !exactMatch.name) {
    return null
  }

  const missingEnvKeys = await getWorkerProjectMissingEnvKeys(accessToken, team, exactMatch.id)

  return {
    projectId: exactMatch.id,
    projectName: exactMatch.name,
    workerBaseUrl: resolveWorkerBaseUrl(exactMatch),
    dashboardUrl: buildDashboardUrl(team, exactMatch.name),
    missingEnvKeys
  }
}

export async function installSkillRunnerWorkerProject(
  accessToken: string,
  team: VercelTeam
): Promise<SkillRunnerWorkerProject> {
  const existing = await findSkillRunnerWorkerProject(accessToken, team)
  if (existing?.workerBaseUrl && (!existing.missingEnvKeys || existing.missingEnvKeys.length === 0)) {
    return existing
  }

  const project = existing ?? (await createWorkerProject(accessToken, team))
  await upsertWorkerProjectEnv(accessToken, team, project, buildWorkerEnvInputs())
  await ensureWorkerBlobStore(accessToken, team, project)

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const resolved = await findSkillRunnerWorkerProject(accessToken, team)
    if (resolved?.workerBaseUrl && (!resolved.missingEnvKeys || resolved.missingEnvKeys.length === 0)) {
      return resolved
    }
    await sleep(3000)
  }

  return (await findSkillRunnerWorkerProject(accessToken, team)) || project
}

async function createWorkerProject(accessToken: string, team: VercelTeam): Promise<SkillRunnerWorkerProject> {
  const apiUrl = new URL("https://api.vercel.com/v11/projects")
  apiUrl.searchParams.set("teamId", team.id)

  const response = await fetch(apiUrl.toString(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      name: SKILL_RUNNER_WORKER_PROJECT_NAME,
      framework: "nextjs",
      rootDirectory: SKILL_RUNNER_WORKER_ROOT_DIRECTORY,
      gitRepository: {
        type: "github",
        repo: SKILL_RUNNER_WORKER_REPO,
        productionBranch: resolveWorkerGitBranch()
      }
    }),
    cache: "no-store"
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Failed to install runner project: ${response.status} ${errorText}`)
  }

  const created = (await response.json()) as VercelProjectCreateResponse
  if (!created.id || !created.name) {
    throw new Error("Runner project was created but the response was incomplete.")
  }

  return {
    projectId: created.id,
    projectName: created.name,
    dashboardUrl: buildDashboardUrl(team, created.name)
  }
}
