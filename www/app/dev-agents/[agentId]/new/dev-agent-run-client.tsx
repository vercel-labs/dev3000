"use client"

import { AlertCircle, ArrowRight, CheckCircle2, ExternalLink, Loader2, Plus, Search, Share2, X } from "lucide-react"
import { usePathname, useSearchParams } from "next/navigation"
import { useEffect, useId, useMemo, useState } from "react"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import type { DevAgent, DevAgentTeam } from "@/lib/dev-agents-client"
import {
  SKILL_RUNNER_WORKER_PROJECT_NAME,
  type SkillRunnerExecutionMode,
  type SkillRunnerWorkerStatus
} from "@/lib/skill-runner-config"

interface UserInfo {
  id: string
  email: string
  name: string
  username: string
}

interface Project {
  id: string
  name: string
  framework: string | null
  rootDirectory?: string | null
  createdAt?: number | string | null
  updatedAt?: number | string | null
  link: {
    type: string
    repo: string
    repoId: number
    org: string
  } | null
  latestDeployments: Array<{
    id: string
    url: string
    state: string
    readyState: string
    createdAt: number
    gitSource: {
      type: string
      repoId: number
      ref: string
      sha: string
      message: string
    } | null
    meta: {
      githubOrg: string
      githubRepo: string
    } | null
  }>
}

type RepoVisibility = "unknown" | "checking" | "public" | "private_or_unknown"

const PROJECT_NAME_COLLATOR = new Intl.Collator("en", { sensitivity: "base" })

interface MarketplaceStats {
  projectRuns: string
  successRate: string
  mergeRate: string
  tokensUsed: string
  avgTime: string
  avgCost: string
  estCost: string
  previouslyPurchased: boolean
}

interface RunStats {
  runCount: number
  avgCost?: string
}

interface DevAgentRunClientProps {
  devAgent: DevAgent
  ownerName: string
  team: DevAgentTeam
  user: UserInfo
  defaultUseV0DevAgentRunner: boolean
  marketplaceStats?: MarketplaceStats
  runStats?: RunStats
  runnerKind?: "dev-agent" | "skill-runner"
  skillRunnerExecutionMode?: SkillRunnerExecutionMode
  skillRunnerWorkerBaseUrl?: string
  skillRunnerWorkerStatus?: SkillRunnerWorkerStatus
}

interface RunnerValidationResult {
  installed: boolean
  expectedProjectName: string
  message?: string
  project?: {
    projectId: string
    projectName: string
    workerBaseUrl?: string
    dashboardUrl?: string
    missingEnvKeys?: string[]
    shellVersionStatus?: "current" | "outdated" | "unknown"
    desiredWorkerGitSha?: string
    workerShellVersion?: string
  }
  settings?: {
    executionMode?: SkillRunnerExecutionMode
    workerBaseUrl?: string
    workerProjectId?: string
    workerStatus?: SkillRunnerWorkerStatus
  }
}

type WorkerSetupErrorCode =
  | "github_integration_required"
  | "initial_deployment_missing"
  | "blob_store_limit_reached"
  | "project_env_vars_forbidden"
  | "unknown"

interface WorkerSetupErrorState {
  message: string
  code?: WorkerSetupErrorCode
  actionLabel?: string
  actionUrl?: string
  repo?: string
}

const RUNNER_ENV_VARS_STORAGE_KEY = "d3k_runner_env_vars"

type RunnerEnvVarKind = "github-pat" | "npm-token" | "custom"

interface RunnerEnvVar {
  id: string
  kind: RunnerEnvVarKind
  name: string
  value: string
}

function createRunnerEnvVar(kind: RunnerEnvVarKind): RunnerEnvVar {
  return {
    id: crypto.randomUUID(),
    kind,
    name: kind === "github-pat" ? "GITHUB_PAT" : kind === "npm-token" ? "NPM_TOKEN" : "",
    value: ""
  }
}

function toTimestampMs(value: number | string | null | undefined): number {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value <= 0) return 0
    return value < 10_000_000_000 ? value * 1000 : value
  }

  if (typeof value !== "string") return 0

  const trimmed = value.trim()
  if (!trimmed) return 0
  const numericValue = Number(trimmed)
  if (Number.isFinite(numericValue)) {
    return toTimestampMs(numericValue)
  }

  const parsed = Date.parse(trimmed)
  return Number.isFinite(parsed) ? parsed : 0
}

function getProjectLastActivityMs(project: Project): number {
  const latestDeploymentActivity = project.latestDeployments.reduce(
    (latest, deployment) => Math.max(latest, toTimestampMs(deployment.createdAt)),
    0
  )
  return Math.max(toTimestampMs(project.updatedAt), latestDeploymentActivity, toTimestampMs(project.createdAt))
}

function getProjectVisibilityRank(project: Project, repoVisibilities: Map<string, RepoVisibility>): number {
  const visibility = repoVisibilities.get(project.id)
  if (visibility === "public") return 0
  return 1
}

function sortProjectsForPicker(projects: Project[], repoVisibilities: Map<string, RepoVisibility>): Project[] {
  return [...projects].sort((a, b) => {
    const visibilityDelta =
      getProjectVisibilityRank(a, repoVisibilities) - getProjectVisibilityRank(b, repoVisibilities)
    if (visibilityDelta !== 0) return visibilityDelta

    const activityDelta = getProjectLastActivityMs(b) - getProjectLastActivityMs(a)
    if (activityDelta !== 0) return activityDelta

    return PROJECT_NAME_COLLATOR.compare(a.name, b.name)
  })
}

function VercelTriangle({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" fill="currentColor" viewBox="0 0 75 65" className={className}>
      <path d="M37.59.25l36.95 64H.64l36.95-64z" />
    </svg>
  )
}

function formatExecutionMode(mode: DevAgent["executionMode"]): string {
  return mode === "dev-server" ? "Dev Server" : "Preview + PR"
}

function isSkillRunnerWorkerProject(project: Pick<Project, "name">): boolean {
  const normalizedName = project.name.trim().toLowerCase()
  return (
    normalizedName === SKILL_RUNNER_WORKER_PROJECT_NAME ||
    normalizedName.startsWith(`${SKILL_RUNNER_WORKER_PROJECT_NAME}-`)
  )
}

function getProjectGitHubRepo(project: Project): { owner: string; repo: string } | null {
  const linkedOwner = project.link?.org?.trim()
  const linkedRepo = project.link?.repo?.trim()
  if (linkedOwner && linkedRepo) {
    return { owner: linkedOwner, repo: linkedRepo }
  }

  const deploymentWithGitHubMeta = project.latestDeployments.find(
    (deployment) => deployment.meta?.githubOrg?.trim() && deployment.meta?.githubRepo?.trim()
  )
  const metaOwner = deploymentWithGitHubMeta?.meta?.githubOrg?.trim()
  const metaRepo = deploymentWithGitHubMeta?.meta?.githubRepo?.trim()
  return metaOwner && metaRepo ? { owner: metaOwner, repo: metaRepo } : null
}

function isSelectableProject(
  project: Project,
  options: { runnerKind: "dev-agent" | "skill-runner"; requiresGitHubBackedProject: boolean }
): boolean {
  if (options.runnerKind === "skill-runner" && isSkillRunnerWorkerProject(project)) {
    return false
  }

  if (options.requiresGitHubBackedProject && !getProjectGitHubRepo(project)) {
    return false
  }

  return true
}

