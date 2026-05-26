import { createHash } from "node:crypto"
import { get, list, put } from "@vercel/blob"
import type {
  DevAgent,
  DevAgentActionStep,
  DevAgentAshArtifact,
  DevAgentAuthor,
  DevAgentSkillRef,
  DevAgentTeam
} from "@/lib/dev-agents"
import {
  D3K_SKILL_INSTALL_ARG,
  DEEPSEC_DEV_AGENT_ACTION_STEPS,
  DEEPSEC_DEV_AGENT_DESCRIPTION,
  DEEPSEC_DEV_AGENT_INSTRUCTIONS,
  DEEPSEC_DEV_AGENT_SUCCESS_EVAL,
  DEEPSEC_SKILL_INSTALL_ARG,
  ensureDevAgentAshArtifactPrepared,
  VERCEL_OPTIMIZE_DEV_AGENT_ACTION_STEPS,
  VERCEL_OPTIMIZE_DEV_AGENT_DESCRIPTION,
  VERCEL_OPTIMIZE_DEV_AGENT_INSTRUCTIONS,
  VERCEL_OPTIMIZE_DEV_AGENT_SUCCESS_EVAL,
  VERCEL_OPTIMIZE_SKILL_INSTALL_ARG,
  VERCEL_OPTIMIZE_SKILL_SOURCE_URL
} from "@/lib/dev-agents"
import { NO_DEV_SERVER_COMMAND } from "@/lib/dev-server-command"
import type { SkillRunnerTeamSettings } from "@/lib/skill-runner-config"
import { isHostedSkillRunnerTeamId } from "@/lib/skill-runner-runtime"
import type { SkillsShSearchResult, SkillsShSkillDetails } from "@/lib/skills-sh"
import { fetchSkillsShSkillDetails, searchSkillsSh } from "@/lib/skills-sh"

const SKILL_RUNNER_STATE_PREFIX = "skill-runners/teams/"
const SKILL_RUNNER_STATS_PREFIX = "skill-runners/stats/"

type SkillRunnerValidationQuality = "high" | "variable"
type SkillRunnerSourceKind = "default" | "imported"
type SkillRunnerExecutionProfile = "generic" | "deepsec" | "vercel-optimize"

export interface SkillRunnerRecord {
  id: string
  kind: "skill-runner"
  sourceKind: SkillRunnerSourceKind
  canonicalPath: string
  sourceUrl: string
  installArg: string
  packageName?: string
  skillName: string
  displayName: string
  description: string
  validationQuality: SkillRunnerValidationQuality
  validationWarning?: string
  author: DevAgentAuthor
  team: DevAgentTeam
  createdAt: string
  updatedAt: string
  upstreamHash: string
  upstreamFetchedAt: string
  executionProfile?: SkillRunnerExecutionProfile
  successEval?: string
  earlyExitEval?: string
  ashArtifact?: DevAgentAshArtifact
}

interface SkillRunnerTeamState {
  teamId: string
  teamSlug: string
  hiddenDefaultIds: string[]
  imported: SkillRunnerRecord[]
  settings: SkillRunnerTeamSettings
  updatedAt: string
}

interface SkillRunnerUsageStat {
  skillRunnerId: string
  usageCount: number
  completedRunCount: number
  totalCostUsd: number
  updatedAt: string
}

interface SkillRunnerUsageSummary {
  usageCount: number
  completedRunCount: number
  totalCostUsd: number
}

interface DefaultSkillRunnerSeed {
  id: string
  canonicalPath: string
  sourceUrl: string
  installArg: string
  packageName?: string
  skillName: string
  displayName: string
  description: string
  validationQuality: SkillRunnerValidationQuality
  validationWarning?: string
  executionProfile?: SkillRunnerExecutionProfile
}

export interface SkillRunnerOpenGraphProfile {
  id: string
  name: string
  description: string
  canonicalPath: string
  executionProfile?: SkillRunnerExecutionProfile
}

const SYSTEM_AUTHOR: DevAgentAuthor = {
  id: "system",
  email: "system@vercel.com",
  name: "Vercel",
  username: "vercel"
}

