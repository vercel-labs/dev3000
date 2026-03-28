import { list, put } from "@vercel/blob"

const FETCH_TIMEOUT_MS = 6000
const FETCH_RETRIES = 2

const CUSTOM_DEV_AGENT_PREFIX = "dev-agents/custom/"
const DEV_AGENT_STATS_PREFIX = "dev-agents/stats/"

const BUILTIN_DEV_AGENT_ID_ALIASES = {
  "dev-agent-cls-fix": "r_c84m2f",
  "dev-agent-design-guidelines": "r_d91q7k",
  "dev-agent-react-performance": "r_p47n6x",
  "dev-agent-turbopack-bundle-analyzer": "r_t62v8m",
  "dev-agent-custom-prompt": "r_u35h9c",
  "devAgent-cls-fix": "r_c84m2f",
  "devAgent-design-guidelines": "r_d91q7k",
  "devAgent-react-performance": "r_p47n6x",
  "devAgent-turbopack-bundle-analyzer": "r_t62v8m",
  "devAgent-custom-prompt": "r_u35h9c"
} as const

export type DevAgentKind = "builtin" | "custom" | "marketplace"
export type DevAgentExecutionMode = "dev-server" | "preview-pr"
export type DevAgentSandboxBrowser = "none" | "agent-browser" | "next-browser"

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

export type DevAgentAiAgent = "d3k" | "claude" | "codex"

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
  actionSteps?: DevAgentActionStep[]
  skillRefs: DevAgentSkillRef[]
  author: DevAgentAuthor
  team?: DevAgentTeam
  createdAt: string
  updatedAt: string
  usageCount: number
  legacyWorkflowType?: "cls-fix" | "prompt" | "design-guidelines" | "react-performance" | "turbopack-bundle-analyzer"
  supportsPathInput?: boolean
  supportsPullRequest?: boolean
  supportsCrawlDepth?: boolean
  requiresCustomPrompt?: boolean
}

interface StoredDevAgent extends Omit<DevAgent, "usageCount" | "sandboxBrowser"> {
  sandboxBrowser?: DevAgentSandboxBrowser
}

interface DevAgentUsageStat {
  devAgentId: string
  usageCount: number
  updatedAt: string
}

async function fetchJsonWithRetry(fetchUrl: string): Promise<Response> {
  let lastError: unknown

  for (let attempt = 0; attempt <= FETCH_RETRIES; attempt++) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    try {
      const response = await fetch(fetchUrl, {
        headers: {
          Accept: "application/json"
        },
        cache: "no-store",
        signal: controller.signal
      })
      clearTimeout(timeout)
      return response
    } catch (error) {
      clearTimeout(timeout)
      lastError = error
      if (attempt < FETCH_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)))
      }
    }
  }

  throw lastError
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

export function parseDevAgentSkillRef(input: {
  installArg: string
  sourceUrl?: string
  displayName?: string
}): DevAgentSkillRef {
  const installArg = input.installArg.trim()
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
    sourceUrl: input.sourceUrl?.trim() || undefined
  }
}

