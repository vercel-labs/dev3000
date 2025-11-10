import { start } from "workflow/api"

/**
 * Cloud Fix Workflow Function - Core workflow logic
 *
 * This is the actual workflow that can be invoked via start() from the Workflow SDK.
 * Accepts serializable parameters and returns a Response.
 */
export async function cloudFixWorkflow(params: {
  devUrl: string
  projectName: string
  repoOwner?: string
  repoName?: string
  baseBranch?: string
}) {
  "use workflow"

  const { devUrl, projectName, repoOwner, repoName, baseBranch = "main" } = params

  console.log("[Workflow] Starting cloud fix workflow...")
  console.log(`[Workflow] Dev URL: ${devUrl}`)
  console.log(`[Workflow] Project: ${projectName}`)
  console.log(`[Workflow] Timestamp: ${new Date().toISOString()}`)
  if (repoOwner && repoName) {
    console.log(`[Workflow] GitHub Repo: ${repoOwner}/${repoName}`)
    console.log(`[Workflow] Base Branch: ${baseBranch}`)
  }

  // Step 1: Fetch real logs from the dev URL
  const logAnalysis = await fetchRealLogs(devUrl)

  // Step 2: Invoke AI agent to analyze logs and create fix
  const fixProposal = await analyzeLogsWithAgent(logAnalysis, devUrl)

  // Step 3: Upload to blob storage with full context
  const blobResult = await uploadToBlob(fixProposal, projectName, logAnalysis, devUrl)

  // Step 4: Create GitHub PR if repo info provided
  let prResult = null
  if (repoOwner && repoName) {
    prResult = await createGitHubPR(fixProposal, blobResult.blobUrl, repoOwner, repoName, baseBranch, projectName)
  }

  return Response.json({
    ...blobResult,
    pr: prResult
  })
}

// Step function wrappers that dynamically import the actual implementations
async function fetchRealLogs(devUrl: string) {
  "use step"
  const { fetchRealLogs } = await import("./steps")
  return fetchRealLogs(devUrl)
}

async function analyzeLogsWithAgent(logAnalysis: string, devUrl: string) {
  "use step"
  const { analyzeLogsWithAgent } = await import("./steps")
  return analyzeLogsWithAgent(logAnalysis, devUrl)
}

async function uploadToBlob(fixProposal: string, projectName: string, logAnalysis: string, devUrl: string) {
  "use step"
  const { uploadToBlob } = await import("./steps")
  return uploadToBlob(fixProposal, projectName, logAnalysis, devUrl)
}

async function createGitHubPR(
  fixProposal: string,
  blobUrl: string,
  repoOwner: string,
  repoName: string,
  baseBranch: string,
  projectName: string
) {
  "use step"
  const { createGitHubPR } = await import("./steps")
  return createGitHubPR(fixProposal, blobUrl, repoOwner, repoName, baseBranch, projectName)
}

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
