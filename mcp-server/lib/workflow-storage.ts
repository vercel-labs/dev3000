import { list, put } from "@vercel/blob"

export interface WorkflowRun {
  id: string
  userId: string
  projectName: string
  timestamp: string
  status: "running" | "success" | "failure"
  reportBlobUrl?: string
  prUrl?: string
  error?: string
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
