import { POST as cloudFixWorkflow } from "../fix-workflow/route"

/**
 * API Route to Start Cloud Fix Workflow
 *
 * This endpoint calls the durable workflow directly and waits for the result,
 * which includes the blob URL where the fix proposal was uploaded.
 */
export async function POST(request: Request) {
  try {
    const { logAnalysis, devUrl, projectName } = await request.json()

    console.log("[Start Fix] Starting cloud fix workflow...")
    console.log(`[Start Fix] Dev URL: ${devUrl}`)
    console.log(`[Start Fix] Project: ${projectName}`)
    console.log(`[Start Fix] Log analysis length: ${logAnalysis?.length || 0} chars`)

    // Call the workflow directly to get the result including blob URL
    const workflowRequest = new Request(request.url, {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify({ logAnalysis, devUrl, projectName })
    })

    const workflowResponse = await cloudFixWorkflow(workflowRequest)
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
