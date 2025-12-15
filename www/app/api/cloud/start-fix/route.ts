import { start } from "workflow/api"
import { clearWorkflowLog, workflowError, workflowLog } from "@/lib/workflow-logger"
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
  let runTimestamp: string | undefined

  try {
    // Check for test bypass token (allows testing without browser auth via CLI)
    const testBypassToken = request.headers.get("x-test-bypass-token")
    const isTestMode =
      testBypassToken === process.env.WORKFLOW_TEST_BYPASS_TOKEN && process.env.WORKFLOW_TEST_BYPASS_TOKEN

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

    if (!accessToken && !isTestMode) {
      return Response.json(
        { success: false, error: "Not authenticated. Please sign in to use workflows." },
        { status: 401, headers: corsHeaders }
      )
    }

    if (isTestMode) {
      workflowLog("[Start Fix] Running in TEST MODE with bypass token")
    }

    // Clear workflow log file at start of new workflow
    clearWorkflowLog()

    // Get VERCEL_OIDC_TOKEN from request header (runtime token)
    const vercelOidcToken = request.headers.get("x-vercel-oidc-token") || process.env.VERCEL_OIDC_TOKEN
    workflowLog(`[Start Fix] VERCEL_OIDC_TOKEN available: ${!!vercelOidcToken}`)

    const body = await request.json()
    const { devUrl, repoOwner, repoName, baseBranch, bypassToken, repoUrl, repoBranch } = body
    userId = body.userId || (isTestMode ? "test-user" : undefined)
    projectName = body.projectName

    workflowLog("[Start Fix] Starting cloud fix workflow...")
    workflowLog(`[Start Fix] Dev URL: ${devUrl}`)
    workflowLog(`[Start Fix] Project: ${projectName}`)
    workflowLog(`[Start Fix] User ID: ${userId}`)
    workflowLog(`[Start Fix] Bypass Token: ${bypassToken ? "provided" : "not provided"}`)
    if (repoUrl) {
      workflowLog(`[Start Fix] Will create sandbox from: ${repoUrl}`)
      workflowLog(`[Start Fix] Branch: ${repoBranch || "main"}`)
    }
    if (repoOwner && repoName) {
      workflowLog(`[Start Fix] GitHub: ${repoOwner}/${repoName} (base: ${baseBranch || "main"})`)
    }

    // Validate required fields for v2 workflow
    if (!repoUrl) {
      return Response.json(
        { success: false, error: "repoUrl is required for the workflow" },
        { status: 400, headers: corsHeaders }
      )
    }

    if (!projectName) {
      return Response.json(
        { success: false, error: "projectName is required for the workflow" },
        { status: 400, headers: corsHeaders }
      )
    }

    // V2 workflow params - simplified "local-style" architecture
    // Note: runId will be set after start() returns the Vercel workflow ID
    const workflowParams = {
      repoUrl,
      repoBranch: repoBranch || baseBranch || "main",
      projectName,
      vercelOidcToken
    }

    // Start the workflow first - this gives us the Vercel runId
    const run = await start(cloudFixWorkflow, [workflowParams])

    // Get the Vercel workflow runId (e.g., "wrun_01KCHS4GR00...")
    // @ts-expect-error - run.id exists at runtime but may not be in types
    runId = run.id as string
    runTimestamp = new Date().toISOString()

    workflowLog(`[Start Fix] Workflow started with Vercel runId: ${runId}`)
    workflowLog(`[Start Fix] Debug - userId: ${userId}, projectName: ${projectName}, runId: ${runId}`)
    workflowLog(`[Start Fix] Debug - run object keys: ${Object.keys(run).join(", ")}`)

    // Save workflow run metadata NOW that we have the Vercel runId
    if (userId && projectName && runId) {
      await saveWorkflowRun({
        id: runId,
        userId,
        projectName,
        timestamp: runTimestamp,
        status: "running",
        currentStep: "Step 1: Initializing sandbox...",
        stepNumber: 1
      })
      workflowLog(`[Start Fix] Saved workflow run metadata (running): ${runId}`)
    }

    // Wait for workflow to complete and get the Response
    const workflowResponse = await run.returnValue

    // Parse the JSON result from the Response
    const result = await workflowResponse.json()

    workflowLog(`[Start Fix] Workflow completed successfully`)
    if (result.blobUrl) {
      workflowLog(`[Start Fix] Fix proposal uploaded to: ${result.blobUrl}`)
    }
    if (result.pr?.prUrl) {
      workflowLog(`[Start Fix] GitHub PR created: ${result.pr.prUrl}`)
    }

    // Update workflow run metadata with success status (use same timestamp to overwrite)
    if (userId && projectName && runId && runTimestamp) {
      await saveWorkflowRun({
        id: runId,
        userId,
        projectName,
        timestamp: runTimestamp,
        status: "done",
        completedAt: new Date().toISOString(),
        reportBlobUrl: result.blobUrl,
        prUrl: result.pr?.prUrl,
        beforeScreenshotUrl: result.beforeScreenshotUrl || undefined
      })
      workflowLog(`[Start Fix] Updated workflow run metadata to done: ${runId}`)
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
    workflowError("[Start Fix] Error running workflow:", error)

    // Update workflow run metadata with failure status (use same timestamp to overwrite)
    if (userId && projectName && runId && runTimestamp) {
      await saveWorkflowRun({
        id: runId,
        userId,
        projectName,
        timestamp: runTimestamp,
        status: "failure",
        completedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error)
      }).catch((err) => workflowError("[Start Fix] Failed to save error metadata:", err))
      workflowLog(`[Start Fix] Updated workflow run metadata to failure: ${runId}`)
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
