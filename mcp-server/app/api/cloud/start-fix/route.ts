import { start } from "workflow/api"
import { POST as cloudFixWorkflow } from "../fix-workflow/route"

/**
 * API Route to Start Cloud Fix Workflow
 *
 * This endpoint can be called via standard HTTP POST and uses the Workflow SDK's
 * start() function to invoke the durable workflow asynchronously.
 */
export async function POST(request: Request) {
  try {
    const { logAnalysis, devUrl, projectName } = await request.json()

    console.log("[Start Fix] Starting cloud fix workflow...")
    console.log(`[Start Fix] Dev URL: ${devUrl}`)
    console.log(`[Start Fix] Project: ${projectName}`)
    console.log(`[Start Fix] Log analysis length: ${logAnalysis?.length || 0} chars`)

    // Use the Workflow SDK's start() function to invoke the workflow
    // The workflow will run asynchronously and durably
    await start(cloudFixWorkflow, [
      new Request(request.url, {
        method: "POST",
        headers: request.headers,
        body: JSON.stringify({ logAnalysis, devUrl, projectName })
      })
    ])

    return Response.json({
      success: true,
      message: "Cloud fix workflow started successfully",
      projectName
    })
  } catch (error) {
    console.error("[Start Fix] Error starting workflow:", error)
    return Response.json(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    )
  }
}
