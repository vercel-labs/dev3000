// Shared types for the MCP server and client components

export interface LogEntry {
  timestamp: string;
  source: string;
  message: string;
  screenshot?: string;
  original: string;
}

export interface LogsApiResponse {
  logs: string;
  total: number;
}

export interface LogsApiError {
  error: string;
}

export interface ConfigApiResponse {
  version: string;
}

export interface StreamLogData {
  type: 'log';
  line: string;
}

export interface LogFile {
  name: string;
  path: string;
  timestamp: string;
  size: number;
  mtime: Date;
  isCurrent: boolean;
}

export interface LogListResponse {
  files: LogFile[];
  currentFile: string;
  projectName: string;
}

export interface LogListError {
  error: string;
}