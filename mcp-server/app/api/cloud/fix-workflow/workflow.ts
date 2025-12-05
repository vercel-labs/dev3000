/**
 * Cloud Fix Workflow Function - Core workflow logic
 *
 * This file contains ONLY the workflow function and step wrappers.
 * It does NOT import workflow/api to avoid bundler issues.
 */

/**
 * Main workflow function that orchestrates the fix process
 */
export async function cloudFixWorkflow(params: {
  devUrl: string
  projectName: string
  vercelToken?: string
  vercelOidcToken?: string
  repoOwner?: string
  repoName?: string
  baseBranch?: string
  bypassToken?: string
  repoUrl?: string
  repoBranch?: string
  runId?: string // For progress tracking
  userId?: string // For progress tracking
}) {
  "use workflow"

  const {
    devUrl,
    projectName,
    vercelToken,
    vercelOidcToken: vercelOidcTokenParam,
    repoOwner,
    repoName,
    baseBranch = "main",
    bypassToken,
    repoUrl,
    repoBranch,
    runId,
    userId
  } = params
  const timestamp = new Date().toISOString()

  console.log("[Workflow] Starting cloud fix workflow...")
  console.log(`[Workflow] Dev URL: ${devUrl}`)
  console.log(`[Workflow] Project: ${projectName}`)
  console.log(`[Workflow] Timestamp: ${new Date().toISOString()}`)
  console.log(`[Workflow] Bypass Token: ${bypassToken ? "provided" : "not provided"}`)
  if (repoOwner && repoName) {
    console.log(`[Workflow] GitHub Repo: ${repoOwner}/${repoName}`)
    console.log(`[Workflow] Base Branch: ${baseBranch}`)
  }
  if (repoUrl) {
    console.log(`[Workflow] Will create sandbox from: ${repoUrl}`)
    console.log(`[Workflow] Branch: ${repoBranch || "main"}`)
  }

  // Use VERCEL_OIDC_TOKEN from params (passed from request header) or fall back to env
  // At runtime, OIDC token is in x-vercel-oidc-token header, not process.env
  const vercelOidcToken = vercelOidcTokenParam || process.env.VERCEL_OIDC_TOKEN
  console.log(`[Workflow] VERCEL_OIDC_TOKEN from param: ${!!vercelOidcTokenParam}`)
  console.log(`[Workflow] VERCEL_OIDC_TOKEN from env: ${!!process.env.VERCEL_OIDC_TOKEN}`)
  console.log(`[Workflow] VERCEL_OIDC_TOKEN available: ${!!vercelOidcToken}`)

  // Helper to update progress if tracking is enabled
  const updateProgress = async (stepNumber: number, currentStep: string, sandboxUrl?: string) => {
    if (runId && userId) {
      await updateWorkflowProgressStep(userId, runId, projectName, timestamp, stepNumber, currentStep, sandboxUrl)
    }
  }

  // Step 0: Create d3k sandbox if repoUrl provided
  // This step also captures CLS data, "before" screenshot, and git diff from inside the sandbox
  let sandboxInfo: {
    mcpUrl: string
    devUrl: string
    bypassToken?: string
    clsData?: unknown
    mcpError?: string | null
    beforeScreenshotUrl?: string | null
    chromiumPath?: string
    gitDiff?: string | null
  } | null = null
  if (repoUrl) {
    await updateProgress(0, "Creating development sandbox...")
    sandboxInfo = await createD3kSandbox(repoUrl, repoBranch || "main", projectName, vercelToken, vercelOidcToken)
    if (sandboxInfo?.devUrl) {
      await updateProgress(0, "Sandbox ready, analyzing...", sandboxInfo.devUrl)
    }
  }

  // Step 1: Fetch real logs (using sandbox MCP if available, otherwise devUrl directly)
  // If we got CLS data from Step 0, pass it to Step 1 to avoid re-fetching
  // Use bypass token from sandbox if available, otherwise use provided one
  // Also pass the beforeScreenshotUrl from Step 0 if available
  await updateProgress(1, "Fetching logs and analyzing errors...")
  const effectiveBypassToken = sandboxInfo?.bypassToken || bypassToken
  const step1Result = await fetchRealLogs(
    sandboxInfo?.mcpUrl || devUrl,
    effectiveBypassToken,
    sandboxInfo?.devUrl,
    sandboxInfo?.clsData,
    sandboxInfo?.mcpError,
    sandboxInfo?.beforeScreenshotUrl
  )
  const { logAnalysis, beforeScreenshotUrl } = step1Result

  // Step 2: Invoke AI agent to analyze logs and create fix
  await updateProgress(2, "AI analyzing logs and generating fixes...")
  const fixProposal = await analyzeLogsWithAgent(logAnalysis, sandboxInfo?.devUrl || devUrl)

  // Step 3: Upload to blob storage with full context, screenshot, and git diff
  await updateProgress(3, "Uploading report to storage...")
  const blobResult = await uploadToBlob(
    fixProposal,
    projectName,
    logAnalysis,
    sandboxInfo?.devUrl || devUrl,
    beforeScreenshotUrl,
    sandboxInfo?.gitDiff
  )

  // Step 4: Create GitHub PR if repo info provided AND there are actual fixes to apply
  let prResult = null
  const hasGitPatch = fixProposal.includes("```diff")
  if (repoOwner && repoName && hasGitPatch) {
    await updateProgress(4, "Creating GitHub PR with fixes...")
    prResult = await createGitHubPR(fixProposal, blobResult.blobUrl, repoOwner, repoName, baseBranch, projectName)
  } else if (repoOwner && repoName && !hasGitPatch) {
    console.log("[Workflow] No git patch found - skipping PR creation (system is healthy)")
  }

  // Note: Sandbox cleanup is handled automatically by the sandbox timeout
  // We cannot store cleanup functions as they're not serializable

  return Response.json({
    ...blobResult,
    pr: prResult
  })
}

