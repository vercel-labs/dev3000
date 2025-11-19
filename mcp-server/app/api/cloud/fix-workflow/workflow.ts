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

  // Use VERCEL_OIDC_TOKEN from params (passed from request header) or fall back to env
  // At runtime, OIDC token is in x-vercel-oidc-token header, not process.env
  const vercelOidcToken = vercelOidcTokenParam || process.env.VERCEL_OIDC_TOKEN
  console.log(`[Workflow] VERCEL_OIDC_TOKEN from param: ${!!vercelOidcTokenParam}`)
  console.log(`[Workflow] VERCEL_OIDC_TOKEN from env: ${!!process.env.VERCEL_OIDC_TOKEN}`)
  console.log(`[Workflow] VERCEL_OIDC_TOKEN available: ${!!vercelOidcToken}`)

  // Step 0: Create d3k sandbox if repoUrl provided
  let sandboxInfo: { mcpUrl: string; devUrl: string } | null = null
  if (repoUrl) {
    sandboxInfo = await createD3kSandbox(repoUrl, repoBranch || "main", projectName, vercelToken, vercelOidcToken)
  }

  // Step 1: Fetch real logs (using sandbox MCP if available, otherwise devUrl directly)
  const logAnalysis = await fetchRealLogs(sandboxInfo?.mcpUrl || devUrl, bypassToken, sandboxInfo?.devUrl)

  // Step 2: Invoke AI agent to analyze logs and create fix
  const fixProposal = await analyzeLogsWithAgent(logAnalysis, sandboxInfo?.devUrl || devUrl)

  // Step 3: Upload to blob storage with full context
  const blobResult = await uploadToBlob(fixProposal, projectName, logAnalysis, sandboxInfo?.devUrl || devUrl)

  // Step 4: Create GitHub PR if repo info provided AND there are actual fixes to apply
  let prResult = null
  const hasGitPatch = fixProposal.includes("```diff")
  if (repoOwner && repoName && hasGitPatch) {
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
