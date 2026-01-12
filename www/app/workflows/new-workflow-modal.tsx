"use client"

import { AlertCircle, HelpCircle } from "lucide-react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { useEffect, useId, useRef, useState } from "react"
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

export default function NewWorkflowModal({ isOpen, onClose, userId }: NewWorkflowModalProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const baseBranchId = useId()
  const autoCreatePRId = useId()
  const bypassTokenId = useId()
  const customPromptId = useId()
  const githubPatId = useId()
  const startPathId = useId()

  // Initialize step from URL params to avoid CLS from cascading useEffects
  const initialStep = (() => {
    const typeParam = searchParams.get("type")
    const teamParam = searchParams.get("team")
    const projectParam = searchParams.get("project")

    if (!typeParam) return "type"
    if (projectParam) return "options"
    if (teamParam) return "project"
    return "team"
  })()

  const [step, setStep] = useState<WorkflowStep>(initialStep)
  const [_selectedType, setSelectedType] = useState<string>(searchParams.get("type") || "")
  const [teams, setTeams] = useState<Team[]>([])
  const [selectedTeam, setSelectedTeam] = useState<Team | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [selectedProject, setSelectedProject] = useState<Project | null>(null)
  const [loadingTeams, setLoadingTeams] = useState(false)
  const [loadingProjects, setLoadingProjects] = useState(false)
  const [projectsError, setProjectsError] = useState<string | null>(null)
  const [workflowStatus, setWorkflowStatus] = useState<string>("")
  // biome-ignore lint/suspicious/noExplicitAny: API response type is dynamic
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [workflowResult, setWorkflowResult] = useState<any>(null)
  const [activeRunId, setActiveRunId] = useState<string | null>(null)
  const [sandboxUrl, setSandboxUrl] = useState<string | null>(null)
  const [baseBranch, setBaseBranch] = useState("main")
  const [autoCreatePR, setAutoCreatePR] = useState(true)
  const [bypassToken, setBypassToken] = useState("")
  const [isCheckingProtection, setIsCheckingProtection] = useState(false)
  const [needsBypassToken, setNeedsBypassToken] = useState(false)
  const [customPrompt, setCustomPrompt] = useState("")
  const [githubPat, setGithubPat] = useState("")
  const [startPath, setStartPath] = useState("/")
  const [crawlDepth, setCrawlDepth] = useState<number | "all">(1)
  const [availableBranches, setAvailableBranches] = useState<
    Array<{ name: string; lastDeployment: { url: string; createdAt: number } }>
  >([])
  const [loadingBranches, setLoadingBranches] = useState(false)
  const [branchesError, setBranchesError] = useState(false)
  const loadedTeamIdRef = useRef<string | null>(null)

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
    const teamParam = searchParams.get("team")
    const projectParam = searchParams.get("project")

    // Only update if there's a meaningful change from current state
    if (typeParam && typeParam !== _selectedType) {
      setSelectedType(typeParam)
    }

    // Determine the correct step based on URL params
    const targetStep: WorkflowStep = !typeParam ? "type" : projectParam ? "options" : teamParam ? "project" : "team"

    if (targetStep !== step) {
      setStep(targetStep)
    }

    // Reset selections if params are removed
    if (!typeParam) {
      setSelectedType("")
      setSelectedTeam(null)
      setSelectedProject(null)
    }
  }, [isOpen, searchParams, step, _selectedType])

  // Reset modal state when closed
  useEffect(() => {
    if (!isOpen) {
      setStep("type")
      setSelectedType("")
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
      setStartPath("/")
      setProjectsError(null)
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
    if (["team", "project", "options"].includes(step) && teams.length === 0 && !loadingTeams) {
      loadTeams()
    }
  }, [step, teams.length, loadingTeams])

  // Restore team from URL once teams are loaded
  useEffect(() => {
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
  }, [teams, searchParams, selectedTeam])

  // Load projects when team selected
  // biome-ignore lint/correctness/useExhaustiveDependencies: loadProjects is stable and doesn't need to be a dependency
  useEffect(() => {
    if (selectedTeam && !loadingProjects && loadedTeamIdRef.current !== selectedTeam.id) {
      loadedTeamIdRef.current = selectedTeam.id
      loadProjects(selectedTeam)
    }
  }, [selectedTeam, loadingProjects])

  // Load branches when project and team are selected and on options step
  useEffect(() => {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadBranches is stable and doesn't need to be a dependency
  }, [selectedProject, selectedTeam, step, availableBranches.length, loadingBranches, branchesError])

  // Poll workflow status when running
  useEffect(() => {
    if (!userId || step !== "running") return

    const pollStatus = async () => {
      try {
        // Use production API for consistent status (same domain as start-fix)
        const response = await fetch(`${DEV3000_API_URL}/api/workflows?userId=${userId}`)
        if (!response.ok) return

        const data = await response.json()
        if (!data.success || !data.runs) return

        // Find the run - either by activeRunId or by matching project + running status
        // biome-ignore lint/suspicious/noExplicitAny: API response type is dynamic
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let run: any = null
        if (activeRunId) {
          // biome-ignore lint/suspicious/noExplicitAny: API response type is dynamic
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          run = data.runs.find((r: any) => r.id === activeRunId)
        } else if (selectedProject) {
          // Find the most recent running workflow for this project
          // biome-ignore lint/suspicious/noExplicitAny: API response type is dynamic
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          run = data.runs.find((r: any) => r.projectName === selectedProject.name && r.status === "running")
          if (run) {
            setActiveRunId(run.id)
          }
        }
        if (!run) return

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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- selectedProject is used for matching but shouldn't re-trigger polling
  }, [activeRunId, userId, step])

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

      // First priority: URL param (bypass or bypassToken)
      const urlBypassToken = searchParams.get("bypass") || searchParams.get("bypassToken")
      if (urlBypassToken) {
        console.log("[Bypass Token] Found token in URL param")
        setBypassToken(urlBypassToken)
      } else {
        // Second priority: Load stored token for this project from localStorage
        const storageKey = `d3k_bypass_token_${selectedProject.id}`
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
  }, [selectedProject, step, searchParams])

  // Restore project from URL once projects are loaded
  useEffect(() => {
    const projectParam = searchParams.get("project")
    if (projectParam && projects.length > 0) {
      // Update if no project selected OR if the URL project differs from selected
      if (!selectedProject || selectedProject.id !== projectParam) {
        const project = projects.find((p) => p.id === projectParam)
        if (project) {
          setSelectedProject(project)
        }
      }
    }
  }, [projects, searchParams, selectedProject])

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

  async function loadProjects(team: Team) {
    setLoadingProjects(true)
    setProjectsError(null)
    try {
      const url = team.isPersonal ? "/api/projects" : `/api/projects?teamId=${team.id}`
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

  async function startWorkflow() {
    console.log("[Start Workflow] Function called")
    console.log("[Start Workflow] selectedProject:", selectedProject)
    console.log("[Start Workflow] selectedTeam:", selectedTeam)

    if (!selectedProject || !selectedTeam) {
      console.log("[Start Workflow] Missing project or team, returning")
      return
    }

    // Reset any previous workflow result to prevent showing stale data
    setWorkflowResult(null)
    setActiveRunId(null)
    setSandboxUrl(null)

    setStep("running")
    setWorkflowStatus("Starting workflow...")

    try {
      // Get the latest deployment URL
      console.log("[Start Workflow] latestDeployments:", selectedProject.latestDeployments)
      const latestDeployment = selectedProject.latestDeployments[0]
      if (!latestDeployment) {
        throw new Error("No deployments found for this project")
      }

      const devUrl = `https://${latestDeployment.url}`
      console.log("[Start Workflow] devUrl:", devUrl)

      // Extract repo info from project link or deployment metadata
      let repoOwner: string | undefined
      let repoName: string | undefined

      // Debug: log what we have
      console.log("[Start Workflow] project.link:", selectedProject.link)
      console.log("[Start Workflow] latestDeployment.meta:", latestDeployment.meta)

      if (selectedProject.link?.org && selectedProject.link?.repo) {
        repoOwner = selectedProject.link.org
        repoName = selectedProject.link.repo
        console.log(`[Start Workflow] Using repo info from project.link: ${repoOwner}/${repoName}`)
      } else if (latestDeployment.meta?.githubOrg && latestDeployment.meta?.githubRepo) {
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
            : "prompt"

      // biome-ignore lint/suspicious/noExplicitAny: Request body type depends on conditional fields
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const body: any = {
        devUrl,
        projectName: selectedProject.name,
        userId,
        bypassToken,
        workflowType,
        customPrompt: workflowType === "prompt" ? customPrompt : undefined,
        crawlDepth: workflowType === "design-guidelines" ? crawlDepth : undefined,
        githubPat: autoCreatePR && githubPat ? githubPat : undefined,
        startPath: startPath !== "/" ? startPath : undefined // Only send if not default
      }

      // If we have repo info, pass it for sandbox creation
      // Use the deployment's git SHA if available, otherwise fall back to baseBranch
      if (repoOwner && repoName) {
        body.repoUrl = `https://github.com/${repoOwner}/${repoName}`
        body.repoBranch = latestDeployment.gitSource?.sha || baseBranch || "main"
        console.log(
          `[Start Workflow] Using git reference: ${body.repoBranch} (${latestDeployment.gitSource?.sha ? "SHA from deployment" : "branch name"})`
        )
      }

      if (autoCreatePR && repoOwner && repoName) {
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
      console.log(
        "[Start Workflow] body.githubPat:",
        body.githubPat ? "SET (length: " + body.githubPat.length + ")" : "NOT SET"
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
          accessToken ? "yes (length: " + accessToken.length + ")" : "NO TOKEN"
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

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <div className="flex justify-between items-start mb-6">
            <h2 className="text-2xl font-bold text-gray-900">New d3k Workflow</h2>
            <button
              type="button"
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600"
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
              {["type", "team", "project", "options", "running"].map((s, index) => (
                <div key={s} className="flex items-center flex-1">
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center ${
                      step === s
                        ? "bg-blue-600 text-white"
                        : ["type", "team", "project", "options", "running"].indexOf(step) >
                            ["type", "team", "project", "options", "running"].indexOf(s)
                          ? "bg-green-600 text-white"
                          : "bg-gray-200 text-gray-600"
                    }`}
                  >
                    {index + 1}
                  </div>
                  {index < 4 && (
                    <div className="flex-1 mx-2">
                      <Progress
                        value={["type", "team", "project", "options", "running"].indexOf(step) > index ? 100 : 0}
                        className="h-1"
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="flex items-center mt-2">
              {["Type", "Team", "Project", "Options", "Run"].map((label, index) => (
                <div key={label} className="flex items-center flex-1">
                  <span className="text-xs text-gray-600 w-8 text-center">{label}</span>
                  {index < 4 && <div className="flex-1 mx-2" />}
                </div>
              ))}
            </div>
          </div>

          {/* Step 1: Select Workflow Type */}
          {step === "type" && (
            <div>
              <h3 className="text-lg font-semibold mb-4">Select Workflow Type</h3>
              <div className="space-y-3">
                <Link
                  href="/workflows/new?type=cloud-fix"
                  className="block w-full p-4 border-2 border-gray-300 rounded-lg hover:border-blue-500 hover:bg-blue-50 text-left transition-colors"
                >
                  <div className="font-semibold">CLS Fix</div>
                  <div className="text-sm text-gray-600 mt-1">
                    Detect and fix Cumulative Layout Shift issues automatically
                  </div>
                </Link>
                <Link
                  href="/workflows/new?type=prompt"
                  className="block w-full p-4 border-2 border-gray-300 rounded-lg hover:border-blue-500 hover:bg-blue-50 text-left transition-colors"
                >
                  <div className="font-semibold">Prompt</div>
                  <div className="text-sm text-gray-600 mt-1">Run a custom AI workflow with your own instructions</div>
                </Link>
                <Link
                  href="/workflows/new?type=design-guidelines"
                  className="block w-full p-4 border-2 border-gray-300 rounded-lg hover:border-blue-500 hover:bg-blue-50 text-left transition-colors"
                >
                  <div className="font-semibold">Design Guidelines Review</div>
                  <div className="text-sm text-gray-600 mt-1">
                    Evaluate your site against Vercel design guidelines and automatically fix issues
                  </div>
                </Link>
              </div>
              {/* Reserve space for Back link to prevent CLS */}
              <div className="mt-4 h-10" aria-hidden="true" />
            </div>
          )}

          {/* Step 2: Select Team */}
          {step === "team" && (
            <div>
              <h3 className="text-lg font-semibold mb-4">Select Team</h3>
              {loadingTeams ? (
                <div className="text-center py-8 text-gray-500">Loading teams...</div>
              ) : (
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {teams.map((team) => (
                    <Link
                      key={team.id}
                      href={`/workflows/new?type=${_selectedType}&team=${team.id}`}
                      className="block w-full p-4 border-2 border-gray-300 rounded-lg hover:border-blue-500 hover:bg-blue-50 text-left transition-colors"
                    >
                      <div className="font-semibold">{team.name}</div>
                      <div className="text-sm text-gray-600">
                        {team.isPersonal ? "Personal Account" : "Team"} • {team.id}
                      </div>
                    </Link>
                  ))}
                </div>
              )}
              <Link href="/workflows/new" className="mt-4 inline-block px-4 py-2 text-gray-600 hover:text-gray-800">
                ← Back
              </Link>
            </div>
          )}

          {/* Step 3: Select Project */}
          {step === "project" && (
            <div>
              <h3 className="text-lg font-semibold mb-4">Select Project</h3>
              {selectedTeam && (
                <div className="mb-4 text-sm text-gray-600">
                  Team: <span className="font-semibold">{selectedTeam.name}</span>
                </div>
              )}
              {projectsError && (
                <Alert variant="destructive" className="mb-4">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>Error</AlertTitle>
                  <AlertDescription>{projectsError}</AlertDescription>
                </Alert>
              )}
              {loadingProjects ? (
                <div className="text-center py-8 text-gray-500">Loading projects...</div>
              ) : projects.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  {projectsError ? "Unable to load projects" : "No projects found"}
                </div>
              ) : (
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {projects.map((project) => (
                    <Link
                      key={project.id}
                      href={`/workflows/new?type=${_selectedType}&team=${selectedTeam?.id}&project=${project.id}`}
                      className="block w-full p-4 border-2 border-gray-300 rounded-lg hover:border-blue-500 hover:bg-blue-50 text-left transition-colors"
                    >
                      <div className="font-semibold">{project.name}</div>
                      <div className="text-sm text-gray-600 mt-1">
                        {project.framework && <span className="mr-2">Framework: {project.framework}</span>}
                        {project.latestDeployments[0] && <span>Latest: {project.latestDeployments[0].url}</span>}
                      </div>
                    </Link>
                  ))}
                </div>
              )}
              <Link
                href={`/workflows/new?type=${_selectedType}`}
                className="mt-4 inline-block px-4 py-2 text-gray-600 hover:text-gray-800"
              >
                ← Back
              </Link>
            </div>
          )}

          {/* Step 4: Configure Options */}
          {step === "options" && (
            <div>
              <h3 className="text-lg font-semibold mb-4">Configure Options</h3>
              {!selectedProject ? (
                <div className="text-center py-8 text-gray-500">
                  <Spinner className="mx-auto mb-2" />
                  Loading project details...
                </div>
              ) : (
                <>
                  <div className="mb-6 p-4 bg-gray-50 rounded-lg">
                    <div className="text-sm text-gray-600 mb-2">Selected Project:</div>
                    <div className="font-semibold">{selectedProject.name}</div>
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
                          <div className="text-sm text-gray-500 py-2">Loading branches...</div>
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
                              className="w-full px-3 py-2 border border-gray-300 rounded-md"
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
                      <div className="text-sm text-gray-500">Checking deployment protection...</div>
                    )}
                    {needsBypassToken && (
                      <div>
                        <label htmlFor={bypassTokenId} className="block text-sm font-medium text-gray-700 mb-1">
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
                            if (selectedProject && newToken) {
                              const storageKey = `d3k_bypass_token_${selectedProject.id}`
                              localStorage.setItem(storageKey, newToken)
                              console.log("[Bypass Token] Saved token to localStorage for project", selectedProject.id)
                            }
                          }}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md font-mono text-sm"
                          placeholder="Enter your 32-character bypass token"
                          required
                        />
                        <p className="mt-1 text-xs text-gray-500">
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
                          className="flex items-center gap-1 text-sm font-medium text-gray-700 mb-1"
                        >
                          GitHub Personal Access Token
                          <span className="text-gray-400">(optional)</span>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button type="button" className="text-gray-400 hover:text-gray-600">
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
                          className="w-full px-3 py-2 border border-gray-300 rounded-md font-mono text-sm"
                          placeholder="github_pat_xxxx or ghp_xxxx"
                        />
                        <p className="mt-1 text-xs text-gray-500">
                          Required to create PRs. Stored locally in your browser.
                        </p>
                      </div>
                    )}
                    <div>
                      <Label htmlFor={startPathId} className="block text-sm font-medium text-gray-700 mb-1">
                        Start Path
                      </Label>
                      <input
                        type="text"
                        id={startPathId}
                        value={startPath}
                        onChange={(e) => setStartPath(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md font-mono text-sm"
                        placeholder="/"
                      />
                      <p className="mt-1 text-xs text-gray-500">
                        The page path to analyze for CLS (e.g., &quot;/&quot;, &quot;/about&quot;,
                        &quot;/products&quot;)
                      </p>
                    </div>
                    {_selectedType === "design-guidelines" && (
                      <div>
                        <Label htmlFor="crawlDepth" className="block text-sm font-medium text-gray-700 mb-1">
                          Crawl Depth
                        </Label>
                        <select
                          id="crawlDepth"
                          value={crawlDepth}
                          onChange={(e) =>
                            setCrawlDepth(e.target.value === "all" ? "all" : Number.parseInt(e.target.value, 10))
                          }
                          className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                        >
                          <option value={1}>1 - Start page only</option>
                          <option value={2}>2 - Start page + linked pages</option>
                          <option value={3}>3 - Two levels of links</option>
                          <option value="all">All - Crawl entire site</option>
                        </select>
                        <p className="mt-1 text-xs text-gray-500">
                          How many pages to audit. Higher depth = more thorough but slower.
                        </p>
                      </div>
                    )}
                    {_selectedType === "prompt" && (
                      <div>
                        <Label htmlFor={customPromptId} className="block text-sm font-medium text-gray-700 mb-1">
                          Custom Instructions
                          <span className="text-red-500 ml-1">*</span>
                        </Label>
                        <textarea
                          id={customPromptId}
                          value={customPrompt}
                          onChange={(e) => setCustomPrompt(e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm min-h-[120px]"
                          placeholder="Describe what you want the AI to do with your codebase..."
                          required
                        />
                        <p className="mt-1 text-xs text-gray-500">
                          Be specific about what changes you want. The AI will analyze your codebase and implement the
                          requested changes.
                        </p>
                      </div>
                    )}
                  </div>
                  <div className="flex gap-3 mt-6">
                    <Link
                      href={`/workflows/new?type=${_selectedType}&team=${selectedTeam?.id}`}
                      className="px-4 py-2 text-gray-600 hover:text-gray-800"
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
              <h3 className="text-lg font-semibold mb-4">Workflow Status</h3>
              <div className="space-y-4">
                <Alert
                  variant={
                    workflowStatus.includes("Error") || workflowStatus.includes("failed") ? "destructive" : "default"
                  }
                  className={
                    workflowStatus.includes("Error") || workflowStatus.includes("failed")
                      ? ""
                      : "bg-blue-50 border-blue-200"
                  }
                >
                  {workflowStatus.includes("Error") || workflowStatus.includes("failed") ? (
                    <AlertCircle className="h-4 w-4" />
                  ) : (
                    !workflowStatus.includes("completed successfully") && <Spinner className="h-4 w-4" />
                  )}
                  <AlertDescription
                    className={
                      workflowStatus.includes("Error") || workflowStatus.includes("failed") ? "" : "text-blue-900"
                    }
                  >
                    {workflowStatus}
                  </AlertDescription>
                </Alert>
                {sandboxUrl && !workflowResult && (
                  <Alert className="bg-yellow-50 border-yellow-200">
                    <AlertDescription className="text-yellow-900">
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
                        className="flex-1 px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
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