// Step function wrappers that dynamically import the actual implementations
async function createD3kSandbox(
  repoUrl: string,
  branch: string,
  projectName: string,
  vercelToken?: string,
  vercelOidcToken?: string
) {
  "use step"
  const { createD3kSandbox } = await import("./steps")
  return createD3kSandbox(repoUrl, branch, projectName, vercelToken, vercelOidcToken)
}

async function fetchRealLogs(
  mcpUrlOrDevUrl: string,
  bypassToken?: string,
  sandboxDevUrl?: string,
  clsData?: unknown,
  mcpError?: string | null,
  beforeScreenshotUrlFromStep0?: string | null
): Promise<{ logAnalysis: string; beforeScreenshotUrl: string | null }> {
  "use step"
  const { fetchRealLogs } = await import("./steps")
  return fetchRealLogs(mcpUrlOrDevUrl, bypassToken, sandboxDevUrl, clsData, mcpError, beforeScreenshotUrlFromStep0)
}

async function analyzeLogsWithAgent(logAnalysis: string, devUrl: string) {
  "use step"
  const { analyzeLogsWithAgent } = await import("./steps")
  return analyzeLogsWithAgent(logAnalysis, devUrl)
}

async function uploadToBlob(
  fixProposal: string,
  projectName: string,
  logAnalysis: string,
  devUrl: string,
  beforeScreenshotUrl?: string | null,
  gitDiff?: string | null
) {
  "use step"
  const { uploadToBlob } = await import("./steps")
  return uploadToBlob(fixProposal, projectName, logAnalysis, devUrl, beforeScreenshotUrl, gitDiff)
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

// Step wrapper for updating workflow progress (uses dynamic import like other steps)
async function updateWorkflowProgressStep(
  userId: string,
  runId: string,
  projectName: string,
  timestamp: string,
  stepNumber: number,
  currentStep: string,
  sandboxUrl?: string
) {
  "use step"
  const { updateWorkflowProgress } = await import("@/lib/workflow-storage")
  return updateWorkflowProgress(userId, runId, projectName, timestamp, stepNumber, currentStep, sandboxUrl)
}
