/**
 * Cloud Fix Workflow - Refactored with discrete steps
 *
 * Each step reconnects to the sandbox via sandboxId, making the workflow
 * more debuggable and allowing proper step isolation.
 *
 * Step 0: Create sandbox, start d3k, capture "before" CLS/screenshots
 * Step 1: Run AI agent with sandbox tools to fix CLS issues
 * Step 2: Verify fix by reloading page and capturing "after" CLS/screenshots
 * Step 3: Compile final report to blob storage
 * Step 4: Create GitHub PR and cleanup sandbox
 */

// Note: Can't use workflowLog here - workflows can't import fs modules
const workflowLog = console.log

// Types for data passed between steps
interface SandboxSetupResult {
  sandboxId: string
  devUrl: string
  mcpUrl: string
  chromiumPath: string
  reportId: string
  clsData: unknown
  beforeScreenshots: Array<{ timestamp: number; blobUrl: string; label?: string }>
  clsScore: number | null
  clsGrade: "good" | "needs-improvement" | "poor" | null
  d3kLogs: string | null
}

interface AgentResult {
  agentAnalysis: string
  gitDiff: string | null
  hasChanges: boolean
}

interface VerificationResult {
  afterClsScore: number
  afterClsGrade: "good" | "needs-improvement" | "poor"
  afterScreenshots: Array<{ timestamp: number; blobUrl: string; label?: string }>
  verificationStatus: "improved" | "unchanged" | "degraded"
}

interface ReportResult {
  blobUrl: string
  reportId: string
}

