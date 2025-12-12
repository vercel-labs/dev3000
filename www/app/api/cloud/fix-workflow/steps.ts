/**
 * Step functions for fix-workflow - Refactored for discrete steps
 *
 * Each step reconnects to sandbox via sandboxId for proper isolation.
 * This makes the workflow more debuggable and allows step resumption.
 */

import { put } from "@vercel/blob"
import { Sandbox } from "@vercel/sandbox"
import { createGateway, generateText, stepCountIs, tool } from "ai"
import { z } from "zod"
import { createD3kSandbox as createD3kSandboxUtil } from "@/lib/cloud/d3k-sandbox"
import type { WorkflowReport } from "@/types"

// Note: Can't use workflowLog from lib - workflows can't import fs modules
const workflowLog = console.log

/**
 * Parse timestamp from d3k screenshot filename.
 * Handles two formats:
 * - With milliseconds: 2025-12-12T15-36-21-424Z-page-loaded.png
 * - Without milliseconds (jank): 2025-12-12T15-36-21Z-jank-67ms.png
 *
 * @returns timestamp in milliseconds, or null if parsing fails
 */
function parseScreenshotTimestamp(filename: string): number | null {
  // Match ISO-like timestamp at start of filename
  // Format: YYYY-MM-DDTHH-MM-SS[-mmm]Z where mmm is optional milliseconds
  const timestampMatch = filename.match(/^(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})(-\d{3})?Z/)
  if (!timestampMatch) {
    return null
  }

  const [, dateTimePart, msPart] = timestampMatch
  // Convert 2025-12-12T15-36-21 to 2025-12-12T15:36:21
  const isoDateTime = dateTimePart.replace(/T(\d{2})-(\d{2})-(\d{2})$/, "T$1:$2:$3")

  // Add milliseconds if present, otherwise use .000
  const milliseconds = msPart ? msPart.slice(1) : "000" // Remove leading dash
  const fullIso = `${isoDateTime}.${milliseconds}Z`

  const date = new Date(fullIso)
  if (Number.isNaN(date.getTime())) {
    workflowLog(`[D3k Artifacts] WARNING: Failed to parse timestamp from ${filename} (parsed as ${fullIso})`)
    return null
  }

  return date.getTime()
}

// ============================================================
// Type definitions for step return values
// ============================================================

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

// ============================================================
// STEP 0: Create sandbox and capture "before" state
// ============================================================

export async function createSandboxAndCaptureBefore(
  repoUrl: string,
  branch: string,
  projectName: string,
  reportId: string,
  _vercelToken?: string,
  vercelOidcToken?: string
): Promise<SandboxSetupResult> {
  workflowLog(`[Step 0] Creating sandbox for ${projectName}...`)
  workflowLog(`[Step 0] Repository: ${repoUrl}`)
  workflowLog(`[Step 0] Branch: ${branch}`)
  workflowLog(`[Step 0] Report ID: ${reportId}`)

  // Set VERCEL_OIDC_TOKEN if passed from workflow context
  if (vercelOidcToken && !process.env.VERCEL_OIDC_TOKEN) {
    process.env.VERCEL_OIDC_TOKEN = vercelOidcToken
    workflowLog(`[Step 0] Set VERCEL_OIDC_TOKEN from workflow context`)
  }

  // Create sandbox with longer timeout for multi-step workflow
  const sandboxResult = await createD3kSandboxUtil({
    repoUrl,
    branch,
    projectDir: "",
    packageManager: "pnpm",
    timeout: "30m", // Extended for multi-step workflow
    debug: true
  })

  const sandboxId = sandboxResult.sandbox.sandboxId
  workflowLog(`[Step 0] Sandbox created: ${sandboxId}`)
  workflowLog(`[Step 0] Dev URL: ${sandboxResult.devUrl}`)
  workflowLog(`[Step 0] MCP URL: ${sandboxResult.mcpUrl}`)

  // Get chromium path for screenshots
  let chromiumPath = "/tmp/chromium"
  try {
    const chromiumResult = await runSandboxCommand(sandboxResult.sandbox, "node", [
      "-e",
      "require('@sparticuz/chromium').executablePath().then(p => workflowLog(p))"
    ])
    if (chromiumResult.exitCode === 0 && chromiumResult.stdout.trim()) {
      chromiumPath = chromiumResult.stdout.trim()
      workflowLog(`[Step 0] Chromium path: ${chromiumPath}`)
    }
  } catch {
    workflowLog(`[Step 0] Using default chromium path: ${chromiumPath}`)
  }

  // Wait for d3k to be fully ready and capture initial CLS data
  workflowLog(`[Step 0] Waiting for d3k to capture CLS data...`)
  await new Promise((resolve) => setTimeout(resolve, 5000))

  // Fetch d3k artifacts (CLS screenshots, metadata, logs)
  const d3kArtifacts = await fetchAndUploadD3kArtifacts(sandboxResult.sandbox, sandboxResult.mcpUrl, projectName)

  // Extract CLS data
  let clsScore: number | null = null
  let clsGrade: "good" | "needs-improvement" | "poor" | null = null
  let clsData: unknown = null

  if (d3kArtifacts.metadata) {
    const meta = d3kArtifacts.metadata as { totalCLS?: number; clsGrade?: string }
    clsScore = meta.totalCLS ?? null
    if (clsScore !== null) {
      clsGrade = clsScore <= 0.1 ? "good" : clsScore <= 0.25 ? "needs-improvement" : "poor"
    }
    clsData = d3kArtifacts.metadata
    workflowLog(`[Step 0] Before CLS: ${clsScore} (${clsGrade})`)
  }

  // Map screenshots to beforeScreenshots format
  const beforeScreenshots = d3kArtifacts.clsScreenshots.map((s) => ({
    timestamp: s.timestamp,
    blobUrl: s.blobUrl,
    label: s.label
  }))
  workflowLog(`[Step 0] Before Screenshots: ${beforeScreenshots.length}`)

  return {
    sandboxId,
    devUrl: sandboxResult.devUrl,
    mcpUrl: sandboxResult.mcpUrl,
    chromiumPath,
    reportId,
    clsData,
    beforeScreenshots,
    clsScore,
    clsGrade,
    d3kLogs: d3kArtifacts.fullLogs
  }
}

