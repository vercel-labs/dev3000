import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { list } from "@vercel/blob"
import { deleteBlobByPathOrUrl, putBlobAndBuildUrl, readBlobJson } from "@/lib/blob-store"
import type { WebVitals, WorkflowReport } from "@/types"

export type WorkflowType =
  | "cls-fix"
  | "prompt"
  | "design-guidelines"
  | "react-performance"
  | "url-audit"
  | "turbopack-bundle-analyzer"

export interface WorkflowRun {
  id: string
  userId: string
  projectName: string
  timestamp: string
  status: "running" | "done" | "failure"
  costUsd?: number
  runnerKind?: "dev-agent" | "skill-runner"
  type?: WorkflowType // Workflow type (cls-fix, prompt, etc.)
  devAgentId?: string
  devAgentName?: string
  devAgentDescription?: string
  devAgentRevision?: number
  devAgentSpecHash?: string
  devAgentExecutionMode?: "dev-server" | "preview-pr"
  devAgentSandboxBrowser?: "none" | "agent-browser"
  skillRunnerCanonicalPath?: string
  skillRunnerValidationWarning?: string
  currentStep?: string // Current step being executed (for live progress)
  stepNumber?: number // 0-4 to show progress (0=sandbox, 1=logs, 2=ai, 3=upload, 4=pr)
  completedAt?: string // ISO timestamp when workflow finished (for duration calc)
  reportBlobUrl?: string
  prUrl?: string
  prError?: string // Error from PR creation step (if any)
  error?: string
  beforeScreenshotUrl?: string
  afterScreenshotUrl?: string
  sandboxUrl?: string // Dev URL from sandbox for live viewing
  isPublic?: boolean // If true, the report can be viewed without authentication
  customPrompt?: string // For prompt type: the user's custom instruction
  progressLogs?: string[] // Rolling log lines for live pending UI
  successEvalResult?: boolean | null // Result of the success eval (true/false/null)
  clsScore?: number | null
  afterClsScore?: number | null
  beforeWebVitals?: WebVitals
  afterWebVitals?: WebVitals
  verificationStatus?: "improved" | "unchanged" | "degraded" | "error"
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
}

export interface WorkflowRunMirrorTarget {
  apiBaseUrl: string
  accessToken?: string
  internalSecret?: string
}

export function getWorkflowMirrorSecret(): string | null {
  const secret = process.env.WORKFLOW_MIRROR_SECRET
  const trimmed = secret?.trim()
  return trimmed ? trimmed : null
}

const LOCAL_WORKFLOW_CACHE_ROOT = path.join(tmpdir(), "dev3000-workflow-runs")

function isLocalWorkflowCacheEnabled(): boolean {
  return process.env.DEV3000_ENABLE_LOCAL_WORKFLOW_CACHE === "1"
}

function getLocalWorkflowCacheDir(userId: string): string {
  return path.join(LOCAL_WORKFLOW_CACHE_ROOT, encodeURIComponent(userId))
}

function getLocalWorkflowCachePath(run: Pick<WorkflowRun, "userId" | "timestamp" | "projectName">): string {
  return path.join(
    getLocalWorkflowCacheDir(run.userId),
    `${encodeURIComponent(run.timestamp)}-${encodeURIComponent(run.projectName)}.json`
  )
}

async function saveLocalWorkflowRun(run: WorkflowRun): Promise<void> {
  if (!isLocalWorkflowCacheEnabled()) {
    return
  }

  const filePath = getLocalWorkflowCachePath(run)
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, JSON.stringify(run, null, 2))
}

async function listLocalWorkflowRuns(userId: string): Promise<WorkflowRun[] | null> {
  if (!isLocalWorkflowCacheEnabled()) {
    return null
  }

  try {
    const dir = getLocalWorkflowCacheDir(userId)
    const entries = await readdir(dir, { withFileTypes: true })
    const runs = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map(async (entry) => {
          const filePath = path.join(dir, entry.name)
          const content = await readFile(filePath, "utf8")
          return JSON.parse(content) as WorkflowRun
        })
    )
    return runs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
  } catch {
    return null
  }
}

async function deleteLocalWorkflowRun(run: Pick<WorkflowRun, "userId" | "timestamp" | "projectName">): Promise<void> {
  if (!isLocalWorkflowCacheEnabled()) {
    return
  }

  const filePath = getLocalWorkflowCachePath(run)
  await rm(filePath, { force: true })
}