const DEFAULT_SKILL_RUNNER_SEEDS: DefaultSkillRunnerSeed[] = [
  {
    id: "deepsec",
    canonicalPath: "vercel-labs/deepsec/deepsec",
    sourceUrl: "https://github.com/vercel-labs/deepsec/tree/main/packages/deepsec",
    installArg: DEEPSEC_SKILL_INSTALL_ARG,
    packageName: "vercel-labs/deepsec",
    skillName: "deepsec",
    displayName: "DeepSec Security Scan",
    description: DEEPSEC_DEV_AGENT_DESCRIPTION,
    validationQuality: "high",
    executionProfile: "deepsec"
  },
  {
    id: "vercel-optimize",
    canonicalPath: "vercel-labs/agent-skills/vercel-optimize",
    sourceUrl: VERCEL_OPTIMIZE_SKILL_SOURCE_URL,
    installArg: VERCEL_OPTIMIZE_SKILL_INSTALL_ARG,
    packageName: "vercel-labs/agent-skills",
    skillName: "vercel-optimize",
    displayName: "Vercel Optimize",
    description: VERCEL_OPTIMIZE_DEV_AGENT_DESCRIPTION,
    validationQuality: "high",
    executionProfile: "vercel-optimize"
  },
  {
    id: "sr_vercel-react-best-practices",
    canonicalPath: "vercel-labs/agent-skills/vercel-react-best-practices",
    sourceUrl: "https://skills.sh/vercel-labs/agent-skills/vercel-react-best-practices",
    installArg: "vercel-labs/agent-skills@vercel-react-best-practices",
    packageName: "vercel-labs/agent-skills",
    skillName: "vercel-react-best-practices",
    displayName: "Vercel React Best Practices",
    description: "Apply Vercel React and Next.js performance guidance to a project and produce a focused PR.",
    validationQuality: "high"
  },
  {
    id: "sr_web-design-guidelines",
    canonicalPath: "vercel-labs/agent-skills/web-design-guidelines",
    sourceUrl: "https://skills.sh/vercel-labs/agent-skills/web-design-guidelines",
    installArg: "vercel-labs/agent-skills@web-design-guidelines",
    packageName: "vercel-labs/agent-skills",
    skillName: "web-design-guidelines",
    displayName: "Web Design Guidelines",
    description: "Review and improve a web surface against Vercel's design and UX guidelines.",
    validationQuality: "high"
  },
  {
    id: "sr_next-best-practices",
    canonicalPath: "vercel-labs/next-skills/next-best-practices",
    sourceUrl: "https://skills.sh/vercel-labs/next-skills/next-best-practices",
    installArg: "vercel-labs/next-skills@next-best-practices",
    packageName: "vercel-labs/next-skills",
    skillName: "next-best-practices",
    displayName: "Next Best Practices",
    description: "Apply Next.js architecture, routing, and rendering best practices in a concrete PR.",
    validationQuality: "high"
  },
  {
    id: "sr_seo-audit",
    canonicalPath: "coreyhaines31/marketingskills/seo-audit",
    sourceUrl: "https://skills.sh/coreyhaines31/marketingskills/seo-audit",
    installArg: "coreyhaines31/marketingskills@seo-audit",
    packageName: "coreyhaines31/marketingskills",
    skillName: "seo-audit",
    displayName: "SEO Audit",
    description:
      "Audit and improve crawlability, indexation, metadata, site speed, and on-page SEO with concrete fixes.",
    validationQuality: "high"
  },
  {
    id: "sr_frontend-design",
    canonicalPath: "anthropics/skills/frontend-design",
    sourceUrl: "https://skills.sh/anthropics/skills/frontend-design",
    installArg: "anthropics/skills@frontend-design",
    packageName: "anthropics/skills",
    skillName: "frontend-design",
    displayName: "Frontend Design",
    description: "Improve a product surface with stronger frontend design decisions and a reviewable UI diff.",
    validationQuality: "high"
  },
  {
    id: "sr_shadcn",
    canonicalPath: "shadcn/ui/shadcn",
    sourceUrl: "https://skills.sh/shadcn/ui/shadcn",
    installArg: "shadcn/ui@shadcn",
    packageName: "shadcn/ui",
    skillName: "shadcn",
    displayName: "shadcn",
    description: "Improve a React UI using shadcn patterns and components without regressing visual consistency.",
    validationQuality: "high"
  }
]

function getTeamStatePath(teamId: string) {
  return `${SKILL_RUNNER_STATE_PREFIX}${teamId}.json`
}

async function readJsonBlob<T>(pathname: string): Promise<T | null> {
  try {
    const blobs = await list({ prefix: pathname, limit: 1 })
    const blob = blobs.blobs.find((entry) => entry.pathname === pathname)
    if (!blob) return null

    const publicResponse = await fetch(blob.url, { cache: "no-store" })
    if (publicResponse.ok) {
      return (await publicResponse.json()) as T
    }

    const privateBlob = await get(pathname, { access: "private", useCache: false })
    if (!privateBlob || privateBlob.statusCode !== 200) return null
    return (await new Response(privateBlob.stream).json()) as T
  } catch {
    return null
  }
}

async function listSkillRunnerUsageStats(): Promise<Map<string, SkillRunnerUsageSummary>> {
  try {
    const blobs = await list({ prefix: SKILL_RUNNER_STATS_PREFIX })
    const items = await Promise.all(
      blobs.blobs.map(async (blob) => {
        const publicResponse = await fetch(blob.url, { cache: "no-store" })
        if (publicResponse.ok) {
          return (await publicResponse.json()) as SkillRunnerUsageStat
        }

        const privateBlob = await get(blob.pathname, { access: "private" })
        if (!privateBlob || privateBlob.statusCode !== 200) return null
        return (await new Response(privateBlob.stream).json()) as SkillRunnerUsageStat
      })
    )
    return new Map(
      items
        .filter((item): item is SkillRunnerUsageStat => item !== null)
        .map((item) => [
          item.skillRunnerId,
          {
            usageCount: item.usageCount,
            completedRunCount: item.completedRunCount ?? 0,
            totalCostUsd: item.totalCostUsd ?? 0
          }
        ])
    )
  } catch {
    return new Map()
  }
}