const systemAuthor: DevAgentAuthor = {
  id: "system",
  email: "system@dev3000.ai",
  name: "dev3000",
  username: "dev3000"
}

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
        installArg: "https://github.com/vercel-labs/dev3000/tree/main/skills/d3k",
        displayName: "d3k"
      })
    ],
    author: systemAuthor,
    createdAt: "2026-03-12T00:00:00.000Z",
    updatedAt: "2026-03-12T00:00:00.000Z",
    legacyWorkflowType: "cls-fix",
    supportsPathInput: true,
    supportsPullRequest: true
  },
  {
    id: "r_d91q7k",
    kind: "builtin",
    name: "Design Guidelines Review",
    description: "Audit a project against design guidelines, apply fixes, and prepare a PR-ready result.",
    instructions:
      "Review the selected project against the loaded design guidance, fix the highest-value issues, and validate that the experience is improved before finalizing.",
    executionMode: "preview-pr",
    sandboxBrowser: "next-browser",
    skillRefs: [
      parseDevAgentSkillRef({
        installArg: "https://github.com/vercel-labs/dev3000/tree/main/skills/d3k",
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
    supportsCrawlDepth: true
  },
  {
    id: "r_p47n6x",
    kind: "builtin",
    name: "React Performance Review",
    description: "Find expensive React and Next.js patterns, apply fixes, and validate the performance direction.",
    instructions:
      "Capture a performance baseline, inspect the codebase for expensive React and Next.js patterns, apply targeted optimizations, and verify the impact before finishing.",
    executionMode: "preview-pr",
    sandboxBrowser: "next-browser",
    skillRefs: [
      parseDevAgentSkillRef({
        installArg: "https://github.com/vercel-labs/dev3000/tree/main/skills/d3k",
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
    supportsPullRequest: true
  },
  {
    id: "r_t62v8m",
    kind: "builtin",
    name: "Turbopack Bundle Analyzer",
    description: "Generate analyzer output, inspect the heaviest routes, and ship targeted bundle reductions.",
    instructions:
      "Generate the Turbopack analyzer artifacts, identify the largest route and bundle regressions, and make improvements that materially reduce shipped JavaScript before opening a PR.",
    executionMode: "preview-pr",
    sandboxBrowser: "none",
    skillRefs: [
      parseDevAgentSkillRef({
        installArg: "https://github.com/vercel-labs/dev3000/tree/main/skills/d3k",
        displayName: "d3k"
      }),
      parseDevAgentSkillRef({
        installArg: "vercel-labs/skills@analyze-bundle",
        sourceUrl: "https://skills.sh/vercel-labs/skills/analyze-bundle"
      })
    ],
    author: systemAuthor,
    createdAt: "2026-03-12T00:00:00.000Z",
    updatedAt: "2026-03-12T00:00:00.000Z",
    legacyWorkflowType: "turbopack-bundle-analyzer",
    supportsPullRequest: true
  },
  {
    id: "r_u35h9c",
    kind: "builtin",
    name: "Custom Prompt",
    description: "Provide one-off instructions for a project and run them with the selected repo context.",
    instructions:
      "Use the supplied custom prompt as the primary task, load the d3k skill first, and complete the request against the selected project with evidence-backed validation.",
    executionMode: "dev-server",
    sandboxBrowser: "agent-browser",
    skillRefs: [
      parseDevAgentSkillRef({
        installArg: "https://github.com/vercel-labs/dev3000/tree/main/skills/d3k",
        displayName: "d3k"
      })
    ],
    author: systemAuthor,
    createdAt: "2026-03-12T00:00:00.000Z",
    updatedAt: "2026-03-12T00:00:00.000Z",
    legacyWorkflowType: "prompt",
    supportsPathInput: true,
    supportsPullRequest: true,
    requiresCustomPrompt: true
  },
  // ── Marketplace agents (demo) ──────────────────────────────────────────
  {
    id: "r_mp_rd01",
    kind: "marketplace",
    name: "Request Deduper",
    description: "Find duplicate fetches, collapse redundant requests, and tighten caching behavior across the app.",
    instructions:
      "Analyze the project for duplicate fetch calls and redundant API requests. Introduce request deduplication via shared caching layers, collapse overlapping routes, and add appropriate Cache-Control headers. Capture before/after metrics to prove improvement.",
    executionMode: "dev-server",
    sandboxBrowser: "agent-browser",
    skillRefs: [
      parseDevAgentSkillRef({
        installArg: "https://github.com/vercel-labs/dev3000/tree/main/skills/d3k",
        displayName: "d3k"
      })
    ],
    author: { id: "shuding", email: "", name: "shuding", username: "shuding" },
    createdAt: "2026-02-18T00:00:00.000Z",
    updatedAt: "2026-03-15T00:00:00.000Z",
    supportsPathInput: true,
    supportsPullRequest: true
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
        installArg: "https://github.com/vercel-labs/dev3000/tree/main/skills/d3k",
        displayName: "d3k"
      })
    ],
    author: { id: "andrewbarba", email: "", name: "andrewbarba", username: "andrewbarba" },
    createdAt: "2026-01-22T00:00:00.000Z",
    updatedAt: "2026-03-10T00:00:00.000Z",
    supportsPathInput: true,
    supportsPullRequest: true
  },
  {
    id: "r_mp_pt03",
    kind: "marketplace",
    name: "Performance Tuner",
    description: "Tune rendering, caching, and loading behavior to reduce regressions in complex production apps.",
    instructions:
      "Capture performance baselines, identify rendering bottlenecks, tune caching strategies and loading behavior, and verify that regressions are resolved with before/after metrics.",
    executionMode: "dev-server",
    sandboxBrowser: "agent-browser",
    skillRefs: [
      parseDevAgentSkillRef({
        installArg: "https://github.com/vercel-labs/dev3000/tree/main/skills/d3k",
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
    supportsPullRequest: true
  },
  {
    id: "r_mp_st04",
    kind: "marketplace",
    name: "Next.js SPA Transformer",
    description: "Reshape legacy page flows into a smoother SPA-like experience without losing Next.js ergonomics.",
    instructions:
      "Analyze navigation patterns and page transitions, refactor hard navigations into client-side transitions, add prefetching and streaming where beneficial, and verify the SPA-like experience preserves Next.js features.",
    executionMode: "preview-pr",
    sandboxBrowser: "next-browser",
    skillRefs: [
      parseDevAgentSkillRef({
        installArg: "https://github.com/vercel-labs/dev3000/tree/main/skills/d3k",
        displayName: "d3k"
      })
    ],
    author: { id: "acdlite", email: "", name: "acdlite", username: "acdlite" },
    createdAt: "2026-02-02T00:00:00.000Z",
    updatedAt: "2026-03-08T00:00:00.000Z",
    supportsPathInput: true,
    supportsPullRequest: true
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
        installArg: "https://github.com/vercel-labs/dev3000/tree/main/skills/d3k",
        displayName: "d3k"
      })
    ],
    author: { id: "ericdodds", email: "", name: "Eric Dodds", username: "ericdodds" },
    createdAt: "2026-03-01T00:00:00.000Z",
    updatedAt: "2026-03-25T00:00:00.000Z",
    supportsPathInput: true,
    supportsPullRequest: true
  }
]

/**
 * Social-proof stats for marketplace agents (displayed on catalog cards and run pages).
 */
export interface MarketplaceAgentStats {
  projectRuns: string
  successRate: string
  tokensUsed: string
  previouslyPurchased: boolean
}

export const MARKETPLACE_AGENT_STATS: Record<string, MarketplaceAgentStats> = {
  r_mp_rd01: { projectRuns: "2,184", successRate: "97.4%", tokensUsed: "4.8M", previouslyPurchased: true },
  r_mp_ta02: { projectRuns: "1,326", successRate: "95.9%", tokensUsed: "3.2M", previouslyPurchased: false },
  r_mp_pt03: { projectRuns: "3,942", successRate: "98.1%", tokensUsed: "8.6M", previouslyPurchased: false },
  r_mp_st04: { projectRuns: "896", successRate: "93.7%", tokensUsed: "2.4M", previouslyPurchased: false },
  r_mp_ae05: { projectRuns: "1,753", successRate: "96.2%", tokensUsed: "5.1M", previouslyPurchased: false }
}

async function readJsonBlob<T>(pathname: string): Promise<T | null> {
  try {
    const { blobs } = await list({ prefix: pathname })
    const blob = blobs.find((item) => item.pathname === pathname)
    if (!blob) {
      return null
    }

    const response = await fetchJsonWithRetry(blob.url)
    if (!response.ok) {
      return null
    }

    const contentType = response.headers.get("content-type")
    if (contentType && !contentType.includes("application/json")) {
      return null
    }

    return (await response.json()) as T
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
          const response = await fetchJsonWithRetry(blob.url)
          if (!response.ok) {
            return null
          }
          const contentType = response.headers.get("content-type")
          if (contentType && !contentType.includes("application/json")) {
            return null
          }
          return (await response.json()) as T
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
  return executionMode === "preview-pr" ? "next-browser" : "agent-browser"
}

function normalizeDevAgent(devAgent: StoredDevAgent | Omit<DevAgent, "usageCount">): Omit<DevAgent, "usageCount"> {
  const sandboxBrowser = devAgent.sandboxBrowser
  return {
    ...devAgent,
    id: canonicalizeDevAgentId(devAgent.id),
    sandboxBrowser:
      sandboxBrowser && isDevAgentSandboxBrowser(sandboxBrowser)
        ? sandboxBrowser
        : getDefaultSandboxBrowser(devAgent.executionMode)
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
  actionSteps?: DevAgentActionStep[]
  skillRefs: DevAgentSkillRef[]
  author: DevAgentAuthor
  team: DevAgentTeam
}): Promise<DevAgent> {
  const id = generateDevAgentId()
  const now = new Date().toISOString()
  const storedDevAgent: StoredDevAgent = {
    id,
    kind: "custom",
    name: input.name.trim(),
    description: input.description.trim(),
    instructions: input.instructions.trim(),
    executionMode: input.executionMode,
    sandboxBrowser: input.sandboxBrowser,
    actionSteps: input.actionSteps,
    skillRefs: input.skillRefs,
    author: input.author,
    team: input.team,
    createdAt: now,
    updatedAt: now,
    supportsPathInput: true,
    supportsPullRequest: true
  }

  await put(`${CUSTOM_DEV_AGENT_PREFIX}${id}.json`, JSON.stringify(storedDevAgent, null, 2), {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true
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
    actionSteps?: DevAgentActionStep[]
    skillRefs: DevAgentSkillRef[]
    author: DevAgentAuthor
    team?: DevAgentTeam
  }
): Promise<DevAgent | null> {
  const canonicalDevAgentId = canonicalizeDevAgentId(devAgentId)
  const existingDevAgent = await getDevAgent(devAgentId)
  if (!existingDevAgent) {
    return null
  }

  const updatedDevAgent: StoredDevAgent = {
    ...existingDevAgent,
    name: input.name.trim(),
    description: input.description.trim(),
    instructions: input.instructions.trim(),
    executionMode: input.executionMode,
    sandboxBrowser: input.sandboxBrowser,
    actionSteps: input.actionSteps,
    skillRefs: input.skillRefs,
    author: input.author,
    team: input.team ?? existingDevAgent.team,
    updatedAt: new Date().toISOString()
  }

  await put(`${CUSTOM_DEV_AGENT_PREFIX}${canonicalDevAgentId}.json`, JSON.stringify(updatedDevAgent, null, 2), {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true
  })

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

  await put(`${DEV_AGENT_STATS_PREFIX}${canonicalDevAgentId}.json`, JSON.stringify(payload, null, 2), {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true
  })
}

export function isDevAgentExecutionMode(value: string): value is DevAgentExecutionMode {
  return value === "dev-server" || value === "preview-pr"
}

export function isDevAgentSandboxBrowser(value: string): value is DevAgentSandboxBrowser {
  return value === "none" || value === "agent-browser" || value === "next-browser"
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
