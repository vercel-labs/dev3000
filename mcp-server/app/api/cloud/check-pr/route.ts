import { start } from "workflow/api"
// @ts-expect-error - Workflow file is resolved at runtime by Next.js
import { cloudCheckPRWorkflow } from "../../../workflows/check-pr"

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

    // Start the workflow with array of arguments (not an object)
    const workflowRun = await start(cloudCheckPRWorkflow, [
      previewUrl,
      prTitle,
      prBody || "",
      changedFiles || [],
      repoOwner,
      repoName,
      String(prNumber)
    ])

    console.log(`[API] Workflow started`)

    // Get the workflow return value using returnValue (not result())
    const result = await workflowRun.returnValue

    console.log(`[API] Workflow completed successfully`)

    return Response.json(result)
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