function buildDefaultValidationWarning(seed: DefaultSkillRunnerSeed): string | undefined {
  if (seed.validationQuality === "variable") {
    return seed.validationWarning || "Validation quality may vary for this imported skill."
  }
  return undefined
}

function buildGenericActionSteps(displayName: string): DevAgentActionStep[] {
  return [
    {
      kind: "send-prompt",
      config: {
        prompt: `Inspect the repository and identify the single highest-value way to apply the ${displayName} skill. If the skill is not meaningfully applicable without speculative work, say so briefly and stop.`
      }
    },
    {
      kind: "send-prompt",
      config: {
        prompt: `Make the smallest high-value code changes needed to apply the ${displayName} skill well. Prefer concrete, reviewable improvements over broad refactors.`
      }
    },
    {
      kind: "send-prompt",
      config: {
        prompt: `Review the diff against the ${displayName} goal, tighten anything incomplete, and remove low-value or overly speculative changes.`
      }
    },
    {
      kind: "send-prompt",
      config: {
        prompt: `Do a quick targeted sanity check that the changed route or behavior still works and that the result is aligned with ${displayName}.`
      }
    }
  ]
}

function buildSkillRunnerInstructions(displayName: string, description: string, canonicalPath: string): string {
  return `Use the installed ${displayName} skill as the primary source of truth.\n\nApply that skill to this repository in a concrete, PR-worthy way. Favor the highest-value improvement you can make from the skill's guidance, avoid speculative broad rewrites, and rely on the workflow runtime for baseline/final measurement.\n\nUpstream skill: ${canonicalPath}\n\nSummary: ${description}`
}

function buildSkillRunnerSuccessEval(displayName: string): string {
  return `Did this run produce a concrete, reviewable improvement using ${displayName} without meaningfully regressing measured performance or visible behavior?`
}

function buildSkillRef(
  record: Pick<SkillRunnerRecord, "id" | "installArg" | "packageName" | "skillName" | "displayName" | "sourceUrl">
): DevAgentSkillRef[] {
  return [
    {
      id: "d3k",
      installArg: D3K_SKILL_INSTALL_ARG,
      packageName: "vercel-labs/dev3000",
      skillName: "d3k",
      displayName: "d3k"
    },
    {
      id: record.id,
      installArg: record.installArg,
      packageName: record.packageName,
      skillName: record.skillName,
      displayName: record.displayName,
      sourceUrl: record.sourceUrl
    }
  ]
}

function buildDeepsecSkillRef(
  record: Pick<SkillRunnerRecord, "id" | "installArg" | "packageName" | "skillName" | "sourceUrl">
): DevAgentSkillRef[] {
  return [
    {
      id: record.id,
      installArg: record.installArg,
      packageName: record.packageName,
      skillName: record.skillName,
      displayName: "deepsec",
      sourceUrl: record.sourceUrl
    }
  ]
}

function buildSingleSkillRef(
  record: Pick<SkillRunnerRecord, "id" | "installArg" | "packageName" | "skillName" | "displayName" | "sourceUrl">
): DevAgentSkillRef[] {
  return [
    {
      id: record.id,
      installArg: record.installArg,
      packageName: record.packageName,
      skillName: record.skillName,
      displayName: record.displayName,
      sourceUrl: record.sourceUrl
    }
  ]
}

function getExecutionProfile(
  record: Pick<SkillRunnerRecord, "executionProfile" | "installArg" | "packageName" | "skillName">
): SkillRunnerExecutionProfile {
  if (record.executionProfile) return record.executionProfile
  if (
    record.installArg === DEEPSEC_SKILL_INSTALL_ARG ||
    (record.packageName === "vercel-labs/deepsec" && record.skillName === "deepsec") ||
    (record.packageName === "vercel-labs/dev3000" && record.skillName === "deepsec")
  ) {
    return "deepsec"
  }
  if (
    record.installArg === VERCEL_OPTIMIZE_SKILL_INSTALL_ARG ||
    (record.packageName === "vercel-labs/agent-skills" && record.skillName === "vercel-optimize")
  ) {
    return "vercel-optimize"
  }
  return "generic"
}

function toSkillRunnerRecord(seed: DefaultSkillRunnerSeed, team: DevAgentTeam): SkillRunnerRecord {
  const now = new Date().toISOString()
  return {
    id: seed.id,
    kind: "skill-runner",
    sourceKind: "default",
    canonicalPath: seed.canonicalPath,
    sourceUrl: seed.sourceUrl,
    installArg: seed.installArg,
    packageName: seed.packageName,
    skillName: seed.skillName,
    displayName: seed.displayName,
    description: seed.description,
    validationQuality: seed.validationQuality,
    validationWarning: buildDefaultValidationWarning(seed),
    author: SYSTEM_AUTHOR,
    team,
    createdAt: now,
    updatedAt: now,
    upstreamHash: "",
    upstreamFetchedAt: now,
    executionProfile: seed.executionProfile
  }
}

function stableImportedRunnerId(teamId: string, canonicalPath: string): string {
  return `sr_imp_${createHash("sha256").update(`${teamId}:${canonicalPath}`).digest("hex").slice(0, 12)}`
}

