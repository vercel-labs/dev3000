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
  // This step also captures CLS data, "before" screenshot, git diff, and d3k artifacts from inside the sandbox
  // It also saves an initial report to blob storage so we have data even if later steps fail
  let sandboxInfo: {
    mcpUrl: string
    devUrl: string
    bypassToken?: string
    clsData?: unknown
    mcpError?: string | null
    beforeScreenshotUrl?: string | null
    chromiumPath?: string
    gitDiff?: string | null
    d3kArtifacts?: {
      clsScreenshots: Array<{ label: string; blobUrl: string; timestamp: number }>
      screencastSessionId: string | null
      fullLogs: string | null
      metadata: Record<string, unknown> | null
    }
    reportId?: string
    reportBlobUrl?: string
    agentAnalysis?: string | null
  } | null = null
  if (repoUrl) {
    await updateProgress(0, "Creating development sandbox...")
    sandboxInfo = await createD3kSandbox(
      repoUrl,
      repoBranch || "main",
      projectName,
      vercelToken,
      vercelOidcToken,
      runId // Pass runId so Step 0 can save the initial report with consistent ID
    )
    if (sandboxInfo?.devUrl) {
      await updateProgress(0, "Sandbox ready, capturing CLS metrics...", sandboxInfo.devUrl)
    }
    if (sandboxInfo?.reportBlobUrl) {
      console.log(`[Workflow] Report saved: ${sandboxInfo.reportBlobUrl}`)
    }
    if (sandboxInfo?.agentAnalysis) {
      console.log(`[Workflow] Agent analysis completed in Step 0`)
    }
  }

  // Step 1: Fetch real logs (only if we don't have sandbox data)
  // Skip if we already got CLS data and agent analysis from Step 0
  let logAnalysis = ""
  let beforeScreenshotUrl: string | null = sandboxInfo?.beforeScreenshotUrl || null

  if (!sandboxInfo?.clsData) {
    await updateProgress(1, "Capturing performance metrics (CLS, LCP, errors)...")
    const effectiveBypassToken = sandboxInfo?.bypassToken || bypassToken
    const step1Result = await fetchRealLogs(
      sandboxInfo?.mcpUrl || devUrl,
      effectiveBypassToken,
      sandboxInfo?.devUrl,
      sandboxInfo?.clsData,
      sandboxInfo?.mcpError,
      sandboxInfo?.beforeScreenshotUrl
    )
    logAnalysis = step1Result.logAnalysis
    beforeScreenshotUrl = step1Result.beforeScreenshotUrl
    await updateProgress(1, `Captured ${logAnalysis.length > 5000 ? "detailed" : "initial"} diagnostics`)
  } else {
    logAnalysis = JSON.stringify(sandboxInfo.clsData, null, 2)
    await updateProgress(1, "Using CLS data from sandbox")
  }

  // Step 2: AI agent analysis
  // If we already ran the agent in Step 0 (with sandbox tools), use that result
  // Otherwise, run the basic agent without sandbox access
  let fixProposal: string

  if (sandboxInfo?.agentAnalysis) {
    // Agent already ran with sandbox tools in Step 0
    fixProposal = sandboxInfo.agentAnalysis
    await updateProgress(2, "AI agent completed analysis with code access")
  } else {
    // Fallback: run agent without sandbox (limited mode)
    await updateProgress(2, "AI agent analyzing logs (limited mode)...")
    fixProposal = await analyzeLogsWithAgent(logAnalysis, sandboxInfo?.devUrl || devUrl)
  }

  // Provide feedback on what was found
  const hasError = fixProposal.toLowerCase().includes("error") || fixProposal.toLowerCase().includes("issue")
  const hasFix = fixProposal.includes("```diff")
  if (hasFix) {
    await updateProgress(2, "AI generated a fix proposal with code changes")
  } else if (hasError) {
    await updateProgress(2, "AI identified issues but no code fix needed")
  } else {
    await updateProgress(2, "AI analysis complete - system appears healthy")
  }

  // Step 3: Upload to blob storage as JSON with full context
  await updateProgress(3, "Compiling full report with screenshots...")
  const agentAnalysisModel = "anthropic/claude-sonnet-4-20250514" // Model used in analyzeLogsWithAgent
  const blobResult = await uploadToBlob(
    fixProposal,
    projectName,
    logAnalysis,
    sandboxInfo?.devUrl || devUrl,
    beforeScreenshotUrl,
    sandboxInfo?.gitDiff,
    sandboxInfo?.d3kArtifacts,
    runId,
    sandboxInfo?.mcpUrl,
    agentAnalysisModel
  )
  await updateProgress(3, "Report uploaded to Vercel Blob")

  // Step 4: Create GitHub PR if repo info provided AND there are actual fixes to apply
  let prResult = null
  const hasGitPatch = fixProposal.includes("```diff")
  if (repoOwner && repoName && hasGitPatch) {
    await updateProgress(4, `Creating PR on ${repoOwner}/${repoName}...`)
    prResult = await createGitHubPR(fixProposal, blobResult.blobUrl, repoOwner, repoName, baseBranch, projectName)
    if (prResult?.success) {
      await updateProgress(4, `PR #${prResult.prNumber} created successfully`)
    }
  } else if (repoOwner && repoName && !hasGitPatch) {
    await updateProgress(4, "No code changes needed - skipping PR")
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
  vercelOidcToken?: string,
  runId?: string
) {
  "use step"
  const { createD3kSandbox } = await import("./steps")
  return createD3kSandbox(repoUrl, branch, projectName, vercelToken, vercelOidcToken, runId)
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
  gitDiff?: string | null,
  d3kArtifacts?: {
    clsScreenshots: Array<{ label: string; blobUrl: string; timestamp: number }>
    screencastSessionId: string | null
    fullLogs: string | null
    metadata: Record<string, unknown> | null
  },
  runId?: string,
  sandboxMcpUrl?: string,
  agentAnalysisModel?: string
) {
  "use step"
  const { uploadToBlob } = await import("./steps")
  return uploadToBlob(
    fixProposal,
    projectName,
    logAnalysis,
    devUrl,
    beforeScreenshotUrl,
    gitDiff,
    d3kArtifacts,
    runId,
    sandboxMcpUrl,
    agentAnalysisModel
  )
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
