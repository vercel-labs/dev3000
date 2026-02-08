import { del, head, list, put } from "@vercel/blob"

const FETCH_TIMEOUT_MS = 6000
const FETCH_RETRIES = 2

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

export type WorkflowType = "cls-fix" | "prompt" | "design-guidelines" | "react-performance"

export interface WorkflowRun {
  id: string
  userId: string
  projectName: string
  timestamp: string
  status: "running" | "done" | "failure"
  type?: WorkflowType // Workflow type (cls-fix, prompt, etc.)
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
}

/**
 * Save a workflow run to blob storage
 * Path format: workflows/{userId}/{timestamp}-{projectName}.json
 */
export async function saveWorkflowRun(run: WorkflowRun): Promise<string> {
  const path = `workflows/${run.userId}/${run.timestamp}-${run.projectName}.json`

  const blob = await put(path, JSON.stringify(run, null, 2), {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true
  })

  console.log(`[Workflow Storage] Saved run to: ${blob.url}`)
  return blob.url
}

/**
 * List all workflow runs for a user
 * Returns runs sorted by timestamp (newest first)
 */
export async function listWorkflowRuns(userId: string): Promise<WorkflowRun[]> {
  const prefix = `workflows/${userId}/`

  let blobs: Awaited<ReturnType<typeof list>>["blobs"] = []
  try {
    ;({ blobs } = await list({ prefix }))
  } catch (error) {
    console.error("[Workflow Storage] Failed to list blobs for prefix %s:", prefix, error)
    return []
  }

  // Debug: log what blobs were found (helps diagnose ghost/stale blob issues)
  if (blobs.length > 0) {
    console.log(
      `[Workflow Storage] Found ${blobs.length} blob(s) for prefix "${prefix}": ${blobs.map((b) => b.pathname).join(", ")}`
    )
  }

  // Fetch and parse each blob
  // Note: Use head() first to verify blob exists, then fetch with special headers
  // to avoid Vercel Security Checkpoint when fetching from serverless functions
  const runs = await Promise.all(
    blobs.map(async (blob) => {
      try {
        // First verify blob exists using authenticated head() call
        const blobInfo = await head(blob.url)
        if (!blobInfo) {
          console.error("[Workflow Storage] Blob not found for URL %s", blob.url)
          return null
        }

        // Check content type from head - if not JSON, skip it
        if (!blobInfo.contentType?.includes("application/json")) {
          console.error(
            "[Workflow Storage] Unexpected content type %s for URL %s",
            blobInfo.contentType,
            blob.url
          )
          return null
        }

        // Use downloadUrl if available (authenticated), otherwise fall back to public url
        const fetchUrl = blobInfo.downloadUrl || blob.url
        const response = await fetchJsonWithRetry(fetchUrl)

        // Check for non-OK responses (security checkpoint returns 200 but HTML)
        if (!response.ok) {
          console.error(
            "[Workflow Storage] HTTP %d fetching %s (content-type: %s)",
            response.status,
            fetchUrl,
            response.headers.get("content-type")
          )
          return null
        }

        // Double-check response is actually JSON (security checkpoint returns text/html)
        const contentType = response.headers.get("content-type")
        if (contentType && !contentType.includes("application/json")) {
          console.error(
            "[Workflow Storage] Response is not JSON: %s for %s (likely Vercel Security Checkpoint)",
            contentType,
            fetchUrl
          )
          return null
        }

        const run: WorkflowRun = await response.json()
        return run
      } catch (error) {
        console.error("[Workflow Storage] Failed to fetch blob URL %s:", blob.url, error)
        return null
      }
    })
  )

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
  let blobs: Awaited<ReturnType<typeof list>>["blobs"] = []
  try {
    ;({ blobs } = await list({ prefix }))
  } catch (error) {
    console.error(`[Workflow Storage] Failed to list blobs for ${prefix}:`, error)
    return null
  }

  // Search through all workflow blobs to find the matching run ID
  for (const blob of blobs) {
    try {
      // Use authenticated head() call to verify blob and get downloadUrl
      const blobInfo = await head(blob.url)
      if (!blobInfo || !blobInfo.contentType?.includes("application/json")) {
        continue
      }

      const fetchUrl = blobInfo.downloadUrl || blob.url
      const response = await fetchJsonWithRetry(fetchUrl)

      // Skip if response is HTML (security checkpoint)
      const contentType = response.headers.get("content-type")
      if (contentType && !contentType.includes("application/json")) {
        continue
      }

      const run: WorkflowRun = await response.json()
      if (run.id === runId && run.isPublic) {
        return run
      }
    } catch {
      // Skip invalid blobs
    }
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
    const urlsToDelete: string[] = []

    // Collect all blob URLs associated with this run
    // The workflow run JSON file
    const runPath = `workflows/${userId}/${run.timestamp}-${run.projectName}.json`
    const { blobs } = await list({ prefix: runPath })
    for (const blob of blobs) {
      urlsToDelete.push(blob.url)
    }

    // Screenshots
    if (run.beforeScreenshotUrl) {
      urlsToDelete.push(run.beforeScreenshotUrl)
    }
    if (run.afterScreenshotUrl) {
      urlsToDelete.push(run.afterScreenshotUrl)
    }

    // Report blob
    if (run.reportBlobUrl) {
      urlsToDelete.push(run.reportBlobUrl)
    }

    // Delete all collected URLs
    try {
      if (urlsToDelete.length > 0) {
        await del(urlsToDelete)
        console.log(`[Workflow Storage] Deleted ${urlsToDelete.length} blobs for run ${run.id}`)
      }
      deleted++
    } catch (error) {
      const errorMsg = `Failed to delete run ${run.id}: ${error instanceof Error ? error.message : String(error)}`
      console.error(`[Workflow Storage] ${errorMsg}`)
      errors.push(errorMsg)
    }
  }

  return { deleted, errors }
}