function normalizeSkillRunnerLookup(value: string): string {
  return value
    .trim()
    .replace(/^https?:\/\/(?:www\.)?skills\.sh\//i, "")
    .replace(/^\/+|\/+$/g, "")
    .toLowerCase()
}

function slugifySkillRunnerLookup(value: string): string {
  const segment = normalizeSkillRunnerLookup(value).split("/").pop() || ""
  return segment.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
}

function skillRunnerLookupMatches(
  lookup: string,
  runner: Pick<
    SkillRunnerRecord | DefaultSkillRunnerSeed,
    "id" | "canonicalPath" | "displayName" | "installArg" | "skillName"
  >
): boolean {
  const normalizedLookup = normalizeSkillRunnerLookup(lookup)
  const canonicalPath = normalizeSkillRunnerLookup(runner.canonicalPath)
  return (
    normalizedLookup === normalizeSkillRunnerLookup(runner.id) ||
    normalizedLookup === normalizeSkillRunnerLookup(runner.skillName) ||
    normalizedLookup === normalizeSkillRunnerLookup(runner.installArg) ||
    normalizedLookup === canonicalPath ||
    normalizedLookup === canonicalPath.split("/").pop() ||
    normalizedLookup === slugifySkillRunnerLookup(runner.displayName)
  )
}

function findDefaultSeedByLookup(lookup: string) {
  return DEFAULT_SKILL_RUNNER_SEEDS.find((seed) => skillRunnerLookupMatches(lookup, seed))
}

function buildSkillsShSelectionFromLookup(lookup: string): SkillsShSearchResult | null {
  const normalizedLookup = normalizeSkillRunnerLookup(lookup)
  const installArgMatch = normalizedLookup.match(/^([^@\s]+\/[^@\s]+)@([^@\s/]+)$/)
  if (installArgMatch) {
    const [, packageName, skillName] = installArgMatch
    const canonicalPath = `${packageName}/${skillName}`
    return {
      id: canonicalPath,
      canonicalPath,
      installArg: `${packageName}@${skillName}`,
      packageName,
      skillName,
      displayName: skillName,
      sourceUrl: `https://skills.sh/${canonicalPath}`
    }
  }

  const canonicalSegments = normalizedLookup.split("/").filter(Boolean)
  if (canonicalSegments.length >= 3) {
    const skillName = canonicalSegments.at(-1)
    if (!skillName) return null
    const packageName = canonicalSegments.slice(0, -1).join("/")
    const canonicalPath = `${packageName}/${skillName}`
    return {
      id: canonicalPath,
      canonicalPath,
      installArg: `${packageName}@${skillName}`,
      packageName,
      skillName,
      displayName: skillName,
      sourceUrl: `https://skills.sh/${canonicalPath}`
    }
  }

  return null
}

function skillsShCandidateMatchesLookup(lookup: string, candidate: SkillsShSearchResult): boolean {
  return skillRunnerLookupMatches(lookup, {
    id: candidate.id,
    canonicalPath: candidate.canonicalPath,
    displayName: candidate.displayName,
    installArg: candidate.installArg,
    skillName: candidate.skillName
  })
}

async function findExactSkillsShSelection(lookup: string): Promise<SkillsShSearchResult | null> {
  const directSelection = buildSkillsShSelectionFromLookup(lookup)
  if (directSelection) return directSelection

  const matches = (await searchSkillsSh(lookup)).filter((candidate) =>
    skillsShCandidateMatchesLookup(lookup, candidate)
  )
  const unique = new Map(matches.map((candidate) => [normalizeSkillRunnerLookup(candidate.canonicalPath), candidate]))
  if (unique.size === 1) {
    return [...unique.values()][0]
  }

  return null
}

async function importSkillRunnerForTeamState(
  state: SkillRunnerTeamState,
  team: DevAgentTeam,
  selection: SkillsShSearchResult
): Promise<SkillRunnerRecord> {
  const details = await fetchSkillsShSkillDetails(selection)
  const defaultSeed = findDefaultSeedByCanonicalPath(details.canonicalPath)

  if (defaultSeed) {
    state.hiddenDefaultIds = state.hiddenDefaultIds.filter((id) => id !== defaultSeed.id)
    state.updatedAt = new Date().toISOString()
    await saveTeamSkillRunnerState(state)
    return toSkillRunnerRecord(defaultSeed, team)
  }

  const existing = state.imported.find((runner) => runner.canonicalPath === details.canonicalPath)
  if (existing) {
    return { ...existing, team }
  }

  const now = new Date().toISOString()
  const record: SkillRunnerRecord = {
    id: stableImportedRunnerId(team.id, details.canonicalPath),
    kind: "skill-runner",
    sourceKind: "imported",
    canonicalPath: details.canonicalPath,
    sourceUrl: details.sourceUrl,
    installArg: details.installArg,
    packageName: details.packageName,
    skillName: details.skillName,
    displayName: details.displayName,
    description: details.description,
    validationQuality: "variable",
    validationWarning: "Validation quality may vary for this imported skill.",
    author: SYSTEM_AUTHOR,
    team,
    createdAt: now,
    updatedAt: now,
    upstreamHash: details.upstreamHash,
    upstreamFetchedAt: now
  }

  state.imported = [record, ...state.imported]
  state.updatedAt = now
  await saveTeamSkillRunnerState(state)
  return record
}

export function getDefaultExecutionMode(_team: { slug: string }): "self-hosted" {
  return "self-hosted"
}

function buildEmptyTeamState(team: DevAgentTeam): SkillRunnerTeamState {
  return {
    teamId: team.id,
    teamSlug: team.slug,
    hiddenDefaultIds: [],
    imported: [],
    settings: {
      executionMode: getDefaultExecutionMode(team),
      workerStatus: "unconfigured"
    },
    updatedAt: new Date().toISOString()
  }
}

function normalizeWorkerBaseUrl(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  if (!trimmed) return undefined

  try {
    const url = new URL(trimmed)
    if (url.protocol !== "https:") {
      return undefined
    }
    url.pathname = ""
    url.search = ""
    url.hash = ""
    return url.toString().replace(/\/$/, "")
  } catch {
    return undefined
  }
}

function normalizeTeamState(raw: SkillRunnerTeamState | null, team: DevAgentTeam): SkillRunnerTeamState {
  const fallback = buildEmptyTeamState(team)
  if (!raw) return fallback

  const executionMode =
    raw.settings?.executionMode === "hosted" && isHostedSkillRunnerTeamId(team.id) ? "hosted" : "self-hosted"
  const workerBaseUrl = normalizeWorkerBaseUrl(raw.settings?.workerBaseUrl)
  const workerProjectId = raw.settings?.workerProjectId?.trim() || undefined
  const workerStatus =
    raw.settings?.workerStatus === "provisioning" ||
    raw.settings?.workerStatus === "ready" ||
    raw.settings?.workerStatus === "outdated" ||
    raw.settings?.workerStatus === "error" ||
    raw.settings?.workerStatus === "unconfigured"
      ? raw.settings.workerStatus
      : workerBaseUrl
        ? "ready"
        : "unconfigured"

  return {
    teamId: raw.teamId || team.id,
    teamSlug: raw.teamSlug || team.slug,
    hiddenDefaultIds: Array.isArray(raw.hiddenDefaultIds) ? raw.hiddenDefaultIds : [],
    imported: Array.isArray(raw.imported) ? raw.imported : [],
    settings: {
      executionMode,
      workerBaseUrl,
      workerProjectId,
      workerStatus
    },
    updatedAt: raw.updatedAt || fallback.updatedAt
  }
}

async function getTeamSkillRunnerState(team: DevAgentTeam): Promise<SkillRunnerTeamState> {
  return normalizeTeamState(await readJsonBlob<SkillRunnerTeamState>(getTeamStatePath(team.id)), team)
}

async function saveTeamSkillRunnerState(state: SkillRunnerTeamState): Promise<void> {
  await put(getTeamStatePath(state.teamId), JSON.stringify(state, null, 2), {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true
  })
}

function formatAvgCost(summary?: SkillRunnerUsageSummary): string | undefined {
  if (!summary || summary.completedRunCount <= 0 || summary.totalCostUsd <= 0) return undefined

  const avg = summary.totalCostUsd / summary.completedRunCount
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: avg < 1 ? 2 : 2,
    maximumFractionDigits: avg < 1 ? 2 : 2
  }).format(avg)
}

