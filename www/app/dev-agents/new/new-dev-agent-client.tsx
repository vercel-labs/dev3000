"use client"

import {
  Bot,
  Cloud,
  GitBranch,
  Globe,
  MessageSquare,
  Monitor,
  Play,
  Plus,
  RotateCcw,
  Search,
  ShieldCheck,
  Trash2,
  X,
  Zap
} from "lucide-react"
import { useCallback, useDeferredValue, useEffect, useId, useMemo, useState, useTransition } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import type { DevAgent, DevAgentActionStep, DevAgentAiAgent, DevAgentTeam } from "@/lib/dev-agents"

// ── Types ──────────────────────────────────────────────────────────────────

interface UserInfo {
  id: string
  email: string
  name: string
  username: string
}

interface SkillSearchResult {
  id: string
  installArg: string
  packageName?: string
  skillName: string
  displayName: string
  sourceUrl?: string
  installsLabel?: string
}

interface NewDevAgentClientProps {
  user: UserInfo
  team: DevAgentTeam
  devAgent?: DevAgent
  mode?: "create" | "edit"
  canEdit?: boolean
}

type ActionStepKind =
  | "browse-to-page"
  | "start-dev-server"
  | "capture-loading-frames"
  | "capture-cwv"
  | "go-back-to-step"
  | "send-prompt"

interface ActionStep {
  id: string
  kind: ActionStepKind
  config: Record<string, string>
}

const ACTION_STEP_META: Record<
  ActionStepKind,
  { label: string; icon: typeof Globe; description: string; accent: string }
