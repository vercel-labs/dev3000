import { start } from "workflow/api"
import { cloudCheckPRWorkflow } from "./workflow"

/**
 * POST /api/cloud/check-pr
 * HTTP endpoint that starts the workflow
 */
export async function POST(request: Request) {
  try {
    const body = await request.json()

    const { previewUrl, prTitle, prBody, changedFiles, repoOwner, repoName, prNumber } = body

    // Validate required fields
    if (!previewUrl || !prTitle || !repoOwner || !repoName || !prNumber) {
      return Response.json({ error: "Missing required fields" }, { status: 400 })
    }

    console.log(`[API] Starting PR check for ${repoOwner}/${repoName}#${prNumber}`)

    // Start the workflow
    // @ts-expect-error - Workflow SDK types are incomplete
    const workflowRun = await start(cloudCheckPRWorkflow, {
      previewUrl,
      prTitle,
      prBody: prBody || "",
      changedFiles: changedFiles || [],
      repoOwner,
      repoName,
      prNumber: String(prNumber)
    })

    // @ts-expect-error - Workflow SDK types are incomplete
    console.log(`[API] Workflow started: ${workflowRun.id}`)

    // Wait for workflow to complete (workflows are durable and will continue even if this times out)
    // @ts-expect-error - Workflow SDK types are incomplete
    const result = await workflowRun.result()

    console.log(`[API] Workflow completed: ${result.status}`)

    return result
  } catch (error) {
    console.error("[API] Error starting workflow:", error)
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Unknown error",
        details: error instanceof Error ? error.stack : undefined
      },
      { status: 500 }
    )
  }
}
