import chalk from "chalk"
import { existsSync, readFileSync } from "fs"
import { homedir } from "os"
import { dirname, join, resolve } from "path"

interface RemoteSkillOptions {
  team?: string
  project?: string
  branch?: string
  projectDir?: string
  baseUrl?: string
  wait?: boolean
  json?: boolean
  install?: boolean
}

interface VercelCliAuth {
  token?: string
  expiresAt?: number
}

interface VercelProjectLink {
  orgId?: string
  projectId?: string
  path: string
}

interface VercelUser {
  id: string
  email: string
  name: string
  username: string
}

interface VercelTeam {
  id: string
  slug: string
  name: string
  isPersonal: boolean
}

interface VercelProject {
  id: string
  name: string
  framework?: string | null
  rootDirectory?: string | null
  link?: {
    type?: string
    repo?: string
    repoId?: number
    org?: string
  } | null
  latestDeployments?: Array<{
    id?: string
    url?: string
    state?: string
    readyState?: string
    createdAt?: number
    gitSource?: {
      type?: string
      repoId?: number
      ref?: string
      sha?: string
      message?: string
    } | null
    meta?: {
      githubOrg?: string
      githubRepo?: string
    } | null
  }>
}

interface VercelProjectsResponse {
  projects?: VercelProject[]
  pagination?: {
    next?: number
  }
}

interface StartSkillRunResponse {
  success?: boolean
  code?: string
  error?: string
  message?: string
  projectName?: string
  runId?: string
}

interface WorkerInstallResponse {
  success?: boolean
  installed?: boolean
  error?: string
  code?: string
  message?: string
  project?: {
    projectId?: string
    projectName?: string
    workerBaseUrl?: string
    missingEnvKeys?: string[]
    shellVersionStatus?: "current" | "outdated" | "unknown"
  }
  settings?: {
    workerStatus?: string
    workerBaseUrl?: string
    workerProjectId?: string
  }
}

interface WorkflowRun {
  id?: string
  status?: string
  cost?: string | number | null
  totalCost?: string | number | null
  formattedCost?: string | null
  duration?: string | number | null
  completedAt?: string | null
  error?: string | null
}

const DEFAULT_DEV3000_BASE_URL = "https://dev3000.ai"
const REMOTE_SKILL_OPTIONS = ["team", "project", "branch", "projectDir", "baseUrl", "wait", "json"]

export function shouldUseRemoteSkillRunner(name: string | undefined, options: RemoteSkillOptions): boolean {
  if (name !== "deepsec") {
    return false
  }

  const hasExplicitRunOption =
    REMOTE_SKILL_OPTIONS.some((option) => Boolean(options[option as keyof RemoteSkillOptions])) ||
    options.install === false

  try {
    return hasExplicitRunOption || Boolean(findLinkedVercelProject())
  } catch {
    return true
  }
}

