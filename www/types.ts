// Types for workflow reports and cloud workflows

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

/**
 * Workflow report data stored as JSON in blob storage
 * This is the full report data, separate from WorkflowRun metadata
 */
export interface WorkflowReport {
  // Core identifiers
  id: string
  projectName: string
  timestamp: string

  // Workflow type and prompts
  workflowType?: "cls-fix" | "prompt" | "design-guidelines"
  customPrompt?: string // User's original prompt (for prompt workflows)
  systemPrompt?: string // The full system prompt used by the agent

  // Sandbox URLs
  sandboxDevUrl: string
  sandboxMcpUrl?: string

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