// ============================================================
// STEP 1: Run AI agent with sandbox tools
// ============================================================

export async function runAgentWithTools(
  sandboxId: string,
  mcpUrl: string,
  devUrl: string,
  clsData: unknown,
  jankScreenshots: Array<{ label: string; blobUrl: string }>,
  d3kLogs: string | null,
  previousAttemptFeedback?: string | null
): Promise<AgentResult> {
  workflowLog(`[Step 1] Reconnecting to sandbox: ${sandboxId}`)

  // Reconnect to existing sandbox
  const sandbox = await Sandbox.get({ sandboxId })
  workflowLog(`[Step 1] Sandbox status: ${sandbox.status}`)

  if (sandbox.status !== "running") {
    throw new Error(`Sandbox ${sandboxId} is not running (status: ${sandbox.status})`)
  }

  // Run the AI agent
  workflowLog(`[Step 1] Running AI agent with sandbox tools...`)
  workflowLog(`[Step 1] Jank screenshots: ${jankScreenshots.length}, d3k logs: ${d3kLogs ? "yes" : "no"}`)
  if (previousAttemptFeedback) {
    workflowLog(`[Step 1] Including feedback from previous failed attempt`)
  }
  const logAnalysis = clsData ? JSON.stringify(clsData, null, 2) : "No CLS data captured"

  const agentAnalysis = await runAgentWithSandboxTools(
    sandbox,
    mcpUrl,
    devUrl,
    logAnalysis,
    jankScreenshots,
    d3kLogs,
    previousAttemptFeedback
  )
  workflowLog(`[Step 1] Agent analysis: ${agentAnalysis.length} chars`)

  // Check for git diff to see if changes were made
  workflowLog(`[Step 1] Checking for git diff...`)
  const diffResult = await runSandboxCommand(sandbox, "sh", [
    "-c",
    "cd /vercel/sandbox && git diff --no-color 2>/dev/null || echo ''"
  ])

  const gitDiff = diffResult.stdout.trim() || null
  const hasChanges = !!gitDiff && gitDiff.length > 0

  workflowLog(`[Step 1] Has changes: ${hasChanges}`)
  if (hasChanges) {
    workflowLog(`[Step 1] Git diff: ${gitDiff?.length || 0} chars`)
  }

  return {
    agentAnalysis,
    gitDiff,
    hasChanges
  }
}

// ============================================================
// STEP 2: Verify fix and capture "after" state
// ============================================================

