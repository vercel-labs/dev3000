"use client"

import { ArrowLeft, ArrowRight, ExternalLink, Search } from "lucide-react"
import Link from "next/link"
import { useEffect, useId, useMemo, useRef, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import type { Recipe } from "@/lib/recipes"

interface UserInfo {
  id: string
  email: string
  name: string
  username: string
}

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

type RepoVisibility = "unknown" | "checking" | "public" | "private_or_unknown"

interface RecipeRunClientProps {
  recipe: Recipe
  user: UserInfo
}

const GITHUB_PAT_STORAGE_KEY = "d3k_github_pat"

function formatExecutionMode(mode: Recipe["executionMode"]): string {
  return mode === "dev-server" ? "Dev Server" : "Preview + PR"
}

function formatSandboxBrowser(browser: Recipe["sandboxBrowser"]): string {
  if (browser === "agent-browser") return "agent-browser"
  if (browser === "next-browser") return "next-browser"
  return "No browser"
}

export default function RecipeRunClient({ recipe, user }: RecipeRunClientProps) {
  const projectSearchId = useId()
  const startPathId = useId()
  const customPromptId = useId()
  const githubPatId = useId()
  const pullRequestId = useId()
  const [teams, setTeams] = useState<Team[]>([])
  const [teamsLoaded, setTeamsLoaded] = useState(false)
  const [selectedTeamId, setSelectedTeamId] = useState("")
  const [projects, setProjects] = useState<Project[]>([])
  const [projectsLoading, setProjectsLoading] = useState(false)
  const [projectSearch, setProjectSearch] = useState("")
  const [selectedProjectId, setSelectedProjectId] = useState("")
  const [availableBranches, setAvailableBranches] = useState<Array<{ name: string; lastDeployment?: { url: string } }>>(
    []
  )
  const [branchesLoading, setBranchesLoading] = useState(false)
  const [baseBranch, setBaseBranch] = useState("main")
  const [startPath, setStartPath] = useState("/")
  const [customPrompt, setCustomPrompt] = useState("")
  const [githubPat, setGithubPat] = useState("")
  const [submitPullRequest, setSubmitPullRequest] = useState(recipe.supportsPullRequest ?? true)
  const [repoVisibility, setRepoVisibility] = useState<RepoVisibility>("unknown")
  const [status, setStatus] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [isRunning, setIsRunning] = useState(false)
  const [activeRunId, setActiveRunId] = useState<string | null>(null)
  const [sandboxUrl, setSandboxUrl] = useState<string | null>(null)
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const selectedTeam = useMemo(() => teams.find((team) => team.id === selectedTeamId) || null, [teams, selectedTeamId])
  const filteredProjects = useMemo(() => {
    const query = projectSearch.trim().toLowerCase()
    if (!query) return projects
    return projects.filter((project) => project.name.toLowerCase().includes(query))
  }, [projectSearch, projects])
  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) || null,
    [projects, selectedProjectId]
  )
  const selectedRepoOwner = selectedProject?.link?.org || selectedProject?.latestDeployments[0]?.meta?.githubOrg
  const selectedRepoName = selectedProject?.link?.repo || selectedProject?.latestDeployments[0]?.meta?.githubRepo
  const hasGitHubRepoInfo = Boolean(selectedRepoOwner && selectedRepoName)
  const isGitHubPatRequired = hasGitHubRepoInfo && (repoVisibility !== "public" || submitPullRequest)

  useEffect(() => {
    const stored = localStorage.getItem(GITHUB_PAT_STORAGE_KEY)
    if (stored) {
      setGithubPat(stored)
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    void fetch("/api/teams")
      .then(async (response) => {
        const data = await response.json()
        if (!response.ok || !data.success) {
          throw new Error(data.error || "Failed to load teams.")
        }
        const nextTeams = [...data.teams].sort((a: Team, b: Team) => {
          if (a.isPersonal && !b.isPersonal) return -1
          if (!a.isPersonal && b.isPersonal) return 1
          return a.name.localeCompare(b.name)
        })
        if (cancelled) return
        setTeams(nextTeams)
        if (!selectedTeamId && nextTeams.length > 0) {
          setSelectedTeamId(nextTeams[0].id)
        }
      })
      .catch((loadError: unknown) => {
        if (cancelled) return
        setError(loadError instanceof Error ? loadError.message : String(loadError))
      })
      .finally(() => {
        if (!cancelled) {
          setTeamsLoaded(true)
        }
      })

    return () => {
      cancelled = true
    }
  }, [selectedTeamId])

  useEffect(() => {
    if (!selectedTeam) {
      setProjects([])
      setSelectedProjectId("")
      return
    }

    const controller = new AbortController()
    setProjectsLoading(true)
    setError(null)

    const params = new URLSearchParams()
    if (!selectedTeam.isPersonal) {
      params.set("teamId", selectedTeam.id)
    }

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
  }, [selectedTeam])

  useEffect(() => {
    if (!selectedProject || !selectedTeam) {
      setAvailableBranches([])
      return
    }

    const controller = new AbortController()
    setBranchesLoading(true)
    const params = new URLSearchParams({ projectId: selectedProject.id })
    if (!selectedTeam.isPersonal) {
      params.set("teamId", selectedTeam.id)
    }

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
  }, [baseBranch, selectedProject, selectedTeam])

  useEffect(() => {
    if (!selectedRepoOwner || !selectedRepoName) {
      setRepoVisibility("unknown")
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
  }, [selectedRepoName, selectedRepoOwner])

  useEffect(() => {
    if (!activeRunId) return

    async function pollStatus() {
      try {
        const response = await fetch(`/api/workflows?userId=${encodeURIComponent(user.id)}`)
        const data = (await response.json()) as {
          success?: boolean
          runs?: Array<{
            id: string
            status?: string
            currentStep?: string
            sandboxUrl?: string
            error?: string
          }>
        }
        if (!data.success || !Array.isArray(data.runs)) return

        const run = data.runs.find((entry) => entry.id === activeRunId)
        if (!run) return

        if (run.currentStep) {
          setStatus(run.currentStep)
        }
        if (run.sandboxUrl) {
          setSandboxUrl(run.sandboxUrl)
        }
        if (run.status === "done") {
          window.location.href = `/recipes/runs/${run.id}/report`
        }
        if (run.status === "failure") {
          setIsRunning(false)
          setError(run.error || "Recipe run failed.")
        }
      } catch (pollError) {
        setError(pollError instanceof Error ? pollError.message : String(pollError))
      }
    }

    pollIntervalRef.current = setInterval(pollStatus, 3000)
    void pollStatus()

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current)
        pollIntervalRef.current = null
      }
    }
  }, [activeRunId, user.id])

  async function startRecipeRun() {
    if (!selectedProject || !selectedTeam) {
      setError("Choose a team and project before starting.")
      return
    }
    if (recipe.requiresCustomPrompt && !customPrompt.trim()) {
      setError("This recipe requires custom instructions.")
      return
    }
    if (isGitHubPatRequired && !githubPat.trim()) {
      setError("A GitHub PAT is required for this recipe and repository.")
      return
    }

    setError(null)
    setIsRunning(true)
    setStatus("Starting recipe run…")

    const projectResponse = await fetch(
      selectedTeam.isPersonal
        ? `/api/projects/${selectedProject.id}`
        : `/api/projects/${selectedProject.id}?teamId=${encodeURIComponent(selectedTeam.id)}`
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

    if (githubPat.trim()) {
      localStorage.setItem(GITHUB_PAT_STORAGE_KEY, githubPat.trim())
    }

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
        recipeId: recipe.id,
        projectName: project.name,
        projectId: project.id,
        teamId: selectedTeam.isPersonal ? undefined : selectedTeam.id,
        projectDir: project.rootDirectory?.trim() || undefined,
        repoUrl: repoOwner && repoName ? `https://github.com/${repoOwner}/${repoName}` : undefined,
        repoOwner,
        repoName,
        repoBranch: gitRef,
        baseBranch,
        startPath: recipe.supportsPathInput && startPath.trim() ? startPath.trim() : undefined,
        githubPat: githubPat.trim() || undefined,
        submitPullRequest,
        customPrompt: recipe.requiresCustomPrompt ? customPrompt.trim() : undefined
      })
    })

    const result = (await response.json()) as {
      success?: boolean
      error?: string
      runId?: string
    }

    if (!response.ok || !result.success || !result.runId) {
      setIsRunning(false)
      setError(result.error || "Failed to start the recipe run.")
      return
    }

    setActiveRunId(result.runId)
    setStatus("Recipe run started.")
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(17,97,89,0.12),_transparent_30%),linear-gradient(180deg,_var(--background),_color-mix(in_oklab,_var(--background)_88%,_#d5ddd6))]">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-start justify-between gap-4 rounded-3xl border border-border/60 bg-background/90 p-6 shadow-sm backdrop-blur">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={recipe.kind === "builtin" ? "secondary" : "default"}>
                {recipe.kind === "builtin" ? "Built-in" : "Custom"}
              </Badge>
              <Badge variant="outline">{formatExecutionMode(recipe.executionMode)}</Badge>
              <Badge variant="outline">{formatSandboxBrowser(recipe.sandboxBrowser)}</Badge>
            </div>
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-3">
                <Button asChild variant="ghost" size="icon" className="size-9 rounded-full">
                  <Link href="/recipes" aria-label="Back to recipes">
                    <ArrowLeft className="size-4" />
                  </Link>
                </Button>
                <h1 className="font-serif text-3xl text-foreground sm:text-4xl">{recipe.name}</h1>
              </div>
              <p className="max-w-3xl text-sm text-muted-foreground sm:text-base">{recipe.description}</p>
            </div>
            <p className="max-w-3xl text-sm leading-6 text-muted-foreground">{recipe.instructions}</p>
            <div className="flex flex-wrap gap-2">
              {recipe.skillRefs.map((skill) => (
                <Badge key={`${recipe.id}-${skill.id}`} variant="outline" className="rounded-full px-3 py-1">
                  {skill.displayName}
                </Badge>
              ))}
            </div>
          </div>
        </div>

        {error && (
          <Card className="border-destructive/30 bg-destructive/5">
            <CardContent className="pt-6 text-sm text-destructive">{error}</CardContent>
          </Card>
        )}

        <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
          <Card className="border-border/60 bg-background/90 shadow-sm">
            <CardHeader>
              <CardTitle>Project Selection</CardTitle>
              <CardDescription>Select the Vercel project this recipe should run against.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-2">
                <Label>Team</Label>
                {!teamsLoaded ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Spinner className="size-4" />
                    Loading teams…
                  </div>
                ) : (
                  <Select value={selectedTeamId} onValueChange={setSelectedTeamId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a team" />
                    </SelectTrigger>
                    <SelectContent>
                      {teams.map((team) => (
                        <SelectItem key={team.id} value={team.id}>
                          {team.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor={projectSearchId}>Search Projects</Label>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-3.5 size-4 text-muted-foreground" />
                  <Input
                    id={projectSearchId}
                    value={projectSearch}
                    onChange={(event) => setProjectSearch(event.target.value)}
                    placeholder="Filter projects by name"
                    className="pl-9"
                  />
                </div>
              </div>

              <div className="max-h-[28rem] space-y-2 overflow-y-auto rounded-2xl border border-border/70 bg-muted/15 p-3">
                {projectsLoading ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Spinner className="size-4" />
                    Loading projects…
                  </div>
                ) : filteredProjects.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No matching projects.</p>
                ) : (
                  filteredProjects.map((project) => (
                    <button
                      type="button"
                      key={project.id}
                      onClick={() => setSelectedProjectId(project.id)}
                      className={`flex w-full items-center justify-between rounded-2xl border px-4 py-4 text-left transition ${
                        selectedProjectId === project.id
                          ? "border-primary bg-primary/5"
                          : "border-border/70 bg-background/90 hover:border-border"
                      }`}
                    >
                      <div className="space-y-1">
                        <div className="font-medium text-foreground">{project.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {project.framework ? `${project.framework} • ` : ""}
                          {project.latestDeployments[0]?.url || "No deployment URL"}
                        </div>
                      </div>
                      <ArrowRight className="size-4 text-muted-foreground" />
                    </button>
                  ))
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/60 bg-background/90 shadow-sm">
            <CardHeader>
              <CardTitle>Run Configuration</CardTitle>
              <CardDescription>Adjust repo-specific inputs before starting the recipe run.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {!selectedProject ? (
                <p className="text-sm text-muted-foreground">Pick a project to unlock configuration.</p>
              ) : (
                <>
                  <div className="rounded-2xl border border-border/70 bg-muted/15 p-4">
                    <div className="font-medium text-foreground">{selectedProject.name}</div>
                    <div className="mt-1 text-sm text-muted-foreground">
                      {selectedTeam ? `${selectedTeam.name} • ` : ""}
                      {selectedRepoOwner && selectedRepoName
                        ? `${selectedRepoOwner}/${selectedRepoName}`
                        : "Repository not linked"}
                    </div>
                    {selectedProject.latestDeployments[0]?.url && (
                      <a
                        href={`https://${selectedProject.latestDeployments[0].url}`}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-3 inline-flex items-center gap-1 text-xs text-primary hover:underline"
                      >
                        Open latest deployment
                        <ExternalLink className="size-3" />
                      </a>
                    )}
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Base Branch</Label>
                      <Select value={baseBranch} onValueChange={setBaseBranch} disabled={branchesLoading}>
                        <SelectTrigger>
                          <SelectValue placeholder={branchesLoading ? "Loading branches…" : "Select a branch"} />
                        </SelectTrigger>
                        <SelectContent>
                          {availableBranches.map((branch) => (
                            <SelectItem key={branch.name} value={branch.name}>
                              {branch.name}
                            </SelectItem>
                          ))}
                          {availableBranches.length === 0 && <SelectItem value="main">main</SelectItem>}
                        </SelectContent>
                      </Select>
                    </div>

                    {recipe.supportsPathInput && (
                      <div className="space-y-2">
                        <Label htmlFor={startPathId}>Start Path</Label>
                        <Input
                          id={startPathId}
                          value={startPath}
                          onChange={(event) => setStartPath(event.target.value)}
                        />
                      </div>
                    )}
                  </div>

                  {recipe.requiresCustomPrompt && (
                    <div className="space-y-2">
                      <Label htmlFor={customPromptId}>Custom Instructions</Label>
                      <Textarea
                        id={customPromptId}
                        value={customPrompt}
                        onChange={(event) => setCustomPrompt(event.target.value)}
                        placeholder="Describe the one-off task for this run."
                        rows={6}
                      />
                    </div>
                  )}

                  {hasGitHubRepoInfo && (
                    <div className="space-y-2">
                      <Label htmlFor={githubPatId}>
                        GitHub PAT
                        {isGitHubPatRequired ? <span className="ml-1 text-destructive">*</span> : null}
                      </Label>
                      <Input
                        id={githubPatId}
                        type="password"
                        value={githubPat}
                        onChange={(event) => setGithubPat(event.target.value)}
                        placeholder="ghp_..."
                      />
                      <p className="text-xs text-muted-foreground">
                        Repo visibility:{" "}
                        {repoVisibility === "checking" ? "checking…" : repoVisibility.replaceAll("_", " ")}
                      </p>
                    </div>
                  )}

                  <div className="flex items-start gap-3 rounded-2xl border border-border/70 bg-muted/15 p-4">
                    <Checkbox
                      id={pullRequestId}
                      checked={submitPullRequest}
                      onCheckedChange={(checked) => setSubmitPullRequest(Boolean(checked))}
                    />
                    <div className="space-y-1">
                      <Label htmlFor={pullRequestId} className="font-medium text-foreground">
                        Open a pull request
                      </Label>
                      <p className="text-sm text-muted-foreground">
                        Keep this on when you want a branch and PR created automatically after the recipe finishes.
                      </p>
                    </div>
                  </div>

                  {sandboxUrl && (
                    <div className="rounded-2xl border border-border/70 bg-muted/15 p-4 text-sm text-muted-foreground">
                      Sandbox URL:{" "}
                      <a href={sandboxUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                        {sandboxUrl}
                      </a>
                    </div>
                  )}

                  {status && (
                    <div className="rounded-2xl border border-border/70 bg-muted/15 p-4 text-sm text-muted-foreground">
                      {status}
                    </div>
                  )}

                  <div className="flex flex-wrap gap-3">
                    <Button onClick={startRecipeRun} disabled={isRunning || !selectedProject}>
                      {isRunning ? "Running…" : "Start Recipe Run"}
                    </Button>
                    <Button asChild variant="outline">
                      <Link href="/recipes/runs">View Runs</Link>
                    </Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