interface PRResult {
  success: boolean
  prUrl?: string
  prNumber?: number
}

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
  runId?: string
  userId?: string
}) {
  "use workflow"

  const {
    projectName,
    vercelToken,
    vercelOidcToken: vercelOidcTokenParam,
    repoOwner,
    repoName,
    baseBranch = "main",
    repoUrl,
    repoBranch,
    runId,
    userId
  } = params
  const timestamp = new Date().toISOString()

  workflowLog("[Workflow] Starting cloud fix workflow (refactored)...")
  workflowLog(`[Workflow] Project: ${projectName}`)
  workflowLog(`[Workflow] Timestamp: ${timestamp}`)
  if (repoUrl) {
    workflowLog(`[Workflow] Repo: ${repoUrl} (branch: ${repoBranch || "main"})`)
  }

  const vercelOidcToken = vercelOidcTokenParam || process.env.VERCEL_OIDC_TOKEN

  // Helper to update progress
  const updateProgress = async (stepNumber: number, currentStep: string, sandboxUrl?: string) => {
    if (runId && userId) {
      await updateWorkflowProgressStep(userId, runId, projectName, timestamp, stepNumber, currentStep, sandboxUrl)
    }
  }

  // Require repoUrl for this workflow
  if (!repoUrl) {
    throw new Error("repoUrl is required for cloud fix workflow")
  }

  // ============================================================
  // STEP 0: Create sandbox, start d3k, capture "before" state
  // ============================================================
  await updateProgress(0, "Creating development sandbox...")

  const sandboxSetup = await createSandboxAndCaptureBefore(
    repoUrl,
    repoBranch || "main",
    projectName,
    runId || crypto.randomUUID(),
    vercelToken,
    vercelOidcToken
  )

  await updateProgress(0, "Sandbox ready, captured before metrics", sandboxSetup.devUrl)
  workflowLog(`[Workflow] Sandbox created: ${sandboxSetup.sandboxId}`)
  workflowLog(`[Workflow] Dev URL: ${sandboxSetup.devUrl}`)
  workflowLog(`[Workflow] Before CLS: ${sandboxSetup.clsScore}`)
  workflowLog(`[Workflow] Before Screenshots: ${sandboxSetup.beforeScreenshots.length}`)

  // ============================================================
  // STEP 1 & 2: Agent fix loop - retry until CLS improves (max 3 attempts)
  // ============================================================
  const MAX_FIX_ATTEMPTS = 3
  let agentResult: AgentResult = { agentAnalysis: "", gitDiff: null, hasChanges: false }
  let verificationResult: VerificationResult | null = null
  let attemptFeedback: string | null = null

  // Filter beforeScreenshots to only jank screenshots for agent context
  const jankScreenshots = sandboxSetup.beforeScreenshots
    .filter((s) => s.label?.includes("jank"))
    .map((s) => ({ label: s.label || "", blobUrl: s.blobUrl }))

  workflowLog(`[Workflow] Jank screenshots for agent: ${jankScreenshots.length}`)

  for (let attempt = 1; attempt <= MAX_FIX_ATTEMPTS; attempt++) {
    workflowLog(`[Workflow] Fix attempt ${attempt}/${MAX_FIX_ATTEMPTS}`)
    await updateProgress(1, `AI agent fixing CLS (attempt ${attempt}/${MAX_FIX_ATTEMPTS})...`)

    // Run agent with d3k context and feedback from previous failed attempt
    agentResult = await runAgentWithTools(
      sandboxSetup.sandboxId,
      sandboxSetup.mcpUrl,
      sandboxSetup.devUrl,
      sandboxSetup.clsData,
      jankScreenshots,
      sandboxSetup.d3kLogs,
      attemptFeedback
    )

    if (agentResult.hasChanges) {
      await updateProgress(1, `Attempt ${attempt}: Agent made code changes`)
      workflowLog(`[Workflow] Agent made changes, git diff: ${agentResult.gitDiff?.length || 0} chars`)

      // Verify the fix
      await updateProgress(2, `Verifying fix (attempt ${attempt})...`)

      verificationResult = await verifyFixAndCaptureAfter(
        sandboxSetup.sandboxId,
        sandboxSetup.mcpUrl,
        sandboxSetup.devUrl,
        sandboxSetup.clsScore,
        projectName
      )

      workflowLog(`[Workflow] After CLS: ${verificationResult.afterClsScore}`)
      workflowLog(`[Workflow] Status: ${verificationResult.verificationStatus}`)

      // Check if fix worked
      if (verificationResult.verificationStatus === "improved") {
        await updateProgress(2, `CLS improved on attempt ${attempt}!`)
        workflowLog(`[Workflow] SUCCESS: CLS improved on attempt ${attempt}`)
        break // Exit loop - fix worked!
      }

      // Fix didn't work - prepare feedback for next attempt
      if (attempt < MAX_FIX_ATTEMPTS) {
        attemptFeedback =
          `IMPORTANT: Your previous fix attempt (#${attempt}) did NOT improve CLS. ` +
          `Before: ${sandboxSetup.clsScore?.toFixed(4)}, After: ${verificationResult.afterClsScore.toFixed(4)} (${verificationResult.verificationStatus}). ` +
          `The changes you made were:\n${agentResult.gitDiff}\n\n` +
          `Please try a DIFFERENT approach. Common issues: ` +
          `1) Reserved space doesn't match actual content size, ` +
          `2) CSS syntax errors in inline styles, ` +
          `3) Missing min-height/min-width on parent containers. ` +
          `Verify your fix addresses the actual layout shift dimensions from the CLS data.`
        workflowLog(`[Workflow] Fix attempt ${attempt} failed, will retry with feedback`)
      }
    } else {
      await updateProgress(1, `Attempt ${attempt}: No changes made`)
      workflowLog("[Workflow] Agent completed without making changes")

      if (attempt < MAX_FIX_ATTEMPTS && attemptFeedback) {
        // If no changes on retry, that's a problem - encourage trying
        attemptFeedback =
          `IMPORTANT: You made NO changes on attempt ${attempt}. ` +
          `The CLS score is still ${sandboxSetup.clsScore?.toFixed(4)} (poor). ` +
          `You MUST make code changes to fix the layout shifts. Review the CLS data and modify the components causing shifts.`
      }
      break // No changes = nothing to verify, exit loop
    }
  }

  // Final status after all attempts
  if (verificationResult) {
    await updateProgress(2, `Final: ${verificationResult.verificationStatus} after ${MAX_FIX_ATTEMPTS} attempts`)
    workflowLog(`[Workflow] Final After Screenshots: ${verificationResult.afterScreenshots.length}`)
  } else {
    await updateProgress(2, "No verification - agent made no changes")
    workflowLog("[Workflow] Skipping verification - no changes made")
  }

  // ============================================================
  // STEP 3: Compile final report
  // ============================================================
  await updateProgress(3, "Compiling final report...")

  const reportResult = await compileReport(
    sandboxSetup.reportId,
    projectName,
    sandboxSetup.devUrl,
    sandboxSetup.mcpUrl,
    sandboxSetup.clsScore,
    sandboxSetup.clsGrade,
    sandboxSetup.beforeScreenshots,
    sandboxSetup.d3kLogs,
    agentResult.agentAnalysis,
    agentResult.gitDiff,
    verificationResult
  )

  await updateProgress(3, "Report compiled and uploaded")
  workflowLog(`[Workflow] Report URL: ${reportResult.blobUrl}`)

  // ============================================================
  // STEP 4: Create PR and cleanup sandbox
  // ============================================================
  let prResult: PRResult | null = null

  if (repoOwner && repoName && agentResult.hasChanges) {
    await updateProgress(4, `Creating PR on ${repoOwner}/${repoName}...`)

    prResult = await createPRAndCleanup(
      sandboxSetup.sandboxId,
      agentResult.gitDiff || "",
      reportResult.blobUrl,
      repoOwner,
      repoName,
      baseBranch,
      projectName
    )

    if (prResult.success) {
      await updateProgress(4, `PR #${prResult.prNumber} created`)
    } else {
      await updateProgress(4, "PR creation failed")
    }
  } else {
    // Just cleanup the sandbox
    await updateProgress(4, "Cleaning up sandbox...")
    await cleanupSandbox(sandboxSetup.sandboxId)
    await updateProgress(4, "Cleanup complete")
  }

  return Response.json({
    blobUrl: reportResult.blobUrl,
    reportId: reportResult.reportId,
    pr: prResult
  })
}

