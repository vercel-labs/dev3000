import { start } from "workflow/api"
import { clearWorkflowLog, workflowError, workflowLog } from "@/lib/workflow-logger"
import { saveWorkflowRun, type WorkflowType } from "@/lib/workflow-storage"
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

function isPrivateOrLocalHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase()
  if (normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1") return true
  if (normalized.endsWith(".local")) return true

  const parts = normalized.split(".")
  if (parts.length === 4 && parts.every((part) => /^\d+$/.test(part))) {
    const [a, b] = parts.map((part) => Number.parseInt(part, 10))
    if (a === 10) return true
    if (a === 127) return true
    if (a === 169 && b === 254) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
  }

  return false
}

async function validatePublicUrl(
  input: string
): Promise<{ ok: true; normalizedUrl: string } | { ok: false; error: string }> {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    return { ok: false, error: "Invalid URL format" }
  }

  if (url.protocol !== "https:") {
    return { ok: false, error: "URL must use https://" }
  }

  if (isPrivateOrLocalHost(url.hostname)) {
    return { ok: false, error: "URL must be publicly reachable (not localhost/private network)" }
  }

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8000)
    const response = await fetch(url.toString(), {
      method: "GET",
      redirect: "follow",
      signal: controller.signal
    })
    clearTimeout(timeout)

    if (!response.ok) {
      return { ok: false, error: `URL responded with HTTP ${response.status}` }
    }

    return { ok: true, normalizedUrl: response.url }
  } catch (error) {
    return { ok: false, error: `Could not reach URL: ${error instanceof Error ? error.message : String(error)}` }
  }
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
  let workflowType: WorkflowType = "cls-fix"
  let customPrompt: string | undefined
  let crawlDepth: number | "all" | undefined
  let analysisTargetType: "vercel-project" | "url" = "vercel-project"
  let publicUrl: string | undefined

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
    const {
      devUrl,
      repoOwner,
      repoName,
      baseBranch,
      bypassToken,
      repoUrl,
      repoBranch,
      githubPat,
      startPath,
      productionUrl,
      projectDir
    } = body
    // Validate workflowType is a valid WorkflowType
    const validWorkflowTypes: WorkflowType[] = [
      "cls-fix",
      "prompt",
      "design-guidelines",
      "react-performance",
      "url-audit",
      "turbopack-bundle-analyzer"
    ]
    if (body.workflowType && validWorkflowTypes.includes(body.workflowType)) {
      workflowType = body.workflowType
    }
    analysisTargetType =
      body.analysisTargetType === "url" ||
      workflowType === "url-audit" ||
      (typeof body.publicUrl === "string" && body.publicUrl.trim().length > 0)
        ? "url"
        : "vercel-project"
    publicUrl = typeof body.publicUrl === "string" ? body.publicUrl : undefined
    customPrompt = body.customPrompt
    crawlDepth = body.crawlDepth
    userId = body.userId || (isTestMode ? "test-user" : undefined)
    projectName = body.projectName

    if (analysisTargetType === "url") {
      if (!publicUrl) {
        return Response.json(
          { success: false, error: "publicUrl is required for URL analysis" },
          { status: 400, headers: corsHeaders }
        )
      }
      const validation = await validatePublicUrl(publicUrl)
      if (!validation.ok) {
        return Response.json({ success: false, error: validation.error }, { status: 400, headers: corsHeaders })
      }
      publicUrl = validation.normalizedUrl
      const hostname = new URL(publicUrl).hostname
      projectName = projectName || `url-audit-${hostname}`
    }

    workflowLog("[Start Fix] Starting cloud fix workflow...")
    workflowLog(`[Start Fix] Dev URL: ${devUrl}`)
    workflowLog(`[Start Fix] Project: ${projectName}`)
    workflowLog(`[Start Fix] User ID: ${userId}`)
    workflowLog(`[Start Fix] Start Path: ${startPath || "/"}`)
    workflowLog(`[Start Fix] Bypass Token: ${bypassToken ? "provided" : "not provided"}`)
    workflowLog(`[Start Fix] GitHub PAT: ${githubPat ? "provided" : "not provided"}`)
    if (repoUrl) {
      workflowLog(`[Start Fix] Will create sandbox from: ${repoUrl}`)
      workflowLog(`[Start Fix] Branch: ${repoBranch || "main"}`)
    }
    if (publicUrl) {
      workflowLog(`[Start Fix] Public URL: ${publicUrl}`)
    }
    if (repoOwner && repoName) {
      workflowLog(`[Start Fix] GitHub: ${repoOwner}/${repoName} (base: ${baseBranch || "main"})`)
    }
    if (productionUrl) {
      workflowLog(`[Start Fix] Production URL: ${productionUrl}`)
    }

    // Validate required fields for v2 workflow
    if (analysisTargetType !== "url" && !repoUrl) {
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

    // Generate runId BEFORE starting workflow (following workflow-builder-template pattern)
    // The SDK's start() doesn't reliably return an id, so we generate our own
    runId = `d3k_${crypto.randomUUID()}`
    runTimestamp = new Date().toISOString()

    console.log(`[Start Fix] Generated runId: ${runId}`)
    console.log(`[Start Fix] userId: ${userId}, projectName: ${projectName}`)

    // V2 workflow params - simplified "local-style" architecture
    const workflowParams = {
      repoUrl:
        analysisTargetType === "url"
          ? (repoUrl as string | undefined) || "https://github.com/vercel-labs/dev3000"
          : repoUrl,
      repoBranch: repoBranch || baseBranch || "main",
      projectDir:
        analysisTargetType === "url"
          ? (projectDir as string | undefined) || "example-apps/nextjs-test-app"
          : projectDir,
      projectName,
      vercelOidcToken,
      runId, // Pass runId to workflow for tracking
      userId, // For progress updates
      timestamp: runTimestamp, // For progress updates
      workflowType, // For progress updates
      analysisTargetType,
      publicUrl,
      startPath: startPath || "/", // Page path to analyze (e.g., "/about")
      customPrompt: workflowType === "prompt" ? customPrompt : undefined, // User's custom instructions
      crawlDepth: workflowType === "design-guidelines" ? crawlDepth : undefined, // Crawl depth for design-guidelines
      // PR creation params
      githubPat,
      repoOwner,
      repoName,
      baseBranch: baseBranch || "main",
      // For before/after screenshots in PR
      productionUrl
    }

    // Save workflow run metadata NOW - runId is guaranteed (either from SDK or fallback UUID)
    // userId and projectName are validated above
    if (userId && projectName) {
      try {
        await saveWorkflowRun({
          id: runId,
          userId,
          projectName,
          timestamp: runTimestamp,
          status: "running",
          type: workflowType,
          currentStep: "Step 1: Initializing sandbox...",
          stepNumber: 1,
          customPrompt: workflowType === "prompt" ? customPrompt : undefined
        })
        console.log(`[Start Fix] Saved workflow run metadata (running): ${runId}`)
      } catch (saveError) {
        console.error(`[Start Fix] ERROR saving workflow metadata:`, saveError)
        // Continue even if save fails - the workflow should still run
      }
    } else {
      console.error(`[Start Fix] Cannot save - missing userId (${!!userId}) or projectName (${!!projectName})`)
    }

    // Start the workflow (fire-and-forget style)
    // The workflow will update its own status to "done" or "failure" when complete
    // If startup fails, mark the run as failure so it doesn't stay stuck at "running".
    void start(cloudFixWorkflow, [workflowParams]).catch(async (startError) => {
      workflowError("[Start Fix] Failed to enqueue workflow:", startError)

      if (userId && projectName && runId && runTimestamp) {
        await saveWorkflowRun({
          id: runId,
          userId,
          projectName,
          timestamp: runTimestamp,
          status: "failure",
          type: workflowType,
          completedAt: new Date().toISOString(),
          error: startError instanceof Error ? startError.message : String(startError),
          customPrompt: workflowType === "prompt" ? customPrompt : undefined
        }).catch((err) => workflowError("[Start Fix] Failed to save startup failure metadata:", err))
      }
    })

    workflowLog(`[Start Fix] Workflow started with runId: ${runId}`)

    // Return immediately - the workflow runs in the background
    // Client should poll /api/workflows to track progress
    workflowLog(`[Start Fix] Returning immediately, workflow running in background`)

    return Response.json(
      {
        success: true,
        message: "Workflow started successfully",
        projectName,
        runId,
        // Debug info to verify metadata was saved
        _debug: {
          userId,
          runIdGenerated: true
        }
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
        type: workflowType,
        completedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
        customPrompt: workflowType === "prompt" ? customPrompt : undefined
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
