import chalk from "chalk"
import { existsSync, readFileSync } from "fs"
import ora, { type Ora } from "ora"
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
  yes?: boolean
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

export interface WorkerInstallResponse {
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

interface WorkerInstallStreamProgress {
  type: "progress"
  phase?: string
  message?: string
  elapsedMs?: number
}

interface WorkerInstallStreamResult {
  type: "result" | "error"
  status?: number
  data?: WorkerInstallResponse
}

type WorkerInstallStreamEvent = WorkerInstallStreamProgress | WorkerInstallStreamResult

interface SkillRunnerResolveResponse {
  success?: boolean
  error?: string
  exactMatch?: {
    id: string
    name: string
    canonicalPath?: string
    sourceUrl?: string
  } | null
  candidates?: SkillRunnerCandidate[]
}

interface SkillRunnerCandidate {
  canonicalPath: string
  installArg: string
  packageName?: string
  skillName: string
  displayName: string
  sourceUrl: string
  installsLabel?: string
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
const REMOTE_SKILL_OPTIONS = ["team", "project", "branch", "projectDir", "baseUrl", "wait", "json", "yes"]

export function shouldUseRemoteSkillRunner(name: string | undefined, options: RemoteSkillOptions): boolean {
  if (!name?.trim()) return false

  const hasExplicitRunOption =
    REMOTE_SKILL_OPTIONS.some((option) => Boolean(options[option as keyof RemoteSkillOptions])) ||
    options.install === false

  if (hasExplicitRunOption) {
    return true
  }

  try {
    return Boolean(findLinkedVercelProject())
  } catch {
    return true
  }
}

export async function runRemoteSkillCommand(name: string | undefined, options: RemoteSkillOptions): Promise<void> {
  const requestedSkillRunnerId = name?.trim()
  if (!requestedSkillRunnerId) {
    throw new Error(
      "A skill name is required. Example: d3k skill vercel-optimize --team elsigh-pro --project cranio-mom"
    )
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
  log(options, `Preparing ${chalk.bold(requestedSkillRunnerId)} on ${chalk.bold(projectInput)}...`)
  if (linkedProject && (!options.team || !options.project)) {
    log(options, `${chalk.green("✓")} Inferred Vercel project link from ${linkedProject.path}`)
  }

  const [user, teams] = await Promise.all([fetchVercelUser(token), fetchVercelTeams(token)])
  const team = resolveTeam(teamInput, user, teams)
  const project = await resolveProject(token, team, projectInput)
  const githubRepo = getProjectGitHubRepo(project)

  if (!githubRepo) {
    throw new Error(
      `Project ${project.name} is not connected to a GitHub repository. Remote skill runs require a GitHub-backed Vercel project.`
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

  const skillRunnerId = await resolveSkillRunnerSelection({
    baseUrl,
    token,
    team,
    requestedSkillRunnerId,
    options
  })
  log(options, `${chalk.green("✓")} Skill: ${skillRunnerId}`)

  if (options.install !== false) {
    await ensureWorkerProjectReady(baseUrl, token, team, options)
  }

  const startRunSpinner = startSpinner(options, "Starting run...")
  let startResult: StartSkillRunResponse
  try {
    startResult = await startSkillRun({
      baseUrl,
      token,
      user,
      skillRunnerId,
      team,
      teamScope,
      project,
      githubRepo,
      branch,
      projectDir,
      productionUrl
    })
  } catch (error) {
    startRunSpinner?.fail("Failed to start run")
    throw error
  }

  if (startResult.code === "runner_setup_required" && options.install !== false) {
    startRunSpinner?.stop()
    await confirmWorkerProjectInstall(team, "Team skill runner project needs setup before this run can start.", options)
    await installWorkerProject(baseUrl, token, team, options)
    const retryStartRunSpinner = startSpinner(options, "Starting run...")
    try {
      startResult = await startSkillRun({
        baseUrl,
        token,
        user,
        skillRunnerId,
        team,
        teamScope,
        project,
        githubRepo,
        branch,
        projectDir,
        productionUrl
      })
    } catch (error) {
      retryStartRunSpinner?.fail("Failed to start run")
      throw error
    }
    if (startResult.success && startResult.runId) {
      retryStartRunSpinner?.stop()
    } else {
      retryStartRunSpinner?.fail("Failed to start run")
    }
  } else if (startResult.success && startResult.runId) {
    startRunSpinner?.stop()
  } else {
    startRunSpinner?.fail("Failed to start run")
  }

  if (!startResult.success || !startResult.runId) {
    const error = startResult.error || "Failed to start DeepSec run."
    throw new Error(error)
  }

  const reportUrl = `${reportBasePath}/${encodeURIComponent(startResult.runId)}/report`
  const output = {
    success: true,
    skill: skillRunnerId,
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

async function resolveSkillRunnerSelection(input: {
  baseUrl: string
  token: string
  team: VercelTeam
  requestedSkillRunnerId: string
  options: RemoteSkillOptions
}): Promise<string> {
  const url = new URL(`${input.baseUrl}/api/skill-runners/resolve`)
  url.searchParams.set("team", input.team.id)
  url.searchParams.set("q", input.requestedSkillRunnerId)

  const response = await fetchJsonResponse<SkillRunnerResolveResponse>(url.toString(), {
    headers: authorizationHeaders(input.token)
  })

  if (!response.ok || !response.data.success) {
    throw new Error(response.data.error || `Failed to resolve skill runner (${response.status}).`)
  }

  if (response.data.exactMatch?.id) {
    return response.data.exactMatch.id
  }

  const candidates = response.data.candidates || []
  if (candidates.length === 0) {
    throw new Error(
      `No existing skill runner or skills.sh match found for "${input.requestedSkillRunnerId}". Try the full skills.sh path, for example owner/repo/skill-name.`
    )
  }

  const selected = await confirmSkillRunnerCandidate(input.requestedSkillRunnerId, candidates, input.options)
  return selected.canonicalPath
}

async function confirmSkillRunnerCandidate(
  requestedSkillRunnerId: string,
  candidates: SkillRunnerCandidate[],
  options: RemoteSkillOptions
): Promise<SkillRunnerCandidate> {
  if (options.yes) {
    if (candidates.length === 1) {
      const [candidate] = candidates
      log(options, `${chalk.green("✓")} Matched skills.sh skill: ${candidate.displayName} (${candidate.sourceUrl})`)
      return candidate
    }

    throw new Error(formatSkillRunnerCandidateRequiredMessage(requestedSkillRunnerId, candidates))
  }

  if (options.json || !process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(formatSkillRunnerCandidateRequiredMessage(requestedSkillRunnerId, candidates))
  }

  if (candidates.length === 1) {
    const [candidate] = candidates
    console.log(`\n${chalk.bold("Found a skills.sh match for")} ${chalk.cyan(requestedSkillRunnerId)}:`)
    printSkillRunnerCandidate(candidate)
    const answer = await promptLine("Run this skill? [y/N] ")
    if (isYesAnswer(answer)) {
      return candidate
    }
    throw new Error("Cancelled skill run.")
  }

  console.log(`\n${chalk.bold("Found multiple skills.sh matches for")} ${chalk.cyan(requestedSkillRunnerId)}:`)
  candidates.forEach((candidate, index) => {
    printSkillRunnerCandidate(candidate, index + 1)
  })

  for (;;) {
    const answer = await promptLine(`Select a skill to run [1-${candidates.length}] or q: `)
    if (/^(q|quit|cancel)$/i.test(answer)) {
      throw new Error("Cancelled skill run.")
    }

    const selectedIndex = Number(answer)
    if (Number.isInteger(selectedIndex) && selectedIndex >= 1 && selectedIndex <= candidates.length) {
      return candidates[selectedIndex - 1]
    }

    console.log(chalk.yellow(`Enter a number from 1 to ${candidates.length}, or q to cancel.`))
  }
}

function printSkillRunnerCandidate(candidate: SkillRunnerCandidate, index?: number): void {
  const prefix = typeof index === "number" ? `${index}. ` : "  "
  console.log(`${prefix}${chalk.bold(candidate.displayName)}`)
  console.log(`   ${chalk.gray(candidate.sourceUrl)}`)
  console.log(`   ${chalk.gray(`install: ${candidate.installArg}`)}`)
  if (candidate.installsLabel) {
    console.log(`   ${chalk.gray(candidate.installsLabel)}`)
  }
}

function formatSkillRunnerCandidateRequiredMessage(
  requestedSkillRunnerId: string,
  candidates: SkillRunnerCandidate[]
): string {
  const choices = candidates
    .slice(0, 5)
    .map((candidate) => `${candidate.displayName} (${candidate.sourceUrl})`)
    .join("; ")
  const suffix =
    candidates.length === 1
      ? "Re-run with the full skill path or pass --yes to accept this single match."
      : "Re-run with the full skill path for the skill you want."
  return `Skill "${requestedSkillRunnerId}" does not exactly match an existing team skill runner. Candidate${
    candidates.length === 1 ? "" : "s"
  }: ${choices}. ${suffix}`
}

async function promptLine(question: string): Promise<string> {
  const { createInterface } = await import("readline/promises")
  const readline = createInterface({
    input: process.stdin,
    output: process.stdout
  })

  try {
    return (await readline.question(question)).trim()
  } finally {
    readline.close()
  }
}

function isYesAnswer(value: string): boolean {
  return /^(y|yes)$/i.test(value.trim())
}

function isNoAnswer(value: string): boolean {
  return /^(n|no)$/i.test(value.trim())
}

function isDefaultYesAnswer(value: string): boolean {
  const trimmed = value.trim()
  return trimmed.length === 0 || isYesAnswer(trimmed)
}

export function getWorkerProjectSetupExplanation(teamName: string): string[] {
  return [
    `d3k-skill-runner creates a small runner project in ${teamName}. Skill runs execute there so compute, AI Gateway usage, deployments, and runtime logs belong to the team running the scan.`,
    "For first-time setup, choose all projects in this team when Vercel asks for project access. Single-project grants cannot include the new runner project."
  ]
}

export interface WorkerReadiness {
  ready: boolean
  message: string
}

export function getWorkerProjectReadiness(response: WorkerInstallResponse): WorkerReadiness {
  const workerStatus = response.settings?.workerStatus
  const project = response.project
  const workerBaseUrl = project?.workerBaseUrl || response.settings?.workerBaseUrl

  if (!response.installed) {
    return {
      ready: false,
      message: response.message || "Team skill runner project is not installed yet."
    }
  }

  if (project?.missingEnvKeys?.length) {
    return {
      ready: false,
      message: `Team skill runner project is missing required environment variables: ${project.missingEnvKeys.join(", ")}.`
    }
  }

  if (project?.shellVersionStatus === "outdated" || workerStatus === "outdated") {
    return {
      ready: false,
      message: "Team skill runner project needs an update before this run can start."
    }
  }

  if (!workerBaseUrl || workerStatus === "provisioning") {
    return {
      ready: false,
      message: "Team skill runner project exists, but its deployment is not ready yet."
    }
  }

  if (workerStatus === "error") {
    return {
      ready: false,
      message: "Team skill runner project exists, but its latest deployment failed."
    }
  }

  return {
    ready: workerStatus === "ready",
    message:
      workerStatus === "ready"
        ? "Team skill runner project is ready."
        : `Team skill runner project is not ready yet${workerStatus ? ` (status: ${workerStatus})` : ""}.`
  }
}

async function confirmWorkerProjectInstall(
  team: VercelTeam,
  reason: string,
  options: RemoteSkillOptions
): Promise<void> {
  const explanation = getWorkerProjectSetupExplanation(team.name)
  if (options.yes) {
    log(options, `${chalk.yellow("!")} ${reason}`)
    for (const line of explanation) {
      log(options, chalk.gray(line))
    }
    return
  }

  const message = `Install or repair d3k-skill-runner in ${team.name} now?`

  if (options.json || !process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(
      `${reason}\n${explanation.join("\n")}\n${message} Re-run with --yes to approve runner project setup.`
    )
  }

  console.log(`\n${chalk.bold("Team skill runner setup required")}`)
  console.log(reason)
  for (const line of explanation) {
    console.log(chalk.gray(line))
  }
  const answer = await promptLine(`Install or repair d3k-skill-runner in ${team.name}? [Y/n] `)
  if (isNoAnswer(answer) || !isDefaultYesAnswer(answer)) {
    throw new Error("Cancelled skill run.")
  }
}

async function validateWorkerProject(baseUrl: string, token: string, team: VercelTeam): Promise<WorkerInstallResponse> {
  const url = new URL(`${baseUrl}/api/skill-runner-teams/worker`)
  url.searchParams.set("team", team.id)
  const response = await fetchJsonResponse<WorkerInstallResponse>(url.toString(), {
    headers: authorizationHeaders(token)
  })

  if (!response.ok || !response.data?.success) {
    throw new Error(response.data?.error || `Failed to validate runner project (${response.status}).`)
  }

  return response.data
}

async function ensureWorkerProjectReady(
  baseUrl: string,
  token: string,
  team: VercelTeam,
  options: RemoteSkillOptions
): Promise<void> {
  const validationSpinner = startSpinner(options, "Checking team skill runner project...")
  let validation: WorkerInstallResponse
  try {
    validation = await validateWorkerProject(baseUrl, token, team)
  } catch (error) {
    validationSpinner?.fail("Failed to check team skill runner project")
    throw error
  }

  const readiness = getWorkerProjectReadiness(validation)
  if (readiness.ready) {
    validationSpinner?.stop()
    log(options, `${chalk.green("✓")} Team skill runner project is ready`)
    return
  }

  validationSpinner?.stop()
  await confirmWorkerProjectInstall(team, readiness.message, options)
  await installWorkerProject(baseUrl, token, team, options)
}

async function installWorkerProject(
  baseUrl: string,
  token: string,
  team: VercelTeam,
  options: RemoteSkillOptions
): Promise<void> {
  const installSpinner = startSpinner(options, "Installing team skill runner project...")
  if (!installSpinner) {
    log(options, "Installing team skill runner project...")
  }

  let response: { ok: boolean; status: number; data: WorkerInstallResponse }
  try {
    response = options.json
      ? await installWorkerProjectJson(baseUrl, token, team)
      : await installWorkerProjectStream(baseUrl, token, team, options, installSpinner)
  } catch (error) {
    installSpinner?.fail("Failed to install team skill runner project")
    throw error
  }

  if (!response.ok || !response.data?.success) {
    installSpinner?.fail("Failed to install team skill runner project")
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
    installSpinner?.fail("Team skill runner project is not ready")
    throw new Error(message)
  }

  if (installSpinner) {
    installSpinner.succeed("Team skill runner project is ready")
  } else {
    log(options, `${chalk.green("✓")} Team skill runner project is ready`)
  }
}

async function installWorkerProjectJson(
  baseUrl: string,
  token: string,
  team: VercelTeam
): Promise<{ ok: boolean; status: number; data: WorkerInstallResponse }> {
  return fetchJsonResponse<WorkerInstallResponse>(`${baseUrl}/api/skill-runner-teams/worker`, {
    method: "POST",
    headers: {
      ...authorizationHeaders(token),
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ team: team.id })
  })
}

async function installWorkerProjectStream(
  baseUrl: string,
  token: string,
  team: VercelTeam,
  options: RemoteSkillOptions,
  installSpinner: Ora | null
): Promise<{ ok: boolean; status: number; data: WorkerInstallResponse }> {
  const response = await fetch(`${baseUrl}/api/skill-runner-teams/worker?stream=1`, {
    method: "POST",
    headers: {
      ...authorizationHeaders(token),
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ team: team.id })
  })

  if (!response.body || !response.headers.get("content-type")?.includes("application/x-ndjson")) {
    const text = await response.text()
    let data: WorkerInstallResponse
    try {
      data = text.trim() ? (JSON.parse(text) as WorkerInstallResponse) : {}
    } catch {
      data = {
        success: false,
        error: `Runner install returned an unexpected response (${response.status}): ${text.slice(0, 300)}`
      }
    }
    return {
      ok: response.ok,
      status: response.status,
      data
    }
  }

  const decoder = new TextDecoder()
  const reader = response.body.getReader()
  let buffer = ""
  let finalResponse: { ok: boolean; status: number; data: WorkerInstallResponse } | null = null

  for (;;) {
    const { done, value } = await reader.read()
    if (value) {
      buffer += decoder.decode(value, { stream: !done })
      const lines = buffer.split("\n")
      buffer = lines.pop() || ""
      for (const line of lines) {
        const event = parseWorkerInstallStreamEvent(line)
        if (!event) continue
        if (event.type === "progress") {
          const message = event.message?.trim()
          if (message) {
            if (installSpinner) {
              installSpinner.text = message
            } else {
              log(options, message)
            }
          }
          continue
        }
        finalResponse = {
          ok: event.type === "result" && response.ok,
          status: event.status || response.status,
          data: event.data || {}
        }
      }
    }
    if (done) break
  }

  const trailingEvent = parseWorkerInstallStreamEvent(buffer)
  if (trailingEvent?.type === "result" || trailingEvent?.type === "error") {
    finalResponse = {
      ok: trailingEvent.type === "result" && response.ok,
      status: trailingEvent.status || response.status,
      data: trailingEvent.data || {}
    }
  }

  return (
    finalResponse || {
      ok: false,
      status: response.status,
      data: {
        success: false,
        error: "Runner install stream ended before returning a result."
      }
    }
  )
}

function parseWorkerInstallStreamEvent(line: string): WorkerInstallStreamEvent | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  try {
    const parsed = JSON.parse(trimmed) as Partial<WorkerInstallStreamEvent>
    if (parsed.type === "progress" || parsed.type === "result" || parsed.type === "error") {
      return parsed as WorkerInstallStreamEvent
    }
  } catch {
    return null
  }
  return null
}

async function startSkillRun(input: {
  baseUrl: string
  token: string
  user: VercelUser
  skillRunnerId: string
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
      skillRunnerId: input.skillRunnerId,
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

function startSpinner(options: RemoteSkillOptions, message: string): Ora | null {
  if (options.json || !process.stderr.isTTY) {
    return null
  }

  return ora({
    text: message,
    spinner: "dots",
    stream: process.stderr
  }).start()
}