// ============================================================
// Step function wrappers with "use step" directive
// ============================================================

async function createSandboxAndCaptureBefore(
  repoUrl: string,
  branch: string,
  projectName: string,
  reportId: string,
  vercelToken?: string,
  vercelOidcToken?: string
): Promise<SandboxSetupResult> {
  "use step"
  const { createSandboxAndCaptureBefore } = await import("./steps")
  return createSandboxAndCaptureBefore(repoUrl, branch, projectName, reportId, vercelToken, vercelOidcToken)
}

async function runAgentWithTools(
  sandboxId: string,
  mcpUrl: string,
  devUrl: string,
  clsData: unknown,
  jankScreenshots: Array<{ label: string; blobUrl: string }>,
  d3kLogs: string | null,
  previousAttemptFeedback?: string | null
): Promise<AgentResult> {
  "use step"
  const { runAgentWithTools } = await import("./steps")
  return runAgentWithTools(sandboxId, mcpUrl, devUrl, clsData, jankScreenshots, d3kLogs, previousAttemptFeedback)
}

async function verifyFixAndCaptureAfter(
  sandboxId: string,
  mcpUrl: string,
  devUrl: string,
  beforeClsScore: number | null,
  projectName: string
): Promise<VerificationResult> {
  "use step"
  const { verifyFixAndCaptureAfter } = await import("./steps")
  return verifyFixAndCaptureAfter(sandboxId, mcpUrl, devUrl, beforeClsScore, projectName)
}

async function compileReport(
  reportId: string,
  projectName: string,
  devUrl: string,
  mcpUrl: string,
  clsScore: number | null,
  clsGrade: "good" | "needs-improvement" | "poor" | null,
  beforeScreenshots: Array<{ timestamp: number; blobUrl: string; label?: string }>,
  d3kLogs: string | null,
  agentAnalysis: string,
  gitDiff: string | null,
  verificationResult: VerificationResult | null
): Promise<ReportResult> {
  "use step"
  const { compileReport } = await import("./steps")
  return compileReport(
    reportId,
    projectName,
    devUrl,
    mcpUrl,
    clsScore,
    clsGrade,
    beforeScreenshots,
    d3kLogs,
    agentAnalysis,
    gitDiff,
    verificationResult
  )
}

async function createPRAndCleanup(
  sandboxId: string,
  gitDiff: string,
  reportBlobUrl: string,
  repoOwner: string,
  repoName: string,
  baseBranch: string,
  projectName: string
): Promise<PRResult> {
  "use step"
  const { createPRAndCleanup } = await import("./steps")
  return createPRAndCleanup(sandboxId, gitDiff, reportBlobUrl, repoOwner, repoName, baseBranch, projectName)
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
