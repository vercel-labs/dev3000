import { start } from "workflow/api"
import { cloudFixWorkflow } from "./workflow"

/**
 * POST /api/cloud/fix-workflow
 * HTTP endpoint that starts the workflow using the Workflow SDK
 */
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { devUrl, projectName, repoOwner, repoName, baseBranch } = body

    // Validate required fields
    if (!devUrl || !projectName) {
      return Response.json({ error: "Missing required fields: devUrl, projectName" }, { status: 400 })
    }

    console.log(`[API] Starting fix workflow for ${projectName}`)

    // Start the workflow using the Workflow SDK
    // @ts-expect-error - Workflow SDK types are incomplete
    const workflowRun = await start(cloudFixWorkflow, {
      devUrl,
      projectName,
      repoOwner,
      repoName,
      baseBranch: baseBranch || "main"
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
