"use client"

import { AlertCircle, HelpCircle } from "lucide-react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { useCallback, useEffect, useId, useRef, useState } from "react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { DEV3000_API_URL } from "@/lib/constants"

interface Team {
  id: string
  slug: string
  name: string
  isPersonal: boolean
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

interface NewWorkflowModalProps {
  isOpen: boolean
  onClose: () => void
  userId: string
}

type WorkflowStep = "type" | "team" | "project" | "options" | "running"
type RecentProject = { id: string; name: string }
type RecentProjectsStore = Record<string, RecentProject[]>
type AnalysisTarget = "project" | "url" | ""

function getAnalysisTarget(typeParam: string | null, targetParam: string | null): AnalysisTarget {
  if (targetParam === "project" || targetParam === "url") return targetParam
  if (typeParam === "url-audit" || typeParam === "url-react-performance") return "url"
  if (typeParam) return "project"
  return ""
}

const RECENT_PROJECTS_KEY = "d3k_recent_projects"

function readRecentProjects(teamId: string): RecentProject[] {
  if (!teamId) return []
  try {
    const raw = localStorage.getItem(RECENT_PROJECTS_KEY)
    if (!raw) return []
    const store = JSON.parse(raw) as RecentProjectsStore
    return Array.isArray(store[teamId]) ? store[teamId] : []
  } catch (error) {
    console.warn("Failed to read recent projects:", error)
    return []
  }
}

function writeRecentProjects(teamId: string, projects: RecentProject[]) {
  if (!teamId) return
  try {
    const raw = localStorage.getItem(RECENT_PROJECTS_KEY)
    const store = (raw ? (JSON.parse(raw) as RecentProjectsStore) : {}) as RecentProjectsStore
    store[teamId] = projects
    localStorage.setItem(RECENT_PROJECTS_KEY, JSON.stringify(store))
  } catch (error) {
    console.warn("Failed to write recent projects:", error)
  }
}

function addRecentProject(teamId: string, project: RecentProject) {
  if (!teamId || !project.id) return []
  const existing = readRecentProjects(teamId)
  const next = [project, ...existing.filter((item) => item.id !== project.id)].slice(0, 3)
  writeRecentProjects(teamId, next)
  return next
}

export default function NewWorkflowModal({ isOpen, onClose, userId }: NewWorkflowModalProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const baseBranchId = useId()
  const autoCreatePRId = useId()
  const bypassTokenId = useId()
  const customPromptId = useId()
  const githubPatId = useId()
  const startPathId = useId()
  const crawlDepthId = useId()
  const projectSearchId = useId()
  const publicUrlId = useId()

  // Initialize step from URL params to avoid CLS from cascading useEffects
  const initialStep = (() => {
    const typeParam = searchParams.get("type")
    const targetParam = searchParams.get("target")
    const teamParam = searchParams.get("team")
    const projectParam = searchParams.get("project")
    const target = getAnalysisTarget(typeParam, targetParam)

    if (!typeParam) return "type"
    if (target === "url") return "options"
    if (projectParam) return "options"
    if (teamParam) return "project"
    return "team"
  })()

  const [step, setStep] = useState<WorkflowStep>(initialStep)
  const [selectedTarget, setSelectedTarget] = useState<AnalysisTarget>(
    getAnalysisTarget(searchParams.get("type"), searchParams.get("target"))
  )
  const [_selectedType, setSelectedType] = useState<string>(searchParams.get("type") || "")
  const [teams, setTeams] = useState<Team[]>([])
  const [selectedTeam, setSelectedTeam] = useState<Team | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [selectedProject, setSelectedProject] = useState<Project | null>(null)
  const [loadingTeams, setLoadingTeams] = useState(false)
  const [loadingProjects, setLoadingProjects] = useState(false)
  const [loadingProjectById, setLoadingProjectById] = useState(false)
  const [projectsError, setProjectsError] = useState<string | null>(null)
  const [projectSearch, setProjectSearch] = useState("")
  const [debouncedProjectSearch, setDebouncedProjectSearch] = useState("")
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>([])
  const [workflowStatus, setWorkflowStatus] = useState<string>("")
  const [workflowResult, setWorkflowResult] = useState<{
    success: boolean
    blobUrl?: string
    runId?: string
    pr?: { prUrl: string } | null
  } | null>(null)
  const [activeRunId, setActiveRunId] = useState<string | null>(null)
  const [redirectedRunId, setRedirectedRunId] = useState<string | null>(null)
  const [sandboxUrl, setSandboxUrl] = useState<string | null>(null)
  const [baseBranch, setBaseBranch] = useState("main")
  const [autoCreatePR, setAutoCreatePR] = useState(true)
  const [bypassToken, setBypassToken] = useState("")
  const [isCheckingProtection, setIsCheckingProtection] = useState(false)
  const [needsBypassToken, setNeedsBypassToken] = useState(false)
  const [customPrompt, setCustomPrompt] = useState("")
  const [publicUrl, setPublicUrl] = useState("")
  const [githubPat, setGithubPat] = useState("")
  const [startPath, setStartPath] = useState("/")
  const [crawlDepth, setCrawlDepth] = useState<number | "all">(1)
  const [availableBranches, setAvailableBranches] = useState<
    Array<{ name: string; lastDeployment: { url: string; createdAt: number } }>
  >([])
  const [loadingBranches, setLoadingBranches] = useState(false)
  const [branchesError, setBranchesError] = useState(false)
  const loadedTeamIdRef = useRef<string | null>(null)

  const getBypassTokenStorageKey = useCallback(
    (projectId: string) => {
      const teamId = selectedTeam?.id || "personal"
      return `d3k_bypass_token_${teamId}_${projectId}`
    },
    [selectedTeam]
  )

  const workflowSkillLabels: Record<string, string[]> = {
    "design-guidelines": ["d3k", "vercel-design-guidelines"],
    "react-performance": ["d3k", "vercel-react-best-practices"],
    "cls-fix": ["d3k"],
    prompt: ["d3k"],
    "url-audit": ["d3k", "vercel-design-guidelines"]
  }

  const isUrlAuditType = selectedTarget === "url"
  const isValidPublicUrl = (() => {
    if (!publicUrl.trim()) return false
    try {
      const parsed = new URL(publicUrl)
      if (parsed.protocol !== "https:") return false
      return true
    } catch {
      return false
    }
  })()

  // Check if GitHub repo info is available from project link or deployment metadata
  const hasGitHubRepoInfo = Boolean(
    selectedProject?.link?.repo || selectedProject?.latestDeployments?.[0]?.meta?.githubRepo
  )

  // Restore state from URL whenever searchParams change (after initial load)
  // This handles the case where user navigates via browser back/forward
  useEffect(() => {
    if (!isOpen) return

    // Don't interfere with the "running" state - it's controlled by workflow execution, not URL
    if (step === "running") return

    const typeParam = searchParams.get("type")
    const targetParam = searchParams.get("target")
    const urlParam = searchParams.get("url")
    const teamParam = searchParams.get("team")
    const projectParam = searchParams.get("project")
    const target = getAnalysisTarget(typeParam, targetParam)

    // Only update if there's a meaningful change from current state
    if (typeParam && typeParam !== _selectedType) {
      setSelectedType(typeParam)
    }
    if (target !== selectedTarget) {
      setSelectedTarget(target)
    }
    if (target === "url" && urlParam && urlParam !== publicUrl) {
      setPublicUrl(urlParam)
    }

    // Determine the correct step based on URL params
    const targetStep: WorkflowStep = !typeParam
      ? "type"
      : target === "url"
        ? "options"
        : projectParam
          ? "options"
          : teamParam
            ? "project"
            : "team"

    if (targetStep !== step) {
      setStep(targetStep)
    }

    // Reset selections if params are removed
    if (!typeParam) {
      setSelectedType("")
      if (!targetParam) setSelectedTarget("")
      setSelectedTeam(null)
      setSelectedProject(null)
    }
  }, [isOpen, searchParams, step, _selectedType, selectedTarget, publicUrl])

  // Reset modal state when closed
  useEffect(() => {
    if (!isOpen) {
      setStep("type")
      setSelectedType("")
      setSelectedTarget("")
      setSelectedTeam(null)
      setSelectedProject(null)
      setProjects([])
      setTeams([])
      setWorkflowStatus("")
      setWorkflowResult(null)
      setActiveRunId(null)
      setSandboxUrl(null)
      setBaseBranch("main")
      setAutoCreatePR(true)
      setBypassToken("")
      setNeedsBypassToken(false)
      setCustomPrompt("")
      setPublicUrl("")
      setStartPath("/")
      setProjectsError(null)
      setProjectSearch("")
      setDebouncedProjectSearch("")
      setRecentProjects([])
      setAvailableBranches([])
      setLoadingBranches(false)
      setBranchesError(false)
      loadedTeamIdRef.current = null
      router.replace("/workflows", { scroll: false })
    }
  }, [isOpen, router])

  // Load teams when needed
  // biome-ignore lint/correctness/useExhaustiveDependencies: loadTeams is stable and doesn't need to be a dependency
  useEffect(() => {
    if (!isUrlAuditType && ["team", "project", "options"].includes(step) && teams.length === 0 && !loadingTeams) {
      loadTeams()
    }
  }, [step, teams.length, loadingTeams, isUrlAuditType])

  // Restore team from URL once teams are loaded
  useEffect(() => {
    if (isUrlAuditType) return
    const teamParam = searchParams.get("team")
    if (teamParam && teams.length > 0) {
      // Update team if URL param differs from currently selected team
      if (!selectedTeam || selectedTeam.id !== teamParam) {
        const team = teams.find((t) => t.id === teamParam)
        if (team) {
          setSelectedTeam(team)
        }
      }
    }
  }, [teams, searchParams, selectedTeam, isUrlAuditType])

  // Load projects when team selected
  // biome-ignore lint/correctness/useExhaustiveDependencies: loadProjects is stable and doesn't need to be a dependency
  useEffect(() => {
    if (isUrlAuditType) return
    if (!selectedTeam) return
    const searchKey = `${selectedTeam.id}:${debouncedProjectSearch}`
    if (!loadingProjects && loadedTeamIdRef.current !== searchKey) {
      loadedTeamIdRef.current = searchKey
      loadProjects(selectedTeam, debouncedProjectSearch)
    }
  }, [selectedTeam, loadingProjects, debouncedProjectSearch, isUrlAuditType])

  // Debounce project search input
  useEffect(() => {
    const timeout = setTimeout(() => {
      setDebouncedProjectSearch(projectSearch.trim())
    }, 300)
    return () => clearTimeout(timeout)
  }, [projectSearch])

  // Load branches when project and team are selected and on options step
  // biome-ignore lint/correctness/useExhaustiveDependencies: loadBranches is stable (defined in component scope)
  useEffect(() => {
    if (isUrlAuditType) return
    if (
      selectedProject &&
      selectedTeam &&
      step === "options" &&
      availableBranches.length === 0 &&
      !loadingBranches &&
      !branchesError
    ) {
      loadBranches(selectedProject, selectedTeam)
    }
  }, [selectedProject, selectedTeam, step, availableBranches.length, loadingBranches, branchesError, isUrlAuditType])

  // Poll workflow status when running
  useEffect(() => {
    if (!userId || step !== "running") return

    const pollStatus = async () => {
      try {
        // Use production API for consistent status (same domain as start-fix)
        const response = await fetch(`${DEV3000_API_URL}/api/workflows?userId=${userId}`)
        if (!response.ok) return

        const data = (await response.json()) as {
          success?: boolean
          runs?: Array<{
            id: string
            projectName?: string
            status?: string
            currentStep?: string
            sandboxUrl?: string
            reportBlobUrl?: string
            prUrl?: string
            error?: string
          }>
        }
        if (!data.success || !Array.isArray(data.runs)) return

        // Find the run - either by activeRunId or by matching project + running status
        let run:
          | {
              id: string
              projectName?: string
              status?: string
              currentStep?: string
              sandboxUrl?: string
              reportBlobUrl?: string
              prUrl?: string
              error?: string
            }
          | undefined
        if (activeRunId) {
          run = data.runs.find((r) => r.id === activeRunId)
        } else if (selectedProject) {
          // Find the most recent running workflow for this project
          run = data.runs.find((r) => r.projectName === selectedProject.name && r.status === "running")
          if (run) {
            setActiveRunId(run.id)
          }
        }
        if (!run) return

        if (redirectedRunId !== run.id) {
          setRedirectedRunId(run.id)
          router.push(`/workflows/${run.id}/report`)
        }

        // Update status from real backend data
        if (run.currentStep) {
          setWorkflowStatus(run.currentStep)
        }
        if (run.sandboxUrl) {
          setSandboxUrl(run.sandboxUrl)
        }

        // Check for completion
        if (run.status === "done") {
          setWorkflowStatus("Workflow completed successfully!")
          setWorkflowResult({
            success: true,
            blobUrl: run.reportBlobUrl,
            runId: run.id,
            pr: run.prUrl ? { prUrl: run.prUrl } : null
          })
        } else if (run.status === "failure") {
          setWorkflowStatus(`Workflow failed: ${run.error || "Unknown error"}`)
        }
      } catch (error) {
        console.error("[Poll Status] Error:", error)
      }
    }

    // Poll every 3 seconds
    const interval = setInterval(pollStatus, 3000)
    // Also poll immediately
    pollStatus()

    return () => clearInterval(interval)
  }, [activeRunId, userId, step, selectedProject, redirectedRunId, router])

  // Load GitHub PAT from localStorage when on options step
  useEffect(() => {
    if (step === "options" && !githubPat) {
      const storedPat = localStorage.getItem("d3k_github_pat")
      if (storedPat) {
        console.log("[GitHub PAT] Loaded from localStorage")
        setGithubPat(storedPat)
      }
    }
  }, [step, githubPat])

  // Check if deployment is protected when project is selected and on options step
  useEffect(() => {
    async function checkDeploymentProtection() {
      console.log("[Bypass Token] useEffect triggered - step:", step, "selectedProject:", selectedProject?.name)

      if (!selectedProject) {
        console.log("[Bypass Token] No selected project, skipping check")
        return
      }

      if (step !== "options") {
        console.log("[Bypass Token] Not on options step, skipping check")
        return
      }

      // Reset token when project changes to avoid stale values
      setBypassToken("")

      // First priority: URL param (bypass or bypassToken)
      const urlBypassToken = searchParams.get("bypass") || searchParams.get("bypassToken")
      if (urlBypassToken) {
        console.log("[Bypass Token] Found token in URL param")
        setBypassToken(urlBypassToken)
        const storageKey = getBypassTokenStorageKey(selectedProject.id)
        localStorage.setItem(storageKey, urlBypassToken)
      } else {
        // Second priority: Load stored token for this project from localStorage
        const storageKey = getBypassTokenStorageKey(selectedProject.id)
        const storedToken = localStorage.getItem(storageKey)
        if (storedToken) {
          console.log("[Bypass Token] Found stored token for project", selectedProject.id)
          setBypassToken(storedToken)
        }
      }

      const latestDeployment = selectedProject.latestDeployments[0]
      if (!latestDeployment) {
        console.log("[Bypass Token] No latest deployment, skipping check")
        return
      }

      setIsCheckingProtection(true)
      console.log("[Bypass Token] Checking deployment protection...")
      try {
        const devUrl = `https://${latestDeployment.url}`
        console.log("[Bypass Token] Checking URL:", devUrl)

        // Use server-side API route to avoid CORS issues
        const response = await fetch("/api/projects/check-protection", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: devUrl })
        })

        const data = await response.json()
        console.log("[Bypass Token] Protection check result:", data)

        setNeedsBypassToken(data.isProtected)
      } catch (error) {
        console.error("[Bypass Token] Failed to check deployment protection:", error)
        // Assume not protected on error
        setNeedsBypassToken(false)
      } finally {
        setIsCheckingProtection(false)
      }
    }