export async function getSkillRunnerTeamSettings(team: DevAgentTeam): Promise<SkillRunnerTeamSettings> {
  const state = await getTeamSkillRunnerState(team)
  return state.settings
}

export async function updateSkillRunnerTeamSettings(
  team: DevAgentTeam,
  input: Partial<SkillRunnerTeamSettings>
): Promise<SkillRunnerTeamSettings> {
  const state = await getTeamSkillRunnerState(team)

  const requestedExecutionMode = input.executionMode || state.settings.executionMode
  const executionMode =
    requestedExecutionMode === "hosted" && isHostedSkillRunnerTeamId(team.id) ? "hosted" : "self-hosted"
  const workerBaseUrl =
    input.workerBaseUrl !== undefined ? normalizeWorkerBaseUrl(input.workerBaseUrl) : state.settings.workerBaseUrl
  const workerProjectId =
    input.workerProjectId !== undefined ? input.workerProjectId?.trim() || undefined : state.settings.workerProjectId
  const workerStatus =
    input.workerStatus === "provisioning" ||
    input.workerStatus === "ready" ||
    input.workerStatus === "outdated" ||
    input.workerStatus === "error" ||
    input.workerStatus === "unconfigured"
      ? input.workerStatus
      : workerBaseUrl
        ? state.settings.workerStatus || "ready"
        : "unconfigured"

  state.settings = {
    executionMode,
    workerBaseUrl,
    workerProjectId,
    workerStatus
  }
  state.updatedAt = new Date().toISOString()
  await saveTeamSkillRunnerState(state)
  return state.settings
}

export async function listSkillRunnerTeamSettings(teams: DevAgentTeam[]): Promise<
  Array<{
    team: DevAgentTeam
    settings: SkillRunnerTeamSettings
  }>