export async function runRemoteSkillCommand(name: string | undefined, options: RemoteSkillOptions): Promise<void> {
  if (!name) {
    throw new Error("A skill name is required. Example: d3k skill deepsec --team elsigh-pro --project commonerband")
  }

  if (name !== "deepsec") {
    throw new Error("Remote skill runs currently support `deepsec` only.")
  }

  const linkedProject = findLinkedVercelProject()
  const teamInput = options.team?.trim() || linkedProject?.orgId
  const projectInput = options.project?.trim() || linkedProject?.projectId
  if (!teamInput || !projectInput) {
    throw new Error(
      "Could not infer the Vercel team/project. Run from a directory linked with `vercel link`, or pass `--team` and `--project`."
    )
  }

  const token = resolveVercelAccessToken()
  if (!token) {
    throw new Error(
      "No Vercel token found. Run `vercel login`, or set VERCEL_TOKEN to a token that can access the target team."
    )
  }

  const baseUrl = normalizeBaseUrl(options.baseUrl || process.env.D3K_CLOUD_URL || DEFAULT_DEV3000_BASE_URL)
  log(options, `Starting ${chalk.bold("DeepSec Security Scan")} on ${chalk.bold(projectInput)}...`)
  if (linkedProject && (!options.team || !options.project)) {
    log(options, `${chalk.green("✓")} Inferred Vercel project link from ${linkedProject.path}`)
  }

  const [user, teams] = await Promise.all([fetchVercelUser(token), fetchVercelTeams(token)])
  const team = resolveTeam(teamInput, user, teams)
  const project = await resolveProject(token, team, projectInput)
  const githubRepo = getProjectGitHubRepo(project)

  if (!githubRepo) {
    throw new Error(
      `Project ${project.name} is not connected to a GitHub repository. DeepSec requires a GitHub-backed Vercel project.`
    )
  }

  const latestDeployment = project.latestDeployments?.[0]
  const branch =
    options.branch?.trim() || latestDeployment?.gitSource?.ref || latestDeployment?.gitSource?.sha || "main"
  const projectDir = options.projectDir?.trim() || project.rootDirectory?.trim() || undefined
  const productionUrl = latestDeployment?.url ? `https://${latestDeployment.url}` : undefined
  const teamScope = team.isPersonal ? team.slug : team.id
  const reportBasePath = `${baseUrl}/${encodeURIComponent(team.slug)}/skill-runner/runs`

  log(options, `${chalk.green("✓")} Team: ${team.name} (${team.slug})`)
  log(options, `${chalk.green("✓")} Project: ${project.name} (${githubRepo.owner}/${githubRepo.repo})`)

  let startResult = await startSkillRun({
    baseUrl,
    token,
    user,
    team,
    teamScope,
    project,
    githubRepo,
    branch,
    projectDir,
    productionUrl
  })

  if (startResult.code === "runner_setup_required" && options.install !== false) {
    log(options, "Team skill runner project needs setup; installing...")
    await installWorkerProject(baseUrl, token, team, options)
    startResult = await startSkillRun({
      baseUrl,
      token,
      user,
      team,
      teamScope,
      project,
      githubRepo,
      branch,
      projectDir,
      productionUrl
    })
  }

  if (!startResult.success || !startResult.runId) {
    const error = startResult.error || "Failed to start DeepSec run."
    throw new Error(error)
  }

  const reportUrl = `${reportBasePath}/${encodeURIComponent(startResult.runId)}/report`
  const output = {
    success: true,
    runId: startResult.runId,
    reportUrl,
    team: team.slug,
    project: project.name
  }

  if (options.json && !options.wait) {
    console.log(JSON.stringify(output, null, 2))
    return
  }

  log(options, `${chalk.green("✓")} Started run ${startResult.runId}`)
  log(options, `${chalk.bold("Report:")} ${reportUrl}`)

  if (options.wait) {
    const run = await waitForRun(baseUrl, user.id, startResult.runId, options)
    if (options.json) {
      console.log(JSON.stringify({ ...output, run }, null, 2))
      return
    }
    log(options, formatRunCompletion(run, reportUrl))
  }
}