> = {
  "browse-to-page": {
    label: "Browse to Page",
    icon: Globe,
    description: "Navigate to a URL in the sandbox browser",
    accent: "border-l-blue-500"
  },
  "start-dev-server": {
    label: "Start Dev Server",
    icon: Play,
    description: "Start the development server",
    accent: "border-l-green-500"
  },
  "capture-loading-frames": {
    label: "Capture Loading Frames",
    icon: Monitor,
    description: "Capture page loading frame sequence",
    accent: "border-l-purple-500"
  },
  "capture-cwv": {
    label: "Capture Core Web Vitals",
    icon: Zap,
    description: "Measure LCP, CLS, INP, FCP, TTFB",
    accent: "border-l-yellow-500"
  },
  "go-back-to-step": {
    label: "Go Back to Step",
    icon: RotateCcw,
    description: "Loop back to a previous step",
    accent: "border-l-orange-500"
  },
  "send-prompt": {
    label: "Send Prompt",
    icon: MessageSquare,
    description: "Send custom instructions to the agent",
    accent: "border-l-pink-500"
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const implicitD3kSkill: SkillSearchResult = {
  id: "d3k",
  installArg: "https://github.com/vercel-labs/dev3000/tree/main/skills/d3k",
  skillName: "d3k",
  displayName: "d3k",
  sourceUrl: "https://skills.sh/vercel-labs/dev3000/d3k"
}

function isD3kSkill(skill: Pick<SkillSearchResult, "id" | "installArg" | "skillName" | "displayName">): boolean {
  return (
    skill.id === "d3k" ||
    skill.skillName.toLowerCase() === "d3k" ||
    skill.displayName.toLowerCase() === "d3k" ||
    skill.installArg === implicitD3kSkill.installArg
  )
}

function generateStepId(): string {
  return `step_${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`
}

function buildPromptFromSteps(steps: ActionStep[]): string {
  const parts: string[] = []
  for (const step of steps) {
    const meta = ACTION_STEP_META[step.kind]
    switch (step.kind) {
      case "browse-to-page":
        if (step.config.url) {
          parts.push(`Browse to ${step.config.url}`)
        }
        break
      case "start-dev-server":
        parts.push("Start the dev server")
        break
      case "capture-loading-frames":
        parts.push("Capture loading frames")
        break
      case "capture-cwv":
        parts.push("Capture Core Web Vitals")
        break
      case "go-back-to-step":
        if (step.config.stepNumber) {
          parts.push(`Go back to step ${step.config.stepNumber}`)
        }
        break
      case "send-prompt":
        if (step.config.prompt) {
          parts.push(step.config.prompt)
        }
        break
      default:
        parts.push(meta.label)
    }
  }
  return parts.join("\n\n")
}

function parseInstructionsToSteps(instructions: string): ActionStep[] {
  if (!instructions.trim()) return []
  return [
    {
      id: generateStepId(),
      kind: "send-prompt",
      config: { prompt: instructions }
    }
  ]
}

// ── Fixed Step Cards ────────────────────────────────────────────────────────

function StepConnector() {
  return (
    <div className="flex justify-center">
      <div className="h-6 w-px bg-border/50" />
    </div>
  )
}

function InsertStepButton({ onInsert }: { onInsert: (kind: ActionStepKind) => void }) {
  return (
    <div className="flex justify-center py-1">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex h-6 w-6 items-center justify-center rounded-full border border-dashed border-border/60 bg-background text-muted-foreground transition hover:border-foreground/40 hover:text-foreground"
            aria-label="Insert step here"
          >
            <Plus className="size-3" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center" className="w-64">
          <DropdownMenuLabel>Insert Action</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {(Object.entries(ACTION_STEP_META) as Array<[ActionStepKind, (typeof ACTION_STEP_META)[ActionStepKind]]>).map(
            ([kind, meta]) => {
              const Icon = meta.icon
              return (
                <DropdownMenuItem key={kind} onClick={() => onInsert(kind)}>
                  <Icon className="size-4" />
                  <div className="flex flex-col">
                    <span>{meta.label}</span>
                    <span className="text-[11px] text-muted-foreground">{meta.description}</span>
                  </div>
                </DropdownMenuItem>
              )
            }
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

function FixedStepCard({
  stepNumber,
  title,
  description,
  icon: Icon
}: {
  stepNumber: number
  title: string
  description: string
  icon: typeof Cloud
}) {
  return (
    <div className="relative flex items-start gap-3 rounded-lg border border-border/60 bg-background/90 px-4 py-3">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted/30 text-xs font-medium text-foreground">
        {stepNumber}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Icon className="size-4 text-muted-foreground" />
          <span className="text-sm font-medium text-foreground">{title}</span>
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      </div>
      <Badge variant="secondary" className="shrink-0 rounded-full px-2 py-0.5 text-[10px]">
        System
      </Badge>
    </div>
  )
}

// ── Action Step Card ────────────────────────────────────────────────────────

function ActionStepCard({
  step,
  stepNumber,
  canEdit,
  onUpdate,
  onRemove
}: {
  step: ActionStep
  stepNumber: number
  canEdit: boolean
  onUpdate: (id: string, config: Record<string, string>) => void
  onRemove: (id: string) => void
}) {
  const meta = ACTION_STEP_META[step.kind]
  const Icon = meta.icon

  return (
    <div className={`relative rounded-lg border border-border/60 bg-background/80 ${meta.accent} border-l-2`}>
      <div className="flex items-start gap-3 px-4 py-3">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted/30 text-xs font-medium text-foreground">
          {stepNumber}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Icon className="size-4 text-muted-foreground" />
              <span className="text-sm font-medium text-foreground">{meta.label}</span>
            </div>
            {canEdit && (
              <button
                type="button"
                onClick={() => onRemove(step.id)}
                className="rounded-md p-1 text-muted-foreground transition hover:bg-muted hover:text-destructive"
                aria-label={`Remove ${meta.label}`}
              >
                <Trash2 className="size-3.5" />
              </button>
            )}
          </div>

          {step.kind === "browse-to-page" && (
            <Input
              value={step.config.url ?? ""}
              onChange={(e) => onUpdate(step.id, { ...step.config, url: e.target.value })}
              placeholder="http://localhost:3000/page"
              className="mt-2 h-8 text-xs"
              disabled={!canEdit}
            />
          )}

          {step.kind === "go-back-to-step" && (
            <Input
              type="number"
              value={step.config.stepNumber ?? ""}
              onChange={(e) => onUpdate(step.id, { ...step.config, stepNumber: e.target.value })}
              placeholder="Step number (e.g. 5)"
              className="mt-2 h-8 w-32 text-xs"
              min={1}
              disabled={!canEdit}
            />
          )}

          {step.kind === "send-prompt" && (
            <Textarea
              value={step.config.prompt ?? ""}
              onChange={(e) => onUpdate(step.id, { ...step.config, prompt: e.target.value })}
              placeholder="Describe what the agent should do..."
              className="mt-2 min-h-24 text-xs"
              disabled={!canEdit}
            />
          )}

          {(step.kind === "start-dev-server" ||
            step.kind === "capture-loading-frames" ||
            step.kind === "capture-cwv") && <p className="mt-0.5 text-xs text-muted-foreground">{meta.description}</p>}
        </div>
      </div>
    </div>
  )
}

// ── Main Component ──────────────────────────────────────────────────────────

export default function NewDevAgentClient({
  user,
  team,
  devAgent,
  mode = "create",
  canEdit = true
}: NewDevAgentClientProps) {
  const nameId = useId()
  const descriptionId = useId()
  const skillSearchId = useId()
  const isEditMode = mode === "edit" && Boolean(devAgent)

  // Core fields
  const [name, setName] = useState(devAgent?.name ?? "")
  const [description, setDescription] = useState(devAgent?.description ?? "")

  // AI agent picker (presentational only for now)
  const [aiAgent, setAiAgent] = useState<DevAgentAiAgent>(devAgent?.aiAgent ?? "d3k")

  // Skills
  const [searchQuery, setSearchQuery] = useState("")
  const deferredSearchQuery = useDeferredValue(searchQuery)
  const [searchResults, setSearchResults] = useState<SkillSearchResult[]>([])
  const [selectedSkills, setSelectedSkills] = useState<SkillSearchResult[]>(() =>
    (devAgent?.skillRefs ?? []).filter((skill) => !isD3kSkill(skill))
  )
  const [isSearching, setIsSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)

  // Success eval
  const [successEval, setSuccessEval] = useState(devAgent?.successEval ?? "")

  // Action steps
  const [actionSteps, setActionSteps] = useState<ActionStep[]>(() => {
    if (devAgent?.actionSteps?.length) {
      return devAgent.actionSteps.map((step) => ({
        id: generateStepId(),
        kind: step.kind as ActionStepKind,
        config: { ...step.config }
      }))
    }
    return parseInstructionsToSteps(devAgent?.instructions ?? "")
  })

  // Submit
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const teamBasePath = `/${team.slug}/dev-agents`
  const submitLabel = isEditMode ? "Save Dev Agent" : "Create Dev Agent"
  const isReadOnly = isEditMode && !canEdit

  // Skill search effect
  useEffect(() => {
    if (!canEdit) {
      setSearchResults([])
      setSearchError(null)
      return
    }

    const query = deferredSearchQuery.trim()
    if (query.length < 2) {
      setSearchResults([])
      setSearchError(null)
      return
    }

    const controller = new AbortController()
    setIsSearching(true)
    setSearchError(null)

    void fetch(`/api/skills/find?q=${encodeURIComponent(query)}`, {
      signal: controller.signal
    })
      .then(async (response) => {
        const data = (await response.json()) as {
          success?: boolean
          error?: string
          results?: SkillSearchResult[]
        }
        if (!response.ok || !data.success) {
          throw new Error(data.error || "Skill search failed.")
        }
        setSearchResults(Array.isArray(data.results) ? data.results : [])
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setSearchError(error instanceof Error ? error.message : String(error))
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setIsSearching(false)
        }
      })

    return () => controller.abort()
  }, [canEdit, deferredSearchQuery])

  // d3k is always implicitly pinned for dev-server mode
  const effectiveSelectedSkills = useMemo(() => {
    return selectedSkills.some((skill) => isD3kSkill(skill)) ? selectedSkills : [implicitD3kSkill, ...selectedSkills]
  }, [selectedSkills])

  const selectedSkillIds = useMemo(
    () => new Set(effectiveSelectedSkills.map((skill) => skill.id)),
    [effectiveSelectedSkills]
  )

  function addSkill(skill: SkillSearchResult) {
    setSelectedSkills((current) => {
      if (current.some((item) => item.id === skill.id)) return current
      return [...current, skill]
    })
  }

  function removeSkill(skillId: string) {
    setSelectedSkills((current) => current.filter((skill) => skill.id !== skillId))
  }

  // Action step management
  const addActionStep = useCallback((kind: ActionStepKind, atIndex?: number) => {
    setActionSteps((current) => {
      const newStep = { id: generateStepId(), kind, config: {} }
      if (atIndex !== undefined && atIndex >= 0 && atIndex <= current.length) {
        const next = [...current]
        next.splice(atIndex, 0, newStep)
        return next
      }
      return [...current, newStep]
    })
  }, [])

  const updateActionStep = useCallback((id: string, config: Record<string, string>) => {
    setActionSteps((current) => current.map((step) => (step.id === id ? { ...step, config } : step)))
  }, [])

  const removeActionStep = useCallback((id: string) => {
    setActionSteps((current) => current.filter((step) => step.id !== id))
  }, [])

  // Derive prompt from action steps
  const derivedPrompt = useMemo(() => buildPromptFromSteps(actionSteps), [actionSteps])

  function submitDevAgent() {
    if (!canEdit) return

    setSubmitError(null)
    startTransition(async () => {
      try {
        const endpoint = isEditMode && devAgent ? `/api/dev-agents/${devAgent.id}` : "/api/dev-agents"
        const response = await fetch(endpoint, {
          method: isEditMode ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name,
            description,
            prompt: derivedPrompt,
            executionMode: "dev-server",
            sandboxBrowser: "agent-browser",
            actionSteps: actionSteps.map(({ kind, config }): DevAgentActionStep => ({ kind, config })),
            skillRefs: effectiveSelectedSkills,
            team,
            successEval: successEval.trim() || undefined
          })
        })

        const data = (await response.json()) as {
          success?: boolean
          error?: string
          devAgent?: { id: string }
        }

        if (!response.ok || !data.success || !data.devAgent) {
          throw new Error(data.error || (isEditMode ? "Failed to save dev agent." : "Failed to create dev agent."))
        }

        window.location.href = isEditMode
          ? `${teamBasePath}/${data.devAgent.id}`
          : `${teamBasePath}/${data.devAgent.id}/new`
      } catch (error) {
        setSubmitError(error instanceof Error ? error.message : String(error))
      }
    })
  }

  const hasPromptContent = actionSteps.some((step) => {
    if (step.kind === "send-prompt") return (step.config.prompt ?? "").trim().length > 0
    if (step.kind === "browse-to-page") return (step.config.url ?? "").trim().length > 0
    return true
  })

  const isFormValid =
    name.trim().length > 0 &&
    description.trim().length > 0 &&
    actionSteps.length > 0 &&
    hasPromptContent &&
    effectiveSelectedSkills.length > 0 &&
    successEval.trim().length > 0 &&
    !isPending

  // Step numbering: fixed steps are 1-2, skills is 3, agent is 4, actions start at 5
  const actionStepBaseNumber = 5

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-8 px-1 py-2 sm:px-2 lg:px-3">
      {/* Name + Description */}
      {isReadOnly ? (
        <p className="text-sm text-muted-foreground">Read only. Only the author can edit this dev agent.</p>
      ) : null}

      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor={nameId}>Name</Label>
          <Input
            id={nameId}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Agent name"
            className="h-12 border-none bg-transparent text-2xl font-semibold tracking-tight text-foreground placeholder:text-muted-foreground/40 focus-visible:ring-0 sm:text-3xl"
            disabled={!canEdit}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={descriptionId}>Description</Label>
          <Textarea
            id={descriptionId}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Short description shown on the dev agents page."
            rows={2}
            className="resize-none border-none bg-transparent text-sm text-foreground placeholder:text-muted-foreground/40 focus-visible:ring-0"
            disabled={!canEdit}
          />
        </div>
      </div>

      {/* Agent Workflow */}
      <div className="space-y-0">
        <div className="mb-3 flex items-center gap-2">
          <div className="h-px flex-1 bg-border/40" />
          <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Agent Workflow</span>
          <div className="h-px flex-1 bg-border/40" />
        </div>

        {/* Step 1: Hydrate Sandbox */}
        <FixedStepCard
          stepNumber={1}
          title="Hydrate Vercel Sandbox"
          description="Provision an isolated sandbox environment"
          icon={Cloud}
        />
        <StepConnector />

        {/* Step 2: Clone Project */}
        <FixedStepCard
          stepNumber={2}
          title="Clone Project + Environment"
          description="Clone repo and inject environment variables"
          icon={GitBranch}
        />
        <StepConnector />

        {/* Step 3: Install Skills */}
        <div className="rounded-lg border border-border/60 bg-background/90">
          <div className="flex items-start gap-3 px-4 py-3">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted/30 text-xs font-medium text-foreground">
              3
            </div>
            <div className="min-w-0 flex-1 space-y-3">
              <div className="flex items-center gap-2">
                <Search className="size-4 text-muted-foreground" />
                <span className="text-sm font-medium text-foreground">Install Skills</span>
              </div>

              {/* Skill search */}
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id={skillSearchId}
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search skills.sh skills"
                  className="h-8 pl-9 text-xs"
                  disabled={!canEdit}
                />
              </div>

              {searchError && <p className="text-xs text-destructive">{searchError}</p>}

              {(isSearching || searchResults.length > 0) && (
                <div className="space-y-1.5 rounded-md border border-border/50 bg-muted/10 p-2">
                  {isSearching ? (
                    <p className="text-xs text-muted-foreground">Searching skills...</p>
                  ) : (
                    searchResults.map((skill) => (
                      <button
                        type="button"
                        key={skill.installArg}
                        onClick={() => addSkill(skill)}
                        disabled={!canEdit || selectedSkillIds.has(skill.id)}
                        className="flex w-full items-start justify-between rounded-md border border-transparent bg-background/60 px-2.5 py-2 text-left transition hover:border-border disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <div className="space-y-0.5">
                          <div className="text-xs font-medium text-foreground">{skill.displayName}</div>
                          <div className="text-[11px] text-muted-foreground">{skill.installArg}</div>
                        </div>
                        <Badge variant="outline" className="text-[10px]">
                          {selectedSkillIds.has(skill.id) ? "Added" : "Add"}
                        </Badge>
                      </button>
                    ))
                  )}
                </div>
              )}

              {/* Selected skills as pills (d3k hidden — it's implicit) */}
              <div className="flex flex-wrap gap-2">
                {effectiveSelectedSkills
                  .filter((skill) => !isD3kSkill(skill))
                  .map((skill) => (
                    <div
                      key={skill.installArg}
                      className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-muted/20 px-3 py-1"
                    >
                      <span className="text-xs font-medium text-foreground">{skill.displayName}</span>
                      <button
                        type="button"
                        onClick={() => removeSkill(skill.id)}
                        disabled={!canEdit}
                        className="rounded-full p-0.5 text-muted-foreground transition hover:bg-muted hover:text-foreground"
                        aria-label={`Remove ${skill.displayName}`}
                      >
                        <X className="size-3" />
                      </button>
                    </div>
                  ))}
              </div>
            </div>
          </div>
        </div>
        <StepConnector />

        {/* Step 4: Start Agent */}
        <div className="rounded-lg border border-border/60 bg-background/90">
          <div className="flex items-start gap-3 px-4 py-3">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted/30 text-xs font-medium text-foreground">
              4
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Bot className="size-4 text-muted-foreground" />
                  <span className="text-sm font-medium text-foreground">Start Agent</span>
                </div>
                <Select
                  value={aiAgent}
                  onValueChange={(value) => setAiAgent(value as DevAgentAiAgent)}
                  disabled={!canEdit}
                >
                  <SelectTrigger className="h-7 w-28 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="d3k">d3k</SelectItem>
                    <SelectItem value="claude">Claude</SelectItem>
                    <SelectItem value="codex">Codex</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Launch the AI agent to execute the following action steps
              </p>
            </div>
          </div>
        </div>

        {/* Action Steps with insert buttons between them */}
        {actionSteps.map((step, index) => (
          <div key={step.id}>
            {canEdit && index > 0 ? (
              <InsertStepButton onInsert={(kind) => addActionStep(kind, index)} />
            ) : (
              <StepConnector />
            )}
            <ActionStepCard
              step={step}
              stepNumber={actionStepBaseNumber + index}
              canEdit={canEdit}
              onUpdate={updateActionStep}
              onRemove={removeActionStep}
            />
          </div>
        ))}

        {/* Add Action Button (append to end) */}
        {canEdit && (
          <>
            <StepConnector />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-border/60 bg-background/50 py-3 text-sm text-muted-foreground transition hover:border-border hover:bg-muted/20 hover:text-foreground"
                >
                  <Plus className="size-4" />
                  Add Action Step
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="center" className="w-64">
                <DropdownMenuLabel>Action Type</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {(
                  Object.entries(ACTION_STEP_META) as Array<[ActionStepKind, (typeof ACTION_STEP_META)[ActionStepKind]]>
                ).map(([kind, meta]) => {
                  const Icon = meta.icon
                  return (
                    <DropdownMenuItem key={kind} onClick={() => addActionStep(kind)}>
                      <Icon className="size-4" />
                      <div className="flex flex-col">
                        <span>{meta.label}</span>
                        <span className="text-[11px] text-muted-foreground">{meta.description}</span>
                      </div>
                    </DropdownMenuItem>
                  )
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}

        {/* Success Eval — fixed final step */}
        <StepConnector />
        <div className="relative rounded-lg border border-border/60 bg-background/90">
          <div className="flex items-start gap-3 px-4 py-3">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted/30 text-xs font-medium text-foreground">
              {actionStepBaseNumber + actionSteps.length}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="size-4 text-muted-foreground" />
                  <span className="text-sm font-medium text-foreground">Success Eval</span>
                </div>
                <Badge variant="secondary" className="shrink-0 rounded-full px-2 py-0.5 text-[10px]">
                  Required
                </Badge>
              </div>
              <Textarea
                value={successEval}
                onChange={(e) => setSuccessEval(e.target.value)}
                placeholder="Describe what success looks like for this agent..."
                className="mt-2 min-h-16 text-xs"
                disabled={!canEdit}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Submit */}
      {submitError && <p className="text-sm text-destructive">{submitError}</p>}
      {!isReadOnly ? (
        <Button onClick={submitDevAgent} disabled={!isFormValid}>
          {isPending ? (isEditMode ? "Saving..." : "Creating...") : submitLabel}
        </Button>
      ) : null}
    </div>
  )
}