async function readWorkflowRunBlob(pathOrUrl: string): Promise<WorkflowRun | null> {
  try {
    const run = await readBlobJson<WorkflowRun>(pathOrUrl)
    if (!run) return null

    if ((typeof run.costUsd !== "number" || !Number.isFinite(run.costUsd)) && run.reportBlobUrl) {
      try {
        const report = await readBlobJson<WorkflowReport>(run.reportBlobUrl)
        if (report && typeof report.costUsd === "number" && Number.isFinite(report.costUsd)) {
          run.costUsd = report.costUsd
        }
      } catch (error) {
        console.error(`[Workflow Storage] Failed to backfill cost from report ${run.reportBlobUrl}:`, error)
      }
    }

    return run
  } catch (error) {
    console.error(`[Workflow Storage] Failed to fetch ${pathOrUrl}:`, error)
    return null
  }
}

/**
 * Save a workflow run to blob storage
 * Path format: workflows/{userId}/{timestamp}-{projectName}.json
 */
export async function saveWorkflowRun(run: WorkflowRun): Promise<string> {
  const path = `workflows/${run.userId}/${run.timestamp}-${run.projectName}.json`
  await saveLocalWorkflowRun(run)

  const blob = await putBlobAndBuildUrl(path, JSON.stringify(run, null, 2), {
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
    absoluteUrl: true
  })

  console.log(`[Workflow Storage] Saved run to: ${blob.appUrl}`)
  return blob.appUrl
}

function normalizeMirrorApiBaseUrl(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null

  try {
    return new URL(trimmed).origin
  } catch {
    return null
  }
}

