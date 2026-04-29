export type DevAgentKind = "builtin" | "custom" | "marketplace" | "skill-runner"
export type DevAgentExecutionMode = "dev-server" | "preview-pr"
export type DevAgentSandboxBrowser = "none" | "agent-browser"

export interface DevAgentAuthor {
  id: string
  email: string
  name: string
  username: string
}

export interface DevAgentEditor {
  id: string
  email: string
}

export interface DevAgentTeam {
  id: string
  slug: string
  name: string
  isPersonal: boolean
}

export interface DevAgentSkillRef {
  id: string
  installArg: string
  packageName?: string
  skillName: string
  displayName: string
  sourceUrl?: string
}

export interface DevAgentAshCompiledSpec {
  schemaVersion: number
  artifactFormatVersion: number
  ashRuntimeVersion: string
  createdAt: string
  id: string
  name: string
  description: string
  instructions: string
  executionMode: DevAgentExecutionMode
  sandboxBrowser: DevAgentSandboxBrowser
  aiAgent: DevAgentAiAgent
  devServerCommand: string
  actionSteps: Array<{
    kind: DevAgentActionStep["kind"]
    config: Record<string, string>
  }>
  skillRefs: Array<{
    id: string
    installArg: string
    packageName: string
    skillName: string
    displayName: string
    sourceUrl: string
  }>
  successEval: string
  earlyExitMode: DevAgentEarlyExitMode | null
  earlyExitEval: string
  earlyExitRule: {
    metricType: DevAgentEarlyExitMetricType
    metricKey: string
    label: string
    valueType: DevAgentEarlyExitValueType
    operator: DevAgentEarlyExitOperator
    valueNumber: number | null
    secondaryValueNumber: number | null
    valueBoolean: boolean | null
    valueString: string
  } | null
  earlyExitPlacementIndex: number | null
}

export interface DevAgentAshArtifact {
  framework: "experimental-ash"
  revision: number
  specHash: string
  generatedAt: string
  packageName: string
  packageVersion: string
  sourceLabel: string
  systemPrompt: string
  packagedSkills?: string[]
  compiledSpec?: DevAgentAshCompiledSpec
  tarballUrl?: string
}

export type DevAgentAiAgent = "anthropic/claude-opus-4.6" | "anthropic/claude-sonnet-4.6"
export type DevAgentEarlyExitMode = "structured" | "text"
export type DevAgentEarlyExitMetricType = "builtin" | "custom"
export type DevAgentEarlyExitValueType = "number" | "boolean" | "string"
export type DevAgentEarlyExitOperator = "<" | "<=" | ">" | ">=" | "===" | "!==" | "between"

export interface DevAgentEarlyExitRule {
  metricType: DevAgentEarlyExitMetricType
  metricKey: string
  label?: string
  valueType: DevAgentEarlyExitValueType
  operator: DevAgentEarlyExitOperator
  valueNumber?: number
  secondaryValueNumber?: number
  valueBoolean?: boolean
  valueString?: string
}

export type DevAgentActionStepKind =
  | "browse-to-page"
  | "start-dev-server"
  | "capture-loading-frames"
  | "capture-cwv"
  | "go-back-to-step"
  | "send-prompt"

export interface DevAgentActionStep {
  kind: DevAgentActionStepKind
  config: Record<string, string>
}

export interface DevAgent {
  id: string
  kind: DevAgentKind
  name: string
  description: string
  instructions: string
  executionMode: DevAgentExecutionMode
  sandboxBrowser: DevAgentSandboxBrowser
  aiAgent?: DevAgentAiAgent
  devServerCommand?: string
  actionSteps?: DevAgentActionStep[]
  skillRefs: DevAgentSkillRef[]
  author: DevAgentAuthor
  team?: DevAgentTeam
  createdAt: string
  updatedAt: string
  usageCount: number
  avgCost?: string
  legacyWorkflowType?: "cls-fix" | "prompt" | "design-guidelines" | "react-performance" | "turbopack-bundle-analyzer"
  supportsPathInput?: boolean
  supportsPullRequest?: boolean
  supportsCrawlDepth?: boolean
  requiresCustomPrompt?: boolean
  successEval?: string
  earlyExitMode?: DevAgentEarlyExitMode
  earlyExitEval?: string
  earlyExitRule?: DevAgentEarlyExitRule
  earlyExitPlacementIndex?: number
  ashArtifact?: DevAgentAshArtifact
  runnerCanonicalPath?: string
  runnerSourceUrl?: string
  runnerSourceKind?: "default" | "imported"
  validationWarning?: string
}

export interface MarketplaceAgentStats {
  projectRuns: string
  successRate: string
  mergeRate: string
  tokensUsed: string
  avgTime: string
  avgCost: string
  estCost: string
  previouslyPurchased: boolean
}

export const D3K_SKILL_INSTALL_ARG = "vercel-labs/dev3000@d3k"
export const VERCEL_PLUGIN_INSTALL_ARG = "vercel/vercel-plugin"

function normalizeSkillIdentifier(value?: string): string {
  return (value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
}

const VERCEL_PLUGIN_SKILL_NAMES = new Set([
  "ai-gateway",
  "ai-sdk",
  "auth",
  "bootstrap",
  "chat-sdk",
  "deployments-cicd",
  "env-vars",
  "knowledge-update",
  "marketplace",
  "next-cache-components",
  "next-upgrade",
  "nextjs",
  "react-best-practices",
  "routing-middleware",
  "runtime-cache",
  "shadcn",
  "turbopack",
  "vercel-agent",
  "vercel-cli",
  "vercel-functions",
  "vercel-sandbox",
  "vercel-storage",
  "verification",
  "workflow",
  "benchmark-agents",
  "benchmark-e2e",
  "benchmark-sandbox",
  "benchmark-testing",
  "plugin-audit",
  "release",
  "vercel-plugin-eval"
])

export function isVercelPluginSkillRef(input: {
  installArg?: string
  packageName?: string
  skillName?: string
  id?: string
  builtInLabel?: string
}): boolean {
  const installArg = input.installArg?.trim().toLowerCase() || ""
  const packageName = input.packageName?.trim().toLowerCase() || ""
  const skillName = normalizeSkillIdentifier(input.skillName || input.id)

  return (
    packageName === VERCEL_PLUGIN_INSTALL_ARG ||
    installArg === VERCEL_PLUGIN_INSTALL_ARG ||
    installArg.startsWith(`${VERCEL_PLUGIN_INSTALL_ARG.toLowerCase()}@`) ||
    VERCEL_PLUGIN_SKILL_NAMES.has(skillName)
  )
}

export function isSandboxBuiltinSkillRef(input: {
  installArg?: string
  packageName?: string
  skillName?: string
  id?: string
  builtInLabel?: string
}): boolean {
  const installArg = input.installArg?.trim() || ""
  return installArg === D3K_SKILL_INSTALL_ARG || isVercelPluginSkillRef(input)
}

export function getDevAgentModelLabel(value: DevAgentAiAgent | undefined): string {
  if (value === "anthropic/claude-sonnet-4.6") return "Claude Sonnet 4.6"
  return "Claude Opus 4.6"
}
