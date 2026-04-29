import { list } from "@vercel/blob"
import { putBlobAndBuildUrl, readBlobJson as readStoredBlobJson } from "@/lib/blob-store"
import { createDevAgentAshArtifactDescriptor } from "@/lib/dev-agent-ash-spec"
import { NO_DEV_SERVER_COMMAND } from "@/lib/dev-server-command"

const CUSTOM_DEV_AGENT_PREFIX = "dev-agents/custom/"
const DEV_AGENT_STATS_PREFIX = "dev-agents/stats/"

const BUILTIN_DEV_AGENT_ID_ALIASES = {
  "dev-agent-cls-fix": "r_c84m2f",
  "dev-agent-design-guidelines": "r_d91q7k",
  "dev-agent-react-performance": "r_p47n6x",
  "dev-agent-turbopack-bundle-analyzer": "r_t62v8m",
  "devAgent-cls-fix": "r_c84m2f",
  "devAgent-design-guidelines": "r_d91q7k",
  "devAgent-react-performance": "r_p47n6x",
  "devAgent-turbopack-bundle-analyzer": "r_t62v8m"
} as const

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

export type DevAgentAshArtifactAvailability = "existing" | "reused" | "stored"

export type DevAgentAiAgent = "anthropic/claude-opus-4.6" | "anthropic/claude-sonnet-4.6"
export type DevAgentEarlyExitMode = "structured" | "text"
export type DevAgentEarlyExitMetricType = "builtin" | "custom"
export type DevAgentEarlyExitValueType = "number" | "boolean" | "string"
export type DevAgentEarlyExitOperator = "<" | "<=" | ">" | ">=" | "===" | "!==" | "between"

export const D3K_SKILL_INSTALL_ARG = "vercel-labs/dev3000@d3k"
export const ANALYZE_BUNDLE_SKILL_INSTALL_ARG = "vercel-labs/dev3000@analyze-bundle"
export const VERCEL_PLUGIN_INSTALL_ARG = "vercel/vercel-plugin"
const LEGACY_D3K_SKILL_INSTALL_ARGS = new Set([
  "https://github.com/vercel-labs/dev3000/tree/main/skills/d3k",
  "https://github.com/vercel-labs/dev3000/tree/main/.agents/skills/d3k",
  "https://skills.sh/vercel-labs/dev3000/d3k"
])
const LEGACY_ANALYZE_BUNDLE_SKILL_INSTALL_ARGS = new Set([
  "vercel-labs/skills@analyze-bundle",
  "https://skills.sh/vercel-labs/skills/analyze-bundle",
  "https://github.com/vercel-labs/dev3000/tree/main/.agents/skills/analyze-bundle",
  "https://github.com/vercel-labs/dev3000/tree/main/skills/analyze-bundle"
])
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

export function isDevAgentEarlyExitMode(value: string): value is DevAgentEarlyExitMode {
  return value === "structured" || value === "text"
}

export function isDevAgentAiAgent(value: string): value is DevAgentAiAgent {
  return value === "anthropic/claude-opus-4.6" || value === "anthropic/claude-sonnet-4.6"
}

export function getDevAgentModelLabel(value: DevAgentAiAgent | undefined): string {
  if (value === "anthropic/claude-sonnet-4.6") return "Claude Sonnet 4.6"
  return "Claude Opus 4.6"
}

export function isDevAgentEarlyExitRule(value: unknown): value is DevAgentEarlyExitRule {
  if (!value || typeof value !== "object") return false
  const rule = value as Record<string, unknown>
  if (rule.metricType !== "builtin" && rule.metricType !== "custom") return false
  if (typeof rule.metricKey !== "string" || rule.metricKey.trim().length === 0) return false
  if (typeof rule.label !== "undefined" && typeof rule.label !== "string") return false
  if (rule.valueType !== "number" && rule.valueType !== "boolean" && rule.valueType !== "string") return false
  if (!["<", "<=", ">", ">=", "===", "!==", "between"].includes(String(rule.operator))) return false

  if (rule.valueType === "number") {
    if (typeof rule.valueNumber !== "number" || !Number.isFinite(rule.valueNumber)) return false
    if (rule.operator === "between") {
      return typeof rule.secondaryValueNumber === "number" && Number.isFinite(rule.secondaryValueNumber)
    }
    return true
  }

  if (rule.operator === "between") return false

  if (rule.valueType === "boolean") {
    return typeof rule.valueBoolean === "boolean"
  }

  return typeof rule.valueString === "string"
}