export async function verifyFixAndCaptureAfter(
  sandboxId: string,
  mcpUrl: string,
  devUrl: string,
  beforeClsScore: number | null,
  projectName: string
): Promise<VerificationResult> {
  workflowLog(`[Step 2] Reconnecting to sandbox: ${sandboxId}`)

  // Reconnect to existing sandbox
  const sandbox = await Sandbox.get({ sandboxId })
  workflowLog(`[Step 2] Sandbox status: ${sandbox.status}`)

  if (sandbox.status !== "running") {
    throw new Error(`Sandbox ${sandboxId} is not running (status: ${sandbox.status})`)
  }

  // Wait for HMR to apply changes
  workflowLog(`[Step 2] Waiting 3s for HMR to apply changes...`)
  await new Promise((resolve) => setTimeout(resolve, 3000))

  // Record timestamp BEFORE navigation to filter for only NEW screenshots/metadata
  // This is more reliable than clearing files, which may not work if npm package doesn't support metadata clearing
  const afterCaptureTimestamp = Date.now()
  workflowLog(`[Step 2] Timestamp before navigation: ${afterCaptureTimestamp}`)

  // Also try to clear via MCP API (may not clear metadata if using older npm package)
  const mcpBaseUrl = mcpUrl.replace(/\/mcp$/, "")
  try {
    const clearResponse = await fetch(`${mcpBaseUrl}/api/screenshots/clear`, {
      method: "DELETE"
    })
    if (clearResponse.ok) {
      const clearResult = (await clearResponse.json()) as { deletedCount?: number; directory?: string }
      workflowLog(`[Step 2] Cleared ${clearResult.deletedCount || 0} files from MCP server`)
    } else {
      workflowLog(`[Step 2] WARNING: Clear API returned ${clearResponse.status}`)
    }
  } catch (clearError) {
    workflowLog(
      `[Step 2] WARNING: Error calling MCP clear API: ${clearError instanceof Error ? clearError.message : String(clearError)}`
    )
  }

  // List screenshots BEFORE navigation for comparison
  try {
    const beforeListResponse = await fetch(`${mcpBaseUrl}/api/screenshots/list`)
    if (beforeListResponse.ok) {
      const beforeList = (await beforeListResponse.json()) as { files?: string[] }
      workflowLog(`[Step 2] Screenshots BEFORE navigation: ${(beforeList.files || []).length} files`)
      workflowLog(
        `[Step 2] File list: ${(beforeList.files || []).slice(0, 5).join(", ")}${(beforeList.files || []).length > 5 ? "..." : ""}`
      )
    }
  } catch {
    workflowLog(`[Step 2] Could not list screenshots before navigation`)
  }

  // Navigate to a blank page first, then back to the dev URL
  // This forces a full page navigation instead of just reload, which triggers fresh CLS capture
  workflowLog(`[Step 2] Navigating away and back to trigger fresh CLS capture...`)

  // Step 2: Navigate to about:blank first
  // Note: Must include Accept header for MCP SSE transport, and timeout to prevent hanging
  const blankNavCommand = `curl -s -m 30 -X POST http://localhost:3684/mcp -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"execute_browser_action","arguments":{"action":"navigate","params":{"url":"about:blank"}}}}'`
  workflowLog(`[Step 2] Executing: navigate to about:blank`)
  const blankNavResult = await runSandboxCommand(sandbox, "bash", ["-c", blankNavCommand])
  workflowLog(`[Step 2] about:blank stdout: ${blankNavResult.stdout.slice(0, 500)}`)
  workflowLog(`[Step 2] about:blank stderr: ${blankNavResult.stderr?.slice(0, 200) || "(none)"}`)
  await new Promise((resolve) => setTimeout(resolve, 1000))

  // Navigate back to the dev URL - this triggers a fresh page load and CLS capture
  const devNavCommand = `curl -s -m 30 -X POST http://localhost:3684/mcp -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"execute_browser_action","arguments":{"action":"navigate","params":{"url":"${devUrl}"}}}}'`
  workflowLog(`[Step 2] Executing: navigate to ${devUrl}`)
  const devNavResult = await runSandboxCommand(sandbox, "bash", ["-c", devNavCommand])
  workflowLog(`[Step 2] ${devUrl} stdout: ${devNavResult.stdout.slice(0, 500)}`)
  workflowLog(`[Step 2] ${devUrl} stderr: ${devNavResult.stderr?.slice(0, 200) || "(none)"}`)

  // Wait for page to load
  workflowLog(`[Step 2] Waiting 5s for page load...`)
  await new Promise((resolve) => setTimeout(resolve, 5000))

  // d3k automatically captures screenshots during navigation via its screencast system
  // The navigation above should have triggered page-loaded, error, and navigation-delayed captures
  workflowLog(`[Step 2] Waiting for d3k's automatic screenshot captures to complete...`)
  await new Promise((resolve) => setTimeout(resolve, 2000))

  // List screenshots AFTER capture
  try {
    const afterListResponse = await fetch(`${mcpBaseUrl}/api/screenshots/list`)
    if (afterListResponse.ok) {
      const afterList = (await afterListResponse.json()) as { files?: string[] }
      workflowLog(`[Step 2] Screenshots AFTER capture: ${(afterList.files || []).length} files`)
      workflowLog(
        `[Step 2] File list: ${(afterList.files || []).slice(0, 5).join(", ")}${(afterList.files || []).length > 5 ? "..." : ""}`
      )
    }
  } catch {
    workflowLog(`[Step 2] Could not list screenshots after capture`)
  }

  // Fetch fresh d3k artifacts - only use files captured AFTER our timestamp
  workflowLog(`[Step 2] Fetching after-fix d3k artifacts (filtering for timestamp > ${afterCaptureTimestamp})...`)
  const afterArtifacts = await fetchAndUploadD3kArtifacts(
    sandbox,
    mcpUrl,
    `${projectName}-after`,
    afterCaptureTimestamp
  )

  // Extract after CLS score
  let afterClsScore = 0
  if (afterArtifacts.metadata) {
    const meta = afterArtifacts.metadata as { totalCLS?: number }
    afterClsScore = meta.totalCLS ?? 0
  }
  workflowLog(`[Step 2] After CLS: ${afterClsScore}`)

  // Determine grade and verification status
  const afterClsGrade: "good" | "needs-improvement" | "poor" =
    afterClsScore <= 0.1 ? "good" : afterClsScore <= 0.25 ? "needs-improvement" : "poor"

  const beforeScore = beforeClsScore ?? 1.0
  let verificationStatus: "improved" | "unchanged" | "degraded"
  if (afterClsScore < beforeScore * 0.9) {
    verificationStatus = "improved"
  } else if (afterClsScore > beforeScore * 1.1) {
    verificationStatus = "degraded"
  } else {
    verificationStatus = "unchanged"
  }

  workflowLog(`[Step 2] Verification: ${verificationStatus} (before: ${beforeScore}, after: ${afterClsScore})`)

  // Map screenshots to afterScreenshots format
  const afterScreenshots = afterArtifacts.clsScreenshots.map((s) => ({
    timestamp: s.timestamp,
    blobUrl: s.blobUrl,
    label: s.label
  }))
  workflowLog(`[Step 2] After Screenshots: ${afterScreenshots.length}`)

  return {
    afterClsScore,
    afterClsGrade,
    afterScreenshots,
    verificationStatus
  }
}

// ============================================================
// STEP 3: Compile final report
// ============================================================

export async function compileReport(
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
  workflowLog(`[Step 3] Compiling report: ${reportId}`)

  const report: WorkflowReport = {
    id: reportId,
    projectName,
    timestamp: new Date().toISOString(),
    sandboxDevUrl: devUrl,
    sandboxMcpUrl: mcpUrl,
    clsScore: clsScore ?? undefined,
    clsGrade: clsGrade ?? undefined,
    beforeScreenshots,
    agentAnalysis,
    agentAnalysisModel: "anthropic/claude-sonnet-4-20250514",
    d3kLogs: d3kLogs ?? undefined,
    gitDiff: gitDiff ?? undefined
  }

  // Add verification data if available
  if (verificationResult) {
    report.afterClsScore = verificationResult.afterClsScore
    report.afterClsGrade = verificationResult.afterClsGrade
    report.afterScreenshots = verificationResult.afterScreenshots
    report.verificationStatus = verificationResult.verificationStatus
  }

  // Save to blob storage
  const blobUrl = await saveReportToBlob(report)
  workflowLog(`[Step 3] Report saved: ${blobUrl}`)

  return {
    blobUrl,
    reportId
  }
}