function DevAgentCriteriaSummary({ devAgent, hideEarlyExit = false }: { devAgent: DevAgent; hideEarlyExit?: boolean }) {
  const successEvalText = devAgent.successEval?.trim() || "None"
  const earlyExitText = devAgent.earlyExitEval?.trim() || "None"

  return (
    <div className="border-t border-[#1f1f1f] px-4 py-3">
      <div className={`grid gap-3 ${hideEarlyExit ? "" : "sm:grid-cols-2"}`}>
        <div>
          <div className="text-[11px] uppercase tracking-wider text-[#555]">Success Eval</div>
          <div className="mt-1 text-[13px] leading-[18px] text-[#888]">{successEvalText}</div>
        </div>
        {!hideEarlyExit ? (
          <div>
            <div className="text-[11px] uppercase tracking-wider text-[#555]">Early Exit</div>
            <div className="mt-1 text-[13px] leading-[18px] text-[#888]">{earlyExitText}</div>
          </div>
        ) : null}
      </div>
    </div>
  )
}

export default function DevAgentRunClient({
  devAgent,
  ownerName,
  team,
  user,
  defaultUseV0DevAgentRunner,
  marketplaceStats,
  runStats,
  runnerKind = "dev-agent",
  skillRunnerExecutionMode = "self-hosted",
  skillRunnerWorkerBaseUrl,
  skillRunnerWorkerStatus
}: DevAgentRunClientProps) {
  const projectSearchId = useId()
  const startPathId = useId()
  const projectDirectoryId = useId()
  const customPromptId = useId()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [projects, setProjects] = useState<Project[]>([])
  const [projectsLoading, setProjectsLoading] = useState(false)
  const [projectSearch, setProjectSearch] = useState("")
  const [selectedProjectId, setSelectedProjectId] = useState(() => searchParams?.get("project") ?? "")
  const [selectedProjectFallback, setSelectedProjectFallback] = useState<Project | null>(null)
  const [availableBranches, setAvailableBranches] = useState<Array<{ name: string; lastDeployment?: { url: string } }>>(
    []
  )
  const [branchesLoading, setBranchesLoading] = useState(false)
  const [baseBranch, setBaseBranch] = useState("main")
  const [startPath, setStartPath] = useState("/")
  const [projectDirectory, setProjectDirectory] = useState("")
  const [customPrompt, setCustomPrompt] = useState("")
  const [runnerEnvVars, setRunnerEnvVars] = useState<RunnerEnvVar[]>([])
  const [repoVisibility, setRepoVisibility] = useState<RepoVisibility>("unknown")
  const [error, setError] = useState<string | null>(null)
  const [isRunning, setIsRunning] = useState(false)
  const [localSkillRunnerExecutionMode, setLocalSkillRunnerExecutionMode] =
    useState<SkillRunnerExecutionMode>(skillRunnerExecutionMode)
  const [localSkillRunnerWorkerBaseUrl, setLocalSkillRunnerWorkerBaseUrl] = useState(skillRunnerWorkerBaseUrl)
  const [localSkillRunnerWorkerStatus, setLocalSkillRunnerWorkerStatus] = useState(skillRunnerWorkerStatus)
  const [isWorkerSetupOpen, setIsWorkerSetupOpen] = useState(false)
  const [isCheckingWorker, setIsCheckingWorker] = useState(false)
  const [isInstallingWorker, setIsInstallingWorker] = useState(false)
  const [workerSetupError, setWorkerSetupError] = useState<WorkerSetupErrorState | null>(null)
  const [workerSetupResult, setWorkerSetupResult] = useState<RunnerValidationResult | null>(null)
  const [didOpenWorkerSetupAction, setDidOpenWorkerSetupAction] = useState(false)
  const [shouldStartAfterWorkerSetup, setShouldStartAfterWorkerSetup] = useState(false)
  const [shareCopied, setShareCopied] = useState(false)

  const [repoVisibilities, setRepoVisibilities] = useState<Map<string, RepoVisibility>>(new Map())

  const selectedTeam = team
  const requiresGitHubBackedProject = devAgent.legacyWorkflowType === "deepsec-security-scan"
  const selectableProjects = useMemo(() => {
    const selectableProjects = projects.filter((project) =>
      isSelectableProject(project, { runnerKind, requiresGitHubBackedProject })
    )
    if (
      !selectedProjectFallback ||
      !isSelectableProject(selectedProjectFallback, { runnerKind, requiresGitHubBackedProject }) ||
      selectableProjects.some((project) => project.id === selectedProjectFallback.id)
    ) {
      return selectableProjects
    }
    return [selectedProjectFallback, ...selectableProjects]
  }, [projects, requiresGitHubBackedProject, runnerKind, selectedProjectFallback])
  const allProjects = useMemo(
    () => sortProjectsForPicker(selectableProjects, repoVisibilities),
    [repoVisibilities, selectableProjects]
  )
  const filteredProjects = useMemo(() => {
    const query = projectSearch.trim().toLowerCase()
    if (!query) return allProjects
    return allProjects.filter((project) => project.name.toLowerCase().includes(query))
  }, [allProjects, projectSearch])
  const selectedProject = useMemo(
    () => allProjects.find((project) => project.id === selectedProjectId) || null,
    [allProjects, selectedProjectId]
  )
  const selectedProjectListVisibility = selectedProjectId ? repoVisibilities.get(selectedProjectId) : undefined
  const selectedProjectGitHubRepo = selectedProject ? getProjectGitHubRepo(selectedProject) : null
  const selectedRepoOwner = selectedProjectGitHubRepo?.owner
  const selectedRepoName = selectedProjectGitHubRepo?.repo
  const hasGitHubRepoInfo = Boolean(selectedRepoOwner && selectedRepoName)
  const effectiveRepoVisibility = selectedProjectListVisibility ?? repoVisibility
  const githubPatEnvVar = runnerEnvVars.find(
    (envVar) => envVar.kind === "github-pat" || envVar.name.trim().toUpperCase() === "GITHUB_PAT"
  )
  const npmTokenEnvVar = runnerEnvVars.find((envVar) => {
    const normalizedName = envVar.name.trim().toUpperCase()
    return envVar.kind === "npm-token" || normalizedName === "NPM_TOKEN" || normalizedName === "NODE_AUTH_TOKEN"
  })
  const requiresGitHubPatForRepoAccess =
    !defaultUseV0DevAgentRunner &&
    hasGitHubRepoInfo &&
    effectiveRepoVisibility === "private_or_unknown" &&
    !githubPatEnvVar?.value.trim()
  const runnerLabel = runnerKind === "skill-runner" ? "skill runner" : "dev agent"
  const displayedRunCount = runStats?.runCount ?? devAgent.usageCount
  const displayedAvgCost = runStats?.avgCost ?? devAgent.avgCost
  const sharePath =
    runnerKind === "skill-runner" && devAgent.runnerSourceKind === "default" ? `/skill-runner/${devAgent.id}` : null
  const isSelfHostedSkillRunner = runnerKind === "skill-runner" && localSkillRunnerExecutionMode === "self-hosted"
  const isReadySelfHostedSkillRunner =
    isSelfHostedSkillRunner && Boolean(localSkillRunnerWorkerBaseUrl) && localSkillRunnerWorkerStatus === "ready"

  async function copyShareLink() {
    if (!sharePath) return

    try {
      await navigator.clipboard.writeText(new URL(sharePath, window.location.origin).toString())
      setShareCopied(true)
      window.setTimeout(() => setShareCopied(false), 1800)
    } catch {
      setError("Could not copy the share link.")
    }
  }

  function normalizeSelfHostedStartError(message: string): string {
    if (/BLOB_READ_WRITE_TOKEN|Vercel Blob: No token found/i.test(message)) {
      return "The team runner still needs a fresh deployment with its Blob connection. Run setup again to finish it."
    }

    if (/Self-hosted worker returned a non-JSON response/i.test(message)) {
      return "The team runner returned an unexpected response. Run setup again to finish configuration."
    }

    if (/no runner project is configured/i.test(message)) {
      return "This team still needs its runner project. Finish setup to continue."
    }

    if (/runner project is still provisioning/i.test(message)) {
      return "The team runner is still provisioning. Try again in a moment."
    }

    if (/runner project still needs its team-owned Blob setup repaired/i.test(message)) {
      return "The team runner still needs its team-owned Blob setup before it can start runs."
    }

    if (/runner is out of date|runner project is updating to the latest shell version/i.test(message)) {
      return "The team runner is updating to the latest shell version. Retry in a moment."
    }

    return message
  }

  function openWorkerSetupAction(url: string) {
    setDidOpenWorkerSetupAction(true)
    const target = url.startsWith("/") ? url : undefined
    if (target) {
      window.location.href = target
      return
    }
    window.open(url, "_blank", "noopener,noreferrer")
  }

  useEffect(() => {
    setLocalSkillRunnerExecutionMode(skillRunnerExecutionMode)
  }, [skillRunnerExecutionMode])

  useEffect(() => {
    setLocalSkillRunnerWorkerBaseUrl(skillRunnerWorkerBaseUrl)
  }, [skillRunnerWorkerBaseUrl])

  useEffect(() => {
    setLocalSkillRunnerWorkerStatus(skillRunnerWorkerStatus)
  }, [skillRunnerWorkerStatus])

  function applyWorkerSetup(result: RunnerValidationResult) {
    setWorkerSetupResult(result)
    setLocalSkillRunnerExecutionMode(result.settings?.executionMode || "self-hosted")
    setLocalSkillRunnerWorkerBaseUrl(result.project?.workerBaseUrl || "")
    setLocalSkillRunnerWorkerStatus(
      result.settings?.workerStatus ||
        (!result.project?.workerBaseUrl
          ? "provisioning"
          : result.project?.missingEnvKeys?.length
            ? "error"
            : result.project?.shellVersionStatus === "outdated"
              ? "outdated"
              : "ready")
    )
  }

  function isReadyWorkerSetupResult(result: RunnerValidationResult) {
    const workerStatus =
      result.settings?.workerStatus ||
      (!result.project?.workerBaseUrl
        ? "provisioning"
        : result.project?.missingEnvKeys?.length
          ? "error"
          : result.project?.shellVersionStatus === "outdated"
            ? "outdated"
            : "ready")

    return (
      result.installed &&
      Boolean(result.project?.workerBaseUrl) &&
      !result.project?.missingEnvKeys?.length &&
      result.project?.shellVersionStatus !== "outdated" &&
      workerStatus === "ready"
    )
  }

  function handleWorkerSetupOpenChange(open: boolean) {
    setIsWorkerSetupOpen(open)
    if (!open) {
      setShouldStartAfterWorkerSetup(false)
    }
  }

  async function installWorkerProject() {
    setIsCheckingWorker(true)
    setIsInstallingWorker(true)
    setWorkerSetupError(null)
    setDidOpenWorkerSetupAction(false)
    try {
      const response = await fetch("/api/skill-runner-teams/worker", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ team: team.id })
      })
      const data = (await response.json()) as
        | ({ success: true } & RunnerValidationResult)
        | {
            success: false
            error?: string
            code?: WorkerSetupErrorCode
            actionLabel?: string
            actionUrl?: string
            repo?: string
          }
      if (!response.ok || !data.success) {
        setWorkerSetupError({
          message: ("error" in data && data.error) || "Failed to install runner project.",
          code: "code" in data ? data.code : undefined,
          actionLabel: "actionLabel" in data ? data.actionLabel : undefined,
          actionUrl: "actionUrl" in data ? data.actionUrl : undefined,
          repo: "repo" in data ? data.repo : undefined
        })
        return
      }
      const shouldResumeRun = shouldStartAfterWorkerSetup && isReadyWorkerSetupResult(data)
      applyWorkerSetup(data)
      if (shouldResumeRun) {
        setShouldStartAfterWorkerSetup(false)
        setIsWorkerSetupOpen(false)
        await startDevAgentRun({ assumeWorkerReady: true })
      }
    } catch (workerError) {
      setWorkerSetupError({
        message: workerError instanceof Error ? workerError.message : "Failed to install runner project."
      })
    } finally {
      setIsCheckingWorker(false)
      setIsInstallingWorker(false)
    }
  }

  const canRetryWorkerSetup =
    localSkillRunnerWorkerStatus === "outdated" ||
    localSkillRunnerWorkerStatus === "error" ||
    !workerSetupResult?.installed ||
    Boolean(workerSetupResult.project?.missingEnvKeys?.length) ||
    workerSetupResult.project?.shellVersionStatus === "outdated"

  useEffect(() => {
    try {
      const raw = localStorage.getItem(RUNNER_ENV_VARS_STORAGE_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw) as Array<Partial<RunnerEnvVar>>
      if (!Array.isArray(parsed)) return
      const restored = parsed
        .map((envVar) => ({
          id: typeof envVar.id === "string" && envVar.id ? envVar.id : crypto.randomUUID(),
          kind:
            envVar.kind === "github-pat" || envVar.kind === "npm-token" || envVar.kind === "custom"
              ? envVar.kind
              : "custom",
          name: typeof envVar.name === "string" ? envVar.name : "",
          value: typeof envVar.value === "string" ? envVar.value : ""
        }))
        .filter((envVar) => envVar.name.trim() || envVar.value.trim())
      if (restored.length > 0) {
        setRunnerEnvVars(restored)
      }
    } catch {
      localStorage.removeItem(RUNNER_ENV_VARS_STORAGE_KEY)
    }
  }, [])

  useEffect(() => {
    if (runnerEnvVars.length === 0) {
      localStorage.removeItem(RUNNER_ENV_VARS_STORAGE_KEY)
      return
    }
    localStorage.setItem(RUNNER_ENV_VARS_STORAGE_KEY, JSON.stringify(runnerEnvVars))
  }, [runnerEnvVars])

  function addRunnerEnvVar(kind: RunnerEnvVarKind) {
    setRunnerEnvVars((current) => {
      if (kind !== "custom" && current.some((envVar) => envVar.kind === kind)) {
        return current
      }
      return [...current, createRunnerEnvVar(kind)]
    })
  }

  function updateRunnerEnvVar(id: string, patch: Partial<Pick<RunnerEnvVar, "name" | "value">>) {
    setRunnerEnvVars((current) =>
      current.map((envVar) =>
        envVar.id === id
          ? {
              ...envVar,
              ...patch
            }
          : envVar
      )
    )
  }

  function removeRunnerEnvVar(id: string) {
    setRunnerEnvVars((current) => current.filter((envVar) => envVar.id !== id))
  }

  const selectedTeamId = selectedTeam?.id
  const selectedTeamScope = selectedTeam?.isPersonal ? selectedTeam?.slug : selectedTeam?.id
  useEffect(() => {
    if (!selectedTeamId || !selectedTeamScope) {
      setProjects([])
      setSelectedProjectFallback(null)
      setSelectedProjectId("")
      return
    }

    const controller = new AbortController()
    setProjectsLoading(true)
    setError(null)

    const params = new URLSearchParams({ teamId: selectedTeamScope })

    void fetch(params.toString() ? `/api/projects?${params.toString()}` : "/api/projects", {
      signal: controller.signal
    })
      .then(async (response) => {
        const data = await response.json()
        if (!response.ok || !data.success) {
          throw new Error(data.error || "Failed to load projects.")
        }
        if (controller.signal.aborted) return
        const nextProjects = Array.isArray(data.projects) ? (data.projects as Project[]) : []
        setProjects(nextProjects)
      })
      .catch((loadError: unknown) => {
        if (controller.signal.aborted) return
        setError(loadError instanceof Error ? loadError.message : String(loadError))
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setProjectsLoading(false)
        }
      })

    return () => controller.abort()
  }, [selectedTeamId, selectedTeamScope])

  useEffect(() => {
    if (!selectedProjectId || !selectedTeamScope) {
      setSelectedProjectFallback(null)
      return
    }

    if (projects.some((project) => project.id === selectedProjectId)) {
      setSelectedProjectFallback(null)
      return
    }

    const controller = new AbortController()
    const params = `?teamId=${encodeURIComponent(selectedTeamScope)}`

    void fetch(`/api/projects/${selectedProjectId}${params}`, {
      signal: controller.signal
    })
      .then(async (response) => {
        const data = await response.json()
        if (!response.ok || !data.success || !data.project) {
          throw new Error(data.error || "Failed to load selected project.")
        }
        if (controller.signal.aborted) return
        const fallbackProject = data.project as Project
        if (!isSelectableProject(fallbackProject, { runnerKind, requiresGitHubBackedProject })) {
          setSelectedProjectFallback(null)
          setSelectedProjectId("")
          if (requiresGitHubBackedProject && !getProjectGitHubRepo(fallbackProject)) {
            setError(
              "DeepSec requires a GitHub-backed Vercel project. Select a project connected to a GitHub repository."
            )
          }
          return
        }
        setSelectedProjectFallback(fallbackProject)
        setError((currentError) => (currentError === "fetch failed" ? null : currentError))
      })
      .catch((loadError: unknown) => {
        if (controller.signal.aborted) return
        setSelectedProjectFallback(null)
        setError((currentError) => currentError || (loadError instanceof Error ? loadError.message : String(loadError)))
      })

    return () => controller.abort()
  }, [projects, requiresGitHubBackedProject, runnerKind, selectedProjectId, selectedTeamScope])

  useEffect(() => {
    if (!selectedProjectId || projectsLoading || projects.length === 0) return
    if (allProjects.some((project) => project.id === selectedProjectId)) return
    if (!projects.some((project) => project.id === selectedProjectId)) return

    setSelectedProjectFallback(null)
    setSelectedProjectId("")
  }, [allProjects, projects, projectsLoading, selectedProjectId])

  // Batch-fetch repo visibility for all projects with GitHub links
  useEffect(() => {
    if (selectableProjects.length === 0) return

    const controller = new AbortController()
    const projectsWithGithub = selectableProjects
      .map((project) => ({ project, repo: getProjectGitHubRepo(project) }))
      .filter((entry): entry is { project: Project; repo: { owner: string; repo: string } } => Boolean(entry.repo))

    if (projectsWithGithub.length === 0) return

    void Promise.allSettled(
      projectsWithGithub.map(async ({ project, repo }) => {
        const params = new URLSearchParams({
          owner: repo.owner,
          repo: repo.repo
        })
        const response = await fetch(`/api/github/repo-visibility?${params.toString()}`, {
          signal: controller.signal
        })
        const data = await response.json()
        return {
          projectId: project.id,
          visibility: (data.success ? data.visibility : "private_or_unknown") as RepoVisibility
        }
      })
    ).then((results) => {
      if (controller.signal.aborted) return
      const nextMap = new Map<string, RepoVisibility>()
      for (const result of results) {
        if (result.status === "fulfilled") {
          nextMap.set(result.value.projectId, result.value.visibility)
        }
      }
      setRepoVisibilities(nextMap)
    })

    return () => controller.abort()
  }, [selectableProjects])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)

    if (selectedProjectId) {
      params.set("project", selectedProjectId)
    } else {
      params.delete("project")
    }

    const nextQuery = params.toString()
    const nextUrl = nextQuery ? `${pathname}?${nextQuery}` : pathname
    if (nextUrl !== `${window.location.pathname}${window.location.search}`) {
      window.history.replaceState(null, "", nextUrl)
    }
  }, [pathname, selectedProjectId])

  useEffect(() => {
    setProjectDirectory(selectedProject?.rootDirectory?.trim() || "")
  }, [selectedProject?.rootDirectory])

  const selectedProjectIdStable = selectedProject?.id
  useEffect(() => {
    if (!selectedProjectIdStable || !selectedTeamScope) {
      setAvailableBranches([])
      return
    }

    const controller = new AbortController()
    setBranchesLoading(true)
    const params = new URLSearchParams({ projectId: selectedProjectIdStable, teamId: selectedTeamScope })

    void fetch(`/api/projects/branches?${params.toString()}`, {
      signal: controller.signal
    })
      .then(async (response) => {
        const data = await response.json()
        if (!response.ok || !data.success) {
          throw new Error(data.error || "Failed to load branches.")
        }
        if (controller.signal.aborted) return
        const nextBranches = Array.isArray(data.branches)
          ? (data.branches as Array<{ name: string; lastDeployment?: { url: string } }>)
          : []
        setAvailableBranches(nextBranches)
        if (!nextBranches.some((branch) => branch.name === baseBranch) && nextBranches[0]) {
          setBaseBranch(nextBranches[0].name)
        }
      })
      .catch((loadError: unknown) => {
        if (!controller.signal.aborted) {
          setError(loadError instanceof Error ? loadError.message : String(loadError))
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setBranchesLoading(false)
        }
      })

    return () => controller.abort()
  }, [baseBranch, selectedProjectIdStable, selectedTeamScope])

  useEffect(() => {
    if (!selectedRepoOwner || !selectedRepoName) {
      setRepoVisibility("unknown")
      return
    }

    if (selectedProjectListVisibility === "public" || selectedProjectListVisibility === "private_or_unknown") {
      setRepoVisibility(selectedProjectListVisibility)
      return
    }

    const controller = new AbortController()
    setRepoVisibility("checking")

    const params = new URLSearchParams({ owner: selectedRepoOwner, repo: selectedRepoName })
    void fetch(`/api/github/repo-visibility?${params.toString()}`, {
      signal: controller.signal
    })
      .then(async (response) => {
        const data = await response.json()
        if (!response.ok || !data.success) {
          throw new Error(data.error || "Failed to inspect repository visibility.")
        }
        if (!controller.signal.aborted) {
          setRepoVisibility(data.visibility || "private_or_unknown")
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setRepoVisibility("private_or_unknown")
        }
      })

    return () => controller.abort()
  }, [selectedProjectListVisibility, selectedRepoName, selectedRepoOwner])

  async function startDevAgentRun(options: { assumeWorkerReady?: boolean } = {}) {
    if (!selectedProject || !selectedTeam) {
      setError("Choose a project before starting.")
      return
    }
    if (devAgent.requiresCustomPrompt && !customPrompt.trim()) {
      setError(`This ${runnerLabel} requires custom instructions.`)
      return
    }
    if (requiresGitHubPatForRepoAccess) {
      setError(`A GitHub PAT is required for this ${runnerLabel} and repository.`)
      return
    }

    if (isSelfHostedSkillRunner && !isReadySelfHostedSkillRunner && !options.assumeWorkerReady) {
      setError(null)
      setWorkerSetupError(null)
      setShouldStartAfterWorkerSetup(true)
      setIsWorkerSetupOpen(true)
      return
    }

    setError(null)
    setIsRunning(true)

    const project = selectedProject
    const latestDeployment = project.latestDeployments[0]

    if (!latestDeployment) {
      setIsRunning(false)
      setError("This project has no deployments to use as a starting point.")
      return
    }

    const projectGitHubRepo = getProjectGitHubRepo(project)
    if (requiresGitHubBackedProject && !projectGitHubRepo) {
      setIsRunning(false)
      setError("DeepSec requires a GitHub-backed Vercel project. Select a project connected to a GitHub repository.")
      return
    }

    const repoOwner = projectGitHubRepo?.owner
    const repoName = projectGitHubRepo?.repo
    const gitRef = latestDeployment.gitSource?.ref || baseBranch || latestDeployment.gitSource?.sha || "main"
    const sanitizedEnvVars = runnerEnvVars
      .map((envVar) => ({
        ...envVar,
        name: envVar.name.trim(),
        value: envVar.value.trim()
      }))
      .filter((envVar) => envVar.name && envVar.value)
    const effectiveGithubPat = githubPatEnvVar?.value.trim() || ""
    const effectiveNpmToken = npmTokenEnvVar?.value.trim() || ""
    const projectEnv = Object.fromEntries(sanitizedEnvVars.map((envVar) => [envVar.name, envVar.value]))

    const tokenResponse = await fetch("/api/auth/token")
    const tokenData = await tokenResponse.json()
    const accessToken = tokenData.accessToken as string | undefined
    if (!accessToken) {
      setIsRunning(false)
      setError("Your auth session is missing an access token. Sign in again.")
      return
    }

    const response = await fetch("/api/cloud/start-fix", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`
      },
      body: JSON.stringify({
        userId: user.id,
        devAgentId: runnerKind === "skill-runner" ? undefined : devAgent.id,
        skillRunnerId: runnerKind === "skill-runner" ? devAgent.id : undefined,
        skillRunnerTeam:
          runnerKind === "skill-runner"
            ? {
                id: team.id,
                slug: team.slug,
                name: team.name,
                isPersonal: team.isPersonal
              }
            : undefined,
        projectName: project.name,
        projectId: project.id,
        teamId: selectedTeamScope,
        projectDir: projectDirectory.trim() || project.rootDirectory?.trim() || undefined,
        repoUrl: repoOwner && repoName ? `https://github.com/${repoOwner}/${repoName}` : undefined,
        repoOwner,
        repoName,
        repoBranch: gitRef,
        baseBranch,
        startPath: devAgent.supportsPathInput && startPath.trim() ? startPath.trim() : undefined,
        githubPat: effectiveGithubPat || undefined,
        npmToken: effectiveNpmToken || undefined,
        projectEnv: Object.keys(projectEnv).length > 0 ? projectEnv : undefined,
        submitPullRequest: true,
        customPrompt: devAgent.requiresCustomPrompt ? customPrompt.trim() : undefined,
        productionUrl: latestDeployment.url ? `https://${latestDeployment.url}` : undefined,
        useV0DevAgentRunner: defaultUseV0DevAgentRunner
      })
    })

    const result = (await response.json()) as {
      success?: boolean
      code?: string
      error?: string
      runId?: string
    }

    if (!response.ok || !result.success || !result.runId) {
      setIsRunning(false)
      if (
        runnerKind === "skill-runner" &&
        result.error &&
        (isSelfHostedSkillRunner || result.code === "runner_setup_required")
      ) {
        setLocalSkillRunnerExecutionMode("self-hosted")
        setLocalSkillRunnerWorkerStatus("error")
        setWorkerSetupError({
          message: normalizeSelfHostedStartError(result.error)
        })
        setShouldStartAfterWorkerSetup(true)
        setIsWorkerSetupOpen(true)
        setError(null)
        return
      }
      setError(result.error || `Failed to start the ${runnerLabel} run.`)
      return
    }

    const reportBasePath =
      runnerKind === "skill-runner"
        ? `/${selectedTeam.slug}/skill-runner/runs`
        : `/${selectedTeam.slug}/dev-agents/runs`
    window.location.href = `${reportBasePath}/${result.runId}/report`
  }

  async function continueAfterWorkerSetup() {
    setShouldStartAfterWorkerSetup(false)
    setIsWorkerSetupOpen(false)
    await startDevAgentRun({ assumeWorkerReady: true })
  }

  const workerSetupNeedsAction = Boolean(workerSetupError?.actionUrl)
  const workerSetupActionUrl = workerSetupError?.actionUrl || null

  return (
    <div className="flex max-w-5xl flex-col gap-5">
      {/* Agent info bar */}
      <div className="rounded-lg border border-[#1f1f1f]">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3">
          {/* Owner */}
          <span className="inline-flex items-center gap-1.5 text-[13px] text-[#888]">
            {ownerName === "Vercel" ? (
              <span className="flex size-4 items-center justify-center">
                <VercelTriangle className="size-3 text-[#888]" />
              </span>
            ) : (
              <Avatar className="size-4 border border-[#333]">
                <AvatarImage src={`https://github.com/${ownerName}.png?size=64`} alt={ownerName} />
                <AvatarFallback className="bg-[#1a1a1a] text-[8px] font-medium text-[#888]">
                  {ownerName.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
            )}
            <span>{ownerName}</span>
          </span>

          <span className="text-[#333]">|</span>

          {/* Stats */}
          <span className="text-[13px] text-[#888]">{formatExecutionMode(devAgent.executionMode)}</span>
          {devAgent.ashArtifact?.revision ? (
            <span className="rounded-md bg-[#1a1a1a] px-2 py-0.5 text-[11px] text-[#666]">
              v{devAgent.ashArtifact.revision}
            </span>
          ) : null}
          {devAgent.sandboxBrowser !== "none" ? (
            <span className="text-[13px] text-[#666]">{devAgent.sandboxBrowser}</span>
          ) : null}
          {devAgent.skillRefs.slice(0, 3).map((skill) => (
            <span key={skill.id} className="rounded-md bg-[#1a1a1a] px-2 py-0.5 text-[11px] text-[#666]">
              {skill.displayName}
            </span>
          ))}
          {marketplaceStats?.previouslyPurchased ? (
            <span className="rounded-full border border-blue-500/20 bg-blue-500/10 px-2 py-0.5 text-[11px] text-blue-400">
              Previously Purchased
            </span>
          ) : null}
          {sharePath ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={copyShareLink}
              className="ml-auto h-8 rounded-md border-[#333] bg-[#111] px-2.5 text-[13px] text-[#888] hover:bg-[#1a1a1a] hover:text-[#ededed]"
            >
              {shareCopied ? <CheckCircle2 className="size-3.5" /> : <Share2 className="size-3.5" />}
              <span>{shareCopied ? "Copied" : "Share"}</span>
            </Button>
          ) : null}
        </div>

        {/* Marketplace social proof stats */}
        {marketplaceStats ? (
          <div className="border-t border-[#1f1f1f] px-4 py-3">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
              <div>
                <div className="text-[11px] uppercase tracking-wider text-[#555]">Runs</div>
                <div className="mt-0.5 text-[13px] font-medium text-[#ededed]">{marketplaceStats.projectRuns}</div>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wider text-[#555]">Success</div>
                <div className="mt-0.5 text-[13px] font-medium text-[#ededed]">{marketplaceStats.successRate}</div>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wider text-[#555]">Merges</div>
                <div className="mt-0.5 text-[13px] font-medium text-[#ededed]">{marketplaceStats.mergeRate}</div>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wider text-[#555]">Avg Time</div>
                <div className="mt-0.5 text-[13px] font-medium text-[#ededed]">{marketplaceStats.avgTime}</div>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wider text-[#555]">Avg Cost</div>
                <div className="mt-0.5 text-[13px] font-medium text-[#ededed]">{marketplaceStats.avgCost}</div>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wider text-[#555]">Est Cost</div>
                <div className="mt-0.5 text-[13px] font-medium text-[#ededed]">{marketplaceStats.estCost}</div>
              </div>
            </div>
          </div>
        ) : (
          <div className="border-t border-[#1f1f1f] px-4 py-3">
            <div className="grid grid-cols-2 gap-3 sm:max-w-xs">
              <div>
                <div className="text-[11px] uppercase tracking-wider text-[#555]">Runs</div>
                <div className="mt-0.5 text-[13px] font-medium text-[#ededed]">{displayedRunCount}</div>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wider text-[#555]">Avg Cost</div>
                <div className="mt-0.5 text-[13px] font-medium text-[#ededed]">{displayedAvgCost || "—"}</div>
              </div>
            </div>
          </div>
        )}

        <DevAgentCriteriaSummary devAgent={devAgent} hideEarlyExit={runnerKind === "skill-runner"} />
      </div>

      {devAgent.runnerCanonicalPath || devAgent.validationWarning ? (
        <div className="rounded-lg border border-[#1f1f1f] bg-[#111] px-4 py-3">
          {devAgent.runnerCanonicalPath ? (
            <div>
              <div className="text-[11px] uppercase tracking-wider text-[#555]">Source Skill</div>
              <div className="mt-1 text-[13px] text-[#888]">{devAgent.runnerCanonicalPath}</div>
            </div>
          ) : null}
          {devAgent.validationWarning ? (
            <div className={devAgent.runnerCanonicalPath ? "mt-3" : undefined}>
              <div className="text-[11px] uppercase tracking-wider text-[#555]">Validation</div>
              <div className="mt-1 text-[13px] leading-[18px] text-[#888]">{devAgent.validationWarning}</div>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Project selection */}
        <div className="rounded-lg border border-[#1f1f1f] p-5">
          <div className="mb-4">
            <h2 className="text-[14px] font-medium text-[#ededed]">Project</h2>
            <p className="mt-0.5 text-[13px] text-[#888]">Select a project in {team.name}.</p>
          </div>

          <div className="space-y-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-2.5 size-3.5 text-[#555]" />
              <Input
                id={projectSearchId}
                value={projectSearch}
                onChange={(event) => setProjectSearch(event.target.value)}
                placeholder="Filter projects…"
                className="h-9 border-[#1f1f1f] bg-transparent pl-9 text-[13px] text-[#ededed] placeholder:text-[#555]"
              />
            </div>

            <div className="max-h-[24rem] space-y-1 overflow-y-auto">
              {projectsLoading ? (
                <div className="flex items-center gap-2 py-3 text-[13px] text-[#666]">
                  <Spinner className="size-3.5" />
                  Loading projects…
                </div>
              ) : filteredProjects.length === 0 ? (
                <p className="py-3 text-[13px] text-[#666]">
                  {requiresGitHubBackedProject ? "No GitHub-backed projects found." : "No matching projects."}
                </p>
              ) : (
                filteredProjects.map((project) => (
                  <button
                    type="button"
                    key={project.id}
                    onClick={() => setSelectedProjectId(project.id)}
                    className={`flex w-full items-center justify-between rounded-md border px-3 py-2.5 text-left transition-colors ${
                      selectedProjectId === project.id
                        ? "border-[#ededed] bg-[#1a1a1a]"
                        : "border-[#1f1f1f] hover:border-[#333]"
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-medium text-[#ededed]">{project.name}</div>
                      <div className="text-[11px] text-[#666]">
                        {project.framework ? `${project.framework} · ` : ""}
                        {project.latestDeployments[0]?.url || "No deployment"}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {repoVisibilities.get(project.id) === "public" ? (
                        <span className="rounded-full border border-[#333] bg-[#1a1a1a] px-2 py-0.5 text-[10px] text-[#888]">
                          Public
                        </span>
                      ) : repoVisibilities.get(project.id) === "private_or_unknown" ? (
                        <span className="rounded-full border border-[#333] bg-[#1a1a1a] px-2 py-0.5 text-[10px] text-[#666]">
                          Private
                        </span>
                      ) : null}
                      <ArrowRight className="size-3.5 text-[#555]" />
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Run configuration */}
        <div className="rounded-lg border border-[#1f1f1f] p-5">
          <div className="mb-4">
            <h2 className="text-[14px] font-medium text-[#ededed]">Configuration</h2>
            <p className="mt-0.5 text-[13px] text-[#888]">Repo-specific inputs for this {runnerLabel} run.</p>
          </div>

          {!selectedProject ? (
            <p className="py-3 text-[13px] text-[#666]">Pick a project first.</p>
          ) : (
            <div className="space-y-4">
              <div className="rounded-md border border-[#1f1f1f] bg-[#111] p-3">
                <div className="text-[13px] font-medium text-[#ededed]">{selectedProject.name}</div>
                <div className="mt-0.5 text-[12px] text-[#666]">
                  {selectedRepoOwner && selectedRepoName
                    ? `${selectedRepoOwner}/${selectedRepoName}`
                    : "Repository not linked"}
                </div>
                <div className="mt-0.5 text-[12px] text-[#666]">
                  Root directory: {selectedProject.rootDirectory?.trim() || "Repo root"}
                </div>
                {selectedProject.latestDeployments[0]?.url && (
                  <a
                    href={`https://${selectedProject.latestDeployments[0].url}`}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-flex items-center gap-1 text-[11px] text-[#888] hover:text-[#ededed]"
                  >
                    Open deployment
                    <ExternalLink className="size-3" />
                  </a>
                )}
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-[13px] text-[#888]">Base Branch</Label>
                  <Select value={baseBranch} onValueChange={setBaseBranch} disabled={branchesLoading}>
                    <SelectTrigger className="h-9 border-[#1f1f1f] bg-transparent text-[13px] text-[#ededed]">
                      <SelectValue placeholder={branchesLoading ? "Loading…" : "Select branch"} />
                    </SelectTrigger>
                    <SelectContent className="border-[#333] bg-[#0a0a0a]">
                      {availableBranches.map((branch) => (
                        <SelectItem key={branch.name} value={branch.name} className="text-[13px]">
                          {branch.name}
                        </SelectItem>
                      ))}
                      {availableBranches.length === 0 && (
                        <SelectItem value="main" className="text-[13px]">
                          main
                        </SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                </div>

                {devAgent.supportsPathInput && (
                  <div className="space-y-1.5">
                    <Label htmlFor={startPathId} className="text-[13px] text-[#888]">
                      Start Path
                    </Label>
                    <Input
                      id={startPathId}
                      value={startPath}
                      onChange={(event) => setStartPath(event.target.value)}
                      className="h-9 border-[#1f1f1f] bg-transparent text-[13px] text-[#ededed]"
                    />
                  </div>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor={projectDirectoryId} className="text-[13px] text-[#888]">
                  Project Directory
                </Label>
                <Input
                  id={projectDirectoryId}
                  value={projectDirectory}
                  onChange={(event) => setProjectDirectory(event.target.value)}
                  placeholder="Repo root"
                  className="h-9 border-[#1f1f1f] bg-transparent text-[13px] text-[#ededed] placeholder:text-[#555]"
                />
                <p className="text-[11px] text-[#555]">
                  Defaults to Vercel project Root Directory. Override for monorepos when the run should start below the
                  repo root.
                </p>
              </div>

              {devAgent.requiresCustomPrompt && (
                <div className="space-y-1.5">
                  <Label htmlFor={customPromptId} className="text-[13px] text-[#888]">
                    Custom Instructions
                  </Label>
                  <Textarea
                    id={customPromptId}
                    value={customPrompt}
                    onChange={(event) => setCustomPrompt(event.target.value)}
                    placeholder="Describe the task for this run."
                    rows={4}
                    className="border-[#1f1f1f] bg-transparent text-[13px] text-[#ededed] placeholder:text-[#555]"
                  />
                </div>
              )}

              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <Label className="text-[13px] text-[#888]">Runner Env Vars</Label>
                    <p className="mt-0.5 text-[11px] text-[#555]">
                      Add secrets for private repos, private npm access, or custom runner needs.
                    </p>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8 rounded-md border border-[#1f1f1f] bg-transparent px-2.5 text-[#888] hover:bg-[#1a1a1a] hover:text-[#ededed]"
                      >
                        <Plus className="size-3.5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-48 border-[#333] bg-[#0a0a0a]">
                      <DropdownMenuItem onClick={() => addRunnerEnvVar("github-pat")} className="text-[13px]">
                        GITHUB_PAT
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => addRunnerEnvVar("npm-token")} className="text-[13px]">
                        NPM_TOKEN
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => addRunnerEnvVar("custom")} className="text-[13px]">
                        CUSTOM
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                {runnerEnvVars.length > 0 ? (
                  <div className="space-y-2">
                    {runnerEnvVars.map((envVar) => {
                      const isGitHubPatEnv =
                        envVar.kind === "github-pat" || envVar.name.trim().toUpperCase() === "GITHUB_PAT"
                      const helperText = isGitHubPatEnv
                        ? `Visibility: ${effectiveRepoVisibility.replaceAll("_", " ")}${requiresGitHubPatForRepoAccess ? " · Required for private repos and PR creation." : ""}`
                        : envVar.kind === "npm-token"
                          ? "Used for installing packages from private npm registries."
                          : "Passed through to the runner sandbox for this run."

                      return (
                        <div key={envVar.id} className="rounded-md border border-[#1f1f1f] bg-[#111] p-3">
                          <div className="grid gap-2 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)_auto]">
                            <Input
                              value={envVar.name}
                              onChange={(event) => updateRunnerEnvVar(envVar.id, { name: event.target.value })}
                              placeholder="Name"
                              className="h-9 border-[#1f1f1f] bg-transparent text-[13px] text-[#ededed] placeholder:text-[#555]"
                            />
                            <Input
                              type="password"
                              value={envVar.value}
                              onChange={(event) => updateRunnerEnvVar(envVar.id, { value: event.target.value })}
                              placeholder="Value"
                              className="h-9 border-[#1f1f1f] bg-transparent text-[13px] text-[#ededed] placeholder:text-[#555]"
                            />
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() => removeRunnerEnvVar(envVar.id)}
                              className="h-9 w-9 rounded-md border border-[#1f1f1f] bg-transparent text-[#666] hover:bg-[#1a1a1a] hover:text-[#ededed]"
                            >
                              <X className="size-3.5" />
                            </Button>
                          </div>
                          <p className="mt-2 text-[11px] text-[#555]">{helperText}</p>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <div className="rounded-md border border-dashed border-[#1f1f1f] bg-[#111] px-3 py-3 text-[12px] text-[#666]">
                    No extra runner env vars added.
                  </div>
                )}
              </div>

              {error ? (
                <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3 text-[13px] text-red-400">
                  {error}
                </div>
              ) : null}

              <div className="flex items-center gap-2 pt-1">
                <Button
                  onClick={() => void startDevAgentRun()}
                  disabled={isRunning || !selectedProject}
                  size="sm"
                  className="h-8 rounded-md bg-[#ededed] px-4 text-[13px] font-medium text-[#0a0a0a] hover:bg-white disabled:opacity-40"
                >
                  {isRunning && isSelfHostedSkillRunner && localSkillRunnerWorkerStatus === "outdated"
                    ? "Updating runner..."
                    : isRunning
                      ? "Starting run..."
                      : "Start Run"}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      <Dialog open={isWorkerSetupOpen} onOpenChange={handleWorkerSetupOpenChange}>
        <DialogContent className="border-[#1f1f1f] bg-[#111] text-[#ededed] sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="text-[28px] font-semibold tracking-[-0.02em] text-[#ededed]">
              Add Team Skill Runner Project
            </DialogTitle>
            <DialogDescription className="text-[#888]">
              Add a team-owned Vercel project so skill runs use {team.name}'s billing, logs, and observability.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 text-[13px] text-[#888]">
            <div className="space-y-2 rounded-lg border border-[#1f1f1f] bg-[#0d0d0d] px-4 py-4">
              <div className="text-[11px] uppercase tracking-[0.14em] text-[#666]">Team</div>
              <div className="text-[15px] text-[#ededed]">{team.name}</div>
              <div className="leading-[20px] text-[#777]">
                This creates a small runner project in this team. Skill runs execute there so compute, AI Gateway usage,
                deployments, and runtime logs belong to the team running the scan.
              </div>
              <div className="leading-[20px] text-[#777]">
                If Vercel asks for project access, choose all projects in this team. Single-project grants cannot
                include the new runner project.
              </div>
            </div>

            {workerSetupError ? (
              <div className="flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3 text-red-400">
                <AlertCircle className="mt-0.5 size-4 shrink-0" />
                <div className="space-y-2">
                  <div>{workerSetupError.message}</div>
                  {workerSetupNeedsAction ? (
                    <div className="text-[12px] leading-[18px] text-red-300/90">
                      {workerSetupError.code === "github_integration_required" ? (
                        <>
                          Install the Vercel GitHub app for the <span className="font-medium">{team.name}</span> team,
                          then come back and retry runner setup.
                        </>
                      ) : workerSetupError.code === "initial_deployment_missing" ? (
                        <>
                          The runner project exists, but its latest deployment did not finish successfully. Open the
                          project, review the deployment error, then come back and retry setup.
                        </>
                      ) : workerSetupError.code === "blob_store_limit_reached" ? (
                        <>
                          This team has reached its Blob store limit. Delete an unused Blob store, then come back and
                          retry runner setup.
                        </>
                      ) : workerSetupError.code === "project_env_vars_forbidden" ? (
                        <>
                          Reconnect Vercel and choose all projects for <span className="font-medium">{team.name}</span>{" "}
                          so dev3000 can configure the new runner project.
                        </>
                      ) : (
                        <>Open Vercel Projects, remove any stale runner project if it appears, then retry setup.</>
                      )}
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}

            {workerSetupResult ? (
              workerSetupResult.installed && workerSetupResult.project ? (
                <div className="rounded-lg border border-[#1f1f1f] bg-[#0d0d0d] px-4 py-4">
                  <div className="flex items-start gap-3">
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-[#ededed]" />
                    <div>
                      <div className="text-[15px] font-medium text-[#ededed]">
                        {workerSetupResult.project.missingEnvKeys?.length
                          ? "Runner project needs configuration"
                          : workerSetupResult.project.shellVersionStatus === "outdated"
                            ? "Runner project needs update"
                            : "Runner project ready"}
                      </div>
                      <div className="mt-2 space-y-1 text-[13px]">
                        <div className="text-[#888]">{workerSetupResult.project.projectName}</div>
                        <div className="text-[#666]">Project ID: {workerSetupResult.project.projectId}</div>
                        <div className="text-[#666]">
                          Worker URL: {workerSetupResult.project.workerBaseUrl || "No URL detected yet"}
                        </div>
                        {workerSetupResult.project.workerShellVersion ? (
                          <div className="text-[#666]">
                            Worker Shell: {workerSetupResult.project.workerShellVersion.slice(0, 8)}
                            {workerSetupResult.project.desiredWorkerGitSha
                              ? ` (target ${workerSetupResult.project.desiredWorkerGitSha.slice(0, 8)})`
                              : ""}
                          </div>
                        ) : null}
                      </div>
                      {workerSetupResult.project.dashboardUrl ? (
                        <a
                          href={workerSetupResult.project.dashboardUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-3 inline-flex text-[12px] text-[#ededed] underline decoration-[#333] underline-offset-4 hover:decoration-[#666]"
                        >
                          Open project in Vercel
                        </a>
                      ) : null}
                      {!workerSetupResult.project.workerBaseUrl ? (
                        <div className="mt-3 flex items-start gap-2 text-[12px] leading-[18px] text-[#888]">
                          <Loader2 className="mt-[2px] size-3 shrink-0 animate-spin text-[#666]" />
                          <span>The project exists, but the deployment URL is still provisioning.</span>
                        </div>
                      ) : localSkillRunnerWorkerStatus === "provisioning" ? (
                        <div className="mt-3 flex items-start gap-2 text-[12px] leading-[18px] text-[#888]">
                          <Loader2 className="mt-[2px] size-3 shrink-0 animate-spin text-[#666]" />
                          <span>The runner project is redeploying with its new Blob connection.</span>
                        </div>
                      ) : workerSetupResult.project.shellVersionStatus === "outdated" ? (
                        <div className="mt-3 space-y-2 text-[12px] leading-[18px] text-[#888]">
                          <div>This team-owned runner is on an older shell version.</div>
                          <div className="text-[#666]">
                            Update it so new self-hosted runs pick up the latest runner shell automatically.
                          </div>
                        </div>
                      ) : workerSetupResult.project.missingEnvKeys?.length ? (
                        <div className="mt-3 space-y-2 text-[12px] leading-[18px] text-[#888]">
                          <div>
                            This runner is still missing these required env vars:{" "}
                            <span className="font-mono text-[#ededed]">
                              {workerSetupResult.project.missingEnvKeys.join(", ")}
                            </span>
                          </div>
                          <div className="text-[#666]">
                            Run setup again to finish the team-owned Blob connection for this runner.
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="rounded-lg border border-[#1f1f1f] bg-[#0d0d0d] px-4 py-4">
                  <div className="flex items-start gap-3">
                    <AlertCircle className="mt-0.5 size-4 shrink-0 text-[#888]" />
                    <div>
                      <div className="text-[15px] font-medium text-[#ededed]">Runner project not found</div>
                      <div className="mt-1 leading-[20px] text-[#888]">
                        {workerSetupResult.message ||
                          `No ${workerSetupResult.expectedProjectName} project was found for this team.`}
                      </div>
                    </div>
                  </div>
                </div>
              )
            ) : null}
          </div>

          <DialogFooter className="flex-col gap-3 sm:flex-col">
            <div className="flex justify-start">
              {workerSetupNeedsAction && !didOpenWorkerSetupAction && workerSetupActionUrl ? (
                <Button
                  type="button"
                  onClick={() => openWorkerSetupAction(workerSetupActionUrl)}
                  className="h-9 rounded-md bg-[#ededed] px-4 text-[13px] font-medium text-[#0a0a0a] hover:bg-white"
                >
                  {workerSetupError?.actionLabel || "Open Setup"}
                </Button>
              ) : canRetryWorkerSetup ? (
                <Button
                  type="button"
                  onClick={() => void installWorkerProject()}
                  disabled={isCheckingWorker || isInstallingWorker}
                  className="h-9 rounded-md bg-[#ededed] px-4 text-[13px] font-medium text-[#0a0a0a] hover:bg-white disabled:opacity-40"
                >
                  {isInstallingWorker || isCheckingWorker ? (
                    <span className="inline-flex items-center gap-2">
                      <Loader2 className="size-3.5 animate-spin" />
                      {workerSetupResult?.installed ? "Configuring…" : "Installing…"}
                    </span>
                  ) : workerSetupNeedsAction && didOpenWorkerSetupAction ? (
                    "Retry Setup"
                  ) : workerSetupResult?.project?.shellVersionStatus === "outdated" ? (
                    "Update Runner"
                  ) : workerSetupResult?.installed ? (
                    "Retry Setup"
                  ) : (
                    "Install Runner Project"
                  )}
                </Button>
              ) : localSkillRunnerWorkerStatus === "provisioning" ? (
                <Button
                  type="button"
                  disabled
                  className="h-9 rounded-md bg-[#ededed] px-4 text-[13px] font-medium text-[#0a0a0a] opacity-60"
                >
                  <span className="inline-flex items-center gap-2">
                    <Loader2 className="size-3.5 animate-spin" />
                    Finishing Setup…
                  </span>
                </Button>
              ) : (
                <Button
                  type="button"
                  onClick={() => void continueAfterWorkerSetup()}
                  disabled={
                    !workerSetupResult?.installed ||
                    !workerSetupResult.project?.workerBaseUrl ||
                    Boolean(workerSetupResult.project?.missingEnvKeys?.length) ||
                    workerSetupResult.project?.shellVersionStatus === "outdated" ||
                    localSkillRunnerWorkerStatus !== "ready"
                  }
                  className="h-9 rounded-md bg-[#ededed] px-4 text-[13px] font-medium text-[#0a0a0a] hover:bg-white disabled:opacity-40"
                >
                  Continue
                </Button>
              )}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