export function parseDevAgentEarlyExitRule(input: DevAgentEarlyExitRule): DevAgentEarlyExitRule {
  const metricKey = input.metricKey.trim()
  const label = input.label?.trim() || undefined
  const baseRule: DevAgentEarlyExitRule = {
    metricType: input.metricType,
    metricKey,
    label,
    valueType: input.valueType,
    operator: input.operator
  }

  if (input.valueType === "number") {
    return {
      ...baseRule,
      valueNumber: input.valueNumber,
      secondaryValueNumber: input.operator === "between" ? input.secondaryValueNumber : undefined
    }
  }

  if (input.valueType === "boolean") {
    return {
      ...baseRule,
      valueBoolean: input.valueBoolean
    }
  }

  return {
    ...baseRule,
    valueString: input.valueString?.trim() ?? ""
  }
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

interface StoredDevAgent extends Omit<DevAgent, "usageCount" | "sandboxBrowser"> {
  sandboxBrowser?: DevAgentSandboxBrowser
}

interface DevAgentUsageStat {
  devAgentId: string
  usageCount: number
  updatedAt: string
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
}

function canonicalizeDevAgentId(devAgentId: string): string {
  return BUILTIN_DEV_AGENT_ID_ALIASES[devAgentId as keyof typeof BUILTIN_DEV_AGENT_ID_ALIASES] ?? devAgentId
}

function generateDevAgentId(): string {
  return `r_${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`
}

function titleCaseSkillName(skillName: string): string {
  return skillName
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

function normalizeSkillIdentifier(value?: string): string {
  return (value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
}

export function isVercelPluginSkillRef(input: {
  installArg?: string
  packageName?: string
  skillName?: string
  id?: string
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
}): boolean {
  const installArg = input.installArg?.trim() || ""
  return installArg === D3K_SKILL_INSTALL_ARG || isVercelPluginSkillRef(input)
}

export function parseDevAgentSkillRef(input: {
  installArg: string
  sourceUrl?: string
  displayName?: string
}): DevAgentSkillRef {
  const rawInstallArg = input.installArg.trim()
  const installArg = LEGACY_D3K_SKILL_INSTALL_ARGS.has(rawInstallArg)
    ? D3K_SKILL_INSTALL_ARG
    : LEGACY_ANALYZE_BUNDLE_SKILL_INSTALL_ARGS.has(rawInstallArg)
      ? ANALYZE_BUNDLE_SKILL_INSTALL_ARG
      : rawInstallArg
  const packageAndSkill = installArg.split("@")
  const packageName = packageAndSkill.length > 1 ? packageAndSkill.slice(0, -1).join("@") : undefined
  const rawSkillName = packageAndSkill.length > 1 ? packageAndSkill[packageAndSkill.length - 1] : installArg
  const normalizedSkillName = rawSkillName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")

  return {
    id: normalizedSkillName || slugify(installArg),
    installArg,
    packageName,
    skillName: normalizedSkillName || slugify(installArg),
    displayName: input.displayName?.trim() || titleCaseSkillName(normalizedSkillName || rawSkillName),
    sourceUrl:
      input.sourceUrl?.trim() ||
      (normalizedSkillName === "d3k"
        ? "https://github.com/vercel-labs/dev3000/tree/main/skills/d3k"
        : normalizedSkillName === "analyze-bundle"
          ? "https://github.com/vercel-labs/dev3000/tree/main/www/.agents/skills/analyze-bundle"
          : undefined)
  }
}

const systemAuthor: DevAgentAuthor = {
  id: "system",
  email: "system@dev3000.ai",
  name: "dev3000",
  username: "dev3000"
}

const REACT_BEST_PRACTICES_SKILL_REFS = [
  parseDevAgentSkillRef({
    installArg: D3K_SKILL_INSTALL_ARG,
    displayName: "d3k"
  }),
  parseDevAgentSkillRef({
    installArg: "vercel-labs/agent-skills@vercel-react-best-practices",
    sourceUrl: "https://skills.sh/vercel-labs/agent-skills/vercel-react-best-practices"
  })
]

const BUILTIN_DEV_AGENTS: Array<Omit<DevAgent, "usageCount">> = [
  {
    id: "r_c84m2f",
    kind: "builtin",
    name: "CLS Fix",
    description: "Capture layout shift problems in a sandboxed dev server, fix them, and verify the result.",
    instructions:
      "Use d3k runtime signals to find and fix cumulative layout shift issues. Capture before and after state, make targeted edits, and verify the page is stable before finishing.",
    executionMode: "dev-server",
    sandboxBrowser: "agent-browser",
    skillRefs: [
      parseDevAgentSkillRef({
        installArg: D3K_SKILL_INSTALL_ARG,
        displayName: "d3k"
      })
    ],
    author: systemAuthor,
    createdAt: "2026-03-12T00:00:00.000Z",
    updatedAt: "2026-03-12T00:00:00.000Z",
    legacyWorkflowType: "cls-fix",
    supportsPathInput: true,
    supportsPullRequest: true,
    aiAgent: "anthropic/claude-opus-4.6",
    devServerCommand: "d3k",
    successEval: "Is the CLS score now ≤ 0.1 and improved from the baseline?",
    earlyExitMode: "structured",
    earlyExitEval: "CLS score is 0.1 or below (already good)",
    earlyExitRule: {
      metricType: "builtin",
      metricKey: "cls",
      valueType: "number",
      operator: "<=",
      valueNumber: 0.1
    }
  },
  {
    id: "r_d91q7k",
    kind: "builtin",
    name: "Design Guidelines Review",
    description: "Audit a project against design guidelines, apply fixes, and prepare a PR-ready result.",
    instructions:
      "Review the selected project against the loaded design guidance, fix the highest-value issues, and validate that the experience is improved before finalizing.",
    executionMode: "preview-pr",
    sandboxBrowser: "agent-browser",
    skillRefs: [
      parseDevAgentSkillRef({
        installArg: D3K_SKILL_INSTALL_ARG,
        displayName: "d3k"
      }),
      parseDevAgentSkillRef({
        installArg: "vercel-labs/agent-skills@web-design-guidelines",
        sourceUrl: "https://skills.sh/vercel-labs/agent-skills/web-design-guidelines"
      })
    ],
    author: systemAuthor,
    createdAt: "2026-03-12T00:00:00.000Z",
    updatedAt: "2026-03-12T00:00:00.000Z",
    legacyWorkflowType: "design-guidelines",
    supportsPathInput: true,
    supportsPullRequest: true,
    supportsCrawlDepth: true,
    aiAgent: "anthropic/claude-opus-4.6",
    devServerCommand: "d3k",
    successEval: "Were the highest-priority design guideline violations resolved?"
  },
  {
    id: "r_p47n6x",
    kind: "builtin",
    name: "React Performance Review",
    description: "Find expensive React and Next.js patterns, apply fixes, and validate the performance direction.",
    instructions:
      "Use the workflow-provided baseline evidence, inspect the codebase for expensive React and Next.js patterns, apply targeted optimizations, and verify the impact before finishing.",
    executionMode: "preview-pr",
    sandboxBrowser: "agent-browser",
    skillRefs: [
      parseDevAgentSkillRef({
        installArg: D3K_SKILL_INSTALL_ARG,
        displayName: "d3k"
      }),
      parseDevAgentSkillRef({
        installArg: "vercel-labs/agent-skills@vercel-react-best-practices",
        sourceUrl: "https://skills.sh/vercel-labs/agent-skills/vercel-react-best-practices"
      })
    ],
    author: systemAuthor,
    createdAt: "2026-03-12T00:00:00.000Z",
    updatedAt: "2026-03-12T00:00:00.000Z",
    legacyWorkflowType: "react-performance",
    supportsPathInput: true,
    supportsPullRequest: true,
    aiAgent: "anthropic/claude-opus-4.6",
    devServerCommand: "d3k",
    successEval: "Did the targeted optimizations improve or maintain Web Vitals?"
  },
  {
    id: "r_w82af1",
    kind: "builtin",
    name: "Eliminate Waterfalls",
    description:
      "Find sequential async work in React and Next.js flows, remove unnecessary waiting, and verify the main path is flatter.",
    instructions:
      "Focus only on async waterfalls. Use the workflow-provided baseline evidence, inspect the route and its related server code for sequential awaits or per-item fetch chains, and rewrite only the highest-impact cases. If the initial inspection shows no meaningful waterfall to remove, stop and report that instead of making speculative edits.",
    executionMode: "preview-pr",
    sandboxBrowser: "agent-browser",
    actionSteps: [
      {
        kind: "send-prompt",
        config: {
          prompt:
            "Use the workflow-provided baseline evidence, then inspect at most 4 likely route-adjacent files for sequential awaits, nested per-item fetch loops, and async work that starts too late. Identify the single highest-impact waterfall before making any edits."
        }
      },
      {
        kind: "send-prompt",
        config: {
          prompt:
            "If no meaningful waterfall exists after the initial code scan, stop early and summarize the evidence instead of making low-confidence changes."
        }
      },
      {
        kind: "send-prompt",
        config: {
          prompt:
            "Parallelize independent operations with Promise.all or promise pipelining, defer awaits until the value is needed, and flatten any obvious per-item server fetch waterfalls."
        }
      },
      {
        kind: "send-prompt",
        config: {
          prompt:
            "Do a quick targeted sanity check and code pass to confirm the main path no longer waits unnecessarily. Do not run broad verification commands or restart investigation. Base this step on the code changes and any lightweight checks you already performed. The workflow runtime will handle final verification."
        }
      }
    ],
    skillRefs: REACT_BEST_PRACTICES_SKILL_REFS,
    author: systemAuthor,
    createdAt: "2026-04-04T00:00:00.000Z",
    updatedAt: "2026-04-04T00:00:00.000Z",
    supportsPathInput: true,
    supportsPullRequest: true,
    aiAgent: "anthropic/claude-opus-4.6",
    devServerCommand: "d3k",
    successEval:
      "Were independent async operations parallelized or deferred so the main path no longer waits unnecessarily, with baseline metrics maintained or improved?"
  },
  {
    id: "r_b61dz2",
    kind: "builtin",
    name: "Bundle Size Optimizer",
    description:
      "Reduce shipped JavaScript by removing oversized client boundaries and deferring low-value code from the initial route bundle.",
    instructions:
      "Focus only on initial bundle size. Use the workflow-provided baseline evidence, inspect client boundaries, route-level imports, and obviously heavy client code or static payloads. Prefer moving work to the server, lazy-loading non-critical UI, or conditionally loading code behind user intent. If the initial route is already lean and there is no clear shipped-JS win, stop and report that rather than churning code.",
    executionMode: "preview-pr",
    sandboxBrowser: "agent-browser",
    actionSteps: [
      {
        kind: "send-prompt",
        config: {
          prompt:
            "Use the workflow-provided baseline evidence, then inspect at most 4 likely files on the selected route for top-level client boundaries, heavy imports, large static payloads, and low-value widgets that load before user intent. Pick the single clearest shipped-JS win before editing."
        }
      },
      {
        kind: "send-prompt",
        config: {
          prompt:
            "If there is no clear way to reduce shipped JavaScript on the initial route, stop early and document why instead of making cosmetic refactors."
        }
      },
      {
        kind: "send-prompt",
        config: {
          prompt:
            "Implement one or two concrete reductions: move code or data to the server, add dynamic imports, or remove oversized client-only imports from the first render path."
        }
      },
      {
        kind: "send-prompt",
        config: {
          prompt:
            "Do a quick targeted sanity check that the route still renders correctly and that the shipped-JS direction should improve based on the changes you made. Do not run broad verification commands or restart investigation. Base this step on the code changes and any lightweight checks you already performed. The workflow runtime will handle final verification."
        }
      }
    ],
    skillRefs: REACT_BEST_PRACTICES_SKILL_REFS,
    author: systemAuthor,
    createdAt: "2026-04-04T00:00:00.000Z",
    updatedAt: "2026-04-04T00:00:00.000Z",
    supportsPathInput: true,
    supportsPullRequest: true,
    aiAgent: "anthropic/claude-opus-4.6",
    devServerCommand: "d3k",
    successEval:
      "Was initial shipped JavaScript measurably reduced by removing, deferring, or server-shifting non-critical client code?"
  },
  {
    id: "r_s93kp4",
    kind: "builtin",
    name: "Server-Side Perf Optimizer",
    description:
      "Tighten server-rendered routes by deduplicating fetches, reducing request-time work, and shrinking serialized payloads.",
    instructions:
      "Focus only on server-side performance. Use the workflow-provided baseline evidence, inspect server components, API routes, and server actions for duplicate fetches, avoidable request-time computation, and oversized client-boundary payloads. Prefer composition, cache(), and narrower props. If the route has no meaningful server-side bottleneck after inspection, stop and summarize that instead of forcing a rewrite.",
    executionMode: "preview-pr",
    sandboxBrowser: "agent-browser",
    actionSteps: [
      {
        kind: "send-prompt",
        config: {
          prompt:
            "Use the workflow-provided baseline evidence, then inspect at most 4 likely server-side files for duplicate fetches, sequential request-time work, and over-serialization into client components. Decide on the single highest-impact bottleneck before making edits."
        }
      },
      {
        kind: "send-prompt",
        config: {
          prompt:
            "If there is no meaningful server-side bottleneck to reduce, stop early and document the evidence instead of making broad structural changes."
        }
      },
      {
        kind: "send-prompt",
        config: {
          prompt:
            "Deduplicate server data access, narrow payloads crossing the RSC boundary, and move avoidable request-time work out of the hot path while preserving behavior."
        }
      },
      {
        kind: "send-prompt",
        config: {
          prompt:
            "Do a quick targeted sanity check that the route still renders correctly and that TTFB or LCP direction should be maintained or improved based on the changes you made. Do not run broad verification commands or restart investigation. Base this step on the code changes and any lightweight checks you already performed. The workflow runtime will handle final verification."
        }
      }
    ],
    skillRefs: REACT_BEST_PRACTICES_SKILL_REFS,
    author: systemAuthor,
    createdAt: "2026-04-04T00:00:00.000Z",
    updatedAt: "2026-04-04T00:00:00.000Z",
    supportsPathInput: true,
    supportsPullRequest: true,
    aiAgent: "anthropic/claude-opus-4.6",
    devServerCommand: "d3k",
    successEval:
      "Were duplicate server fetches, unnecessary serialization, or avoidable request-time work reduced with TTFB/LCP maintained or improved?"
  },
  {
    id: "r_c74hf5",
    kind: "builtin",
    name: "Client-Side Fetch Optimizer",
    description:
      "Collapse duplicate browser-side requests and subscriptions so client data loading becomes simpler and cheaper.",
    instructions:
      "Focus only on browser-side fetching and subscriptions. Use the workflow-provided baseline evidence, inspect client components for duplicate requests to the same endpoint, redundant listeners, and repeated local browser work that should be shared or deduplicated. Prefer SWR-style deduplication or a single shared hook. If there is no real duplication to remove, stop and report that rather than introducing abstractions for their own sake.",
    executionMode: "preview-pr",
    sandboxBrowser: "agent-browser",
    actionSteps: [
      {
        kind: "send-prompt",
        config: {
          prompt:
            "Use the workflow-provided baseline evidence, then inspect at most 4 likely client files for repeated fetches to the same resource, duplicated event listeners, and redundant localStorage or browser work. Pick one concrete duplication problem before editing."
        }
      },
      {
        kind: "send-prompt",
        config: {
          prompt:
            "If the client-side data flow is already deduplicated, stop early and summarize the evidence instead of adding unnecessary caching layers."
        }
      },
      {
        kind: "send-prompt",
        config: {
          prompt:
            "Unify repeated client fetches behind a shared request layer or SWR-style hook, collapse duplicate listeners, and keep the fix tightly scoped to the affected flow."
        }
      },
      {
        kind: "send-prompt",
        config: {
          prompt:
            "Do a quick targeted sanity check that the route still loads and updates correctly and that redundant browser work should be reduced based on the changes you made. Do not run broad verification commands or restart investigation. Base this step on the code changes and any lightweight checks you already performed. The workflow runtime will handle final verification."
        }
      }
    ],
    skillRefs: REACT_BEST_PRACTICES_SKILL_REFS,
    author: systemAuthor,
    createdAt: "2026-04-04T00:00:00.000Z",
    updatedAt: "2026-04-04T00:00:00.000Z",
    supportsPathInput: true,
    supportsPullRequest: true,
    aiAgent: "anthropic/claude-opus-4.6",
    devServerCommand: "d3k",
    successEval:
      "Were duplicate client requests or redundant browser-side subscriptions eliminated, with data loading behavior measurably simpler or more efficient?"
  },
  {
    id: "r_r55mq6",
    kind: "builtin",
    name: "Re-render Optimizer",
    description:
      "Reduce unnecessary render churn by tightening derived state, render-path computation, and transient client state.",
    instructions:
      "Focus only on unnecessary re-renders. Use the workflow-provided baseline evidence, inspect client components for expensive work performed on every render, derived state stored via effects, broad dependencies, and transient values that do not need to live in state. If the route has no meaningful render churn after inspection, stop and report that instead of adding memoization by reflex.",
    executionMode: "preview-pr",
    sandboxBrowser: "agent-browser",
    actionSteps: [
      {
        kind: "send-prompt",
        config: {
          prompt:
            "Use the workflow-provided baseline evidence, then inspect at most 4 likely client files for expensive render-path work, effect-driven derived state, and state updates that trigger unnecessary rerenders. Identify the single clearest render-churn bottleneck before editing."
        }
      },
      {
        kind: "send-prompt",
        config: {
          prompt:
            "If the route has no meaningful rerender pressure, stop early and explain why instead of adding speculative memoization."
        }
      },
      {
        kind: "send-prompt",
        config: {
          prompt:
            "Move derived state back into render when appropriate, stop rebuilding large values every render, and use more appropriate state or refs for transient values."
        }
      },
      {
        kind: "send-prompt",
        config: {
          prompt:
            "Do a quick targeted sanity check that the route still behaves correctly and that the main render path should be simpler and less noisy based on the changes you made. Do not run broad verification commands or restart investigation. Base this step on the code changes and any lightweight checks you already performed. The workflow runtime will handle final verification."
        }
      }
    ],
    skillRefs: REACT_BEST_PRACTICES_SKILL_REFS,
    author: systemAuthor,
    createdAt: "2026-04-04T00:00:00.000Z",
    updatedAt: "2026-04-04T00:00:00.000Z",
    supportsPathInput: true,
    supportsPullRequest: true,
    aiAgent: "anthropic/claude-opus-4.6",
    devServerCommand: "d3k",
    successEval:
      "Were unnecessary re-renders or expensive render-path computations removed without regressing visible behavior?"
  },
  {
    id: "r_t62v8m",
    kind: "builtin",
    name: "Turbopack Bundle Analyzer",
    description: "Generate analyzer output, inspect the heaviest routes, and ship targeted bundle reductions.",
    instructions:
      "Generate the Turbopack analyzer artifacts, identify the heaviest shipped-JS sources, and implement a concrete code change that materially reduces shipped JavaScript. Prefer moving oversized data out of client components, splitting server and client responsibilities, and keeping the fix tightly scoped.",
    executionMode: "preview-pr",
    sandboxBrowser: "none",
    skillRefs: [
      parseDevAgentSkillRef({
        installArg: ANALYZE_BUNDLE_SKILL_INSTALL_ARG,
        sourceUrl: "https://github.com/vercel-labs/dev3000/tree/main/www/.agents/skills/analyze-bundle"
      })
    ],
    author: systemAuthor,
    createdAt: "2026-03-12T00:00:00.000Z",
    updatedAt: "2026-03-12T00:00:00.000Z",
    legacyWorkflowType: "turbopack-bundle-analyzer",
    supportsPullRequest: true,
    aiAgent: "anthropic/claude-opus-4.6",
    devServerCommand: NO_DEV_SERVER_COMMAND,
    successEval: "Was the total shipped JavaScript measurably reduced?"
  },
  // ── Marketplace agents (demo) ──────────────────────────────────────────
  {
    id: "r_mp_rd01",
    kind: "marketplace",
    name: "Request Deduper",
    description: "Find duplicate fetches, collapse redundant requests, and tighten caching behavior across the app.",
    instructions:
      "Analyze the project for duplicate fetch calls and redundant API requests. Introduce request deduplication via shared caching layers, collapse overlapping routes, and add appropriate Cache-Control headers. Use the workflow runtime's before/after evidence to prove improvement.",
    executionMode: "dev-server",
    sandboxBrowser: "agent-browser",
    skillRefs: [
      parseDevAgentSkillRef({
        installArg: D3K_SKILL_INSTALL_ARG,
        displayName: "d3k"
      })
    ],
    author: { id: "shuding", email: "", name: "shuding", username: "shuding" },
    createdAt: "2026-02-18T00:00:00.000Z",
    updatedAt: "2026-03-15T00:00:00.000Z",
    supportsPathInput: true,
    supportsPullRequest: true,
    aiAgent: "anthropic/claude-opus-4.6",
    devServerCommand: "d3k",
    successEval: "Were duplicate fetches eliminated and caching behavior measurably improved?"
  },
  {
    id: "r_mp_sc06",
    kind: "marketplace",
    name: "shadcn Component Optimizer",
    description:
      "Update and enhance customized shadcn components only when the change is clearly safe, worthwhile, and consistent with the local design system.",
    instructions:
      "Inspect the project's customized shadcn components and supporting UI primitives. Identify safe upgrades such as API cleanup, accessibility fixes, composition improvements, styling consistency, and low-risk modernization. Only update components when the change is clearly compatible with the existing codebase and design language. Preserve intentional customizations, avoid broad rewrites, and verify the UI still behaves correctly before finishing.",
    executionMode: "preview-pr",
    sandboxBrowser: "agent-browser",
    skillRefs: [
      parseDevAgentSkillRef({
        installArg: `${VERCEL_PLUGIN_INSTALL_ARG}@shadcn`,
        displayName: "shadcn"
      })
    ],
    author: { id: "shadcn", email: "", name: "shadcn", username: "shadcn" },
    createdAt: "2026-04-02T00:00:00.000Z",
    updatedAt: "2026-04-02T00:00:00.000Z",
    supportsPathInput: true,
    supportsPullRequest: true,
    successEval: "Were customized shadcn components safely improved without regressing behavior or visual consistency?"
  },
  {
    id: "r_mp_ta02",
    kind: "marketplace",
    name: "Transaction Analyzer",
    description: "Trace checkout and mutation flows, isolate transactional bottlenecks, and harden error handling.",
    instructions:
      "Trace checkout and mutation flows end-to-end, identify transactional bottlenecks, add proper error boundaries and retry logic, and verify the hardened flow against failure scenarios.",
    executionMode: "dev-server",
    sandboxBrowser: "agent-browser",
    skillRefs: [
      parseDevAgentSkillRef({
        installArg: D3K_SKILL_INSTALL_ARG,
        displayName: "d3k"
      })
    ],
    author: { id: "andrewbarba", email: "", name: "andrewbarba", username: "andrewbarba" },
    createdAt: "2026-01-22T00:00:00.000Z",
    updatedAt: "2026-03-10T00:00:00.000Z",
    supportsPathInput: true,
    supportsPullRequest: true,
    successEval: "Were transactional bottlenecks isolated and error handling hardened with evidence?"
  },
  {
    id: "r_mp_pt03",
    kind: "marketplace",
    name: "Performance Tuner",
    description: "Tune rendering, caching, and loading behavior to reduce regressions in complex production apps.",
    instructions:
      "Use the workflow-provided baseline evidence, identify rendering bottlenecks, tune caching strategies and loading behavior, and verify that regressions are resolved with before/after metrics.",
    executionMode: "dev-server",
    sandboxBrowser: "agent-browser",
    skillRefs: [
      parseDevAgentSkillRef({
        installArg: D3K_SKILL_INSTALL_ARG,
        displayName: "d3k"
      }),
      parseDevAgentSkillRef({
        installArg: "vercel-labs/agent-skills@vercel-react-best-practices",
        sourceUrl: "https://skills.sh/vercel-labs/agent-skills/vercel-react-best-practices"
      })
    ],
    author: { id: "feedthejim", email: "", name: "feedthejim", username: "feedthejim" },
    createdAt: "2026-01-05T00:00:00.000Z",
    updatedAt: "2026-03-20T00:00:00.000Z",
    supportsPathInput: true,
    supportsPullRequest: true,
    successEval: "Were rendering and caching regressions resolved with before/after metrics?"
  },
  {
    id: "r_mp_st04",
    kind: "marketplace",
    name: "Next.js SPA Transformer",
    description: "Reshape legacy page flows into a smoother SPA-like experience without losing Next.js ergonomics.",
    instructions:
      "Analyze navigation patterns and page transitions, refactor hard navigations into client-side transitions, add prefetching and streaming where beneficial, and verify the SPA-like experience preserves Next.js features.",
    executionMode: "preview-pr",
    sandboxBrowser: "agent-browser",
    skillRefs: [
      parseDevAgentSkillRef({
        installArg: D3K_SKILL_INSTALL_ARG,
        displayName: "d3k"
      })
    ],
    author: { id: "acdlite", email: "", name: "acdlite", username: "acdlite" },
    createdAt: "2026-02-02T00:00:00.000Z",
    updatedAt: "2026-03-08T00:00:00.000Z",
    supportsPathInput: true,
    supportsPullRequest: true,
    successEval: "Were navigation flows converted to SPA-like transitions without losing Next.js features?"
  },
  {
    id: "r_mp_ae05",
    kind: "marketplace",
    name: "AE Optimizer",
    description:
      "Audit and optimize analytics event instrumentation — deduplicate events, fix missing properties, and align tracking with your data schema.",
    instructions:
      "Scan the codebase for analytics event calls (track, identify, page, etc.), deduplicate redundant events, ensure required properties are present per the schema, add missing instrumentation for key user flows, and validate the final event catalog against the data contract.",
    executionMode: "dev-server",
    sandboxBrowser: "agent-browser",
    skillRefs: [
      parseDevAgentSkillRef({
        installArg: D3K_SKILL_INSTALL_ARG,
        displayName: "d3k"
      })
    ],
    author: { id: "ericdodds", email: "", name: "Eric Dodds", username: "ericdodds" },
    createdAt: "2026-03-01T00:00:00.000Z",
    updatedAt: "2026-03-25T00:00:00.000Z",
    supportsPathInput: true,
    supportsPullRequest: true,
    successEval: "Were analytics events deduplicated and aligned with the data schema?"
  }
]

/**
 * Social-proof stats for marketplace agents (displayed on catalog cards and run pages).
 */
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

export const MARKETPLACE_AGENT_STATS: Record<string, MarketplaceAgentStats> = {
  r_mp_rd01: {
    projectRuns: "2,184",
    successRate: "97.4%",
    mergeRate: "84.2%",
    tokensUsed: "4.8M",
    avgTime: "6m 20s",
    avgCost: "$2.30",
    estCost: "$2.10-$2.90",
    previouslyPurchased: true
  },
  r_mp_ta02: {
    projectRuns: "1,326",
    successRate: "95.9%",
    mergeRate: "78.6%",
    tokensUsed: "3.2M",
    avgTime: "4m 10s",
    avgCost: "$1.70",
    estCost: "$1.40-$2.20",
    previouslyPurchased: false
  },
  r_mp_pt03: {
    projectRuns: "3,942",
    successRate: "98.1%",
    mergeRate: "91.3%",
    tokensUsed: "8.6M",
    avgTime: "8m 35s",
    avgCost: "$3.40",
    estCost: "$2.80-$4.60",
    previouslyPurchased: false
  },
  r_mp_st04: {
    projectRuns: "896",
    successRate: "93.7%",
    mergeRate: "72.1%",
    tokensUsed: "2.4M",
    avgTime: "2m 45s",
    avgCost: "$1.20",
    estCost: "$0.90-$1.80",
    previouslyPurchased: false
  },
  r_mp_ae05: {
    projectRuns: "1,753",
    successRate: "96.2%",
    mergeRate: "80.5%",
    tokensUsed: "5.1M",
    avgTime: "5m 50s",
    avgCost: "$2.90",
    estCost: "$2.20-$3.80",
    previouslyPurchased: false
  },
  r_mp_sc06: {
    projectRuns: "742",
    successRate: "97.8%",
    mergeRate: "88.4%",
    tokensUsed: "2.9M",
    avgTime: "3m 15s",
    avgCost: "$1.80",
    estCost: "$1.20-$2.40",
    previouslyPurchased: true
  }
}

export const MARKETPLACE_AGENT_ORDER = [
  "r_mp_rd01",
  "r_mp_sc06",
  "r_mp_ta02",
  "r_mp_pt03",
  "r_mp_st04",
  "r_mp_ae05"
] as const

async function readJsonBlob<T>(pathname: string): Promise<T | null> {
  try {
    return await readStoredBlobJson<T>(pathname)
  } catch (error) {
    console.error(`[Dev Agents] Failed to read blob ${pathname}:`, error)
    return null
  }
}

async function listJsonBlobs<T>(prefix: string): Promise<T[]> {
  try {
    const { blobs } = await list({ prefix })
    const parsed: Array<T | null> = await Promise.all(
      blobs.map(async (blob) => {
        try {
          return await readStoredBlobJson<T>(blob.pathname)
        } catch (error) {
          console.error(`[Dev Agents] Failed to fetch ${blob.pathname}:`, error)
          return null
        }
      })
    )

    return parsed.filter((value): value is T => value !== null)
  } catch (error) {
    console.error(`[Dev Agents] Failed to list blobs for ${prefix}:`, error)
    return []
  }
}

async function listDevAgentUsageStats(): Promise<Map<string, number>> {
  const stats = await listJsonBlobs<DevAgentUsageStat>(DEV_AGENT_STATS_PREFIX)
  return new Map(stats.map((item) => [item.devAgentId, item.usageCount]))
}

function getDefaultSandboxBrowser(executionMode: DevAgentExecutionMode): DevAgentSandboxBrowser {
  void executionMode
  return "agent-browser"
}

function getBuiltinDevAgentDefaults(devAgentId: string): Omit<DevAgent, "usageCount"> | undefined {
  const canonicalDevAgentId = canonicalizeDevAgentId(devAgentId)
  return BUILTIN_DEV_AGENTS.find((candidate) => candidate.id === canonicalDevAgentId)
}

function toDevAgentAshInput(
  devAgent: Pick<
    Omit<DevAgent, "usageCount">,
    | "id"
    | "name"
    | "description"
    | "instructions"
    | "executionMode"
    | "sandboxBrowser"
    | "aiAgent"
    | "devServerCommand"
    | "actionSteps"
    | "skillRefs"
    | "createdAt"
    | "successEval"
    | "earlyExitMode"
    | "earlyExitEval"
    | "earlyExitRule"
    | "earlyExitPlacementIndex"
  >
) {
  return {
    id: devAgent.id,
    name: devAgent.name,
    description: devAgent.description,
    instructions: devAgent.instructions,
    executionMode: devAgent.executionMode,
    sandboxBrowser: devAgent.sandboxBrowser,
    aiAgent: devAgent.aiAgent,
    devServerCommand: devAgent.devServerCommand,
    actionSteps: devAgent.actionSteps,
    skillRefs: devAgent.skillRefs,
    createdAt: devAgent.createdAt,
    successEval: devAgent.successEval,
    earlyExitMode: devAgent.earlyExitMode,
    earlyExitEval: devAgent.earlyExitEval,
    earlyExitRule: devAgent.earlyExitRule,
    earlyExitPlacementIndex: devAgent.earlyExitPlacementIndex
  }
}

function isStructuredActionStepsPlaceholder(instructions: string | undefined): boolean {
  return typeof instructions === "string" && /^\[\d+\s+structured action steps\]$/i.test(instructions.trim())
}

function normalizeWorkflowAwareInstructions(instructions: string | undefined): string | undefined {
  if (typeof instructions !== "string") {
    return instructions
  }

  return instructions
    .replace(/\bCapture a performance baseline\b/i, "Use the workflow-provided baseline evidence")
    .replace(/\bCapture performance baselines\b/i, "Use the workflow-provided baseline evidence")
    .replace(/\bCapture a baseline\b/i, "Use the workflow-provided baseline evidence")
    .replace(/\bCapture before\/after metrics\b/i, "Use the workflow runtime's before/after evidence")
}

function normalizeWorkflowAwarePrompt(prompt: string | undefined): string | undefined {
  if (typeof prompt !== "string") {
    return prompt
  }

  let normalized = prompt.trim()
  if (!normalized) {
    return normalized
  }

  normalized = normalized
    .replace(
      /^capture (?:a |the )?(?:performance )?baseline(?:s)?(?: with getwebvitals)?\s*,?\s*then\s*/i,
      "Use the workflow-provided baseline evidence, then "
    )
    .replace(
      /^capture before\/after metrics(?: to prove improvement)?/i,
      "Use the workflow runtime's before/after evidence"
    )

  if (/\bgetwebvitals\b/i.test(normalized) && /\b(verify|re-?check|check again)\b/i.test(normalized)) {
    normalized = normalized
      .replace(/\bagain with getwebvitals and\b/i, "again with ")
      .replace(/\bwith getwebvitals and\b/i, "with ")
      .replace(/\busing getwebvitals and\b/i, "")
      .replace(/\busing getwebvitals\b/i, "")
      .replace(/\bwith getwebvitals\b/i, "")
      .replace(/\s{2,}/g, " ")
      .trim()

    if (!/workflow runtime will handle final verification\./i.test(normalized)) {
      normalized = `${normalized.replace(/[. ]+$/, "")}. The workflow runtime will handle final verification.`
    }
  }

  return normalized
}

function normalizeWorkflowAwareActionSteps(
  actionSteps: DevAgentActionStep[] | undefined
): DevAgentActionStep[] | undefined {
  if (!Array.isArray(actionSteps)) {
    return actionSteps
  }

  return actionSteps.map((step) =>
    step.kind === "send-prompt"
      ? {
          ...step,
          config: {
            ...step.config,
            prompt: normalizeWorkflowAwarePrompt(step.config.prompt) || ""
          }
        }
      : step
  )
}

function normalizeDevAgent(devAgent: StoredDevAgent | Omit<DevAgent, "usageCount">): Omit<DevAgent, "usageCount"> {
  const canonicalDevAgentId = canonicalizeDevAgentId(devAgent.id)
  const builtinDefaults = getBuiltinDevAgentDefaults(canonicalDevAgentId)
  const mergedDevAgent = builtinDefaults
    ? {
        ...builtinDefaults,
        ...devAgent,
        kind: builtinDefaults.kind,
        author: builtinDefaults.author,
        team: builtinDefaults.team,
        executionMode: builtinDefaults.executionMode,
        sandboxBrowser: builtinDefaults.sandboxBrowser,
        devServerCommand: builtinDefaults.devServerCommand,
        skillRefs: builtinDefaults.skillRefs,
        supportsPathInput: builtinDefaults.supportsPathInput,
        supportsPullRequest: builtinDefaults.supportsPullRequest,
        legacyWorkflowType: builtinDefaults.legacyWorkflowType
      }
    : devAgent
  const normalizedInstructions =
    builtinDefaults && isStructuredActionStepsPlaceholder(mergedDevAgent.instructions)
      ? builtinDefaults.instructions
      : normalizeWorkflowAwareInstructions(mergedDevAgent.instructions) || mergedDevAgent.instructions
  const sandboxBrowser = mergedDevAgent.sandboxBrowser
  const aiAgent =
    mergedDevAgent.aiAgent === "anthropic/claude-opus-4.6" || mergedDevAgent.aiAgent === "anthropic/claude-sonnet-4.6"
      ? mergedDevAgent.aiAgent
      : mergedDevAgent.aiAgent === "claude"
        ? "anthropic/claude-opus-4.6"
        : mergedDevAgent.aiAgent === "codex" || mergedDevAgent.aiAgent === "d3k"
          ? "anthropic/claude-opus-4.6"
          : undefined
  const devServerCommand =
    typeof mergedDevAgent.devServerCommand === "string" && mergedDevAgent.devServerCommand.trim().length > 0
      ? mergedDevAgent.devServerCommand.trim()
      : undefined
  const normalizedSandboxBrowser =
    sandboxBrowser && isDevAgentSandboxBrowser(sandboxBrowser)
      ? sandboxBrowser
      : getDefaultSandboxBrowser(mergedDevAgent.executionMode)
  const normalizedDevServerCommand =
    builtinDefaults &&
    mergedDevAgent.executionMode === "preview-pr" &&
    normalizedSandboxBrowser === "none" &&
    (devServerCommand === "d3k" || devServerCommand === undefined)
      ? NO_DEV_SERVER_COMMAND
      : devServerCommand
  const skillRefs = Array.isArray(mergedDevAgent.skillRefs)
    ? mergedDevAgent.skillRefs.map((skillRef) =>
        parseDevAgentSkillRef({
          installArg: skillRef.installArg,
          sourceUrl: skillRef.sourceUrl,
          displayName: skillRef.displayName
        })
      )
    : []
  const normalizedDevAgent: Omit<DevAgent, "usageCount"> = {
    ...mergedDevAgent,
    id: canonicalDevAgentId,
    instructions: normalizedInstructions,
    actionSteps: normalizeWorkflowAwareActionSteps(mergedDevAgent.actionSteps),
    aiAgent,
    devServerCommand: normalizedDevServerCommand,
    skillRefs,
    sandboxBrowser: normalizedSandboxBrowser
  }
  const synthesizedAshArtifact = createDevAgentAshArtifactDescriptor(
    toDevAgentAshInput({
      ...normalizedDevAgent,
      sandboxBrowser: normalizedDevAgent.sandboxBrowser
    }),
    mergedDevAgent.ashArtifact?.revision ?? 1,
    mergedDevAgent.ashArtifact?.generatedAt || mergedDevAgent.updatedAt || mergedDevAgent.createdAt
  )
  const normalizedAshArtifact =
    mergedDevAgent.ashArtifact?.tarballUrl && mergedDevAgent.ashArtifact.specHash === synthesizedAshArtifact.specHash
      ? {
          ...synthesizedAshArtifact,
          tarballUrl: mergedDevAgent.ashArtifact.tarballUrl
        }
      : synthesizedAshArtifact

  return {
    ...normalizedDevAgent,
    ashArtifact: normalizedAshArtifact
  }
}

function applyUsageCounts(devAgents: Array<Omit<DevAgent, "usageCount">>, usageMap: Map<string, number>): DevAgent[] {
  return devAgents
    .map((devAgent) => ({
      ...devAgent,
      usageCount: usageMap.get(devAgent.id) ?? 0
    }))
    .sort((a, b) => {
      if (b.usageCount !== a.usageCount) return b.usageCount - a.usageCount
      return a.name.localeCompare(b.name)
    })
}

function filterDevAgentsByTeam(
  devAgents: Array<Omit<DevAgent, "usageCount">>,
  options?: { teamId?: string; teamSlug?: string }
): Array<Omit<DevAgent, "usageCount">> {
  const teamId = options?.teamId?.trim()
  const teamSlug = options?.teamSlug?.trim().toLowerCase()

  if (!teamId && !teamSlug) {
    return devAgents
  }

  return devAgents.filter((devAgent) => {
    if (!devAgent.team) {
      return true
    }

    if (teamId && devAgent.team.id === teamId) {
      return true
    }

    return Boolean(teamSlug && devAgent.team.slug.toLowerCase() === teamSlug)
  })
}

export async function listDevAgents(options?: { teamId?: string; teamSlug?: string }): Promise<DevAgent[]> {
  const [usageMap, customDevAgents] = await Promise.all([listDevAgentUsageStats(), listCustomDevAgents()])
  const mergedDevAgents = new Map<string, Omit<DevAgent, "usageCount">>()

  for (const devAgent of BUILTIN_DEV_AGENTS) {
    mergedDevAgents.set(devAgent.id, normalizeDevAgent(devAgent))
  }

  for (const devAgent of customDevAgents.map(normalizeDevAgent)) {
    const existing = mergedDevAgents.get(devAgent.id)
    if (!existing || new Date(devAgent.updatedAt).getTime() >= new Date(existing.updatedAt).getTime()) {
      mergedDevAgents.set(devAgent.id, devAgent)
    }
  }

  return applyUsageCounts(filterDevAgentsByTeam(Array.from(mergedDevAgents.values()), options), usageMap)
}

export async function listCustomDevAgents(): Promise<StoredDevAgent[]> {
  return listJsonBlobs<StoredDevAgent>(CUSTOM_DEV_AGENT_PREFIX)
}

export async function getDevAgent(devAgentId: string): Promise<DevAgent | null> {
  const canonicalDevAgentId = canonicalizeDevAgentId(devAgentId)
  const usageMap = await listDevAgentUsageStats()
  const candidateCustomDevAgents = await Promise.all([
    readJsonBlob<StoredDevAgent>(`${CUSTOM_DEV_AGENT_PREFIX}${devAgentId}.json`),
    canonicalDevAgentId !== devAgentId
      ? readJsonBlob<StoredDevAgent>(`${CUSTOM_DEV_AGENT_PREFIX}${canonicalDevAgentId}.json`)
      : null
  ])
  const customDevAgent = candidateCustomDevAgents
    .filter((value): value is StoredDevAgent => value !== null)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0]

  if (customDevAgent) {
    return {
      ...normalizeDevAgent(customDevAgent),
      usageCount: usageMap.get(canonicalDevAgentId) ?? usageMap.get(devAgentId) ?? 0
    }
  }

  const builtinDevAgent = BUILTIN_DEV_AGENTS.find((devAgent) => devAgent.id === canonicalDevAgentId)
  if (builtinDevAgent) {
    return {
      ...normalizeDevAgent(builtinDevAgent),
      usageCount: usageMap.get(canonicalDevAgentId) ?? usageMap.get(devAgentId) ?? 0
    }
  }

  return null
}

export async function createCustomDevAgent(input: {
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
  team: DevAgentTeam
  successEval?: string
  earlyExitMode?: DevAgentEarlyExitMode
  earlyExitEval?: string
  earlyExitRule?: DevAgentEarlyExitRule
  earlyExitPlacementIndex?: number
}): Promise<DevAgent> {
  const id = generateDevAgentId()
  const now = new Date().toISOString()
  const normalizedInstructions = normalizeWorkflowAwareInstructions(input.instructions)?.trim() || ""
  const normalizedActionSteps = normalizeWorkflowAwareActionSteps(input.actionSteps)
  const normalizedEarlyExitRule = input.earlyExitRule ? parseDevAgentEarlyExitRule(input.earlyExitRule) : undefined
  const normalizedEarlyExitPlacementIndex =
    typeof input.earlyExitPlacementIndex === "number" && Number.isInteger(input.earlyExitPlacementIndex)
      ? Math.max(0, input.earlyExitPlacementIndex)
      : undefined
  const { publishDevAgentAshArtifact } = await import("@/lib/dev-agent-ash")
  const ashArtifact = await publishDevAgentAshArtifact(
    {
      id,
      name: input.name.trim(),
      description: input.description.trim(),
      instructions: normalizedInstructions,
      executionMode: input.executionMode,
      sandboxBrowser: input.sandboxBrowser,
      aiAgent: input.aiAgent,
      devServerCommand: input.devServerCommand?.trim() || undefined,
      actionSteps: normalizedActionSteps,
      skillRefs: input.skillRefs,
      createdAt: now,
      successEval: input.successEval?.trim() || undefined,
      earlyExitMode: input.earlyExitMode,
      earlyExitEval: input.earlyExitEval?.trim() || undefined,
      earlyExitRule: normalizedEarlyExitRule,
      earlyExitPlacementIndex: normalizedEarlyExitPlacementIndex
    },
    1
  )
  const storedDevAgent: StoredDevAgent = {
    id,
    kind: "custom",
    name: input.name.trim(),
    description: input.description.trim(),
    instructions: normalizedInstructions,
    executionMode: input.executionMode,
    sandboxBrowser: input.sandboxBrowser,
    aiAgent: input.aiAgent,
    devServerCommand: input.devServerCommand?.trim() || undefined,
    actionSteps: normalizedActionSteps,
    skillRefs: input.skillRefs,
    author: input.author,
    team: input.team,
    createdAt: now,
    updatedAt: now,
    supportsPathInput: true,
    supportsPullRequest: true,
    successEval: input.successEval?.trim() || undefined,
    earlyExitMode: input.earlyExitMode,
    earlyExitEval: input.earlyExitEval?.trim() || undefined,
    earlyExitRule: normalizedEarlyExitRule,
    earlyExitPlacementIndex: normalizedEarlyExitPlacementIndex,
    ashArtifact
  }

  await putBlobAndBuildUrl(`${CUSTOM_DEV_AGENT_PREFIX}${id}.json`, JSON.stringify(storedDevAgent, null, 2), {
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json"
  })

  return {
    ...normalizeDevAgent(storedDevAgent),
    usageCount: 0
  }
}

export async function updateCustomDevAgent(
  devAgentId: string,
  input: {
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
    successEval?: string
    earlyExitMode?: DevAgentEarlyExitMode
    earlyExitEval?: string
    earlyExitRule?: DevAgentEarlyExitRule
    earlyExitPlacementIndex?: number
  }
): Promise<DevAgent | null> {
  const canonicalDevAgentId = canonicalizeDevAgentId(devAgentId)
  const existingDevAgent = await getDevAgent(devAgentId)
  if (!existingDevAgent) {
    return null
  }
  const builtinDefaults = getBuiltinDevAgentDefaults(canonicalDevAgentId)
  const nextRevision = (existingDevAgent.ashArtifact?.revision ?? 1) + 1
  const { publishDevAgentAshArtifact } = await import("@/lib/dev-agent-ash")
  const normalizedInstructions = normalizeWorkflowAwareInstructions(input.instructions)?.trim() || ""
  const normalizedActionSteps = normalizeWorkflowAwareActionSteps(input.actionSteps)

  const updatedDevAgent: StoredDevAgent = {
    ...existingDevAgent,
    name: input.name.trim(),
    description: input.description.trim(),
    instructions: normalizedInstructions,
    executionMode: input.executionMode,
    sandboxBrowser: input.sandboxBrowser,
    aiAgent: input.aiAgent ?? existingDevAgent.aiAgent,
    devServerCommand: input.devServerCommand?.trim() || existingDevAgent.devServerCommand,
    actionSteps: normalizedActionSteps,
    skillRefs: input.skillRefs,
    author: builtinDefaults?.author ?? input.author,
    team: builtinDefaults?.team ?? input.team ?? existingDevAgent.team,
    updatedAt: new Date().toISOString(),
    successEval: input.successEval?.trim() || existingDevAgent.successEval,
    earlyExitMode: input.earlyExitMode ?? existingDevAgent.earlyExitMode,
    earlyExitEval: input.earlyExitEval?.trim() || existingDevAgent.earlyExitEval,
    earlyExitRule: input.earlyExitRule
      ? parseDevAgentEarlyExitRule(input.earlyExitRule)
      : input.earlyExitMode === "text"
        ? undefined
        : existingDevAgent.earlyExitRule,
    earlyExitPlacementIndex:
      typeof input.earlyExitPlacementIndex === "number" && Number.isInteger(input.earlyExitPlacementIndex)
        ? Math.max(0, input.earlyExitPlacementIndex)
        : existingDevAgent.earlyExitPlacementIndex
  }
  updatedDevAgent.ashArtifact = await publishDevAgentAshArtifact(
    {
      id: canonicalDevAgentId,
      name: updatedDevAgent.name,
      description: updatedDevAgent.description,
      instructions: updatedDevAgent.instructions,
      executionMode: updatedDevAgent.executionMode,
      sandboxBrowser:
        updatedDevAgent.sandboxBrowser && isDevAgentSandboxBrowser(updatedDevAgent.sandboxBrowser)
          ? updatedDevAgent.sandboxBrowser
          : getDefaultSandboxBrowser(updatedDevAgent.executionMode),
      aiAgent: updatedDevAgent.aiAgent,
      devServerCommand: updatedDevAgent.devServerCommand,
      actionSteps: updatedDevAgent.actionSteps,
      skillRefs: updatedDevAgent.skillRefs,
      createdAt: updatedDevAgent.createdAt,
      successEval: updatedDevAgent.successEval,
      earlyExitMode: updatedDevAgent.earlyExitMode,
      earlyExitEval: updatedDevAgent.earlyExitEval,
      earlyExitRule: updatedDevAgent.earlyExitRule,
      earlyExitPlacementIndex: updatedDevAgent.earlyExitPlacementIndex
    },
    nextRevision
  )

  await putBlobAndBuildUrl(
    `${CUSTOM_DEV_AGENT_PREFIX}${canonicalDevAgentId}.json`,
    JSON.stringify(updatedDevAgent, null, 2),
    {
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json"
    }
  )

  const usageMap = await listDevAgentUsageStats()
  return {
    ...normalizeDevAgent(updatedDevAgent),
    usageCount: usageMap.get(canonicalDevAgentId) ?? usageMap.get(devAgentId) ?? 0
  }
}

export async function incrementDevAgentUsage(devAgentId: string): Promise<void> {
  const canonicalDevAgentId = canonicalizeDevAgentId(devAgentId)
  const current = await readJsonBlob<DevAgentUsageStat>(`${DEV_AGENT_STATS_PREFIX}${canonicalDevAgentId}.json`)
  const nextUsageCount = (current?.usageCount ?? 0) + 1
  const payload: DevAgentUsageStat = {
    devAgentId: canonicalDevAgentId,
    usageCount: nextUsageCount,
    updatedAt: new Date().toISOString()
  }

  await putBlobAndBuildUrl(`${DEV_AGENT_STATS_PREFIX}${canonicalDevAgentId}.json`, JSON.stringify(payload, null, 2), {
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json"
  })
}

export async function ensureDevAgentAshArtifactPublished(devAgent: DevAgent): Promise<DevAgentAshArtifact> {
  const prepared = await ensureDevAgentAshArtifactPrepared(devAgent)
  return prepared.artifact
}

export async function ensureDevAgentAshArtifactPrepared(
  devAgent: DevAgent
): Promise<{ artifact: DevAgentAshArtifact; state: DevAgentAshArtifactAvailability }> {
  const currentDescriptor = createDevAgentAshArtifactDescriptor(
    toDevAgentAshInput({
      ...devAgent,
      sandboxBrowser: devAgent.sandboxBrowser
    }),
    devAgent.ashArtifact?.revision ?? 1,
    devAgent.ashArtifact?.generatedAt || devAgent.updatedAt || devAgent.createdAt
  )

  if (devAgent.ashArtifact?.tarballUrl && devAgent.ashArtifact.specHash === currentDescriptor.specHash) {
    return { artifact: devAgent.ashArtifact, state: "existing" }
  }

  const { publishDevAgentAshArtifactWithStatus } = await import("@/lib/dev-agent-ash")
  const { artifact, publishState } = await publishDevAgentAshArtifactWithStatus(
    toDevAgentAshInput({
      ...devAgent,
      sandboxBrowser: devAgent.sandboxBrowser
    }),
    devAgent.ashArtifact?.revision ?? 1
  )

  return {
    artifact,
    state: publishState
  }
}

export function isDevAgentExecutionMode(value: string): value is DevAgentExecutionMode {
  return value === "dev-server" || value === "preview-pr"
}

export function isDevAgentSandboxBrowser(value: string): value is DevAgentSandboxBrowser {
  return value === "none" || value === "agent-browser"
}

export function canEditDevAgent(devAgent: DevAgent, user: DevAgentEditor): boolean {
  if (devAgent.author.id && user.id && devAgent.author.id === user.id) {
    return true
  }

  if (devAgent.author.email && user.email && devAgent.author.email === user.email) {
    return true
  }

  return (
    devAgent.author.id === "system" ||
    devAgent.author.username === "dev3000" ||
    devAgent.author.email === "system@dev3000.ai"
  )
}