function resolveVercelAccessToken(): string | null {
  const explicitToken = process.env.VERCEL_TOKEN?.trim()
  if (explicitToken) {
    return explicitToken
  }

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

function findLinkedVercelProject(startDirectory = process.cwd()): VercelProjectLink | null {
  let currentDirectory = resolve(startDirectory)

  for (;;) {
    const candidate = join(currentDirectory, ".vercel", "project.json")
    if (existsSync(candidate)) {
      try {
        const parsed = JSON.parse(readFileSync(candidate, "utf8")) as Record<string, unknown>
        const orgId = stringValue(parsed.orgId)
        const projectId = stringValue(parsed.projectId)
        if (orgId || projectId) {
          return { orgId, projectId, path: candidate }
        }
      } catch (error) {
        throw new Error(
          `Could not read ${candidate}. Re-run \`vercel link\` or fix the invalid project.json. ${
            error instanceof Error ? error.message : String(error)
          }`
        )
      }
    }

    const parentDirectory = dirname(currentDirectory)
    if (parentDirectory === currentDirectory) {
      return null
    }

    currentDirectory = parentDirectory
  }
}

async function fetchVercelUser(token: string): Promise<VercelUser> {
  const data = await fetchJson<{ user?: Record<string, unknown> }>("https://api.vercel.com/v2/user", {
    headers: authorizationHeaders(token)
  })
  const rawUser = data.user || {}
  const id = stringValue(rawUser.uid) || stringValue(rawUser.id)
  const username = stringValue(rawUser.username)

  if (!id || !username) {
    throw new Error("Could not resolve the signed-in Vercel user from the configured token.")
  }

  return {
    id,
    username,
    email: stringValue(rawUser.email) || "",
    name: stringValue(rawUser.name) || username
  }
}

async function fetchVercelTeams(token: string): Promise<VercelTeam[]> {
  const teams: VercelTeam[] = []
  const seen = new Set<string>()
  let until: string | null = null

  for (let page = 0; page < 20; page++) {
    const apiUrl = new URL("https://api.vercel.com/v2/teams")
    apiUrl.searchParams.set("limit", "100")
    if (until) {
      apiUrl.searchParams.set("until", until)
    }

    const data = await fetchJson<{
      teams?: Array<Record<string, unknown>>
      pagination?: { next?: number }
    }>(apiUrl.toString(), {
      headers: authorizationHeaders(token)
    })
    const pageTeams = Array.isArray(data.teams) ? data.teams : []

    for (const rawTeam of pageTeams) {
      const id = stringValue(rawTeam.id)
      const slug = stringValue(rawTeam.slug)
      const name = stringValue(rawTeam.name)
      if (!id || !slug || !name || seen.has(id.toLowerCase())) {
        continue
      }

      seen.add(id.toLowerCase())
      teams.push({ id, slug, name, isPersonal: false })
    }

    const nextCursor = data.pagination?.next
    if (!nextCursor || pageTeams.length === 0) {
      break
    }

    until = String(nextCursor)
  }

  return teams
}

function resolveTeam(input: string, user: VercelUser, teams: VercelTeam[]): VercelTeam {
  const normalizedInput = input.toLowerCase()
  const personalTeam: VercelTeam = {
    id: user.id,
    slug: user.username,
    name: user.name || user.username,
    isPersonal: true
  }
  const allTeams = [personalTeam, ...teams]
  const team =
    allTeams.find((candidate) => candidate.id.toLowerCase() === normalizedInput) ||
    allTeams.find((candidate) => candidate.slug.toLowerCase() === normalizedInput) ||
    allTeams.find((candidate) => candidate.name.toLowerCase() === normalizedInput)

  if (!team) {
    const available = allTeams.map((candidate) => candidate.slug).join(", ")
    throw new Error(`Could not find Vercel team "${input}". Available teams: ${available}`)
  }

  return team
}

async function resolveProject(token: string, team: VercelTeam, input: string): Promise<VercelProject> {
  const fetchedProjects = await fetchProjects(token, team, input.startsWith("prj_") ? undefined : input)
  const normalizedInput = input.toLowerCase()
  const project =
    fetchedProjects.find((candidate) => candidate.id?.toLowerCase() === normalizedInput) ||
    fetchedProjects.find((candidate) => candidate.name?.toLowerCase() === normalizedInput)

  if (!project?.id || !project.name) {
    const available = fetchedProjects
      .filter((candidate) => candidate.name && !isSkillRunnerWorkerProject(candidate.name))
      .slice(0, 10)
      .map((candidate) => candidate.name)
      .join(", ")
    throw new Error(
      `Could not find Vercel project "${input}" in ${team.slug}.${available ? ` Nearby projects: ${available}` : ""}`
    )
  }

  if (isSkillRunnerWorkerProject(project.name)) {
    throw new Error("The d3k-skill-runner project cannot be used as the scan target.")
  }

  return project
}

async function fetchProjects(token: string, team: VercelTeam, search?: string): Promise<VercelProject[]> {
  const projects: VercelProject[] = []
  let until: string | null = null

  for (let page = 0; page < 20; page++) {
    const apiUrl = new URL("https://api.vercel.com/v9/projects")
    if (!team.isPersonal) {
      apiUrl.searchParams.set("teamId", team.id)
    }
    if (search) {
      apiUrl.searchParams.set("search", search)
    }
    apiUrl.searchParams.set("limit", "100")
    if (until) {
      apiUrl.searchParams.set("until", until)
    }

    const data = await fetchJson<VercelProjectsResponse>(apiUrl.toString(), {
      headers: authorizationHeaders(token)
    })
    const pageProjects = Array.isArray(data.projects) ? data.projects : []
    projects.push(...pageProjects)

    const nextCursor = data.pagination?.next
    if (!nextCursor || pageProjects.length === 0) {
      break
    }

    until = String(nextCursor)
  }

  return projects
}

function getProjectGitHubRepo(project: VercelProject): { owner: string; repo: string } | null {
  const linkedOwner = project.link?.org?.trim()
  const linkedRepo = project.link?.repo?.trim()
  if (linkedOwner && linkedRepo) {
    return { owner: linkedOwner, repo: linkedRepo }
  }

  const deploymentWithGitHubMeta = project.latestDeployments?.find(
    (deployment) => deployment.meta?.githubOrg?.trim() && deployment.meta?.githubRepo?.trim()
  )
  const metaOwner = deploymentWithGitHubMeta?.meta?.githubOrg?.trim()
  const metaRepo = deploymentWithGitHubMeta?.meta?.githubRepo?.trim()
  return metaOwner && metaRepo ? { owner: metaOwner, repo: metaRepo } : null
}

async function installWorkerProject(
  baseUrl: string,
  token: string,
  team: VercelTeam,
  options: RemoteSkillOptions
): Promise<void> {
  log(options, "Installing team skill runner project...")
  const response = await fetchJsonResponse<WorkerInstallResponse>(`${baseUrl}/api/skill-runner-teams/worker`, {
    method: "POST",
    headers: {
      ...authorizationHeaders(token),
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ team: team.id })
  })

  if (!response.ok || !response.data?.success) {
    throw new Error(response.data?.error || `Failed to install runner project (${response.status}).`)
  }

  const workerStatus = response.data.settings?.workerStatus
  const project = response.data.project
  const isReady =
    response.data.installed &&
    Boolean(project?.workerBaseUrl || response.data.settings?.workerBaseUrl) &&
    !project?.missingEnvKeys?.length &&
    project?.shellVersionStatus !== "outdated" &&
    workerStatus === "ready"

  if (!isReady) {
    const message =
      response.data.message ||
      `Runner project is not ready yet${workerStatus ? ` (status: ${workerStatus})` : ""}. Open the report link after setup completes, then retry.`
    throw new Error(message)
  }

  log(options, `${chalk.green("✓")} Team skill runner project is ready`)
}

