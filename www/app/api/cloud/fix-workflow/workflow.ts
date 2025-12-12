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

import { workflowLog } from "@/lib/workflow-logger"

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
  // STEP 1: Run AI agent with sandbox tools
  // ============================================================
  await updateProgress(1, "AI agent analyzing and fixing CLS issues...")

  const agentResult = await runAgentWithTools(
    sandboxSetup.sandboxId,
    sandboxSetup.mcpUrl,
    sandboxSetup.devUrl,
    sandboxSetup.clsData
  )

  if (agentResult.hasChanges) {
    await updateProgress(1, "AI agent made code changes")
    workflowLog(`[Workflow] Agent made changes, git diff: ${agentResult.gitDiff?.length || 0} chars`)
  } else {
    await updateProgress(1, "AI agent completed - no changes needed")
    workflowLog("[Workflow] Agent completed without making changes")
  }

  // ============================================================
  // STEP 2: Verify fix (only if agent made changes)
  // ============================================================
  let verificationResult: VerificationResult | null = null

  if (agentResult.hasChanges) {
    await updateProgress(2, "Verifying fix - reloading page...")

    verificationResult = await verifyFixAndCaptureAfter(
      sandboxSetup.sandboxId,
      sandboxSetup.mcpUrl,
      sandboxSetup.devUrl,
      sandboxSetup.clsScore,
      projectName
    )

    await updateProgress(2, `Verification: ${verificationResult.verificationStatus}`)
    workflowLog(`[Workflow] After CLS: ${verificationResult.afterClsScore}`)
    workflowLog(`[Workflow] After Screenshots: ${verificationResult.afterScreenshots.length}`)
    workflowLog(`[Workflow] Status: ${verificationResult.verificationStatus}`)
  } else {
    await updateProgress(2, "Skipped - no changes to verify")
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
  clsData: unknown
): Promise<AgentResult> {
  "use step"
  const { runAgentWithTools } = await import("./steps")
  return runAgentWithTools(sandboxId, mcpUrl, devUrl, clsData)
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