// ============================================================
// STEP 4: Create PR and cleanup
// ============================================================

export async function createPRAndCleanup(
  sandboxId: string,
  gitDiff: string,
  reportBlobUrl: string,
  repoOwner: string,
  repoName: string,
  baseBranch: string,
  _projectName: string
): Promise<PRResult> {
  workflowLog(`[Step 4] Creating PR for ${repoOwner}/${repoName}...`)

  // TODO: Implement actual PR creation via GitHub API
  // For now, just log and return success
  workflowLog(`[Step 4] Git diff length: ${gitDiff.length}`)
  workflowLog(`[Step 4] Report URL: ${reportBlobUrl}`)
  workflowLog(`[Step 4] Base branch: ${baseBranch}`)

  // Cleanup sandbox
  await cleanupSandbox(sandboxId)

  // Placeholder - actual PR creation would go here
  return {
    success: false,
    prUrl: undefined,
    prNumber: undefined
  }
}

// ============================================================
// Cleanup helper
// ============================================================

export async function cleanupSandbox(sandboxId: string): Promise<void> {
  workflowLog(`[Cleanup] Stopping sandbox: ${sandboxId}`)

  try {
    const sandbox = await Sandbox.get({ sandboxId })
    if (sandbox.status === "running") {
      await sandbox.stop()
      workflowLog(`[Cleanup] Sandbox stopped`)
    } else {
      workflowLog(`[Cleanup] Sandbox already stopped (status: ${sandbox.status})`)
    }
  } catch (error) {
    workflowLog(`[Cleanup] Error stopping sandbox: ${error instanceof Error ? error.message : String(error)}`)
  }
}

// ============================================================
// Helper functions
// ============================================================

/**
 * Helper function to run commands in sandbox
 */
async function runSandboxCommand(
  sandbox: Sandbox,
  cmd: string,
  args: string[]
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const result = await sandbox.runCommand({ cmd, args })
  let stdout = ""
  let stderr = ""
  for await (const log of result.logs()) {
    if (log.stream === "stdout") {
      stdout += log.data
    } else {
      stderr += log.data
    }
  }
  await result.wait()
  return { exitCode: result.exitCode, stdout, stderr }
}

/**
 * Save report to blob storage
 */
export async function saveReportToBlob(
  report: Partial<WorkflowReport> & { id: string; projectName: string; timestamp: string }
): Promise<string> {
  const filename = `report-${report.id}.json`
  const blob = await put(filename, JSON.stringify(report, null, 2), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true
  })
  return blob.url
}

/**
 * Fetch d3k artifacts (screenshots, metadata, logs) from sandbox
 * @param minTimestamp - Optional: only include screenshots with timestamp > this value (for filtering "after" captures)
 */
