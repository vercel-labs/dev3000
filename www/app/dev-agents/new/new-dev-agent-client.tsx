"use client"

import {
  Bot,
  Cloud,
  Code2,
  GitBranch,
  Globe,
  MessageSquare,
  Monitor,
  Plus,
  RotateCcw,
  Rows3,
  Search,
  ShieldCheck,
  Terminal,
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
import {
  type DevAgent,
  type DevAgentActionStep,
  type DevAgentAiAgent,
  type DevAgentEarlyExitMode,
  type DevAgentEarlyExitOperator,
  type DevAgentEarlyExitRule,
  type DevAgentEarlyExitValueType,
  type DevAgentTeam,
  getDevAgentModelLabel,
  isSandboxBuiltinSkillRef,
  isVercelPluginSkillRef
} from "@/lib/dev-agents-client"
import { NO_DEV_SERVER_COMMAND } from "@/lib/dev-server-command"

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
  isBuiltIn?: boolean
  builtInLabel?: string
}

interface NewDevAgentClientProps {
  user: UserInfo
  team: DevAgentTeam
  devAgent?: DevAgent
  mode?: "create" | "edit"
  canEdit?: boolean
  defaultDevServerCommand: string
}

type ActionStepKind = "send-prompt"

interface ActionStep {
  id: string
  kind: ActionStepKind
  config: Record<string, string>
}

// Prompt templates — each menu item inserts a send-prompt with pre-filled text
const PROMPT_TEMPLATES: Array<{
  label: string
  icon: typeof Globe
  description: string
  prompt: string
}> = [
  {
    label: "Blank Prompt",
    icon: MessageSquare,
    description: "Empty prompt — write your own instructions",
    prompt: ""
  },
  {
    label: "Browse to Page",
    icon: Globe,
    description: "Navigate to a URL in the sandbox browser",
    prompt: "Browse to http://localhost:3000/ and take a snapshot of what you see."
  },
  {
    label: "Capture Loading Frames",
    icon: Monitor,
    description: "Capture page loading frame sequence",
    prompt: "Capture the page loading sequence with screenshots showing how the page renders over time."
  },
  {
    label: "Capture Core Web Vitals",
    icon: Zap,
    description: "Measure LCP, CLS, INP, FCP, TTFB",
    prompt: "Use getWebVitals to measure all Core Web Vitals (LCP, CLS, INP, FCP, TTFB) and report the results."
  },
  {
    label: "Go Back to Step",
    icon: RotateCcw,
    description: "Loop back to a previous step",
    prompt: "Go back to step N and repeat from there to verify improvements."
  }
]

const BUILTIN_EARLY_EXIT_METRICS = [
  { value: "cls", label: "CLS", description: "Cumulative Layout Shift" },
  { value: "lcp", label: "LCP", description: "Largest Contentful Paint (ms)" },
  { value: "fcp", label: "FCP", description: "First Contentful Paint (ms)" },
  { value: "ttfb", label: "TTFB", description: "Time to First Byte (ms)" },
  { value: "inp", label: "INP", description: "Interaction to Next Paint (ms)" },
  { value: "cls_grade", label: "CLS Grade", description: "good / needs-improvement / poor" },
  { value: "lcp_grade", label: "LCP Grade", description: "good / needs-improvement / poor" },
  { value: "fcp_grade", label: "FCP Grade", description: "good / needs-improvement / poor" },
  { value: "ttfb_grade", label: "TTFB Grade", description: "good / needs-improvement / poor" },
  { value: "inp_grade", label: "INP Grade", description: "good / needs-improvement / poor" },
  { value: "skills_installed_count", label: "Installed Skills Count", description: "Number of sandbox skills" },
  { value: "has_skills_installed", label: "Has Installed Skills", description: "true / false" },
  { value: "cloud_browser_mode", label: "Cloud Browser Mode", description: "agent-browser" }
] as const

const NUMERIC_OPERATORS: DevAgentEarlyExitOperator[] = ["<", "<=", ">", ">=", "===", "!==", "between"]
const MATCH_OPERATORS: DevAgentEarlyExitOperator[] = ["===", "!=="]

function createDefaultEarlyExitRule(): DevAgentEarlyExitRule {
  return {
    metricType: "builtin",
    metricKey: "cls",
    valueType: "number",
    operator: "<=",
    valueNumber: 0.1
  }
}

function getEarlyExitOperators(valueType: DevAgentEarlyExitValueType): DevAgentEarlyExitOperator[] {
  return valueType === "number" ? NUMERIC_OPERATORS : MATCH_OPERATORS
}