    checkDeploymentProtection()
  }, [selectedProject, step, searchParams, getBypassTokenStorageKey])

  // Load recent projects for the selected team
  useEffect(() => {
    if (isUrlAuditType) return
    if (!selectedTeam) return
    setRecentProjects(readRecentProjects(selectedTeam.id))
  }, [selectedTeam, isUrlAuditType])

  // Persist recent projects when a selection is made
  useEffect(() => {
    if (isUrlAuditType) return
    if (!selectedTeam || !selectedProject) return
    const next = addRecentProject(selectedTeam.id, { id: selectedProject.id, name: selectedProject.name })
    setRecentProjects(next)
  }, [selectedTeam, selectedProject, isUrlAuditType])

  async function loadTeams() {
    setLoadingTeams(true)
    try {
      const response = await fetch("/api/teams")
      const data = await response.json()
      if (data.success) {
        // Sort teams alphabetically by name (personal account first if present, then alphabetically)
        const sortedTeams = [...data.teams].sort((a, b) => {
          // Personal accounts first
          if (a.isPersonal && !b.isPersonal) return -1
          if (!a.isPersonal && b.isPersonal) return 1
          // Then alphabetically by name (case-insensitive)
          return a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
        })
        setTeams(sortedTeams)
      }
    } catch (error) {
      console.error("Failed to load teams:", error)
    } finally {
      setLoadingTeams(false)
    }
  }

  async function loadBranches(project: Project, team: Team) {
    setLoadingBranches(true)
    setBranchesError(false)
    try {
      const url = team.isPersonal
        ? `/api/projects/branches?projectId=${project.id}`
        : `/api/projects/branches?projectId=${project.id}&teamId=${team.id}`
      console.log("Fetching branches from:", url)
      const response = await fetch(url)
      const data = await response.json()
      console.log("Branches response:", data)

      if (data.success && data.branches) {
        setAvailableBranches(data.branches)
        // If current baseBranch is not in the list, reset to first available or "main"
        if (data.branches.length > 0 && !data.branches.some((b: { name: string }) => b.name === baseBranch)) {
          const mainBranch = data.branches.find((b: { name: string }) => b.name === "main")
          setBaseBranch(mainBranch?.name || data.branches[0].name)
        }
      } else {
        // API call succeeded but returned error (like 403)
        setBranchesError(true)
        console.warn("Failed to fetch branches:", data.error)
      }
    } catch (error) {
      console.error("Failed to load branches:", error)
      setBranchesError(true)
    } finally {
      setLoadingBranches(false)
    }
  }

  async function loadProjects(team: Team, search?: string) {
    setLoadingProjects(true)
    setProjectsError(null)
    try {
      const params = new URLSearchParams()
      if (!team.isPersonal) {
        params.set("teamId", team.id)
      }
      if (search) {
        params.set("search", search)
      }
      const url = params.toString() ? `/api/projects?${params.toString()}` : "/api/projects"
      console.log("Fetching projects from:", url)
      const response = await fetch(url)
      const data = await response.json()
      console.log("Projects response:", data)

      if (data.success) {
        setProjects(data.projects)
        if (data.projects.length === 0) {
          setProjectsError("No projects found for this account")
        }
      } else {
        const errorMsg = `Failed to fetch projects: ${data.error || "Unknown error"}`
        console.error(errorMsg)
        setProjectsError(errorMsg)
      }
    } catch (error) {
      const errorMsg = `Failed to load projects: ${error instanceof Error ? error.message : String(error)}`
      console.error(errorMsg, error)
      setProjectsError(errorMsg)
    } finally {
      setLoadingProjects(false)
    }
  }

  const loadProjectById = useCallback(async (projectId: string, team: Team) => {
    setLoadingProjectById(true)
    try {
      const params = new URLSearchParams()
      if (!team.isPersonal) {
        params.set("teamId", team.id)
      }
      const url = params.toString() ? `/api/projects/${projectId}?${params.toString()}` : `/api/projects/${projectId}`
      console.log("Fetching project by id from:", url)
      const response = await fetch(url)
      const data = await response.json()
      if (data.success && data.project) {
        setSelectedProject(data.project)
      } else {
        const errorMsg = `Failed to fetch project: ${data.error || "Unknown error"}`
        console.error(errorMsg)
        setProjectsError(errorMsg)
      }
    } catch (error) {
      const errorMsg = `Failed to load project: ${error instanceof Error ? error.message : String(error)}`
      console.error(errorMsg, error)
      setProjectsError(errorMsg)
    } finally {
      setLoadingProjectById(false)
    }
  }, [])

  // Restore project from URL once projects are loaded
  useEffect(() => {
    if (isUrlAuditType) return
    const projectParam = searchParams.get("project")
    if (!projectParam || !selectedTeam) return

    // Update if no project selected OR if the URL project differs from selected
    if (!selectedProject || selectedProject.id !== projectParam) {
      const project = projects.find((p) => p.id === projectParam)
      if (project) {
        setSelectedProject(project)
        return
      }
      if (!loadingProjectById) {
        loadProjectById(projectParam, selectedTeam)
      }
    }
  }, [projects, searchParams, selectedProject, selectedTeam, loadingProjectById, loadProjectById, isUrlAuditType])

  async function startWorkflow() {
    console.log("[Start Workflow] Function called")
    console.log("[Start Workflow] selectedProject:", selectedProject)
    console.log("[Start Workflow] selectedTeam:", selectedTeam)

    if (!isUrlAuditType && (!selectedProject || !selectedTeam)) {
      console.log("[Start Workflow] Missing project or team, returning")
      return
    }
    if (isUrlAuditType && !isValidPublicUrl) {
      setWorkflowStatus("Error: Enter a valid public https:// URL")
      return
    }
    const project = selectedProject

    // Reset any previous workflow result to prevent showing stale data
    setWorkflowResult(null)
    setActiveRunId(null)
    setSandboxUrl(null)

    setStep("running")
    setWorkflowStatus("Starting workflow...")

    try {
      // Get the latest deployment URL
      console.log("[Start Workflow] latestDeployments:", project?.latestDeployments)
      let devUrl: string | undefined
      let latestDeployment: Project["latestDeployments"][number] | undefined
      if (!isUrlAuditType) {
        latestDeployment = project?.latestDeployments[0]
        if (!latestDeployment) {
          throw new Error("No deployments found for this project")
        }
        devUrl = `https://${latestDeployment.url}`
        console.log("[Start Workflow] devUrl:", devUrl)
      }

      // Extract repo info from project link or deployment metadata
      let repoOwner: string | undefined
      let repoName: string | undefined

      // Debug: log what we have
      console.log("[Start Workflow] project.link:", selectedProject?.link)
      console.log("[Start Workflow] latestDeployment.meta:", latestDeployment?.meta)

      if (project?.link?.org && project.link.repo) {
        repoOwner = project.link.org
        repoName = project.link.repo
        console.log(`[Start Workflow] Using repo info from project.link: ${repoOwner}/${repoName}`)
      } else if (latestDeployment?.meta?.githubOrg && latestDeployment.meta.githubRepo) {
        // Fallback: use deployment metadata when project.link is missing
        repoOwner = latestDeployment.meta.githubOrg
        repoName = latestDeployment.meta.githubRepo
        console.log(`[Start Workflow] Using repo info from deployment meta: ${repoOwner}/${repoName}`)
      } else {
        console.log("[Start Workflow] WARNING: No repo info found in project.link or deployment.meta")
      }

      // Map URL param type to workflow type
      const workflowType =
        _selectedType === "cloud-fix"
          ? "cls-fix"
          : _selectedType === "design-guidelines"
            ? "design-guidelines"
            : _selectedType === "react-performance"
              ? "react-performance"
              : "prompt"

      const body: Record<string, unknown> = {
        devUrl,
        projectName: isUrlAuditType ? new URL(publicUrl).hostname : project?.name,
        userId,
        bypassToken,
        workflowType,
        analysisTargetType: isUrlAuditType ? "url" : "vercel-project",
        publicUrl: isUrlAuditType ? publicUrl : undefined,
        customPrompt: workflowType === "prompt" ? customPrompt : undefined,
        crawlDepth: workflowType === "design-guidelines" ? crawlDepth : undefined,
        githubPat: autoCreatePR && githubPat ? githubPat : undefined,
        startPath: startPath !== "/" ? startPath : undefined // Only send if not default
      }

      if (project?.rootDirectory) {
        body.projectDir = project.rootDirectory
      }

      // If we have repo info, pass it for sandbox creation
      // Use the deployment's git SHA if available, otherwise fall back to baseBranch
      if (!isUrlAuditType && repoOwner && repoName) {
        body.repoUrl = `https://github.com/${repoOwner}/${repoName}`
        const gitRef = latestDeployment?.gitSource?.sha || baseBranch || "main"
        body.repoBranch = gitRef
        console.log(
          `[Start Workflow] Using git reference: ${gitRef} (${latestDeployment?.gitSource?.sha ? "SHA from deployment" : "branch name"})`
        )
      }

      if (!isUrlAuditType && autoCreatePR && repoOwner && repoName) {
        body.repoOwner = repoOwner
        body.repoName = repoName
        body.baseBranch = baseBranch
      }

      // Initial status - will be updated by polling
      setWorkflowStatus("Starting workflow...")

      // Always call the production API directly - this ensures workflows run on Vercel
      // infrastructure with full durability and observability, whether we're running
      // locally or in production. The production API has CORS headers configured.
      // NOTE: Use dev3000.ai directly (not d3k.dev) to avoid redirect which breaks CORS preflight
      const apiUrl = `${DEV3000_API_URL}/api/cloud/start-fix`

      console.log("[Start Workflow] API URL:", apiUrl)
      console.log("[Start Workflow] Request body:", body)
      console.log("[Start Workflow] Body keys:", Object.keys(body))
      console.log("[Start Workflow] body.repoUrl:", body.repoUrl)
      console.log("[Start Workflow] body.repoOwner:", body.repoOwner)
      const githubPatValue = body.githubPat
      console.log(
        "[Start Workflow] body.githubPat:",
        typeof githubPatValue === "string" && githubPatValue.length > 0
          ? `SET (length: ${githubPatValue.length})`
          : "NOT SET"
      )

      // Create an AbortController for timeout handling
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 10 * 60 * 1000) // 10 minute timeout (matches server maxDuration)

      try {
        console.log("[Start Workflow] Making fetch request...")
        console.log("[Start Workflow] About to stringify body...")
        const bodyString = JSON.stringify(body)
        console.log("[Start Workflow] Body stringified successfully, length:", bodyString.length)
        console.log("[Start Workflow] FULL BODY STRING:", bodyString)
        console.log("[Start Workflow] Calling fetch with URL:", apiUrl)

        // Get access token for Authorization header (needed for cross-origin requests)
        const tokenResponse = await fetch("/api/auth/token")
        console.log("[Start Workflow] Token response status:", tokenResponse.status)

        if (!tokenResponse.ok) {
          const tokenError = await tokenResponse.text()
          console.error("[Start Workflow] Token fetch failed:", tokenResponse.status, tokenError)
          throw new Error(`Authentication failed: ${tokenError}`)
        }

        const tokenData = await tokenResponse.json()
        const accessToken = tokenData.accessToken
        console.log(
          "[Start Workflow] Got access token:",
          accessToken ? `yes (length: ${accessToken.length})` : "NO TOKEN"
        )

        if (!accessToken) {
          throw new Error("No access token available. Please sign in again.")
        }

        const headers: HeadersInit = { "Content-Type": "application/json" }
        // Always include Authorization header for production API
        headers.Authorization = `Bearer ${accessToken}`

        const response = await fetch(apiUrl, {
          method: "POST",
          headers,
          body: bodyString,
          credentials: "include",
          signal: controller.signal
        })

        console.log("[Start Workflow] Fetch completed, status:", response.status)

        clearTimeout(timeoutId)

        if (!response.ok) {
          const errorText = await response.text()
          throw new Error(`API returned ${response.status}: ${errorText}`)
        }

        const result = await response.json()

        // Set activeRunId for polling - let polling handle status updates
        if (result.runId) {
          setActiveRunId(result.runId)
          if (redirectedRunId !== result.runId) {
            setRedirectedRunId(result.runId)
            router.push(`/workflows/${result.runId}/report`)
          }
        }

        // Don't immediately show completion - let polling verify the workflow status
        // The API may return success=true but polling should confirm the backend state
        // This prevents showing "completed" while the workflow is still running
        if (!result.success) {
          setWorkflowStatus(`Workflow failed: ${result.error}`)
        }
        // If success, let polling update the status when it confirms the run is "done"
      } catch (fetchError) {
        clearTimeout(timeoutId)
        if (fetchError instanceof Error && fetchError.name === "AbortError") {
          throw new Error("Workflow timed out after 10 minutes")
        }
        throw fetchError
      }
    } catch (error) {
      console.error("[Start Workflow] OUTER ERROR caught:", error)
      console.error("[Start Workflow] Error type:", error?.constructor?.name)
      console.error("[Start Workflow] Error stack:", error instanceof Error ? error.stack : "no stack")

      let errorMessage = error instanceof Error ? error.message : String(error)

      if (error instanceof TypeError && errorMessage === "Failed to fetch") {
        errorMessage =
          "Network error: Unable to connect to API. This might be a CORS issue, network problem, or Content Security Policy blocking the request."
      }

      setWorkflowStatus(`Error: ${errorMessage}`)
    }
  }

  if (!isOpen) return null

  const progressSteps = isUrlAuditType
    ? (["type", "options", "running"] as WorkflowStep[])
    : (["type", "team", "project", "options", "running"] as WorkflowStep[])
  const progressLabels = isUrlAuditType ? ["Mode", "Options", "Run"] : ["Type", "Team", "Project", "Options", "Run"]
  const currentProgressIndex = progressSteps.indexOf(step)

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-card rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto border border-border">
        <div className="p-6">
          <div className="flex justify-between items-start mb-6">
            <h2 className="text-2xl font-bold text-foreground">New d3k Workflow</h2>
            <button
              type="button"
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground"
              aria-label="Close modal"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Progress indicator */}
          <div className="mb-8">
            <div className="flex items-center">
              {progressSteps.map((s, index) => (
                <div key={s} className="flex items-center flex-1">
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center ${
                      step === s
                        ? "bg-blue-600 text-white"
                        : currentProgressIndex > index
                          ? "bg-green-600 text-white"
                          : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {index + 1}
                  </div>
                  {index < progressSteps.length - 1 && (
                    <div className="flex-1 mx-2">
                      <Progress value={currentProgressIndex > index ? 100 : 0} className="h-1" />
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="flex items-center mt-2">
              {progressLabels.map((label, index) => (
                <div key={label} className="flex items-center flex-1">
                  <span className="text-xs text-muted-foreground w-8 text-center">{label}</span>
                  {index < progressLabels.length - 1 && <div className="flex-1 mx-2" />}
                </div>
              ))}
            </div>
          </div>

          {/* Step 1: Select Workflow Type */}
          {step === "type" && (
            <div>
              {!selectedTarget ? (
                <>
                  <h3 className="text-lg font-semibold mb-4 text-foreground">Choose Analysis Target</h3>
                  <div className="space-y-3">
                    <Link
                      href="/workflows/new?target=project"
                      className="block w-full p-4 border-2 border-gray-300 dark:border-gray-600 rounded-lg hover:border-blue-500 hover:bg-accent text-left transition-colors"
                    >
                      <div className="font-semibold text-foreground">Analyze a Vercel Project</div>
                      <div className="text-sm text-muted-foreground mt-1">
                        Run code-aware workflows with sandbox edits, validation, and optional PR creation.
                      </div>
                    </Link>
                    <Link
                      href="/workflows/new?target=url"
                      className="block w-full p-4 border-2 border-orange-300/60 dark:border-orange-600/60 rounded-lg hover:border-orange-500 hover:bg-accent text-left transition-colors"
                    >
                      <div className="font-semibold text-foreground">Analyze an URL</div>
                      <div className="text-sm text-muted-foreground mt-1">
                        Run a read-only external audit on a public `https://` URL with prioritized guidance.
                      </div>
                    </Link>
                  </div>
                </>
              ) : selectedTarget === "project" ? (
                <>
                  <h3 className="text-lg font-semibold mb-4 text-foreground">Choose Project Workflow</h3>
                  <div className="space-y-3">
                    <Link
                      href="/workflows/new?target=project&type=design-guidelines"
                      className="block w-full p-4 border-2 border-gray-300 dark:border-gray-600 rounded-lg hover:border-blue-500 hover:bg-accent text-left transition-colors"
                    >
                      <div className="font-semibold text-foreground">Design Guidelines Review</div>
                      <div className="text-sm text-muted-foreground mt-1">
                        Evaluate your site against Vercel design guidelines and automatically fix issues
                      </div>
                      <div className="text-xs text-muted-foreground mt-2">
                        Skills: {workflowSkillLabels["design-guidelines"].join(", ")}
                      </div>
                    </Link>
                    <Link
                      href="/workflows/new?target=project&type=react-performance"
                      className="block w-full p-4 border-2 border-gray-300 dark:border-gray-600 rounded-lg hover:border-blue-500 hover:bg-accent text-left transition-colors"
                    >
                      <div className="font-semibold text-foreground">React Performance Review</div>
                      <div className="text-sm text-muted-foreground mt-1">
                        Analyze React/Next.js code for performance issues and apply optimizations
                      </div>
                      <div className="text-xs text-muted-foreground mt-2">
                        Skills: {workflowSkillLabels["react-performance"].join(", ")}
                      </div>
                    </Link>
                    <Link
                      href="/workflows/new?target=project&type=cloud-fix"
                      className="block w-full p-4 border-2 border-gray-300 dark:border-gray-600 rounded-lg hover:border-blue-500 hover:bg-accent text-left transition-colors"
                    >
                      <div className="font-semibold text-foreground">CLS Fix</div>
                      <div className="text-sm text-muted-foreground mt-1">
                        Detect and fix Cumulative Layout Shift issues automatically
                      </div>
                      <div className="text-xs text-muted-foreground mt-2">
                        Skills: {workflowSkillLabels["cls-fix"].join(", ")}
                      </div>
                    </Link>
                    <Link
                      href="/workflows/new?target=project&type=prompt"
                      className="block w-full p-4 border-2 border-gray-300 dark:border-gray-600 rounded-lg hover:border-blue-500 hover:bg-accent text-left transition-colors"
                    >
                      <div className="font-semibold text-foreground">Prompt</div>
                      <div className="text-sm text-muted-foreground mt-1">
                        Run a custom AI workflow with your own instructions
                      </div>
                      <div className="text-xs text-muted-foreground mt-2">
                        Skills: {workflowSkillLabels.prompt.join(", ")}
                      </div>
                    </Link>
                  </div>
                  <Link
                    href="/workflows/new"
                    className="mt-4 inline-block px-4 py-2 text-muted-foreground hover:text-foreground"
                  >
                    ← Back
                  </Link>
                </>
              ) : (
                <>
                  <h3 className="text-lg font-semibold mb-4 text-foreground">Choose URL Analysis Type</h3>
                  <div className="space-y-3">
                    <Link
                      href="/workflows/new?target=url&type=design-guidelines"
                      className="block w-full p-4 border-2 border-orange-300/60 dark:border-orange-600/60 rounded-lg hover:border-orange-500 hover:bg-accent text-left transition-colors"
                    >
                      <div className="font-semibold text-foreground">Design Guidelines Review</div>
                      <div className="text-sm text-muted-foreground mt-1">
                        Evaluate a public URL against Vercel design guidelines with prioritized recommendations.
                      </div>
                      <div className="text-xs text-muted-foreground mt-2">
                        Skills: {workflowSkillLabels["design-guidelines"].join(", ")}
                      </div>
                    </Link>
                    <Link
                      href="/workflows/new?target=url&type=react-performance"
                      className="block w-full p-4 border-2 border-orange-300/60 dark:border-orange-600/60 rounded-lg hover:border-orange-500 hover:bg-accent text-left transition-colors"
                    >
                      <div className="font-semibold text-foreground">React Performance Review</div>
                      <div className="text-sm text-muted-foreground mt-1">
                        External React-focused performance review from runtime signals (read-only).
                      </div>
                      <div className="text-xs text-muted-foreground mt-2">
                        Skills: {workflowSkillLabels["react-performance"].join(", ")}
                      </div>
                    </Link>
                  </div>
                  <Link
                    href="/workflows/new"
                    className="mt-4 inline-block px-4 py-2 text-muted-foreground hover:text-foreground"
                  >
                    ← Back
                  </Link>
                </>
              )}
              {/* Reserve space for Back link to prevent CLS */}
              <div className="mt-4 h-10" aria-hidden="true" />
            </div>
          )}

          {/* Step 2: Select Team */}
          {step === "team" && (
            <div>
              <h3 className="text-lg font-semibold mb-4 text-foreground">Select Team</h3>
              {loadingTeams ? (
                <div className="text-center py-8 text-muted-foreground">Loading teams...</div>
              ) : (
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {teams.map((team) => (
                    <Link
                      key={team.id}
                      href={`/workflows/new?type=${_selectedType}&team=${team.id}`}
                      className="block w-full p-4 border-2 border-gray-300 dark:border-gray-600 rounded-lg hover:border-blue-500 hover:bg-accent text-left transition-colors"
                    >
                      <div className="font-semibold text-foreground">{team.name}</div>
                      <div className="text-sm text-muted-foreground">
                        {team.isPersonal ? "Personal Account" : "Team"} • {team.id}
                      </div>
                    </Link>
                  ))}
                </div>
              )}
              <Link
                href="/workflows/new?target=project"
                className="mt-4 inline-block px-4 py-2 text-muted-foreground hover:text-foreground"
              >
                ← Back
              </Link>
            </div>
          )}

          {/* Step 3: Select Project */}
          {step === "project" && (
            <div>
              <h3 className="text-lg font-semibold mb-4 text-foreground">Select Project</h3>
              {selectedTeam && (
                <div className="mb-4 text-sm text-muted-foreground">
                  Team: <span className="font-semibold">{selectedTeam.name}</span>
                </div>
              )}
              <div className="mb-4">
                <Label htmlFor={projectSearchId} className="text-sm text-muted-foreground">
                  Search projects by name
                </Label>
                <input
                  id={projectSearchId}
                  type="text"
                  value={projectSearch}
                  onChange={(event) => setProjectSearch(event.target.value)}
                  placeholder="Search projects..."
                  className="mt-2 w-full px-3 py-2 border border-border rounded-md bg-background text-foreground"
                />
              </div>
              {projectsError && (
                <Alert variant="destructive" className="mb-4">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>Error</AlertTitle>
                  <AlertDescription>{projectsError}</AlertDescription>
                </Alert>
              )}
              {loadingProjects ? (
                <div className="text-center py-8 text-muted-foreground">
                  {debouncedProjectSearch ? "Searching projects..." : "Loading projects..."}
                </div>
              ) : recentProjects.length === 0 && projects.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  {projectsError
                    ? "Unable to load projects"
                    : debouncedProjectSearch
                      ? "No matches found"
                      : "No projects found"}
                </div>
              ) : (
                <div className="space-y-4 max-h-96 overflow-y-auto">
                  {recentProjects.length > 0 && (
                    <div className="space-y-2">
                      <div className="text-xs uppercase tracking-wide text-muted-foreground">Recent</div>
                      {recentProjects.map((project) => {
                        const fullProject = projects.find((item) => item.id === project.id)
                        return (
                          <Link
                            key={project.id}
                            href={`/workflows/new?type=${_selectedType}&team=${selectedTeam?.id}&project=${project.id}`}
                            onClick={() => {
                              if (selectedTeam) {
                                const next = addRecentProject(selectedTeam.id, project)
                                setRecentProjects(next)
                              }
                            }}
                            className="block w-full p-4 border-2 border-gray-300 dark:border-gray-600 rounded-lg hover:border-blue-500 hover:bg-accent text-left transition-colors"
                          >
                            <div className="font-semibold text-foreground">{project.name}</div>
                            {fullProject?.latestDeployments?.[0] && (
                              <div className="text-sm text-muted-foreground mt-1">
                                Latest: {fullProject.latestDeployments[0].url}
                              </div>
                            )}
                          </Link>
                        )
                      })}
                    </div>
                  )}
                  <div className="space-y-2">
                    {recentProjects.length > 0 && (
                      <div className="text-xs uppercase tracking-wide text-muted-foreground">All projects</div>
                    )}
                    {projects.length === 0 && debouncedProjectSearch && (
                      <div className="text-sm text-muted-foreground">No matches found</div>
                    )}
                    {projects.map((project) => (
                      <Link
                        key={project.id}
                        href={`/workflows/new?type=${_selectedType}&team=${selectedTeam?.id}&project=${project.id}`}
                        onClick={() => {
                          if (selectedTeam) {
                            const next = addRecentProject(selectedTeam.id, { id: project.id, name: project.name })
                            setRecentProjects(next)
                          }
                        }}
                        className="block w-full p-4 border-2 border-gray-300 dark:border-gray-600 rounded-lg hover:border-blue-500 hover:bg-accent text-left transition-colors"
                      >
                        <div className="font-semibold text-foreground">{project.name}</div>
                        <div className="text-sm text-muted-foreground mt-1">
                          {project.framework && <span className="mr-2">Framework: {project.framework}</span>}
                          {project.latestDeployments[0] && <span>Latest: {project.latestDeployments[0].url}</span>}
                        </div>
                      </Link>
                    ))}
                  </div>
                </div>
              )}
              <Link
                href={`/workflows/new?target=project&type=${_selectedType}`}
                className="mt-4 inline-block px-4 py-2 text-muted-foreground hover:text-foreground"
              >
                ← Back
              </Link>
            </div>
          )}

          {/* Step 4: Configure Options */}
          {step === "options" && (
            <div>
              <h3 className="text-lg font-semibold mb-4 text-foreground">Configure Options</h3>
              {isUrlAuditType ? (
                <>
                  <div className="mb-6 p-4 bg-muted rounded-lg text-left">
                    <div className="text-sm text-muted-foreground mb-1">Mode</div>
                    <div className="font-semibold text-foreground">
                      {_selectedType === "react-performance"
                        ? "React Performance Review"
                        : "Vercel Design Guidelines Review"}
                    </div>
                  </div>
                  <div className="space-y-4">
                    <div>
                      <Label htmlFor={publicUrlId} className="block text-sm font-medium text-foreground mb-1">
                        Public URL
                        <span className="text-red-500 ml-1">*</span>
                      </Label>
                      <input
                        type="url"
                        id={publicUrlId}
                        value={publicUrl}
                        onChange={(e) => setPublicUrl(e.target.value)}
                        className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground font-mono text-sm"
                        placeholder="https://example.com"
                        required
                      />
                      <p className="mt-1 text-xs text-muted-foreground">
                        Must be a publicly reachable https URL. Private/localhost addresses are blocked.
                      </p>
                    </div>

                    <div>
                      <Label htmlFor={crawlDepthId} className="block text-sm font-medium text-foreground mb-1">
                        Start Path
                      </Label>
                      <input
                        type="text"
                        id={crawlDepthId}
                        value={startPath}
                        onChange={(e) => setStartPath(e.target.value)}
                        className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground font-mono text-sm"
                        placeholder="/"
                      />
                      <p className="mt-1 text-xs text-muted-foreground">
                        Optional path to prioritize during analysis (e.g. /pricing). Defaults to /.
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-3 mt-6">
                    <Link
                      href="/workflows/new?target=url"
                      className="px-4 py-2 text-muted-foreground hover:text-foreground"
                    >
                      ← Back
                    </Link>
                    <button
                      type="button"
                      onClick={startWorkflow}
                      disabled={!isValidPublicUrl}
                      className="flex-1 px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Start URL Analysis
                    </button>
                  </div>
                </>
              ) : !selectedProject ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Spinner className="mx-auto mb-2" />
                  Loading project details...
                </div>
              ) : (
                <>
                  <div className="mb-6 p-4 bg-muted rounded-lg">
                    <div className="text-sm text-muted-foreground mb-2">Selected Project:</div>
                    <div className="font-semibold text-foreground">{selectedProject.name}</div>
                  </div>
                  <div className="space-y-4">
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id={autoCreatePRId}
                        checked={autoCreatePR}
                        onCheckedChange={(checked) => setAutoCreatePR(checked === true)}
                      />
                      <Label htmlFor={autoCreatePRId} className="text-sm font-normal cursor-pointer">
                        Automatically create GitHub PR with fixes
                      </Label>
                    </div>
                    {autoCreatePR && hasGitHubRepoInfo && (
                      <div>
                        <Label htmlFor={baseBranchId} className="mb-2">
                          Base Branch
                        </Label>
                        {loadingBranches ? (
                          <div className="text-sm text-muted-foreground py-2">Loading branches...</div>
                        ) : availableBranches.length > 0 ? (
                          <>
                            <Select value={baseBranch} onValueChange={setBaseBranch}>
                              <SelectTrigger id={baseBranchId} className="w-full">
                                <SelectValue placeholder="Select a branch" />
                              </SelectTrigger>
                              <SelectContent>
                                {availableBranches.map((branch) => (
                                  <SelectItem key={branch.name} value={branch.name}>
                                    {branch.name} (deployed{" "}
                                    {new Date(branch.lastDeployment.createdAt).toLocaleDateString()})
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <p className="text-xs text-muted-foreground mt-1">
                              Showing branches with recent deployments (last {availableBranches.length} branch
                              {availableBranches.length !== 1 ? "es" : ""})
                            </p>
                          </>
                        ) : (
                          <>
                            <input
                              type="text"
                              id={baseBranchId}
                              value={baseBranch}
                              onChange={(e) => setBaseBranch(e.target.value)}
                              className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground"
                              placeholder="main"
                            />
                            {branchesError && (
                              <p className="text-xs text-amber-600 mt-1">
                                Unable to load branches automatically. Please enter the branch name manually.
                              </p>
                            )}
                          </>
                        )}
                      </div>
                    )}
                    {autoCreatePR && !hasGitHubRepoInfo && (
                      <div className="text-sm text-amber-600">
                        This project is not connected to a GitHub repository. PRs cannot be created automatically.
                      </div>
                    )}
                    {isCheckingProtection && (
                      <div className="text-sm text-muted-foreground">Checking deployment protection...</div>
                    )}
                    {needsBypassToken && (
                      <div>
                        <label htmlFor={bypassTokenId} className="block text-sm font-medium text-foreground mb-1">
                          Deployment Protection Bypass Token
                          <span className="text-red-500 ml-1">*</span>
                        </label>
                        <input
                          type="text"
                          id={bypassTokenId}
                          value={bypassToken}
                          onChange={(e) => {
                            const newToken = e.target.value
                            setBypassToken(newToken)
                            // Save to localStorage for this project
                            if (selectedProject) {
                              const storageKey = getBypassTokenStorageKey(selectedProject.id)
                              if (newToken) {
                                localStorage.setItem(storageKey, newToken)
                                console.log(
                                  "[Bypass Token] Saved token to localStorage for project",
                                  selectedProject.id
                                )
                              } else {
                                localStorage.removeItem(storageKey)
                              }
                            }
                          }}
                          className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground font-mono text-sm"
                          placeholder="Enter your 32-character bypass token"
                          required
                        />
                        <p className="mt-1 text-xs text-muted-foreground">
                          This deployment is protected. Get your bypass token from{" "}
                          {selectedTeam && selectedProject ? (
                            <a
                              href={`https://vercel.com/${selectedTeam.slug}/${selectedProject.name}/settings/deployment-protection#protection-bypass-for-automation`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-600 hover:underline"
                            >
                              Project Settings → Deployment Protection
                            </a>
                          ) : (
                            <a
                              href="https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation"
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-600 hover:underline"
                            >
                              Vercel Dashboard → Project Settings → Deployment Protection
                            </a>
                          )}
                        </p>
                      </div>
                    )}
                    {autoCreatePR && hasGitHubRepoInfo && (
                      <div>
                        <label
                          htmlFor={githubPatId}
                          className="flex items-center gap-1 text-sm font-medium text-foreground mb-1"
                        >
                          GitHub Personal Access Token
                          <span className="text-muted-foreground">(optional)</span>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button type="button" className="text-muted-foreground hover:text-foreground">
                                <HelpCircle className="h-4 w-4" />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent side="right" className="max-w-sm text-left p-3">
                              <p className="font-semibold mb-2">How to create a GitHub PAT:</p>
                              <ol className="list-decimal list-inside space-y-1 text-xs">
                                <li>Go to github.com/settings/tokens?type=beta</li>
                                <li>Click &quot;Generate new token&quot;</li>
                                <li>Give it a name like &quot;d3k-testing&quot;</li>
                                <li>Set expiration (e.g., 30 days)</li>
                                <li>Under Repository access, select your repo</li>
                                <li>
                                  Under Permissions, set:
                                  <ul className="list-disc list-inside ml-3">
                                    <li>Contents: Read and write</li>
                                    <li>Pull requests: Read and write</li>
                                  </ul>
                                </li>
                                <li>Click Generate token</li>
                                <li>Copy the token (starts with github_pat_)</li>
                              </ol>
                            </TooltipContent>
                          </Tooltip>
                        </label>
                        <input
                          type="password"
                          id={githubPatId}
                          value={githubPat}
                          onChange={(e) => {
                            const newPat = e.target.value
                            setGithubPat(newPat)
                            // Save to localStorage
                            if (newPat) {
                              localStorage.setItem("d3k_github_pat", newPat)
                              console.log("[GitHub PAT] Saved to localStorage")
                            } else {
                              localStorage.removeItem("d3k_github_pat")
                              console.log("[GitHub PAT] Removed from localStorage")
                            }
                          }}
                          className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground font-mono text-sm"
                          placeholder="github_pat_xxxx or ghp_xxxx"
                        />
                        <p className="mt-1 text-xs text-muted-foreground">
                          Required to create PRs. Stored locally in your browser.
                          <a
                            href="https://github.com/settings/tokens?type=beta"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="ml-2 text-blue-600 hover:underline"
                          >
                            Open GitHub token settings
                          </a>
                        </p>
                      </div>
                    )}
                    <div>
                      <Label htmlFor={startPathId} className="block text-sm font-medium text-foreground mb-1">
                        Start Path
                      </Label>
                      <input
                        type="text"
                        id={startPathId}
                        value={startPath}
                        onChange={(e) => setStartPath(e.target.value)}
                        className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground font-mono text-sm"
                        placeholder="/"
                      />
                      <p className="mt-1 text-xs text-muted-foreground">
                        The page path to analyze for CLS (e.g., &quot;/&quot;, &quot;/about&quot;,
                        &quot;/products&quot;)
                      </p>
                    </div>
                    {_selectedType === "design-guidelines" && (
                      <div>
                        <Label htmlFor={crawlDepthId} className="block text-sm font-medium text-foreground mb-1">
                          Crawl Depth
                        </Label>
                        <select
                          id={crawlDepthId}
                          value={crawlDepth}
                          onChange={(e) =>
                            setCrawlDepth(e.target.value === "all" ? "all" : Number.parseInt(e.target.value, 10))
                          }
                          className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground text-sm"
                        >
                          <option value={1}>1 - Start path only</option>
                          <option value={2}>2 - Start path + linked pages</option>
                          <option value={3}>3 - Two levels of links</option>
                          <option value="all">All - Crawl entire site</option>
                        </select>
                        <p className="mt-1 text-xs text-muted-foreground">
                          How many pages to audit. Higher depth = more thorough but slower.
                        </p>
                      </div>
                    )}
                    {_selectedType === "prompt" && (
                      <div>
                        <Label htmlFor={customPromptId} className="block text-sm font-medium text-foreground mb-1">
                          Custom Instructions
                          <span className="text-red-500 ml-1">*</span>
                        </Label>
                        <textarea
                          id={customPromptId}
                          value={customPrompt}
                          onChange={(e) => setCustomPrompt(e.target.value)}
                          className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground text-sm min-h-[120px]"
                          placeholder="Describe what you want the AI to do with your codebase..."
                          required
                        />
                        <p className="mt-1 text-xs text-muted-foreground">
                          Be specific about what changes you want. The AI will analyze your codebase and implement the
                          requested changes.
                        </p>
                      </div>
                    )}
                  </div>
                  <div className="flex gap-3 mt-6">
                    <Link
                      href={`/workflows/new?type=${_selectedType}&team=${selectedTeam?.id}`}
                      className="px-4 py-2 text-muted-foreground hover:text-foreground"
                    >
                      ← Back
                    </Link>
                    <button
                      type="button"
                      onClick={startWorkflow}
                      disabled={
                        (needsBypassToken && !bypassToken) || (_selectedType === "prompt" && !customPrompt.trim())
                      }
                      className="flex-1 px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Start Workflow
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Step 5: Running / Results */}
          {step === "running" && (
            <div>
              <h3 className="text-lg font-semibold mb-4 text-foreground">Workflow Status</h3>
              <div className="space-y-4">
                <Alert
                  variant={
                    workflowStatus.includes("Error") || workflowStatus.includes("failed") ? "destructive" : "default"
                  }
                  className={
                    workflowStatus.includes("Error") || workflowStatus.includes("failed")
                      ? ""
                      : "bg-blue-50 border-blue-200 dark:bg-blue-950 dark:border-blue-800"
                  }
                >
                  {workflowStatus.includes("Error") || workflowStatus.includes("failed") ? (
                    <AlertCircle className="h-4 w-4" />
                  ) : (
                    !workflowStatus.includes("completed successfully") && <Spinner className="h-4 w-4" />
                  )}
                  <AlertDescription
                    className={
                      workflowStatus.includes("Error") || workflowStatus.includes("failed")
                        ? ""
                        : "text-blue-900 dark:text-blue-100"
                    }
                  >
                    {workflowStatus}
                  </AlertDescription>
                </Alert>
                {sandboxUrl && !workflowResult && (
                  <Alert className="bg-yellow-50 border-yellow-200 dark:bg-yellow-950 dark:border-yellow-800">
                    <AlertDescription className="text-yellow-900 dark:text-yellow-100">
                      <span className="font-medium">Sandbox:</span>{" "}
                      <a
                        href={sandboxUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:underline font-mono text-sm"
                      >
                        {sandboxUrl}
                      </a>
                    </AlertDescription>
                  </Alert>
                )}
                {workflowResult && workflowStatus.includes("completed successfully") && (
                  <div className="space-y-3">
                    {/* Main action buttons - side by side */}
                    <div className="flex gap-3">
                      <button
                        type="button"
                        onClick={onClose}
                        className="flex-1 px-4 py-2 border border-border rounded-md text-foreground hover:bg-accent"
                      >
                        Done
                      </button>
                      {workflowResult.blobUrl && workflowResult.runId && (
                        <Link
                          href={`/workflows/${workflowResult.runId}/report`}
                          className="flex-1 px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 text-center"
                        >
                          View Report
                        </Link>
                      )}
                    </div>
                    {/* PR link as secondary text link */}
                    {workflowResult.pr?.prUrl && (
                      <div className="text-center">
                        <a
                          href={workflowResult.pr.prUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm text-blue-600 hover:underline"
                        >
                          View GitHub PR →
                        </a>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