export async function mirrorWorkflowRun(run: WorkflowRun, mirrorTarget: WorkflowRunMirrorTarget): Promise<void> {
  const apiBaseUrl = normalizeMirrorApiBaseUrl(mirrorTarget.apiBaseUrl)
  const accessToken = mirrorTarget.accessToken?.trim()
  const internalSecret = mirrorTarget.internalSecret?.trim()

  if (!apiBaseUrl || (!accessToken && !internalSecret)) {
    throw new Error("Missing workflow mirror target configuration")
  }

  const headers: HeadersInit = {
    "content-type": "application/json",
    "x-dev3000-workflow-mirror": "1"
  }

  if (internalSecret) {
    headers["x-dev3000-workflow-mirror-secret"] = internalSecret
  } else if (accessToken) {
    headers.authorization = `Bearer ${accessToken}`
  }

  const response = await fetch(new URL("/api/internal/workflow-runs", apiBaseUrl), {
    method: "POST",
    headers,
    body: JSON.stringify({ run }),
    cache: "no-store"
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Workflow mirror failed with HTTP ${response.status}: ${body.slice(0, 400)}`)
  }
}

export async function persistWorkflowRun(
  run: WorkflowRun,
  options?: { mirrorTarget?: WorkflowRunMirrorTarget | null }
): Promise<string> {
  const appUrl = await saveWorkflowRun(run)

  if (options?.mirrorTarget) {
    await mirrorWorkflowRun(run, options.mirrorTarget)
  }

  return appUrl
}

/**
 * List all workflow runs for a user
 * Returns runs sorted by timestamp (newest first)
 */
export async function listWorkflowRuns(userId: string): Promise<WorkflowRun[]> {
  const localRuns = await listLocalWorkflowRuns(userId)
  if (localRuns) {
    return localRuns
  }

  const prefix = `workflows/${userId}/`

  let blobs: Awaited<ReturnType<typeof list>>["blobs"] = []
  try {
    ;({ blobs } = await list({ prefix }))
  } catch (error) {
    console.error(`[Workflow Storage] Failed to list blobs for ${prefix}:`, error)
    return []
  }

  // Debug: log what blobs were found (helps diagnose ghost/stale blob issues)
  if (blobs.length > 0) {
    console.log(
      `[Workflow Storage] Found ${blobs.length} blob(s) for prefix "${prefix}": ${blobs.map((b) => b.pathname).join(", ")}`
    )
  }

  // Fetch and parse each blob
  const runs = await Promise.all(blobs.map(async (blob) => readWorkflowRunBlob(blob.pathname)))

  // Filter out failed fetches and sort by timestamp
  return runs
    .filter((run): run is WorkflowRun => run !== null)
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
}

/**
 * Get a single workflow run by ID
 */
export async function getWorkflowRun(userId: string, runId: string): Promise<WorkflowRun | null> {
  const runs = await listWorkflowRuns(userId)
  return runs.find((run) => run.id === runId) || null
}

/**
 * Get a workflow run by ID without requiring userId (for public access)
 * This searches across all users' workflows - only returns if isPublic is true
 */
export async function getPublicWorkflowRun(runId: string): Promise<WorkflowRun | null> {
  const prefix = "workflows/"
  let cursor: string | undefined
  let page = 0

  while (true) {
    let pageResult: Awaited<ReturnType<typeof list>>
    try {
      pageResult = await list({ prefix, cursor, limit: 1000 })
    } catch (error) {
      console.error(`[Workflow Storage] Failed to list blobs for ${prefix} (page ${page}):`, error)
      return null
    }

    // Search through current page of blobs to find the matching run ID
    for (const blob of pageResult.blobs) {
      const run = await readWorkflowRunBlob(blob.pathname)
      if (run?.id === runId && run.isPublic) {
        return run
      }
    }

    if (!pageResult.hasMore || !pageResult.cursor) {
      break
    }

    cursor = pageResult.cursor
    page += 1
  }

  return null
}

/**
 * Toggle public status of a workflow run
 */
export async function setWorkflowPublic(userId: string, runId: string, isPublic: boolean): Promise<WorkflowRun | null> {
  const run = await getWorkflowRun(userId, runId)
  if (!run) {
    return null
  }

  run.isPublic = isPublic
  await saveWorkflowRun(run)
  console.log(`[Workflow Storage] Set run ${runId} public status to: ${isPublic}`)
  return run
}

/**
 * Update workflow progress (step tracking for live UI updates)
 * This is a lightweight update that only changes step info, not the full run
 */
export async function updateWorkflowProgress(
  userId: string,
  runId: string,
  projectName: string,
  timestamp: string,
  stepNumber: number,
  currentStep: string,
  sandboxUrl?: string
): Promise<void> {
  // We need to re-save the full run with updated step info
  // First, try to get existing run data
  const existingRuns = await listWorkflowRuns(userId)
  const existingRun = existingRuns.find((r) => r.id === runId)

  const runData: WorkflowRun = existingRun || {
    id: runId,
    userId,
    projectName,
    timestamp,
    status: "running"
  }

  // Update with new step info
  runData.stepNumber = stepNumber
  runData.currentStep = currentStep
  if (sandboxUrl) {
    runData.sandboxUrl = sandboxUrl
  }

  await saveWorkflowRun(runData)
  console.log(`[Workflow Storage] Updated progress: Step ${stepNumber} - ${currentStep}`)
}

/**
 * Delete workflow runs and their associated blobs (screenshots, reports)
 * Returns the number of successfully deleted runs
 */
export async function deleteWorkflowRuns(
  userId: string,
  runIds: string[]
): Promise<{ deleted: number; errors: string[] }> {
  const runs = await listWorkflowRuns(userId)
  const runsToDelete = runs.filter((run) => runIds.includes(run.id))

  const errors: string[] = []
  let deleted = 0

  for (const run of runsToDelete) {
    const pathsToDelete: string[] = []

    // Collect all blob URLs associated with this run
    // The workflow run JSON file
    const runPath = `workflows/${userId}/${run.timestamp}-${run.projectName}.json`
    const { blobs } = await list({ prefix: runPath })
    for (const blob of blobs) {
      pathsToDelete.push(blob.pathname)
    }

    // Screenshots
    if (run.beforeScreenshotUrl) {
      pathsToDelete.push(run.beforeScreenshotUrl)
    }
    if (run.afterScreenshotUrl) {
      pathsToDelete.push(run.afterScreenshotUrl)
    }

    // Report blob
    if (run.reportBlobUrl) {
      pathsToDelete.push(run.reportBlobUrl)
    }

    // Delete all collected paths/URLs
    try {
      if (pathsToDelete.length > 0) {
        await Promise.all(pathsToDelete.map((item) => deleteBlobByPathOrUrl(item)))
        console.log(`[Workflow Storage] Deleted ${pathsToDelete.length} blobs for run ${run.id}`)
      }
      await deleteLocalWorkflowRun(run)
      deleted++
    } catch (error) {
      const errorMsg = `Failed to delete run ${run.id}: ${error instanceof Error ? error.message : String(error)}`
      console.error(`[Workflow Storage] ${errorMsg}`)
      errors.push(errorMsg)
    }
  }

  return { deleted, errors }
}