async function fetchAndUploadD3kArtifacts(
  sandbox: Sandbox,
  mcpUrl: string,
  projectName: string,
  minTimestamp?: number
): Promise<{
  clsScreenshots: Array<{ label: string; blobUrl: string; timestamp: number }>
  screencastSessionId: string | null
  fullLogs: string | null
  metadata: Record<string, unknown> | null
}> {
  const result: {
    clsScreenshots: Array<{ label: string; blobUrl: string; timestamp: number }>
    screencastSessionId: string | null
    fullLogs: string | null
    metadata: Record<string, unknown> | null
  } = {
    clsScreenshots: [],
    screencastSessionId: null,
    fullLogs: null,
    metadata: null
  }

  try {
    // Fetch CLS metadata from d3k server's jank API
    // First, find the screencast session by listing screenshots
    const baseUrl = mcpUrl.replace(/\/mcp$/, "")
    workflowLog(`[D3k Artifacts] Fetching CLS metadata from ${baseUrl}/api/jank/...`)

    // Try to get the session ID from screenshots list
    const listResponse = await fetch(`${baseUrl}/api/screenshots/list`, {
      method: "GET",
      headers: { Accept: "application/json" }
    })

    if (listResponse.ok) {
      const listData = (await listResponse.json()) as { files?: string[] }
      const screenshotFiles = listData.files || []

      // Extract session ID from first screenshot filename
      // Filenames can be:
      // - screencast-abc123-jank-100ms.png (old format)
      // - 2025-12-11T18-57-08-789Z-page-loaded.png (new format, session ID is the ISO timestamp)
      let sessionId: string | null = null

      // Filter by minTimestamp first if we're looking for "after" captures
      let filesToSearch = screenshotFiles
      if (minTimestamp) {
        filesToSearch = screenshotFiles.filter((filename) => {
          const fileTimestamp = parseScreenshotTimestamp(filename)
          if (fileTimestamp !== null) {
            return fileTimestamp > minTimestamp
          }
          return false
        })
        workflowLog(`[D3k Artifacts] Filtered to ${filesToSearch.length} files with timestamp > ${minTimestamp}`)
      }

      for (const filename of filesToSearch) {
        // Try old screencast format first
        const screencastMatch = filename.match(/^(screencast-[^-]+)/)
        if (screencastMatch) {
          sessionId = screencastMatch[1]
          break
        }
        // Try new ISO timestamp format: 2025-12-11T18-57-08-789Z-page-loaded.png
        const isoMatch = filename.match(/^(\d{4}-\d{2}-\d{2}T[\d-]+Z)/)
        if (isoMatch) {
          sessionId = isoMatch[1]
          break
        }
      }

      if (sessionId) {
        workflowLog(`[D3k Artifacts] Found session: ${sessionId}`)

        // Call the jank API which returns structured CLS data
        const jankResponse = await fetch(`${baseUrl}/api/jank/${sessionId}`, {
          method: "GET",
          headers: { Accept: "application/json" }
        })

        if (jankResponse.ok) {
          const jankData = (await jankResponse.json()) as {
            actualCLS?: number
            grade?: string
            clsMarkers?: Array<{ timestamp: number; score?: number }>
          }

          if (jankData.actualCLS !== undefined) {
            result.metadata = {
              totalCLS: jankData.actualCLS,
              clsGrade: jankData.grade,
              layoutShifts: jankData.clsMarkers?.map((m) => ({
                timestamp: m.timestamp,
                score: m.score || 0
              }))
            }
            workflowLog(`[D3k Artifacts] CLS metadata: totalCLS=${jankData.actualCLS}, grade=${jankData.grade}`)
          }
        }
      }

      // Upload screenshots to blob storage
      // Take up to 20 screenshots to capture loading sequences and CLS animation
      if (screenshotFiles.length > 0) {
        // Filter by minTimestamp if provided (for "after" captures)
        let filesToProcess = screenshotFiles
        if (minTimestamp) {
          filesToProcess = screenshotFiles.filter((filename) => {
            const fileTimestamp = parseScreenshotTimestamp(filename)
            if (fileTimestamp !== null) {
              return fileTimestamp > minTimestamp
            }
            return false // Exclude files without parseable timestamps
          })
          workflowLog(
            `[D3k Artifacts] Filtered ${screenshotFiles.length} -> ${filesToProcess.length} screenshots (minTimestamp: ${minTimestamp})`
          )
        }

        workflowLog(`[D3k Artifacts] Uploading ${filesToProcess.length} screenshots...`)
        const recentScreenshots = filesToProcess.slice(-20)
        for (const filename of recentScreenshots) {
          try {
            const imageResponse = await fetch(`${baseUrl}/api/screenshots/${filename}`)
            if (imageResponse.ok) {
              const imageBuffer = Buffer.from(await imageResponse.arrayBuffer())
              const timestamp = parseScreenshotTimestamp(filename) ?? Date.now()
              const blobFilename = `cls-screenshot-${projectName}-${timestamp}.png`

              const blob = await put(blobFilename, imageBuffer, {
                access: "public",
                contentType: "image/png"
              })

              result.clsScreenshots.push({
                label: filename.replace(".png", ""),
                blobUrl: blob.url,
                timestamp
              })
            }
          } catch (err) {
            workflowLog(
              `[D3k Artifacts] Error uploading ${filename}: ${err instanceof Error ? err.message : String(err)}`
            )
          }
        }
      }
    }

    // Also fetch d3k logs
    const logsResult = await runSandboxCommand(sandbox, "sh", [
      "-c",
      'for log in /home/vercel-sandbox/.d3k/logs/*.log; do [ -f "$log" ] && cat "$log"; done 2>/dev/null || echo ""'
    ])
    if (logsResult.stdout.trim()) {
      result.fullLogs = logsResult.stdout

      // Fallback: Parse CLS from logs if metadata wasn't found via jank API
      if (!result.metadata) {
        // Match log lines like: [CDP] Detected 1 layout shifts (CLS: 0.4716)
        const clsMatch = logsResult.stdout.match(/\[CDP\] Detected (\d+) layout shifts \(CLS: ([\d.]+)\)/)
        if (clsMatch) {
          const shiftCount = parseInt(clsMatch[1], 10)
          const clsScore = parseFloat(clsMatch[2])
          workflowLog(`[D3k Artifacts] Parsed CLS from logs: ${clsScore} (${shiftCount} shifts)`)

          // Determine grade based on CLS thresholds (Google Core Web Vitals)
          let clsGrade: "good" | "needs-improvement" | "poor"
          if (clsScore <= 0.1) {
            clsGrade = "good"
          } else if (clsScore <= 0.25) {
            clsGrade = "needs-improvement"
          } else {
            clsGrade = "poor"
          }

          // Parse individual shift details from subsequent log lines
          // Match lines like: [CDP]   - <DIV> shifted right by 57px
          const shiftDetailRegex = /\[CDP\]\s+-\s+<(\w+)>\s+shifted\s+(.+)/g
          const layoutShifts: Array<{ element: string; movement: string }> = []
          const shiftDetails = logsResult.stdout.matchAll(shiftDetailRegex)
          for (const detailMatch of shiftDetails) {
            layoutShifts.push({
              element: detailMatch[1],
              movement: detailMatch[2]
            })
          }

          result.metadata = {
            totalCLS: clsScore,
            clsGrade,
            shiftCount,
            layoutShifts: layoutShifts.length > 0 ? layoutShifts : undefined,
            source: "parsed-from-logs"
          }
        }
      }
    }

    workflowLog(
      `[D3k Artifacts] Summary: ${result.clsScreenshots.length} screenshots, metadata: ${result.metadata ? "yes" : "no"}`
    )
  } catch (error) {
    workflowLog(`[D3k Artifacts] Error: ${error instanceof Error ? error.message : String(error)}`)
  }

  return result
}

/**
 * Create tools for AI agent to use in sandbox
 */
