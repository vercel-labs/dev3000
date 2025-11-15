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
  repoOwner?: string
  repoName?: string
  baseBranch?: string
  bypassToken?: string
  repoUrl?: string
  repoBranch?: string
}) {
  "use workflow"

  const {
    devUrl,
    projectName,
    vercelToken,
    repoOwner,
    repoName,
    baseBranch = "main",
    bypassToken,
    repoUrl,
    repoBranch
  } = params

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

  // Capture VERCEL_OIDC_TOKEN from workflow context to pass to steps
  const vercelOidcToken = process.env.VERCEL_OIDC_TOKEN
  console.log(`[Workflow] VERCEL_OIDC_TOKEN available: ${!!vercelOidcToken}`)

  // Step 0: Create d3k sandbox if repoUrl provided
  let sandboxInfo: { mcpUrl: string; devUrl: string; cleanup: () => Promise<void> } | null = null
  if (repoUrl) {
    sandboxInfo = await createD3kSandbox(repoUrl, repoBranch || "main", projectName, vercelToken, vercelOidcToken)
  }

  try {
    // Step 1: Fetch real logs (using sandbox MCP if available, otherwise devUrl directly)
    const logAnalysis = await fetchRealLogs(sandboxInfo?.mcpUrl || devUrl, bypassToken, sandboxInfo?.devUrl)

    // Step 2: Invoke AI agent to analyze logs and create fix
    const fixProposal = await analyzeLogsWithAgent(logAnalysis, sandboxInfo?.devUrl || devUrl)

    // Step 3: Upload to blob storage with full context
    const blobResult = await uploadToBlob(fixProposal, projectName, logAnalysis, sandboxInfo?.devUrl || devUrl)

    // Step 4: Create GitHub PR if repo info provided
    let prResult = null
    if (repoOwner && repoName) {
      prResult = await createGitHubPR(fixProposal, blobResult.blobUrl, repoOwner, repoName, baseBranch, projectName)
    }

    return Response.json({
      ...blobResult,
      pr: prResult
    })
  } finally {
    // Cleanup sandbox if it was created
    if (sandboxInfo) {
      await cleanupSandbox(sandboxInfo.cleanup)
    }
  }
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

async function fetchRealLogs(mcpUrlOrDevUrl: string, bypassToken?: string, sandboxDevUrl?: string) {
  "use step"
  const { fetchRealLogs } = await import("./steps")
  return fetchRealLogs(mcpUrlOrDevUrl, bypassToken, sandboxDevUrl)
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

async function cleanupSandbox(cleanup: () => Promise<void>) {
  "use step"
  const { cleanupSandbox } = await import("./steps")
  return cleanupSandbox(cleanup)
}