function getBuiltinMetricMeta(metricKey: string) {
  return BUILTIN_EARLY_EXIT_METRICS.find((metric) => metric.value === metricKey)
}

function buildStructuredEarlyExitPreview(rule: DevAgentEarlyExitRule): string {
  const metricLabel =
    rule.metricType === "builtin"
      ? getBuiltinMetricMeta(rule.metricKey)?.label || rule.metricKey
      : rule.label?.trim() || rule.metricKey

  if (rule.valueType === "number") {
    if (rule.operator === "between") {
      return `${metricLabel} is between ${rule.valueNumber ?? "?"} and ${rule.secondaryValueNumber ?? "?"}`
    }
    return `${metricLabel} ${rule.operator} ${rule.valueNumber ?? "?"}`
  }

  if (rule.valueType === "boolean") {
    return `${metricLabel} ${rule.operator} ${String(rule.valueBoolean ?? false)}`
  }

  return `${metricLabel} ${rule.operator} "${rule.valueString ?? ""}"`
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const implicitD3kSkill: SkillSearchResult = {
  id: "d3k",
  installArg: "vercel-labs/dev3000@d3k",
  skillName: "d3k",
  displayName: "d3k",
  sourceUrl: "https://github.com/vercel-labs/dev3000/tree/main/skills/d3k",
  isBuiltIn: true,
  builtInLabel: "Sandbox base"
}

function isD3kSkill(skill: Pick<SkillSearchResult, "id" | "installArg" | "skillName" | "displayName">): boolean {
  return (
    skill.id === "d3k" ||
    skill.skillName.toLowerCase() === "d3k" ||
    skill.displayName.toLowerCase() === "d3k" ||
    skill.installArg === implicitD3kSkill.installArg
  )
}

function normalizeSkillResult(skill: SkillSearchResult): SkillSearchResult {
  if (isD3kSkill(skill)) {
    return {
      ...skill,
      isBuiltIn: true,
      builtInLabel: "Sandbox base"
    }
  }

  if (isVercelPluginSkillRef(skill)) {
    return {
      ...skill,
      isBuiltIn: true,
      builtInLabel: skill.builtInLabel || "Vercel plugin"
    }
  }

  return {
    ...skill,
    isBuiltIn: skill.isBuiltIn ?? false,
    builtInLabel: skill.builtInLabel
  }
}

function generateStepId(): string {
  return `step_${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`
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

const STEP_SEPARATOR = "\n\n---\n\n"

function summarizeStepsForInstructions(steps: ActionStep[]): string {
  return steps
    .map((step, index) => step.config.prompt?.trim() || `${index + 1}. Continue the workflow`)
    .filter((value) => value.length > 0)
    .join("\n")
}

function serializeStepsToText(steps: ActionStep[]): string {
  return steps.map((step) => step.config.prompt ?? "").join(STEP_SEPARATOR)
}

function parseTextToSteps(text: string): ActionStep[] {
  return text
    .split(STEP_SEPARATOR)
    .map((prompt) => ({
      id: generateStepId(),
      kind: "send-prompt" as ActionStepKind,
      config: { prompt }
    }))
    .filter((step) => step.config.prompt.trim().length > 0)
}

type WorkflowViewMode = "ui" | "text"

// ── Fixed Step Cards ────────────────────────────────────────────────────────

function StepConnector() {
  return (
    <div className="flex justify-center">
      <div className="h-6 w-px bg-border/50" />
    </div>
  )
}

function InsertStepButton({
  onInsert,
  onConfigureEarlyExit
}: {
  onInsert: (prompt: string) => void
  onConfigureEarlyExit: () => void
}) {
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
          <DropdownMenuLabel>Insert Prompt</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {PROMPT_TEMPLATES.slice(0, 1).map((tmpl) => {
            const Icon = tmpl.icon
            return (
              <DropdownMenuItem key={tmpl.label} onClick={() => onInsert(tmpl.prompt)}>
                <Icon className="size-4" />
                <div className="flex flex-col">
                  <span>{tmpl.label}</span>
                  <span className="text-[11px] text-muted-foreground">{tmpl.description}</span>
                </div>
              </DropdownMenuItem>
            )
          })}
          <DropdownMenuItem onClick={onConfigureEarlyExit}>
            <Zap className="size-4" />
            <div className="flex flex-col">
              <span>Early Exit</span>
              <span className="text-[11px] text-muted-foreground">
                Configure a rule to skip the agent when already passing
              </span>
            </div>
          </DropdownMenuItem>
          {PROMPT_TEMPLATES.slice(1).map((tmpl) => {
            const Icon = tmpl.icon
            return (
              <DropdownMenuItem key={tmpl.label} onClick={() => onInsert(tmpl.prompt)}>
                <Icon className="size-4" />
                <div className="flex flex-col">
                  <span>{tmpl.label}</span>
                  <span className="text-[11px] text-muted-foreground">{tmpl.description}</span>
                </div>
              </DropdownMenuItem>
            )
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

function InlineEarlyExitCard({
  editorId,
  mode,
  rule,
  textValue,
  canEdit,
  onRemove,
  onModeChange,
  onRuleChange,
  onTextChange
}: {
  editorId: string
  mode: DevAgentEarlyExitMode
  rule: DevAgentEarlyExitRule
  textValue: string
  canEdit: boolean
  onRemove: () => void
  onModeChange: (mode: DevAgentEarlyExitMode) => void
  onRuleChange: (rule: DevAgentEarlyExitRule) => void
  onTextChange: (value: string) => void
}) {
  return (
    <div id={editorId} className="rounded-lg border border-border/60 bg-background/90">
      <EarlyExitEditor
        mode={mode}
        rule={rule}
        textValue={textValue}
        canEdit={canEdit}
        onRemove={onRemove}
        onModeChange={onModeChange}
        onRuleChange={onRuleChange}
        onTextChange={onTextChange}
      />
    </div>
  )
}

function EarlyExitEditor({
  mode,
  rule,
  textValue,
  canEdit,
  onRemove,
  onModeChange,
  onRuleChange,
  onTextChange
}: {
  mode: DevAgentEarlyExitMode
  rule: DevAgentEarlyExitRule
  textValue: string
  canEdit: boolean
  onRemove?: () => void
  onModeChange: (mode: DevAgentEarlyExitMode) => void
  onRuleChange: (rule: DevAgentEarlyExitRule) => void
  onTextChange: (value: string) => void
}) {
  const operators = getEarlyExitOperators(rule.valueType)
  const preview = buildStructuredEarlyExitPreview(rule)

  return (
    <div className="rounded-lg border border-border/60 bg-background/90 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Zap className="size-4 text-muted-foreground" />
          <span className="text-sm font-medium text-foreground">Early Exit Condition</span>
        </div>
        <div className="flex items-center gap-2">
          {canEdit && onRemove ? (
            <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={onRemove}>
              <Trash2 className="size-4 text-muted-foreground" />
              <span className="sr-only">Remove early exit condition</span>
            </Button>
          ) : null}
          <Select
            value={mode}
            onValueChange={(value) => onModeChange(value as DevAgentEarlyExitMode)}
            disabled={!canEdit}
          >
            <SelectTrigger className="h-8 w-[170px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="structured">Structured Rule</SelectItem>
              <SelectItem value="text">Text Rule</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {mode === "structured" ? (
        <div className="mt-3 grid gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Metric Type</Label>
              <Select
                value={rule.metricType}
                onValueChange={(value) =>
                  onRuleChange({
                    ...rule,
                    metricType: value as DevAgentEarlyExitRule["metricType"],
                    metricKey: value === "builtin" ? "cls" : rule.metricKey || "custom_metric"
                  })
                }
                disabled={!canEdit}
              >
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="builtin">Built-in Metric</SelectItem>
                  <SelectItem value="custom">Custom Metric</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Metric</Label>
              {rule.metricType === "builtin" ? (
                <Select
                  value={rule.metricKey}
                  onValueChange={(value) => onRuleChange({ ...rule, metricKey: value })}
                  disabled={!canEdit}
                >
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {BUILTIN_EARLY_EXIT_METRICS.map((metric) => (
                      <SelectItem key={metric.value} value={metric.value}>
                        {metric.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  value={rule.metricKey}
                  onChange={(event) => onRuleChange({ ...rule, metricKey: event.target.value })}
                  placeholder="e.g. auth_enabled"
                  className="h-9 text-xs"
                  disabled={!canEdit}
                />
              )}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Value Type</Label>
              <Select
                value={rule.valueType}
                onValueChange={(value) => {
                  const valueType = value as DevAgentEarlyExitValueType
                  onRuleChange({
                    ...rule,
                    valueType,
                    operator: getEarlyExitOperators(valueType)[0],
                    valueNumber: valueType === "number" ? (rule.valueNumber ?? 0) : undefined,
                    secondaryValueNumber: valueType === "number" ? rule.secondaryValueNumber : undefined,
                    valueBoolean: valueType === "boolean" ? (rule.valueBoolean ?? true) : undefined,
                    valueString: valueType === "string" ? (rule.valueString ?? "") : undefined
                  })
                }}
                disabled={!canEdit}
              >
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="number">Number</SelectItem>
                  <SelectItem value="boolean">Boolean</SelectItem>
                  <SelectItem value="string">String</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Operator</Label>
              <Select
                value={rule.operator}
                onValueChange={(value) => onRuleChange({ ...rule, operator: value as DevAgentEarlyExitOperator })}
                disabled={!canEdit}
              >
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {operators.map((operator) => (
                    <SelectItem key={operator} value={operator}>
                      {operator}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Value</Label>
              {rule.valueType === "number" ? (
                <Input
                  type="number"
                  step="any"
                  value={typeof rule.valueNumber === "number" ? String(rule.valueNumber) : ""}
                  onChange={(event) =>
                    onRuleChange({
                      ...rule,
                      valueNumber: event.target.value === "" ? undefined : Number(event.target.value)
                    })
                  }
                  className="h-9 text-xs"
                  disabled={!canEdit}
                />
              ) : rule.valueType === "boolean" ? (
                <Select
                  value={String(rule.valueBoolean ?? true)}
                  onValueChange={(value) => onRuleChange({ ...rule, valueBoolean: value === "true" })}
                  disabled={!canEdit}
                >
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="true">true</SelectItem>
                    <SelectItem value="false">false</SelectItem>
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  value={rule.valueString ?? ""}
                  onChange={(event) => onRuleChange({ ...rule, valueString: event.target.value })}
                  className="h-9 text-xs"
                  disabled={!canEdit}
                />
              )}
            </div>
          </div>

          {rule.valueType === "number" && rule.operator === "between" ? (
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Upper Bound</Label>
              <Input
                type="number"
                step="any"
                value={typeof rule.secondaryValueNumber === "number" ? String(rule.secondaryValueNumber) : ""}
                onChange={(event) =>
                  onRuleChange({
                    ...rule,
                    secondaryValueNumber: event.target.value === "" ? undefined : Number(event.target.value)
                  })
                }
                className="h-9 text-xs"
                disabled={!canEdit}
              />
            </div>
          ) : null}

          <div className="rounded-md border border-border/50 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Preview:</span> {preview}
          </div>
        </div>
      ) : (
        <Textarea
          value={textValue}
          onChange={(event) => onTextChange(event.target.value)}
          placeholder="Describe when this agent should skip running..."
          className="mt-3 min-h-12 text-xs"
          rows={2}
          disabled={!canEdit}
        />
      )}
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
  return (
    <div className="relative rounded-lg border border-border/60 bg-background/80">
      <div className="flex items-start gap-3 px-4 py-3">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted/30 text-xs font-medium text-foreground">
          {stepNumber}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <MessageSquare className="size-4 text-muted-foreground" />
              <span className="text-sm font-medium text-foreground">Prompt</span>
            </div>
            {canEdit && (
              <button
                type="button"
                onClick={() => onRemove(step.id)}
                className="rounded-md p-1 text-muted-foreground transition hover:bg-muted hover:text-destructive"
                aria-label="Remove prompt"
              >
                <Trash2 className="size-3.5" />
              </button>
            )}
          </div>
          <Textarea
            value={step.config.prompt ?? ""}
            onChange={(e) => onUpdate(step.id, { ...step.config, prompt: e.target.value })}
            placeholder="Describe what the agent should do..."
            className="mt-2 min-h-12 text-xs"
            rows={2}
            disabled={!canEdit}
          />
        </div>
      </div>
    </div>
  )
}

// ── Main Component ──────────────────────────────────────────────────────────

export default function NewDevAgentClient({
  user: _user,
  team,
  devAgent,
  mode = "create",
  canEdit = true,
  defaultDevServerCommand
}: NewDevAgentClientProps) {
  const nameId = useId()
  const descriptionId = useId()
  const skillSearchId = useId()
  const isEditMode = mode === "edit" && Boolean(devAgent)

  // Core fields
  const [name, setName] = useState(devAgent?.name ?? "")
  const [description, setDescription] = useState(devAgent?.description ?? "")

  const legacyStartDevServerStep = devAgent?.actionSteps?.find((step) => step.kind === "start-dev-server")
  const normalizedStoredActionStepCount =
    devAgent?.actionSteps?.filter((step) => step.kind !== "start-dev-server").length ?? 0

  const [devServerCommand, setDevServerCommand] = useState(
    devAgent?.devServerCommand?.trim() || legacyStartDevServerStep?.config.command?.trim() || defaultDevServerCommand
  )

  const [aiAgent, setAiAgent] = useState<DevAgentAiAgent>(
    devAgent?.aiAgent === "anthropic/claude-sonnet-4.6" ? "anthropic/claude-sonnet-4.6" : "anthropic/claude-opus-4.6"
  )

  // Workflow view mode — UI (step cards) or Text (single textarea)
  const [workflowView, setWorkflowView] = useState<WorkflowViewMode>("ui")
  const [textModeValue, setTextModeValue] = useState("")

  // Skills
  const [searchQuery, setSearchQuery] = useState("")
  const deferredSearchQuery = useDeferredValue(searchQuery)
  const [searchResults, setSearchResults] = useState<SkillSearchResult[]>([])
  const [selectedSkills, setSelectedSkills] = useState<SkillSearchResult[]>(() =>
    (devAgent?.skillRefs ?? []).map(normalizeSkillResult).filter((skill) => !isD3kSkill(skill))
  )
  const [isSearching, setIsSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)

  // Success eval
  const [successEval, setSuccessEval] = useState(devAgent?.successEval ?? "")

  // Early exit eval
  const [earlyExitMode, setEarlyExitMode] = useState<DevAgentEarlyExitMode>(() => {
    if (devAgent?.earlyExitRule) return devAgent.earlyExitMode ?? "structured"
    if (devAgent?.earlyExitEval) return devAgent.earlyExitMode ?? "text"
    return "text"
  })
  const [earlyExitEval, setEarlyExitEval] = useState(devAgent?.earlyExitEval ?? "")
  const [earlyExitRule, setEarlyExitRule] = useState<DevAgentEarlyExitRule>(
    () => devAgent?.earlyExitRule ?? createDefaultEarlyExitRule()
  )
  const [isEarlyExitEnabled, setIsEarlyExitEnabled] = useState(() => {
    if (devAgent) {
      return Boolean(
        devAgent.earlyExitRule || devAgent.earlyExitEval || typeof devAgent.earlyExitPlacementIndex === "number"
      )
    }
    return true
  })
  const [earlyExitPlacementIndex, setEarlyExitPlacementIndex] = useState<number | null>(() => {
    if (typeof devAgent?.earlyExitPlacementIndex === "number") {
      return devAgent.earlyExitPlacementIndex
    }
    if (devAgent?.earlyExitRule || devAgent?.earlyExitEval) {
      return normalizedStoredActionStepCount
    }
    return null
  })

  // Action steps — migrate legacy kinds to send-prompt on load
  const [actionSteps, setActionSteps] = useState<ActionStep[]>(() => {
    if (devAgent?.actionSteps?.length) {
      return devAgent.actionSteps
        .map((step) => {
          if (step.kind === "start-dev-server") {
            return null
          }
          // Legacy kinds → convert to send-prompt with descriptive text
          if (step.kind !== "send-prompt") {
            const legacyPrompts: Record<string, string> = {
              "browse-to-page": `Browse to ${step.config.url || "http://localhost:3000/"} and take a snapshot of what you see.`,
              "capture-loading-frames":
                "Capture the page loading sequence with screenshots showing how the page renders over time.",
              "capture-cwv":
                "Use getWebVitals to measure all Core Web Vitals (LCP, CLS, INP, FCP, TTFB) and report the results.",
              "go-back-to-step": `Go back to step ${step.config.stepNumber || "N"} and repeat from there to verify improvements.`
            }
            return {
              id: generateStepId(),
              kind: "send-prompt" as ActionStepKind,
              config: { prompt: legacyPrompts[step.kind] || step.config.prompt || "" }
            }
          }
          return {
            id: generateStepId(),
            kind: "send-prompt" as ActionStepKind,
            config: { ...step.config }
          }
        })
        .filter((step): step is ActionStep => step !== null)
    }
    return parseInstructionsToSteps(devAgent?.instructions ?? "")
  })

  const switchToTextMode = useCallback(() => {
    setTextModeValue(serializeStepsToText(actionSteps))
    setWorkflowView("text")
  }, [actionSteps])

  const switchToUiMode = useCallback(() => {
    const parsed = parseTextToSteps(textModeValue)
    setActionSteps(parsed.length > 0 ? parsed : [{ id: generateStepId(), kind: "send-prompt", config: { prompt: "" } }])
    setWorkflowView("ui")
  }, [textModeValue])

  // Submit
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [savedMessage, setSavedMessage] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const earlyExitEditorId = useId()

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
        setSearchResults(Array.isArray(data.results) ? data.results.map(normalizeSkillResult) : [])
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
      const normalized = normalizeSkillResult(skill)
      if (
        current.some(
          (item) =>
            item.id === normalized.id ||
            item.installArg === normalized.installArg ||
            (normalized.isBuiltIn && isSandboxBuiltinSkillRef(item))
        )
      ) {
        return current
      }
      return [...current, normalized]
    })
  }

  function removeSkill(skillId: string) {
    setSelectedSkills((current) => current.filter((skill) => skill.id !== skillId))
  }

  // Action step management
  const addActionStep = useCallback((prompt?: string, atIndex?: number) => {
    setActionSteps((current) => {
      const newStep: ActionStep = {
        id: generateStepId(),
        kind: "send-prompt",
        config: prompt ? { prompt } : {}
      }
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

  const configureEarlyExit = useCallback(
    (placementIndex: number) => {
      setIsEarlyExitEnabled(true)
      setEarlyExitMode("text")
      setEarlyExitRule((current) => current ?? createDefaultEarlyExitRule())
      setEarlyExitPlacementIndex(placementIndex)
      window.requestAnimationFrame(() => {
        document.getElementById(earlyExitEditorId)?.scrollIntoView({ behavior: "smooth", block: "center" })
      })
    },
    [earlyExitEditorId]
  )

  const removeEarlyExit = useCallback(() => {
    setIsEarlyExitEnabled(false)
    setEarlyExitPlacementIndex(null)
  }, [])

  function submitDevAgent() {
    if (!canEdit) return

    // If in text mode, sync text back to action steps before submitting
    const resolvedSteps = workflowView === "text" ? parseTextToSteps(textModeValue) : actionSteps
    const resolvedPrompt = summarizeStepsForInstructions(resolvedSteps)
    const resolvedEarlyExitEval = isEarlyExitEnabled
      ? earlyExitMode === "structured"
        ? buildStructuredEarlyExitPreview(earlyExitRule)
        : earlyExitEval.trim()
      : ""

    setSubmitError(null)
    setSavedMessage(null)
    startTransition(async () => {
      try {
        const endpoint = isEditMode && devAgent ? `/api/dev-agents/${devAgent.id}` : "/api/dev-agents"
        const response = await fetch(endpoint, {
          method: isEditMode ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name,
            description,
            prompt: resolvedPrompt,
            executionMode: "dev-server",
            sandboxBrowser: "agent-browser",
            aiAgent,
            devServerCommand: devServerCommand.trim(),
            actionSteps: resolvedSteps.map(({ kind, config }): DevAgentActionStep => ({ kind, config })),
            skillRefs: effectiveSelectedSkills,
            team,
            successEval: successEval.trim() || undefined,
            earlyExitMode: isEarlyExitEnabled ? earlyExitMode : undefined,
            earlyExitEval: isEarlyExitEnabled ? resolvedEarlyExitEval || undefined : undefined,
            earlyExitRule: isEarlyExitEnabled && earlyExitMode === "structured" ? earlyExitRule : undefined,
            earlyExitPlacementIndex: isEarlyExitEnabled ? (earlyExitPlacementIndex ?? undefined) : undefined
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

        if (isEditMode) {
          setSavedMessage("Saved")
          setTimeout(() => setSavedMessage(null), 2000)
        } else {
          window.location.href = `${teamBasePath}/${data.devAgent.id}/new`
        }
      } catch (error) {
        setSubmitError(error instanceof Error ? error.message : String(error))
      }
    })
  }

  const hasPromptContent =
    workflowView === "text"
      ? textModeValue.trim().length > 0
      : actionSteps.some((step) => (step.config.prompt ?? "").trim().length > 0)

  const hasSteps = workflowView === "text" ? textModeValue.trim().length > 0 : actionSteps.length > 0

  const isFormValid =
    name.trim().length > 0 &&
    description.trim().length > 0 &&
    devServerCommand.trim().length > 0 &&
    hasSteps &&
    hasPromptContent &&
    effectiveSelectedSkills.length > 0 &&
    successEval.trim().length > 0 &&
    !isPending

  // Step numbering: fixed steps are 1-2, skills is 3, start dev server is 4, agent is 5, actions start at 6
  const actionStepBaseNumber = 6
  const effectiveEarlyExitPlacementIndex =
    workflowView === "ui" && isEarlyExitEnabled
      ? Math.min(Math.max(earlyExitPlacementIndex ?? actionSteps.length, 0), actionSteps.length)
      : null

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
          <div className="flex rounded-md border border-border/60 text-[11px]">
            <button
              type="button"
              onClick={() => (workflowView === "text" ? switchToUiMode() : undefined)}
              className={`inline-flex items-center gap-1 px-2 py-1 rounded-l-md transition-colors ${
                workflowView === "ui" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Rows3 className="size-3" />
              UI
            </button>
            <button
              type="button"
              onClick={() => (workflowView === "ui" ? switchToTextMode() : undefined)}
              className={`inline-flex items-center gap-1 px-2 py-1 rounded-r-md transition-colors ${
                workflowView === "text" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Code2 className="size-3" />
              Text
            </button>
          </div>
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
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Search className="size-4 text-muted-foreground" />
                  <span className="text-sm font-medium text-foreground">Install Skills</span>
                </div>
                <Badge variant="secondary" className="shrink-0 rounded-full px-2 py-0.5 text-[10px]">
                  System
                </Badge>
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
                          <div className="flex items-center gap-2">
                            <div className="text-xs font-medium text-foreground">{skill.displayName}</div>
                            {skill.isBuiltIn ? (
                              <Badge variant="secondary" className="rounded-full px-2 py-0.5 text-[10px]">
                                Built-in
                              </Badge>
                            ) : null}
                          </div>
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
                      {skill.isBuiltIn ? (
                        <Badge variant="secondary" className="rounded-full px-1.5 py-0 text-[10px]">
                          Built-in
                        </Badge>
                      ) : null}
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

        {/* Step 4: Start Dev Server — always visible (system step) */}
        <div className="rounded-lg border border-border/60 bg-background/90">
          <div className="flex items-start gap-3 px-4 py-3">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted/30 text-xs font-medium text-foreground">
              4
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <Terminal className="size-4 text-muted-foreground" />
                <span className="text-sm font-medium text-foreground">Start Dev Server</span>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant={devServerCommand.trim() === "d3k" ? "secondary" : "outline"}
                  size="sm"
                  className="h-7 text-[11px]"
                  onClick={() => setDevServerCommand("d3k")}
                  disabled={!canEdit}
                >
                  Use d3k
                </Button>
                <Button
                  type="button"
                  variant={devServerCommand.trim().toLowerCase() === NO_DEV_SERVER_COMMAND ? "secondary" : "outline"}
                  size="sm"
                  className="h-7 text-[11px]"
                  onClick={() => setDevServerCommand(NO_DEV_SERVER_COMMAND)}
                  disabled={!canEdit}
                >
                  Use none
                </Button>
              </div>
              <Input
                value={devServerCommand}
                onChange={(event) => setDevServerCommand(event.target.value)}
                placeholder={defaultDevServerCommand}
                className="mt-2 h-9 text-xs font-mono"
                disabled={!canEdit}
              />
              <p className="mt-1.5 text-xs text-muted-foreground">
                Use a repo-aware dev command like <code>bun run dev</code>. If you set this to <code>d3k</code>, the
                workflow expands it to the standard sandbox d3k runtime flags and keeps d3k focused on the dev server,
                browser, and logs. Use <code>none</code> to skip dev-server startup entirely for code-only agents.
              </p>
            </div>
          </div>
        </div>
        <StepConnector />

        {/* Step 5: Claude Model — always visible (system step) */}
        <div className="rounded-lg border border-border/60 bg-background/90">
          <div className="flex items-start gap-3 px-4 py-3">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted/30 text-xs font-medium text-foreground">
              5
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Bot className="size-4 text-muted-foreground" />
                  <span className="text-sm font-medium text-foreground">Claude Model</span>
                </div>
                <Select
                  value={aiAgent}
                  onValueChange={(value) => setAiAgent(value as DevAgentAiAgent)}
                  disabled={!canEdit}
                >
                  <SelectTrigger className="h-8 w-44 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="anthropic/claude-opus-4.6">Claude Opus 4.6</SelectItem>
                    <SelectItem value="anthropic/claude-sonnet-4.6">Claude Sonnet 4.6</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Select which Claude model the sandbox agent should use through AI Gateway.{" "}
                {getDevAgentModelLabel(aiAgent)} is the current default for this run.
              </p>
            </div>
          </div>
        </div>

        {workflowView === "ui" ? (
          <>
            <div className="rounded-lg border border-border/60 bg-muted/20 px-4 py-3 text-xs text-muted-foreground">
              The workflow runtime already captures baseline evidence and final verification. Write prompts that use
              that evidence, inspect code, and make decisions or fixes instead of re-running measurements inside the
              agent.
            </div>

            {/* Action Steps with insert buttons between them */}
            {actionSteps.map((step, index) => (
              <div key={step.id}>
                {canEdit ? (
                  <InsertStepButton
                    onInsert={(prompt) => addActionStep(prompt, index)}
                    onConfigureEarlyExit={() => configureEarlyExit(index)}
                  />
                ) : (
                  <StepConnector />
                )}
                {effectiveEarlyExitPlacementIndex === index ? (
                  <>
                    <InlineEarlyExitCard
                      editorId={earlyExitEditorId}
                      mode={earlyExitMode}
                      rule={earlyExitRule}
                      textValue={earlyExitEval}
                      canEdit={canEdit}
                      onRemove={removeEarlyExit}
                      onModeChange={setEarlyExitMode}
                      onRuleChange={setEarlyExitRule}
                      onTextChange={setEarlyExitEval}
                    />
                    {canEdit ? (
                      <InsertStepButton
                        onInsert={(prompt) => addActionStep(prompt, index)}
                        onConfigureEarlyExit={() => configureEarlyExit(index)}
                      />
                    ) : (
                      <StepConnector />
                    )}
                  </>
                ) : null}
                <ActionStepCard
                  step={step}
                  stepNumber={actionStepBaseNumber + index}
                  canEdit={canEdit}
                  onUpdate={updateActionStep}
                  onRemove={removeActionStep}
                />
              </div>
            ))}

            {/* Add Prompt Button (append to end) */}
            {canEdit && (
              <InsertStepButton
                onInsert={(prompt) => addActionStep(prompt)}
                onConfigureEarlyExit={() => configureEarlyExit(actionSteps.length)}
              />
            )}
            {effectiveEarlyExitPlacementIndex === actionSteps.length ? (
              <>
                <InlineEarlyExitCard
                  editorId={earlyExitEditorId}
                  mode={earlyExitMode}
                  rule={earlyExitRule}
                  textValue={earlyExitEval}
                  canEdit={canEdit}
                  onRemove={removeEarlyExit}
                  onModeChange={setEarlyExitMode}
                  onRuleChange={setEarlyExitRule}
                  onTextChange={setEarlyExitEval}
                />
                {canEdit ? (
                  <InsertStepButton
                    onInsert={(prompt) => addActionStep(prompt, actionSteps.length)}
                    onConfigureEarlyExit={() => configureEarlyExit(actionSteps.length)}
                  />
                ) : null}
              </>
            ) : null}

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
                    className="mt-2 min-h-12 text-xs"
                    rows={2}
                    disabled={!canEdit}
                  />
                </div>
              </div>
            </div>
          </>
        ) : (
          <>
            {/* Text Mode — single textarea for all prompts */}
            <StepConnector />
            <div className="space-y-3">
              <div className="rounded-lg border border-border/60 bg-background/80 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <MessageSquare className="size-4 text-muted-foreground" />
                  <span className="text-sm font-medium text-foreground">Agent Prompts</span>
                  <span className="text-[11px] text-muted-foreground">(separate steps with ---)</span>
                </div>
                <p className="mb-3 text-xs text-muted-foreground">
                  The workflow runtime already captures baseline evidence and final verification. Use these prompts for
                  inspection, decisions, and code changes rather than repeating measurements.
                </p>
                <Textarea
                  value={textModeValue}
                  onChange={(e) => setTextModeValue(e.target.value)}
                  placeholder={"Step 1 prompt...\n\n---\n\nStep 2 prompt..."}
                  className="min-h-48 text-xs font-mono"
                  disabled={!canEdit}
                />
              </div>

              {/* Success Eval — separate textarea in text mode */}
              <div className="rounded-lg border border-border/60 bg-background/90 p-4">
                <div className="flex items-center justify-between gap-2 mb-2">
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
                  className="min-h-12 text-xs"
                  rows={2}
                  disabled={!canEdit}
                />
              </div>

              {isEarlyExitEnabled ? (
                <div id={earlyExitEditorId}>
                  <EarlyExitEditor
                    mode={earlyExitMode}
                    rule={earlyExitRule}
                    textValue={earlyExitEval}
                    canEdit={canEdit}
                    onRemove={removeEarlyExit}
                    onModeChange={setEarlyExitMode}
                    onRuleChange={setEarlyExitRule}
                    onTextChange={setEarlyExitEval}
                  />
                </div>
              ) : canEdit ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-fit"
                  onClick={() => configureEarlyExit(actionSteps.length)}
                >
                  <Plus className="size-4" />
                  Add Early Exit Condition
                </Button>
              ) : null}
            </div>
          </>
        )}
      </div>

      {/* Submit */}
      {submitError && <p className="text-sm text-destructive">{submitError}</p>}
      {!isReadOnly ? (
        <div className="flex items-center gap-3">
          <Button onClick={submitDevAgent} disabled={!isFormValid}>
            {isPending ? (isEditMode ? "Saving..." : "Creating...") : submitLabel}
          </Button>
          {savedMessage && <span className="text-sm text-muted-foreground">{savedMessage}</span>}
        </div>
      ) : null}
    </div>
  )
}
