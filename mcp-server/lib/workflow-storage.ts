import { del, list, put } from "@vercel/blob"

export interface WorkflowRun {
  id: string
  userId: string
  projectName: string
  timestamp: string
  status: "running" | "done" | "failure"
  reportBlobUrl?: string
  prUrl?: string
  error?: string
  beforeScreenshotUrl?: string
  afterScreenshotUrl?: string
}

/**
 * Save a workflow run to blob storage
 * Path format: workflows/{userId}/{timestamp}-{projectName}.json
 */
export async function saveWorkflowRun(run: WorkflowRun): Promise<string> {
  const path = `workflows/${run.userId}/${run.timestamp}-${run.projectName}.json`

  const blob = await put(path, JSON.stringify(run, null, 2), {
    access: "public",
    addRandomSuffix: false
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

  const { blobs } = await list({ prefix })

  // Fetch and parse each blob
  const runs = await Promise.all(
    blobs.map(async (blob) => {
      try {
        const response = await fetch(blob.url)
        const run: WorkflowRun = await response.json()
        return run
      } catch (error) {
        console.error(`[Workflow Storage] Failed to fetch ${blob.url}:`, error)
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