function createD3kSandboxTools(sandbox: Sandbox, _mcpUrl: string, devUrl: string) {
  const SANDBOX_CWD = "/vercel/sandbox"
  const D3K_MCP_PORT = 3684

  return {
    measureCLS: tool({
      description:
        "Measure CLS by navigating the page and getting fresh metrics from d3k. " +
        "Use this AFTER making changes to verify they actually fixed the layout shifts. " +
        "Returns the new CLS score and details about any remaining shifts.",
      inputSchema: z.object({
        waitMs: z.number().optional().describe("Milliseconds to wait for page load and CLS capture (default: 5000)")
      }),
      execute: async ({ waitMs = 5000 }: { waitMs?: number }) => {
        workflowLog("[measureCLS] Starting fresh CLS measurement...")

        // Navigate to about:blank first to reset
        const blankCmd = `curl -s -m 30 -X POST http://localhost:${D3K_MCP_PORT}/mcp -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"execute_browser_action","arguments":{"action":"navigate","params":{"url":"about:blank"}}}}'`
        await runSandboxCommand(sandbox, "bash", ["-c", blankCmd])
        await new Promise((resolve) => setTimeout(resolve, 500))

        // Navigate back to dev URL to trigger fresh CLS capture
        const navCmd = `curl -s -m 30 -X POST http://localhost:${D3K_MCP_PORT}/mcp -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"execute_browser_action","arguments":{"action":"navigate","params":{"url":"${devUrl}"}}}}'`
        await runSandboxCommand(sandbox, "bash", ["-c", navCmd])

        // Wait for page load and CLS capture
        await new Promise((resolve) => setTimeout(resolve, waitMs))

        // Read d3k logs to get fresh CLS data
        const logsResult = await runSandboxCommand(sandbox, "sh", [
          "-c",
          'for log in /home/vercel-sandbox/.d3k/logs/*.log; do [ -f "$log" ] && tail -100 "$log" || true; done 2>/dev/null'
        ])
        const logs = logsResult.stdout || ""

        // Parse CLS from logs
        const clsMatch = logs.match(/\[CDP\] Detected (\d+) layout shifts \(CLS: ([\d.]+)\)/)
        if (clsMatch) {
          const shiftCount = parseInt(clsMatch[1], 10)
          const clsScore = parseFloat(clsMatch[2])

          // Parse individual shift details
          const shiftDetailRegex = /\[CDP\]\s+-\s+<(\w+)>\s+shifted\s+(.+)/g
          const shifts: string[] = []
          const shiftDetails = logs.matchAll(shiftDetailRegex)
          for (const match of shiftDetails) {
            shifts.push(`- <${match[1]}> shifted ${match[2]}`)
          }

          const grade = clsScore <= 0.1 ? "good ✅" : clsScore <= 0.25 ? "needs-improvement ⚠️" : "poor ❌"

          return `## Fresh CLS Measurement

**CLS Score: ${clsScore.toFixed(4)}** (${grade})
**Layout Shifts: ${shiftCount}**

${shifts.length > 0 ? `### Elements that shifted:\n${shifts.join("\n")}` : "No shift details captured."}

${clsScore <= 0.1 ? "🎉 CLS is now GOOD! Your fix worked!" : "⚠️ CLS still needs improvement. Try a different approach."}`
        }

        return `## CLS Measurement

Could not detect CLS data in d3k logs. This might mean:
1. No layout shifts occurred (good!)
2. The page didn't fully load yet
3. d3k didn't capture the shifts

Check the page manually or try running measureCLS again with a longer waitMs.`
      }
    }),

    readFile: tool({
      description: "Read a file from the codebase.",
      inputSchema: z.object({
        path: z.string().describe("File path relative to project root"),
        maxLines: z.number().optional().describe("Maximum lines to read (default: 500)")
      }),
      execute: async ({ path, maxLines = 500 }: { path: string; maxLines?: number }) => {
        const fullPath = `${SANDBOX_CWD}/${path}`
        const result = await runSandboxCommand(sandbox, "sh", [
          "-c",
          `head -n ${maxLines} "${fullPath}" 2>&1 || echo "ERROR: File not found"`
        ])
        if (result.stdout.startsWith("ERROR:")) {
          return `Failed to read ${path}: ${result.stdout}`
        }
        return `Contents of ${path}:\n\`\`\`\n${result.stdout}\n\`\`\``
      }
    }),

    globSearch: tool({
      description: "Find files matching a glob pattern.",
      inputSchema: z.object({
        pattern: z.string().describe("Glob pattern to match files"),
        maxResults: z.number().optional().describe("Maximum results (default: 20)")
      }),
      execute: async ({ pattern, maxResults = 20 }: { pattern: string; maxResults?: number }) => {
        const result = await runSandboxCommand(sandbox, "sh", [
          "-c",
          `cd ${SANDBOX_CWD} && find . -type f -name "${pattern}" 2>/dev/null | head -n ${maxResults} | sed 's|^\\./||'`
        ])
        if (!result.stdout.trim()) {
          return `No files found matching pattern: ${pattern}`
        }
        return `Found files:\n${result.stdout}`
      }
    }),

    grepSearch: tool({
      description: "Search for text/patterns in files.",
      inputSchema: z.object({
        pattern: z.string().describe("Search pattern"),
        fileGlob: z.string().optional().describe("File pattern to search in"),
        maxResults: z.number().optional().describe("Maximum results (default: 20)")
      }),
      execute: async ({
        pattern,
        fileGlob,
        maxResults = 20
      }: {
        pattern: string
        fileGlob?: string
        maxResults?: number
      }) => {
        const includeArg = fileGlob ? `--include="${fileGlob}"` : ""
        const result = await runSandboxCommand(sandbox, "sh", [
          "-c",
          `cd ${SANDBOX_CWD} && grep -rn ${includeArg} "${pattern}" . 2>/dev/null | head -n ${maxResults}`
        ])
        if (!result.stdout.trim()) {
          return `No matches found for: ${pattern}`
        }
        return `Search results:\n${result.stdout}`
      }
    }),

    listDirectory: tool({
      description: "List files and directories at a path.",
      inputSchema: z.object({
        path: z.string().optional().describe("Directory path (default: root)")
      }),
      execute: async ({ path = "" }: { path?: string }) => {
        const fullPath = path ? `${SANDBOX_CWD}/${path}` : SANDBOX_CWD
        const result = await runSandboxCommand(sandbox, "sh", ["-c", `ls -la "${fullPath}" 2>&1`])
        return `Contents of ${path || "/"}:\n${result.stdout}`
      }
    }),

    writeFile: tool({
      description: "Write content to a file.",
      inputSchema: z.object({
        path: z.string().describe("File path relative to project root"),
        content: z.string().describe("Complete file content to write")
      }),
      execute: async ({ path, content }: { path: string; content: string }) => {
        const fullPath = `${SANDBOX_CWD}/${path}`
        const result = await runSandboxCommand(sandbox, "sh", [
          "-c",
          `cat > "${fullPath}" << 'FILEEOF'\n${content}\nFILEEOF`
        ])
        if (result.exitCode !== 0) {
          return `Failed to write ${path}: ${result.stderr}`
        }
        return `Successfully wrote ${content.length} characters to ${path}`
      }
    }),

    getGitDiff: tool({
      description: "Get git diff of changes made.",
      inputSchema: z.object({}),
      execute: async () => {
        const result = await runSandboxCommand(sandbox, "sh", [
          "-c",
          `cd ${SANDBOX_CWD} && git diff --no-color 2>/dev/null || echo "No changes"`
        ])
        if (!result.stdout.trim() || result.stdout.includes("No changes")) {
          return "No changes have been made yet."
        }
        return `Current changes:\n\`\`\`diff\n${result.stdout}\n\`\`\``
      }
    }),

    verifyChanges: tool({
      description: "Verify changes don't break the app. Call after making file changes.",
      inputSchema: z.object({
        waitMs: z.number().optional().describe("Milliseconds to wait for HMR (default: 2000)")
      }),
      execute: async ({ waitMs = 2000 }: { waitMs?: number }) => {
        await new Promise((resolve) => setTimeout(resolve, waitMs))

        const errors: string[] = []

        // Check d3k logs for errors
        const logsResult = await runSandboxCommand(sandbox, "sh", [
          "-c",
          'for log in /home/vercel-sandbox/.d3k/logs/*.log; do [ -f "$log" ] && tail -50 "$log" || true; done 2>/dev/null'
        ])
        const logs = logsResult.stdout || ""

        if (logs.includes("Failed to compile") || logs.includes("SyntaxError")) {
          errors.push(`COMPILATION ERROR detected in logs`)
        }

        // Check page loads
        const pageResult = await runSandboxCommand(sandbox, "sh", [
          "-c",
          'curl -s -o /dev/null -w "%{http_code}" http://localhost:3000 2>&1'
        ])
        if (pageResult.stdout.trim() !== "200") {
          errors.push(`Page load failed: HTTP ${pageResult.stdout.trim()}`)
        }

        if (errors.length > 0) {
          return `❌ VERIFICATION FAILED:\n${errors.join("\n")}\n\nFix these errors and verify again.`
        }

        return `✅ VERIFICATION PASSED - Changes work correctly.`
      }
    })
  }
}

/**
 * Run AI agent with sandbox tools
 */
async function runAgentWithSandboxTools(
  sandbox: Sandbox,
  mcpUrl: string,
  devUrl: string,
  logAnalysis: string,
  jankScreenshots: Array<{ label: string; blobUrl: string }>,
  d3kLogs: string | null,
  previousAttemptFeedback?: string | null
): Promise<string> {
  workflowLog("[Agent] Starting AI agent with d3k sandbox tools...")
  workflowLog(`[Agent] Jank screenshots provided: ${jankScreenshots.length}`)
  if (previousAttemptFeedback) {
    workflowLog("[Agent] This is a RETRY attempt with feedback from previous failure")
  }

  const gateway = createGateway({
    apiKey: process.env.AI_GATEWAY_API_KEY,
    baseURL: "https://ai-gateway.vercel.sh/v1/ai"
  })

  const model = gateway("anthropic/claude-sonnet-4-20250514")
  const tools = createD3kSandboxTools(sandbox, mcpUrl, devUrl)

  const systemPrompt = `You are a CLS (Cumulative Layout Shift) specialist engineer working with d3k, an AI-powered debugging tool that monitors layout shifts in real-time.

## WHAT IS d3k?
d3k is running in this sandbox and has already captured CLS data during the initial page load. It monitors the browser via Chrome DevTools Protocol and detects exactly which elements shifted, by how much, and when. The diagnostic data you receive comes directly from d3k's CLS detection.

## YOUR TOOLS

### CLS Verification (USE THIS!)
- **measureCLS**: Navigate the page and get FRESH CLS metrics from d3k. Use this AFTER making changes to verify they actually work. This is your most important tool for validation!

### Code Tools
- readFile: Read source files
- globSearch: Find files by pattern (e.g., "*.tsx", "layout.*")
- grepSearch: Search for code patterns
- listDirectory: Explore project structure
- writeFile: Write fixes to files
- verifyChanges: Check for build/compilation errors
- getGitDiff: Review your changes

## WORKFLOW
1. **Analyze the d3k diagnostic data** - It tells you EXACTLY which elements shifted and by how much
2. **Find the source files** - Use the element tags (DIV, MAIN, A, etc.) to find the components
3. **Read the relevant files** - Understand the current implementation
4. **Write your fix** - Make minimal, targeted changes to prevent the shifts
5. **Verify no errors** - Use verifyChanges to check for compilation errors
6. **MEASURE CLS** - Use measureCLS to get fresh CLS data and confirm your fix worked
7. **Iterate if needed** - If CLS is still bad, try a different approach
8. **Get final diff** - Use getGitDiff at the end

## CLS KNOWLEDGE
CLS measures visual stability. Scores: ≤0.1 = good, ≤0.25 = needs improvement, >0.25 = poor.

### Common Causes (from d3k element shift data):
- **Elements moving right**: Usually sidebar/margin issues - space not reserved from initial render
- **Elements moving down**: Content above expanding - delayed loading, async components, fonts
- **Large shifts (>100px)**: Major layout changes - fixed/absolute positioning issues, missing dimensions

### Fixes:
- For delayed sidebars: Ensure space is ALWAYS reserved with CSS (not conditional rendering)
- For async content: Use skeleton loaders with EXACT dimensions matching final content
- For images: Add explicit width/height or aspect-ratio
- For fonts: Use font-display: optional or preload critical fonts
- For conditional content: Keep element in DOM with visibility:hidden or opacity:0, not conditional {show && ...}

## CRITICAL TIPS
1. The shift dimensions in the diagnostic data are EXACT - your fix must reserve that EXACT space
2. Use measureCLS after EVERY fix attempt to verify - don't guess!
3. If a fix doesn't work, the issue is likely that space isn't being reserved at the RIGHT TIME (initial render)
4. Fixed/absolute positioned elements don't take up document flow - siblings need explicit margins

## OUTPUT FORMAT
After fixing, provide:
- Summary: What you fixed and why
- Root cause: The specific elements/code causing shifts
- measureCLS result: The new CLS score after your fix
- Verification: Build status`

  const feedbackSection = previousAttemptFeedback
    ? `\n\n## CRITICAL - PREVIOUS ATTEMPT FAILED\n${previousAttemptFeedback}\n\nYou MUST try a different approach this time.\n`
    : ""

  // Build jank screenshots section
  const jankScreenshotsSection =
    jankScreenshots.length > 0
      ? `\n## d3k Jank Screenshots (Visual Evidence)
These screenshots show the exact moment of layout shift:
${jankScreenshots.map((s) => `- ${s.label}: ${s.blobUrl}`).join("\n")}
`
      : ""

  // Extract key CLS details from d3k logs
  let d3kLogsSection = ""
  if (d3kLogs) {
    // Extract CLS detection lines
    const clsLines = d3kLogs
      .split("\n")
      .filter(
        (line) =>
          line.includes("[CDP] Detected") ||
          line.includes("[CDP]   -") ||
          line.includes("CLS #") ||
          line.includes("shifted")
      )
      .slice(0, 20) // Limit to avoid too much context
      .join("\n")

    if (clsLines) {
      d3kLogsSection = `\n## d3k CLS Detection Logs
\`\`\`
${clsLines}
\`\`\`
`
    }
  }

  const userPrompt = `## Dev Server
${devUrl}
${feedbackSection}
## d3k Diagnostic Data (Source of Truth)
${logAnalysis}
${d3kLogsSection}${jankScreenshotsSection}
## Your Task
Fix the CLS issues identified by d3k. Use measureCLS after making changes to verify your fix works!`

  const { text, steps } = await generateText({
    model,
    system: systemPrompt,
    prompt: userPrompt,
    tools,
    stopWhen: stepCountIs(20)
  })

  workflowLog(`[Agent] Completed in ${steps.length} step(s)`)

  // Build transcript
  const transcript: string[] = []
  transcript.push("## System Prompt")
  transcript.push("```")
  transcript.push(systemPrompt)
  transcript.push("```")
  transcript.push("")
  transcript.push("## User Prompt")
  transcript.push("```")
  transcript.push(userPrompt)
  transcript.push("```")
  transcript.push("")
  transcript.push("## Agent Execution")
  transcript.push("")

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]
    transcript.push(`### Step ${i + 1}`)

    if (step.text) {
      transcript.push("")
      transcript.push("**Assistant:**")
      transcript.push(step.text)
    }

    if (step.toolCalls && step.toolCalls.length > 0) {
      for (let j = 0; j < step.toolCalls.length; j++) {
        const toolCall = step.toolCalls[j] as unknown as { toolName: string; input?: unknown }
        const toolResult = step.toolResults?.[j] as unknown as { output?: unknown } | undefined

        transcript.push("")
        transcript.push(`**Tool Call: ${toolCall.toolName}**`)
        transcript.push("```json")
        transcript.push(toolCall.input ? JSON.stringify(toolCall.input, null, 2) : "{}")
        transcript.push("```")

        transcript.push("")
        transcript.push("**Tool Result:**")
        let resultStr = "[no result]"
        if (toolResult?.output !== undefined) {
          resultStr =
            typeof toolResult.output === "string" ? toolResult.output : JSON.stringify(toolResult.output, null, 2)
        }
        if (resultStr.length > 2000) {
          resultStr = `${resultStr.substring(0, 2000)}\n... [truncated]`
        }
        transcript.push("```")
        transcript.push(resultStr)
        transcript.push("```")
      }
    }

    transcript.push("")
  }

  transcript.push("## Final Output")
  transcript.push("")
  transcript.push(text)

  return transcript.join("\n")
}