async function startSkillRun(input: {
  baseUrl: string
  token: string
  user: VercelUser
  team: VercelTeam
  teamScope: string
  project: VercelProject
  githubRepo: { owner: string; repo: string }
  branch: string
  projectDir?: string
  productionUrl?: string
}): Promise<StartSkillRunResponse> {
  const response = await fetchJsonResponse<StartSkillRunResponse>(`${input.baseUrl}/api/cloud/start-fix`, {
    method: "POST",
    headers: {
      ...authorizationHeaders(input.token),
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      userId: input.user.id,
      skillRunnerId: "deepsec",
      skillRunnerTeam: {
        id: input.team.id,
        slug: input.team.slug,
        name: input.team.name,
        isPersonal: input.team.isPersonal
      },
      projectName: input.project.name,
      projectId: input.project.id,
      teamId: input.teamScope,
      projectDir: input.projectDir,
      repoUrl: `https://github.com/${input.githubRepo.owner}/${input.githubRepo.repo}`,
      repoOwner: input.githubRepo.owner,
      repoName: input.githubRepo.repo,
      repoBranch: input.branch,
      baseBranch: input.branch,
      submitPullRequest: true,
      productionUrl: input.productionUrl,
      useV0DevAgentRunner: true
    })
  })

  return {
    ...response.data,
    success: response.ok && response.data?.success === true
  }
}

