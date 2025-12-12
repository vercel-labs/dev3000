/**
 * Cloud Fix Workflow v2 - Simplified "Local-style" Architecture
 *
 * Designed to match the fast, iterative local d3k experience:
 * - 2 steps instead of 4+
 * - Agent controls the fix loop (not workflow orchestration)
 * - Agent has `diagnose` tool for real-time CLS feedback
 * - Report generated inline at end of agent step
 *
 * Step 1 (Init): Create sandbox, start d3k, capture initial CLS
 * Step 2 (Fix):  Agent iterates with diagnose→fix→verify until done
 */

const workflowLog = console.log

interface InitResult {
  sandboxId: string
  devUrl: string
  mcpUrl: string
  reportId: string
  beforeCls: number | null
  beforeGrade: "good" | "needs-improvement" | "poor" | null
  beforeScreenshots: Array<{ timestamp: number; blobUrl: string; label?: string }>
}

interface FixResult {
  reportBlobUrl: string
  reportId: string
  beforeCls: number | null
  afterCls: number | null
  status: "improved" | "unchanged" | "degraded" | "no-changes"
  agentSummary: string
  gitDiff: string | null
}

/**
 * Main workflow - simplified to 2 steps
 */
export async function cloudFixWorkflowV2(params: {
  repoUrl: string
  repoBranch?: string
  projectName: string
  vercelOidcToken?: string
  runId?: string
  userId?: string
}) {
  "use workflow"

  const { projectName, repoUrl, repoBranch = "main", vercelOidcToken, runId, userId } = params
  const timestamp = new Date().toISOString()
  const reportId = runId || crypto.randomUUID()

  workflowLog("[Workflow v2] Starting simplified cloud fix workflow...")
  workflowLog(`[Workflow v2] Project: ${projectName}, Repo: ${repoUrl}`)

  // Helper to update progress
  const updateProgress = async (step: number, message: string, sandboxUrl?: string) => {
    if (runId && userId) {
      await updateWorkflowProgressStep(userId, runId, projectName, timestamp, step, message, sandboxUrl)
    }
  }

  // ============================================================
  // STEP 1: Init - Create sandbox and capture before state
  // ============================================================
  await updateProgress(1, "Initializing sandbox...")

  const initResult = await initSandbox(repoUrl, repoBranch, projectName, reportId, vercelOidcToken)

  await updateProgress(1, `Init complete - CLS: ${initResult.beforeCls?.toFixed(4) || "N/A"}`, initResult.devUrl)
  workflowLog(`[Workflow v2] Sandbox: ${initResult.sandboxId}, CLS: ${initResult.beforeCls}`)

  // ============================================================
  // STEP 2: Agent Fix Loop - Single step with internal iteration
  // ============================================================
  await updateProgress(2, "Agent fixing CLS issues...")

  const fixResult = await agentFixLoop(
    initResult.sandboxId,
    initResult.devUrl,
    initResult.mcpUrl,
    initResult.beforeCls,
    initResult.beforeGrade,
    initResult.beforeScreenshots,
    projectName,
    reportId
  )

  await updateProgress(2, `Fix complete - Status: ${fixResult.status}`)
  workflowLog(`[Workflow v2] Result: ${fixResult.status}, After CLS: ${fixResult.afterCls}`)

  // Cleanup sandbox
  await cleanupSandbox(initResult.sandboxId)

  return Response.json({
    blobUrl: fixResult.reportBlobUrl,
    reportId: fixResult.reportId,
    status: fixResult.status,
    beforeCls: fixResult.beforeCls,
    afterCls: fixResult.afterCls
  })
}

// ============================================================
// Step wrapper functions with "use step" directive
// ============================================================

async function initSandbox(
  repoUrl: string,
  branch: string,
  projectName: string,
  reportId: string,
  vercelOidcToken?: string
): Promise<InitResult> {
  "use step"
  const { initSandboxStep } = await import("./steps-v2")
  return initSandboxStep(repoUrl, branch, projectName, reportId, vercelOidcToken)
}

async function agentFixLoop(
  sandboxId: string,
  devUrl: string,
  mcpUrl: string,
  beforeCls: number | null,
  beforeGrade: "good" | "needs-improvement" | "poor" | null,
  beforeScreenshots: Array<{ timestamp: number; blobUrl: string; label?: string }>,
  projectName: string,
  reportId: string
): Promise<FixResult> {
  "use step"
  const { agentFixLoopStep } = await import("./steps-v2")
  return agentFixLoopStep(sandboxId, devUrl, mcpUrl, beforeCls, beforeGrade, beforeScreenshots, projectName, reportId)
}

async function cleanupSandbox(sandboxId: string): Promise<void> {
  "use step"
  const { cleanupSandbox } = await import("./steps")
  return cleanupSandbox(sandboxId)
}

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
