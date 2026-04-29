// Types for workflow reports and cloud workflows
import type { DevAgentEarlyExitRule } from "@/lib/dev-agents"

/**
 * Core Web Vitals metrics with grades
 */
export interface WebVitals {
  lcp?: { value: number; grade: "good" | "needs-improvement" | "poor" } // Largest Contentful Paint (ms)
  fcp?: { value: number; grade: "good" | "needs-improvement" | "poor" } // First Contentful Paint (ms)
  ttfb?: { value: number; grade: "good" | "needs-improvement" | "poor" } // Time to First Byte (ms)
  cls?: { value: number; grade: "good" | "needs-improvement" | "poor" } // Cumulative Layout Shift
  inp?: { value: number; grade: "good" | "needs-improvement" | "poor" } // Interaction to Next Paint (ms)
}

export interface TurbopackBundleRouteMetric {
  route: string
  compressedBytes: number
  rawBytes: number
}

export interface TurbopackBundleSourceMetric {
  fullPath: string
  compressedBytes: number
  rawBytes: number
  routes: string[]
}

export interface TurbopackBundleMetricsSnapshot {
  generatedAt: string
  totalCompressedBytes: number
  totalRawBytes: number
  routeCount: number
  outputFileCount: number
  topRoutes: TurbopackBundleRouteMetric[]
  topSources?: TurbopackBundleSourceMetric[]
}

export interface TurbopackBundleDelta {
  compressedBytes: number
  rawBytes: number
  compressedPercent: number | null
  rawPercent: number | null
}

export interface TurbopackBundleComparison {
  before: TurbopackBundleMetricsSnapshot
  after: TurbopackBundleMetricsSnapshot
  delta: TurbopackBundleDelta
}

/**
 * Workflow report data stored as JSON in blob storage
 * This is the full report data, separate from WorkflowRun metadata
 */
export interface WorkflowReport {
  // Core identifiers
  id: string
  projectName: string
  timestamp: string
  devAgentId?: string
  devAgentName?: string
  devAgentDescription?: string
  devAgentRevision?: number
  devAgentSpecHash?: string
  devAgentExecutionMode?: "dev-server" | "preview-pr"
  devAgentSandboxBrowser?: "none" | "agent-browser"

  // Workflow type and prompts
  workflowType?:
    | "cls-fix"
    | "prompt"
    | "design-guidelines"
    | "react-performance"
    | "url-audit"
    | "turbopack-bundle-analyzer"
  customPrompt?: string // User's original prompt (for prompt workflows)
  systemPrompt?: string // The full system prompt used by the agent
  devAgentInstructions?: string
  devAgentPrompt?: string
  devAgentSkills?: Array<{
    id: string
    installArg: string
    packageName?: string
    skillName: string
    displayName: string
    sourceUrl?: string
  }>

  // Sandbox URLs
  sandboxDevUrl: string
  targetUrl?: string
  startPath?: string
  analysisTargetType?: "vercel-project" | "url"
  repoUrl?: string
  repoBranch?: string
  projectDir?: string
  repoOwner?: string
  repoName?: string

  // CLS data (legacy - kept for backward compat, prefer webVitals)
  clsScore?: number
  clsGrade?: "good" | "needs-improvement" | "poor"
  layoutShifts?: Array<{
    score: number
    timestamp: number
    elements: string[]
  }>

  // Core Web Vitals - before and after metrics (for ALL workflow types)
  beforeWebVitals?: WebVitals
  afterWebVitals?: WebVitals

  // Screenshots - single images (legacy/fallback)
  beforeScreenshotUrl?: string

  // Screenshot sequences for animated playback (CLS workflows)
  beforeScreenshots?: Array<{
    timestamp: number
    blobUrl: string
    label?: string
  }>
  afterScreenshots?: Array<{
    timestamp: number
    blobUrl: string
    label?: string
  }>

  // Legacy: individual CLS screenshots (deprecated, use beforeScreenshots/afterScreenshots)
  clsScreenshots?: Array<{
    timestamp: number
    blobUrl: string
    label?: string
  }>

  // AI agent analysis
  agentAnalysis: string
  agentAnalysisModel?: string // e.g. "anthropic/claude-sonnet-4-20250514"
  skillsInstalled?: string[] // Skills available in the sandbox at runtime
  skillsLoaded?: string[] // Skills explicitly loaded by the agent via get_skill
  turbopackBundleComparison?: TurbopackBundleComparison // Before/after NDJSON bundle metrics (turbopack workflow)

  // d3k logs
  d3kLogs?: string // Combined (backward compat)
  initD3kLogs?: string // Step 1: before agent
  afterD3kLogs?: string // Step 2: after agent fix

  // Web Vitals diagnostic logs (for debugging capture issues)
  webVitalsDiagnostics?: {
    before?: string[]
    after?: string[]
  }

  // Git diff of changes made by agent
  gitDiff?: string

  // After-fix verification data (proves the fix worked)
  afterClsScore?: number
  afterClsGrade?: "good" | "needs-improvement" | "poor"
  afterScreenshotUrl?: string
  verificationStatus?: "improved" | "unchanged" | "degraded" | "error"
  verificationError?: string

  // AI Gateway usage
  gatewayUsage?: {
    totalTokens?: number
    promptTokens?: number
    completionTokens?: number
    cacheReadTokens?: number
    cacheCreationTokens?: number
  }
  costUsd?: number

  // Whether this was a marketplace agent run (hides internal implementation details)
  isMarketplaceAgent?: boolean

  // Success eval
  successEval?: string
  successEvalResult?: boolean | null

  // Early exit eval
  earlyExitEval?: string
  earlyExitRule?: DevAgentEarlyExitRule
  earlyExitResult?: { shouldExit: boolean; reason: string }

  // PR info (future)
  prUrl?: string
  prDiff?: string

  // Sandbox and timing info
  fromSnapshot?: boolean // Whether sandbox was created from a base snapshot
  snapshotId?: string // The snapshot ID used (if any)
  timing?: {
    total: {
      initMs: number
      agentMs: number
      prMs?: number
      totalMs: number
    }
    init?: {
      sandboxCreationMs: number
      fromSnapshot: boolean
      steps: Array<{ name: string; durationMs: number }>
    }
    agent?: {
      steps: Array<{ name: string; durationMs: number }>
    }
    pr?: {
      steps: Array<{ name: string; durationMs: number }>
    }
  }
}
