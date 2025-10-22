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