> {
  return Promise.all(
    teams.map(async (team) => ({
      team,
      settings: await getSkillRunnerTeamSettings(team)
    }))
  )
}

function applyUsageCount(record: SkillRunnerRecord, usageMap: Map<string, SkillRunnerUsageSummary>): DevAgent {
  const usage = usageMap.get(record.id)
  const executionProfile = getExecutionProfile(record)

  if (executionProfile === "deepsec") {
    return {
      id: record.id,
      kind: "skill-runner",
      name: record.displayName,
      description: record.description,
      instructions: `${DEEPSEC_DEV_AGENT_INSTRUCTIONS}\n\nUpstream skill: ${record.canonicalPath}`,
      executionMode: "preview-pr",
      sandboxBrowser: "none",
      aiAgent: "anthropic/claude-opus-4.6",
      devServerCommand: NO_DEV_SERVER_COMMAND,
      actionSteps: DEEPSEC_DEV_AGENT_ACTION_STEPS,
      skillRefs: buildDeepsecSkillRef(record),
      author: record.author,
      team: record.team,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      usageCount: usage?.usageCount ?? 0,
      avgCost: formatAvgCost(usage),
      legacyWorkflowType: "deepsec-security-scan",
      supportsPathInput: false,
      supportsPullRequest: false,
      successEval: DEEPSEC_DEV_AGENT_SUCCESS_EVAL,
      ashArtifact: record.ashArtifact,
      runnerCanonicalPath: record.canonicalPath,
      runnerSourceUrl: record.sourceUrl,
      runnerSourceKind: record.sourceKind,
      validationWarning: record.validationWarning
    }
  }

  if (executionProfile === "vercel-optimize") {
    return {
      id: record.id,
      kind: "skill-runner",
      name: record.displayName,
      description: record.description,
      instructions: `${VERCEL_OPTIMIZE_DEV_AGENT_INSTRUCTIONS}\n\nUpstream skill: ${record.canonicalPath}`,
      executionMode: "preview-pr",
      sandboxBrowser: "none",
      aiAgent: "anthropic/claude-opus-4.6",
      devServerCommand: NO_DEV_SERVER_COMMAND,
      actionSteps: VERCEL_OPTIMIZE_DEV_AGENT_ACTION_STEPS,
      skillRefs: buildSingleSkillRef(record),
      author: record.author,
      team: record.team,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      usageCount: usage?.usageCount ?? 0,
      avgCost: formatAvgCost(usage),
      legacyWorkflowType: "vercel-optimize-audit",
      supportsPathInput: false,
      supportsPullRequest: false,
      successEval: VERCEL_OPTIMIZE_DEV_AGENT_SUCCESS_EVAL,
      ashArtifact: record.ashArtifact,
      runnerCanonicalPath: record.canonicalPath,
      runnerSourceUrl: record.sourceUrl,
      runnerSourceKind: record.sourceKind,
      validationWarning: record.validationWarning
    }
  }

  return {
    id: record.id,
    kind: "skill-runner",
    name: record.displayName,
    description: record.description,
    instructions: buildSkillRunnerInstructions(record.displayName, record.description, record.canonicalPath),
    executionMode: "preview-pr",
    sandboxBrowser: "agent-browser",
    aiAgent: "anthropic/claude-opus-4.6",
    actionSteps: buildGenericActionSteps(record.displayName),
    skillRefs: buildSkillRef(record),
    author: record.author,
    team: record.team,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    usageCount: usage?.usageCount ?? 0,
    avgCost: formatAvgCost(usage),
    supportsPathInput: true,
    supportsPullRequest: true,
    successEval: buildSkillRunnerSuccessEval(record.displayName),
    ashArtifact: record.ashArtifact,
    runnerCanonicalPath: record.canonicalPath,
    runnerSourceUrl: record.sourceUrl,
    runnerSourceKind: record.sourceKind,
    validationWarning: record.validationWarning
  }
}

function buildFallbackDefaultSkillRunnerDetails(seed: DefaultSkillRunnerSeed): SkillsShSkillDetails {
  const upstreamHash = createHash("sha256")
    .update(
      JSON.stringify({
        canonicalPath: seed.canonicalPath,
        sourceUrl: seed.sourceUrl,
        installArg: seed.installArg,
        displayName: seed.displayName,
        description: seed.description
      })
    )
    .digest("hex")

  return {
    canonicalPath: seed.canonicalPath,
    installArg: seed.installArg,
    packageName: seed.packageName,
    skillName: seed.skillName,
    displayName: seed.displayName,
    sourceUrl: seed.sourceUrl,
    description: seed.description,
    upstreamHash
  }
}

async function fetchDefaultSkillRunnerDetails(seed: DefaultSkillRunnerSeed): Promise<SkillsShSkillDetails> {
  if (seed.executionProfile === "deepsec" || seed.executionProfile === "vercel-optimize") {
    return buildFallbackDefaultSkillRunnerDetails(seed)
  }

  return await fetchSkillsShSkillDetails(seed)
}

