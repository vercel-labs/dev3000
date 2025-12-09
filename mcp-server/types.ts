// Shared types for the MCP server and client components

export interface LogEntry {
  timestamp: string
  source: string
  message: string
  screenshot?: string
  screencast?: string
  original: string
  tabIdentifier?: string
  userAgent?: string
}

export interface LogsApiResponse {
  logs: string
  total: number
}

export interface LogsApiError {
  error: string
}

export interface ConfigApiResponse {
  version: string
}

export interface StreamLogData {
  type: "log"
  line: string
}

export interface LogFile {
  name: string
  path: string
  timestamp: string
  size: number
  mtime: string // ISO string (was Date, changed for Next.js 16 serialization compatibility)
  isCurrent: boolean
}

export interface LogListResponse {
  files: LogFile[]
  currentFile: string
  projectName: string
}

export interface LogListError {
  error: string
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

  // Screenshots
  beforeScreenshotUrl?: string
  clsScreenshots?: Array<{
    timestamp: number
    blobUrl: string
    label?: string
  }>

  // AI agent analysis
  agentAnalysis: string
  agentAnalysisModel?: string // e.g. "anthropic/claude-sonnet-4-20250514"

  // d3k logs
  d3kLogs?: string

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