async function waitForRun(
  baseUrl: string,
  userId: string,
  runId: string,
  options: RemoteSkillOptions
): Promise<WorkflowRun> {
  log(options, "Waiting for run to finish...")

  for (let attempt = 0; attempt < 720; attempt++) {
    const run = await fetchRun(baseUrl, userId, runId)
    if (run?.status && run.status !== "running") {
      return run
    }

    await new Promise((resolve) => setTimeout(resolve, 5000))
  }

  throw new Error("Timed out waiting for DeepSec run to finish.")
}

async function fetchRun(baseUrl: string, userId: string, runId: string): Promise<WorkflowRun | null> {
  const apiUrl = new URL(`${baseUrl}/api/dev-agents/runs`)
  apiUrl.searchParams.set("userId", userId)
  const data = await fetchJson<{ success?: boolean; runs?: WorkflowRun[] }>(apiUrl.toString())
  const runs = Array.isArray(data.runs) ? data.runs : []
  return runs.find((run) => run.id === runId) || null
}

function formatRunCompletion(run: WorkflowRun, reportUrl: string): string {
  const status = run.status || "unknown"
  const cost = run.formattedCost || formatCost(run.cost ?? run.totalCost)
  const duration = run.duration ? `, ${run.duration}` : ""
  const costText = cost ? `, ${cost}` : ""
  const errorText = run.error ? `\n${chalk.red(run.error)}` : ""
  return `${chalk.bold("Run finished:")} ${status}${duration}${costText}\n${chalk.bold("Report:")} ${reportUrl}${errorText}`
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetchJsonResponse<T>(url, init)
  if (!response.ok) {
    throw new Error(formatFetchError(url, response.status, response.data))
  }
  return response.data
}

async function fetchJsonResponse<T>(
  url: string,
  init?: RequestInit
): Promise<{
  ok: boolean
  status: number
  data: T
}> {
  const response = await fetch(url, init)
  const text = await response.text()
  let data: unknown = null

  if (text.trim()) {
    try {
      data = JSON.parse(text)
    } catch {
      throw new Error(`${url} returned invalid JSON: ${text.slice(0, 300)}`)
    }
  }

  return {
    ok: response.ok,
    status: response.status,
    data: data as T
  }
}

function formatFetchError(url: string, status: number, data: unknown): string {
  const error = typeof data === "object" && data !== null ? (data as Record<string, unknown>).error : undefined
  const message =
    typeof error === "object" && error !== null
      ? stringValue((error as Record<string, unknown>).message)
      : stringValue(error) ||
        (typeof data === "object" && data !== null ? stringValue((data as Record<string, unknown>).message) : "")

  let hostname = ""
  try {
    hostname = new URL(url).hostname
  } catch {
    hostname = ""
  }

  if (hostname === "api.vercel.com" && status === 401) {
    return "Vercel authentication failed. Run `vercel login`, or set VERCEL_TOKEN to a token that can access the target team."
  }

  if (hostname === "api.vercel.com" && status === 403) {
    return `Vercel API access was denied${message ? `: ${message}` : "."} Re-authenticate with \`vercel login\`; for SAML teams, re-authenticate that scope in the Vercel CLI, then retry.`
  }

  return `${url} failed (${status})${message ? `: ${message}` : ""}`
}

function authorizationHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`
  }
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "")
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined
}

function isSkillRunnerWorkerProject(name: string): boolean {
  const normalizedName = name.trim().toLowerCase()
  return normalizedName === "d3k-skill-runner" || normalizedName.startsWith("d3k-skill-runner-")
}

function formatCost(value: string | number | null | undefined): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return `$${value.toFixed(2)}`
  }

  if (typeof value !== "string") {
    return null
  }

  const parsed = Number(value.replace(/[^0-9.]/g, ""))
  if (!Number.isFinite(parsed)) {
    return value
  }

  return `$${parsed.toFixed(2)}`
}

function log(options: RemoteSkillOptions, message: string): void {
  if (!options.json) {
    console.log(message)
  }
}
