/**
 * Types for dev3000 Cloud API
 */

export interface ProductionError {
  id: string
  timestamp: string
  message: string
  stack?: string
  url: string
  userAgent: string
  interactions?: string[]
  severity: "critical" | "error" | "warning"
  reproduced?: boolean
  reproductionId?: string
}

export interface ReproductionRequest {
  errorId: string
  repoUrl?: string
  branch?: string
}

export interface ReproductionResult {
  id: string
  errorId: string
  status: "pending" | "running" | "completed" | "failed"
  sandboxId?: string
  logs?: string
  screenshots?: string[]
  analysis?: string
  startedAt: string
  completedAt?: string
  error?: string
}

export interface CloudStatus {
  totalErrors: number
  unreproduced: number
  reproductions: {
    pending: number
    running: number
    completed: number
    failed: number
  }
  recentErrors: ProductionError[]
}
