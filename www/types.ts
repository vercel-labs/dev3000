// Types for workflow reports and cloud workflows

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
  workflowType?: "cls-fix" | "prompt"
  customPrompt?: string // User's original prompt (for prompt workflows)
  systemPrompt?: string // The full system prompt used by the agent

  // Sandbox URLs
  sandboxDevUrl: string
  sandboxMcpUrl?: string

  // CLS data
  clsScore?: number
  clsGrade?: "good" | "needs-improvement" | "poor"
  layoutShifts?: Array<{
    score: number
    timestamp: number
    elements: string[]
  }>

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
}
