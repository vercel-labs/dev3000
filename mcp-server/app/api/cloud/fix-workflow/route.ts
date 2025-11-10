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
 * Next.js API Route Handler
 *
 * This is the HTTP POST endpoint that Next.js exposes as /api/cloud/fix-workflow.
 * It extracts parameters from the Request and calls the workflow function.
 */
export async function POST(request: Request) {
  const { devUrl, projectName, repoOwner, repoName, baseBranch } = await request.json()
  const result = await cloudFixWorkflow({ devUrl, projectName, repoOwner, repoName, baseBranch })
  return result
}
