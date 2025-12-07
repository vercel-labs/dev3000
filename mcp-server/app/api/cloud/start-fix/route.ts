import { randomUUID } from "crypto"
import { start } from "workflow/api"
import { saveWorkflowRun } from "@/lib/workflow-storage"
import { cloudFixWorkflow } from "../fix-workflow/workflow"

/**
 * API Route to Start Cloud Fix Workflow
 *
 * This endpoint uses the Workflow SDK's start() API to invoke the workflow
 * and waits for the result using run.returnValue, which includes the blob URL
 * where the fix proposal was uploaded.
 */

// Configure longer timeout for workflow execution (10 minutes)
export const maxDuration = 600

// CORS headers - allowing credentials from localhost
const corsHeaders = {
  "Access-Control-Allow-Origin": "http://localhost:3000",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Credentials": "true"
}

// Handle OPTIONS preflight request
export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders
  })
}

export async function POST(request: Request) {
  let userId: string | undefined
  let projectName: string | undefined
  let runId: string | undefined

  try {
    // Get user's access token from cookies or Authorization header
    const { cookies: getCookies } = await import("next/headers")
    const cookieStore = await getCookies()
    let accessToken = cookieStore.get("access_token")?.value

    // Fallback to Authorization header for cross-origin requests
    if (!accessToken) {
      const authHeader = request.headers.get("Authorization")
      if (authHeader?.startsWith("Bearer ")) {
        accessToken = authHeader.substring(7)
      }
    }

    if (!accessToken) {
      return Response.json(
        { success: false, error: "Not authenticated. Please sign in to use workflows." },
        { status: 401, headers: corsHeaders }
      )
    }

    // Get VERCEL_OIDC_TOKEN from request header (runtime token)
    const vercelOidcToken = request.headers.get("x-vercel-oidc-token") || process.env.VERCEL_OIDC_TOKEN
    console.log(`[Start Fix] VERCEL_OIDC_TOKEN available: ${!!vercelOidcToken}`)

    const body = await request.json()
    const { devUrl, repoOwner, repoName, baseBranch, bypassToken, repoUrl, repoBranch } = body
    userId = body.userId
    projectName = body.projectName

    console.log("[Start Fix] Starting cloud fix workflow...")
    console.log(`[Start Fix] Dev URL: ${devUrl}`)
    console.log(`[Start Fix] Project: ${projectName}`)
    console.log(`[Start Fix] User ID: ${userId}`)
    console.log(`[Start Fix] Bypass Token: ${bypassToken ? "provided" : "not provided"}`)
    if (repoUrl) {
      console.log(`[Start Fix] Will create sandbox from: ${repoUrl}`)
      console.log(`[Start Fix] Branch: ${repoBranch || "main"}`)
    }
    if (repoOwner && repoName) {
      console.log(`[Start Fix] GitHub: ${repoOwner}/${repoName} (base: ${baseBranch || "main"})`)
    }

    // Start the workflow and get a Run object
    // Pass serializable data instead of Request object
    // The workflow will fetch real logs from the devUrl and optionally create a PR
    const workflowParams: Parameters<typeof cloudFixWorkflow>[0] = {
      devUrl,
      projectName,
      vercelToken: accessToken, // Pass user's access token for sandbox creation
      vercelOidcToken, // Pass OIDC token from request header for sandbox creation
      ...(repoOwner && { repoOwner }),
      ...(repoName && { repoName }),
      ...(baseBranch && { baseBranch }),
      ...(bypassToken && { bypassToken }),
      ...(repoUrl && { repoUrl }),
      ...(repoBranch && { repoBranch })
    }

    // Save workflow run metadata at start if userId and projectName provided
    if (userId && projectName) {
      runId = randomUUID()
      await saveWorkflowRun({
        id: runId,
        userId,
        projectName,
        timestamp: new Date().toISOString(),
        status: "running",
        currentStep: "Starting workflow...",
        stepNumber: 0
      })
      console.log(`[Start Fix] Saved workflow run metadata (running): ${runId}`)
    }

    // Pass runId and userId to workflow for progress tracking
    const workflowParamsWithTracking = {
      ...workflowParams,
      runId,
      userId
    }

    const run = await start(cloudFixWorkflow, [workflowParamsWithTracking])

    console.log(`[Start Fix] Workflow started, waiting for completion...`)

    // Wait for workflow to complete and get the Response
    const workflowResponse = await run.returnValue

    // Parse the JSON result from the Response
    const result = await workflowResponse.json()

    console.log(`[Start Fix] Workflow completed successfully`)
    if (result.blobUrl) {
      console.log(`[Start Fix] Fix proposal uploaded to: ${result.blobUrl}`)
    }
    if (result.pr?.prUrl) {
      console.log(`[Start Fix] GitHub PR created: ${result.pr.prUrl}`)
    }

    // Update workflow run metadata with success status
    if (userId && projectName && runId) {
      await saveWorkflowRun({
        id: runId,
        userId,
        projectName,
        timestamp: new Date().toISOString(),
        status: "done",
        reportBlobUrl: result.blobUrl,
        prUrl: result.pr?.prUrl,
        beforeScreenshotUrl: result.beforeScreenshotUrl || undefined
      })
      console.log(`[Start Fix] Updated workflow run metadata to done: ${runId}`)
    }

    return Response.json(
      {
        success: true,
        message: "Cloud fix workflow completed successfully",
        projectName,
        runId,
        blobUrl: result.blobUrl,
        fixProposal: result.fixProposal,
        pr: result.pr
      },
      {
        headers: corsHeaders
      }
    )
  } catch (error) {
    console.error("[Start Fix] Error running workflow:", error)

    // Update workflow run metadata with failure status
    if (userId && projectName && runId) {
      await saveWorkflowRun({
        id: runId,
        userId,
        projectName,
        timestamp: new Date().toISOString(),
        status: "failure",
        error: error instanceof Error ? error.message : String(error)
      }).catch((err) => console.error("[Start Fix] Failed to save error metadata:", err))
      console.log(`[Start Fix] Updated workflow run metadata to failure: ${runId}`)
    }

    return Response.json(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      },
      { status: 500, headers: corsHeaders }
    )
  }
}