export async function listSkillRunners(team: DevAgentTeam): Promise<DevAgent[]> {
  const [state, usageMap] = await Promise.all([getTeamSkillRunnerState(team), listSkillRunnerUsageStats()])
  const hidden = new Set(state.hiddenDefaultIds)
  const defaults = DEFAULT_SKILL_RUNNER_SEEDS.filter((seed) => !hidden.has(seed.id)).map((seed) =>
    applyUsageCount(toSkillRunnerRecord(seed, team), usageMap)
  )
  const imported = state.imported.map((record) => applyUsageCount({ ...record, team }, usageMap))
  return [...imported, ...defaults]
}

export async function getSkillRunner(team: DevAgentTeam, runnerId: string): Promise<DevAgent | null> {
  const runners = await listSkillRunners(team)
  return runners.find((runner) => runner.id === runnerId) || null
}

export function getDefaultSkillRunnerOpenGraphProfile(runnerId: string): SkillRunnerOpenGraphProfile | null {
  const seed = DEFAULT_SKILL_RUNNER_SEEDS.find((item) => item.id === runnerId)
  if (!seed) return null

  return {
    id: seed.id,
    name: seed.displayName,
    description: seed.description,
    canonicalPath: seed.canonicalPath,
    executionProfile: seed.executionProfile
  }
}

function findDefaultSeedByCanonicalPath(canonicalPath: string) {
  return DEFAULT_SKILL_RUNNER_SEEDS.find((seed) => seed.canonicalPath === canonicalPath)
}

export async function searchSkillRunnerCandidates(query: string): Promise<SkillsShSearchResult[]> {
  return searchSkillsSh(query)
}

export interface SkillRunnerExistingMatch {
  id: string
  name: string
  canonicalPath?: string
  sourceUrl?: string
}

export interface SkillRunnerLookupResolution {
  exactMatch: SkillRunnerExistingMatch | null
  candidates: SkillsShSearchResult[]
}

function normalizedSkillRunnerCandidatesForDevAgent(runner: DevAgent): string[] {
  return [
    runner.id,
    runner.name,
    slugifySkillRunnerLookup(runner.name),
    runner.runnerCanonicalPath,
    runner.runnerSourceUrl,
    ...runner.skillRefs
      .filter((skillRef) => skillRef.id !== "d3k")
      .flatMap((skillRef) => [
        skillRef.id,
        skillRef.installArg,
        skillRef.packageName && skillRef.skillName ? `${skillRef.packageName}@${skillRef.skillName}` : undefined,
        skillRef.packageName && skillRef.skillName ? `${skillRef.packageName}/${skillRef.skillName}` : undefined,
        skillRef.skillName,
        skillRef.displayName,
        skillRef.displayName ? slugifySkillRunnerLookup(skillRef.displayName) : undefined,
        skillRef.sourceUrl
      ])
  ].filter((value): value is string => Boolean(value?.trim()))
}

function devAgentExactlyMatchesSkillRunnerLookup(lookup: string, runner: DevAgent): boolean {
  const normalizedLookup = normalizeSkillRunnerLookup(lookup)
  return normalizedSkillRunnerCandidatesForDevAgent(runner).some(
    (candidate) => normalizeSkillRunnerLookup(candidate) === normalizedLookup
  )
}

function dedupeSkillRunnerCandidates(candidates: SkillsShSearchResult[]): SkillsShSearchResult[] {
  const seen = new Set<string>()
  const deduped: SkillsShSearchResult[] = []

  for (const candidate of candidates) {
    const key = normalizeSkillRunnerLookup(candidate.canonicalPath)
    if (!key || seen.has(key)) continue
    seen.add(key)
    deduped.push(candidate)
  }

  return deduped
}

export async function resolveSkillRunnerLookupForCli(
  team: DevAgentTeam,
  lookup: string
): Promise<SkillRunnerLookupResolution> {
  const trimmed = lookup.trim()
  const runners = await listSkillRunners(team)
  const exactRunner = runners.find((runner) => devAgentExactlyMatchesSkillRunnerLookup(trimmed, runner))
  if (exactRunner) {
    return {
      exactMatch: {
        id: exactRunner.id,
        name: exactRunner.name,
        canonicalPath: exactRunner.runnerCanonicalPath,
        sourceUrl: exactRunner.runnerSourceUrl
      },
      candidates: []
    }
  }

  const directSelection = buildSkillsShSelectionFromLookup(trimmed)
  const searchResults = await searchSkillsSh(trimmed)
  const candidates = dedupeSkillRunnerCandidates(directSelection ? [directSelection, ...searchResults] : searchResults)

  return {
    exactMatch: null,
    candidates
  }
}

export async function importSkillRunnerForTeam(team: DevAgentTeam, selection: SkillsShSearchResult): Promise<DevAgent> {
  const state = await getTeamSkillRunnerState(team)
  const record = await importSkillRunnerForTeamState(state, team, selection)
  return applyUsageCount(record, await listSkillRunnerUsageStats())
}

