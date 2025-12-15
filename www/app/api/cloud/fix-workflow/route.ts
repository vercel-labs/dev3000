import { start } from "workflow/api"
import { cloudFixWorkflow } from "./workflow"

/**
 * POST /api/cloud/fix-workflow
 * HTTP endpoint that starts the workflow using the Workflow SDK
 */
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { projectName, repoUrl, repoBranch } = body

    // Validate required fields
    if (!projectName) {
      return Response.json({ error: "Missing required field: projectName" }, { status: 400 })
    }

    if (!repoUrl) {
      return Response.json({ error: "Missing required field: repoUrl" }, { status: 400 })
    }

    console.log(`[API] Starting fix workflow for ${projectName}`)

    const workflowRun = await start(cloudFixWorkflow, [
      {
        repoUrl,
        repoBranch: repoBranch || "main",
        projectName
      }
    ])

    console.log("[API] Workflow started, waiting for completion...")

    // Wait for workflow to complete and get the Response
    const workflowResponse = await workflowRun.returnValue

    // Parse the result - the workflow returns a Response.json()
    const result = await workflowResponse.json()

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
