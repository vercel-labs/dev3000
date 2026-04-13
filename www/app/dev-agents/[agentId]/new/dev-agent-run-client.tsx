"use client"

import { AlertCircle, ArrowRight, CheckCircle2, ExternalLink, Loader2, Plus, Search, X } from "lucide-react"
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

interface DevAgentRunClientProps {
  devAgent: DevAgent
  ownerName: string
  team: DevAgentTeam
  user: UserInfo
  defaultUseV0DevAgentRunner: boolean
  marketplaceStats?: MarketplaceStats
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
  }
  settings?: {
    executionMode?: SkillRunnerExecutionMode
    workerBaseUrl?: string
    workerProjectId?: string
    workerStatus?: SkillRunnerWorkerStatus
  }
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
  runnerKind = "dev-agent",
  skillRunnerExecutionMode = "hosted",
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
  const [workerSetupError, setWorkerSetupError] = useState<string | null>(null)
  const [workerSetupResult, setWorkerSetupResult] = useState<RunnerValidationResult | null>(null)

  const [repoVisibilities, setRepoVisibilities] = useState<Map<string, RepoVisibility>>(new Map())

  const selectedTeam = team
  const allProjects = useMemo(() => {
    if (!selectedProjectFallback || projects.some((project) => project.id === selectedProjectFallback.id)) {
      return projects
    }
    return [selectedProjectFallback, ...projects]
  }, [projects, selectedProjectFallback])
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
  const selectedRepoOwner = selectedProject?.link?.org || selectedProject?.latestDeployments[0]?.meta?.githubOrg
  const selectedRepoName = selectedProject?.link?.repo || selectedProject?.latestDeployments[0]?.meta?.githubRepo
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
  const runnerTitle = runnerKind === "skill-runner" ? "Skill Runner" : "Dev Agent"
  const isSelfHostedSkillRunner = runnerKind === "skill-runner" && localSkillRunnerExecutionMode === "self-hosted"
  const isReadySelfHostedSkillRunner =
    isSelfHostedSkillRunner && Boolean(localSkillRunnerWorkerBaseUrl) && localSkillRunnerWorkerStatus === "ready"
  const selfHostedHelperText =
    localSkillRunnerWorkerStatus === "error"
      ? "This team is configured for self-hosted skill-runner execution, but the team-owned runner still needs its Blob connection repaired."
      : localSkillRunnerWorkerBaseUrl
        ? `This team is configured for self-hosted skill-runner execution via ${localSkillRunnerWorkerBaseUrl}. New runs will execute on the team-owned worker.`
        : localSkillRunnerWorkerStatus === "provisioning"
          ? "This team is configured for self-hosted skill-runner execution. The runner project is still provisioning."
          : "This team is configured for self-hosted skill-runner execution. Click Start Run to install the team-owned runner."

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
        (!result.project?.workerBaseUrl ? "provisioning" : result.project?.missingEnvKeys?.length ? "error" : "ready")
    )
  }

  async function validateWorkerInstallation() {
    setIsCheckingWorker(true)
    setWorkerSetupError(null)
    try {
      const params = new URLSearchParams({ team: team.id })
      const response = await fetch(`/api/skill-runner-teams/worker?${params.toString()}`)
      const data = (await response.json()) as
        | ({ success: true } & RunnerValidationResult)
        | { success: false; error?: string }
      if (!response.ok || !data.success) {
        throw new Error(("error" in data && data.error) || "Failed to validate runner installation.")
      }
      applyWorkerSetup(data)
    } catch (workerError) {
      setWorkerSetupError(
        workerError instanceof Error ? workerError.message : "Failed to validate runner installation."
      )
    } finally {
      setIsCheckingWorker(false)
    }
  }

  async function installWorkerProject() {
    setIsInstallingWorker(true)
    setWorkerSetupError(null)
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
        | { success: false; error?: string }
      if (!response.ok || !data.success) {
        throw new Error(("error" in data && data.error) || "Failed to install runner project.")
      }
      applyWorkerSetup(data)
    } catch (workerError) {
      setWorkerSetupError(workerError instanceof Error ? workerError.message : "Failed to install runner project.")
    } finally {
      setIsInstallingWorker(false)
    }
  }

  const canRetryWorkerSetup =
    !workerSetupResult?.installed || Boolean(workerSetupResult.project?.missingEnvKeys?.length)

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
        setProjects(Array.isArray(data.projects) ? data.projects : [])
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
        setSelectedProjectFallback(data.project as Project)
        setError((currentError) => (currentError === "fetch failed" ? null : currentError))
      })
      .catch((loadError: unknown) => {
        if (controller.signal.aborted) return
        setSelectedProjectFallback(null)
        setError((currentError) => currentError || (loadError instanceof Error ? loadError.message : String(loadError)))
      })

    return () => controller.abort()
  }, [projects, selectedProjectId, selectedTeamScope])

  // Batch-fetch repo visibility for all projects with GitHub links
  useEffect(() => {
    if (allProjects.length === 0) return

    const controller = new AbortController()
    const projectsWithGithub = allProjects
      .filter((project): project is Project & { link: { org: string; repo: string } } =>
        Boolean(project.link?.org && project.link?.repo)
      )
      .slice(0, 20) // cap to avoid rate limits

    if (projectsWithGithub.length === 0) return

    void Promise.allSettled(
      projectsWithGithub.map(async (project) => {
        const params = new URLSearchParams({
          owner: project.link.org,
          repo: project.link.repo
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
  }, [allProjects])

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

  async function startDevAgentRun() {
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

    if (isSelfHostedSkillRunner && !isReadySelfHostedSkillRunner) {
      setError(null)
      setWorkerSetupError(null)
      setIsWorkerSetupOpen(true)
      return
    }

    setError(null)
    setIsRunning(true)

    const projectResponse = await fetch(
      `/api/projects/${selectedProject.id}?teamId=${encodeURIComponent(selectedTeamScope || selectedTeam.id)}`
    )
    const projectData = await projectResponse.json()
    const project = (projectData.success ? projectData.project : selectedProject) as Project
    const latestDeployment = project.latestDeployments[0]

    if (!latestDeployment) {
      setIsRunning(false)
      setError("This project has no deployments to use as a starting point.")
      return
    }

    const repoOwner = project.link?.org || latestDeployment.meta?.githubOrg
    const repoName = project.link?.repo || latestDeployment.meta?.githubRepo
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
      error?: string
      runId?: string
    }

    if (!response.ok || !result.success || !result.runId) {
      setIsRunning(false)
      setError(result.error || `Failed to start the ${runnerLabel} run.`)
      return
    }

    window.location.href = `/dev-agents/runs/${result.runId}/report`
  }

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
          <div className="border-t border-[#1f1f1f] px-4 py-2.5">
            <span className="text-[13px] text-[#888]">
              <span className="text-[#ededed]">{devAgent.usageCount}</span> runs
            </span>
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

      {isSelfHostedSkillRunner ? (
        <div className="rounded-lg border border-[#1f1f1f] bg-[#111] px-4 py-3">
          <div className="text-[11px] uppercase tracking-wider text-[#555]">Execution Mode</div>
          <div className="mt-1 text-[13px] font-medium text-[#ededed]">Self-hosted</div>
          <div className="mt-1 text-[13px] leading-[18px] text-[#888]">{selfHostedHelperText}</div>
        </div>
      ) : null}

      {error && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3 text-[13px] text-red-400">
          {error}
        </div>
      )}

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
                <p className="py-3 text-[13px] text-[#666]">No matching projects.</p>
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

              <div className="flex items-center gap-2 pt-1">
                <Button
                  onClick={startDevAgentRun}
                  disabled={isRunning || !selectedProject}
                  size="sm"
                  className="h-8 rounded-md bg-[#ededed] px-4 text-[13px] font-medium text-[#0a0a0a] hover:bg-white disabled:opacity-40"
                >
                  {isRunning ? `Running ${runnerTitle}…` : "Start Run"}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      <Dialog open={isWorkerSetupOpen} onOpenChange={setIsWorkerSetupOpen}>
        <DialogContent className="border-[#1f1f1f] bg-[#111] text-[#ededed] sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="text-[28px] font-semibold tracking-[-0.02em] text-[#ededed]">
              Set Up Team Runner
            </DialogTitle>
            <DialogDescription className="text-[#888]">
              Before {team.name} can run this skill runner in self-hosted mode, it needs a team-owned{" "}
              <span className="font-mono text-[#cfcfcf]">{SKILL_RUNNER_WORKER_PROJECT_NAME}</span> project.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 text-[13px] text-[#888]">
            <div className="space-y-2 rounded-lg border border-[#1f1f1f] bg-[#0d0d0d] px-4 py-4">
              <div className="text-[11px] uppercase tracking-[0.14em] text-[#666]">Team</div>
              <div className="text-[15px] text-[#ededed]">{team.name}</div>
              <div className="leading-[20px] text-[#777]">
                We can look for an existing runner project in this team or install it for you automatically.
              </div>
            </div>

            {workerSetupError ? (
              <div className="flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3 text-red-400">
                <AlertCircle className="mt-0.5 size-4 shrink-0" />
                <div>{workerSetupError}</div>
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
                          : "Runner project ready"}
                      </div>
                      <div className="mt-2 space-y-1 text-[13px]">
                        <div className="text-[#888]">{workerSetupResult.project.projectName}</div>
                        <div className="text-[#666]">Project ID: {workerSetupResult.project.projectId}</div>
                        <div className="text-[#666]">
                          Worker URL: {workerSetupResult.project.workerBaseUrl || "No URL detected yet"}
                        </div>
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
                      ) : workerSetupResult.project.missingEnvKeys?.length ? (
                        <div className="mt-3 space-y-2 text-[12px] leading-[18px] text-[#888]">
                          <div>
                            The team-owned runner is still missing these required env vars:{" "}
                            <span className="font-mono text-[#ededed]">
                              {workerSetupResult.project.missingEnvKeys.join(", ")}
                            </span>
                          </div>
                          <div className="text-[#666]">
                            Blob setup should complete automatically for this team-owned runner. Retry setup to repair
                            any partial install.
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
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => void validateWorkerInstallation()}
                disabled={isCheckingWorker || isInstallingWorker}
                className="h-9 rounded-md border border-[#333] bg-transparent px-4 text-[13px] text-[#ededed] hover:bg-[#1a1a1a]"
              >
                {isCheckingWorker ? (
                  <span className="inline-flex items-center gap-2">
                    <Loader2 className="size-3.5 animate-spin" />
                    Checking…
                  </span>
                ) : (
                  "Check Existing Project"
                )}
              </Button>
              {canRetryWorkerSetup ? (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => void installWorkerProject()}
                  disabled={isCheckingWorker || isInstallingWorker}
                  className="h-9 rounded-md border border-[#333] bg-transparent px-4 text-[13px] text-[#ededed] hover:bg-[#1a1a1a]"
                >
                  {isInstallingWorker ? (
                    <span className="inline-flex items-center gap-2">
                      <Loader2 className="size-3.5 animate-spin" />
                      {workerSetupResult?.installed ? "Repairing…" : "Installing…"}
                    </span>
                  ) : workerSetupResult?.installed ? (
                    "Retry Setup"
                  ) : (
                    "Install Runner Project"
                  )}
                </Button>
              ) : null}
            </div>

            <div className="flex items-center justify-between gap-3">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setIsWorkerSetupOpen(false)}
                className="h-9 rounded-md px-0 text-[13px] text-[#777] hover:bg-transparent hover:text-[#ededed]"
              >
                Not now
              </Button>
              <Button
                type="button"
                onClick={() => setIsWorkerSetupOpen(false)}
                disabled={
                  !workerSetupResult?.installed ||
                  !workerSetupResult.project?.workerBaseUrl ||
                  Boolean(workerSetupResult.project?.missingEnvKeys?.length)
                }
                className="h-9 rounded-md bg-[#ededed] px-4 text-[13px] font-medium text-[#0a0a0a] hover:bg-white disabled:opacity-40"
              >
                Continue
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