export async function removeSkillRunnerForTeam(team: DevAgentTeam, runnerId: string): Promise<void> {
  const state = await getTeamSkillRunnerState(team)
  const defaultSeed = DEFAULT_SKILL_RUNNER_SEEDS.find((seed) => seed.id === runnerId)
  if (defaultSeed) {
    if (!state.hiddenDefaultIds.includes(defaultSeed.id)) {
      state.hiddenDefaultIds.push(defaultSeed.id)
    }
  } else {
    state.imported = state.imported.filter((runner) => runner.id !== runnerId)
  }
  state.updatedAt = new Date().toISOString()
  await saveTeamSkillRunnerState(state)
}

export async function incrementSkillRunnerUsage(skillRunnerId: string): Promise<void> {
  const current = await readJsonBlob<SkillRunnerUsageStat>(`${SKILL_RUNNER_STATS_PREFIX}${skillRunnerId}.json`)
  const payload: SkillRunnerUsageStat = {
    skillRunnerId,
    usageCount: (current?.usageCount ?? 0) + 1,
    completedRunCount: current?.completedRunCount ?? 0,
    totalCostUsd: current?.totalCostUsd ?? 0,
    updatedAt: new Date().toISOString()
  }

  await put(`${SKILL_RUNNER_STATS_PREFIX}${skillRunnerId}.json`, JSON.stringify(payload, null, 2), {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true
  })
}

export async function recordSkillRunnerCompletion(skillRunnerId: string, costUsd: number): Promise<void> {
  const current = await readJsonBlob<SkillRunnerUsageStat>(`${SKILL_RUNNER_STATS_PREFIX}${skillRunnerId}.json`)
  const payload: SkillRunnerUsageStat = {
    skillRunnerId,
    usageCount: current?.usageCount ?? 0,
    completedRunCount: (current?.completedRunCount ?? 0) + 1,
    totalCostUsd: (current?.totalCostUsd ?? 0) + (Number.isFinite(costUsd) && costUsd > 0 ? costUsd : 0),
    updatedAt: new Date().toISOString()
  }

  await put(`${SKILL_RUNNER_STATS_PREFIX}${skillRunnerId}.json`, JSON.stringify(payload, null, 2), {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true
  })
}

export async function getSkillRunnerForExecution(
  team: DevAgentTeam,
  runnerId: string
): Promise<{
  devAgent: DevAgent
  validationWarning?: string
  canonicalPath: string
}> {
  const state = await getTeamSkillRunnerState(team)
  const defaultSeed = findDefaultSeedByLookup(runnerId)

  if (defaultSeed) {
    const details = await fetchDefaultSkillRunnerDetails(defaultSeed)
    const devAgent = applyUsageCount(
      {
        ...toSkillRunnerRecord(
          {
            ...defaultSeed,
            sourceUrl: details.sourceUrl,
            displayName: defaultSeed.executionProfile ? defaultSeed.displayName : details.displayName,
            description: defaultSeed.executionProfile ? defaultSeed.description : details.description,
            executionProfile: defaultSeed.executionProfile
          },
          team
        ),
        upstreamHash: details.upstreamHash,
        upstreamFetchedAt: new Date().toISOString()
      },
      await listSkillRunnerUsageStats()
    )

    const prepared = await ensureDevAgentAshArtifactPrepared(devAgent)
    return {
      devAgent: {
        ...devAgent,
        ashArtifact: prepared.artifact
      },
      validationWarning: defaultSeed.validationWarning,
      canonicalPath: details.canonicalPath
    }
  }

  let existingIndex = state.imported.findIndex((runner) => skillRunnerLookupMatches(runnerId, runner))
  if (existingIndex === -1) {
    const selection = await findExactSkillsShSelection(runnerId)
    if (!selection) {
      throw new Error("Skill runner not found")
    }

    await importSkillRunnerForTeamState(state, team, selection)
    existingIndex = state.imported.findIndex((runner) => skillRunnerLookupMatches(runnerId, runner))
    if (existingIndex === -1) {
      const importedIndex = state.imported.findIndex((runner) =>
        skillRunnerLookupMatches(selection.canonicalPath, runner)
      )
      existingIndex = importedIndex
    }
  }

  if (existingIndex === -1) {
    const defaultSelection = findDefaultSeedByLookup(runnerId)
    if (defaultSelection) {
      return getSkillRunnerForExecution(team, defaultSelection.id)
    }
    throw new Error("Skill runner not found")
  }

  const existing = state.imported[existingIndex]
  const details = await fetchSkillsShSkillDetails(existing)
  const now = new Date().toISOString()
  const refreshed: SkillRunnerRecord = {
    ...existing,
    canonicalPath: details.canonicalPath,
    sourceUrl: details.sourceUrl,
    displayName: details.displayName,
    description: details.description,
    upstreamHash: details.upstreamHash,
    upstreamFetchedAt: now,
    updatedAt: now
  }
  let devAgent = applyUsageCount(refreshed, await listSkillRunnerUsageStats())
  const prepared = await ensureDevAgentAshArtifactPrepared(devAgent)
  devAgent = {
    ...devAgent,
    ashArtifact: prepared.artifact
  }
  state.imported[existingIndex] = {
    ...refreshed,
    ashArtifact: prepared.artifact
  }
  state.updatedAt = now
  await saveTeamSkillRunnerState(state)

  return {
    devAgent,
    validationWarning: refreshed.validationWarning,
    canonicalPath: refreshed.canonicalPath
  }
}
