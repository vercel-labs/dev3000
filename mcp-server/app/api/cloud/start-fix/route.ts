import { start } from "workflow/api"
import { cloudFixWorkflow } from "../fix-workflow/route"

/**
 * API Route to Start Cloud Fix Workflow
 *
 * This endpoint uses the Workflow SDK's start() API to invoke the workflow
 * and waits for the result using run.returnValue, which includes the blob URL
 * where the fix proposal was uploaded.
 */
export async function POST(request: Request) {
  try {
    const { devUrl, projectName } = await request.json()

    console.log("[Start Fix] Starting cloud fix workflow...")
    console.log(`[Start Fix] Dev URL: ${devUrl}`)
    console.log(`[Start Fix] Project: ${projectName}`)

    // Start the workflow and get a Run object
    // Pass serializable data instead of Request object
    // The workflow will fetch real logs from the devUrl
    const run = await start(cloudFixWorkflow, [{ devUrl, projectName }])

    console.log(`[Start Fix] Workflow started, waiting for completion...`)

    // Wait for workflow to complete and get the Response
    const workflowResponse = await run.returnValue

    // Parse the JSON result from the Response
    const result = await workflowResponse.json()

    console.log(`[Start Fix] Workflow completed successfully`)
    if (result.blobUrl) {
      console.log(`[Start Fix] Fix proposal uploaded to: ${result.blobUrl}`)
    }

    return Response.json({
      success: true,
      message: "Cloud fix workflow completed successfully",
      projectName,
      blobUrl: result.blobUrl,
      fixProposal: result.fixProposal
    })
  } catch (error) {
    console.error("[Start Fix] Error running workflow:", error)
    return Response.json(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    )
  }
}
