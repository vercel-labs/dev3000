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
  console.log(`[Step 0] Creating sandbox for ${projectName}...`)
  console.log(`[Step 0] Repository: ${repoUrl}`)
  console.log(`[Step 0] Branch: ${branch}`)
  console.log(`[Step 0] Report ID: ${reportId}`)

  // Set VERCEL_OIDC_TOKEN if passed from workflow context
  if (vercelOidcToken && !process.env.VERCEL_OIDC_TOKEN) {
    process.env.VERCEL_OIDC_TOKEN = vercelOidcToken
    console.log(`[Step 0] Set VERCEL_OIDC_TOKEN from workflow context`)
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
  console.log(`[Step 0] Sandbox created: ${sandboxId}`)
  console.log(`[Step 0] Dev URL: ${sandboxResult.devUrl}`)
  console.log(`[Step 0] MCP URL: ${sandboxResult.mcpUrl}`)

  // Get chromium path for screenshots
  let chromiumPath = "/tmp/chromium"
  try {
    const chromiumResult = await runSandboxCommand(sandboxResult.sandbox, "node", [
      "-e",
      "require('@sparticuz/chromium').executablePath().then(p => console.log(p))"
    ])
    if (chromiumResult.exitCode === 0 && chromiumResult.stdout.trim()) {
      chromiumPath = chromiumResult.stdout.trim()
      console.log(`[Step 0] Chromium path: ${chromiumPath}`)
    }
  } catch {
    console.log(`[Step 0] Using default chromium path: ${chromiumPath}`)
  }

  // Wait for d3k to be fully ready and capture initial CLS data
  console.log(`[Step 0] Waiting for d3k to capture CLS data...`)
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
    console.log(`[Step 0] Before CLS: ${clsScore} (${clsGrade})`)
  }

  // Map screenshots to beforeScreenshots format
  const beforeScreenshots = d3kArtifacts.clsScreenshots.map((s) => ({
    timestamp: s.timestamp,
    blobUrl: s.blobUrl,
    label: s.label
  }))
  console.log(`[Step 0] Before Screenshots: ${beforeScreenshots.length}`)

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
  clsData: unknown
): Promise<AgentResult> {
  console.log(`[Step 1] Reconnecting to sandbox: ${sandboxId}`)

  // Reconnect to existing sandbox
  const sandbox = await Sandbox.get({ sandboxId })
  console.log(`[Step 1] Sandbox status: ${sandbox.status}`)

  if (sandbox.status !== "running") {
    throw new Error(`Sandbox ${sandboxId} is not running (status: ${sandbox.status})`)
  }

  // Run the AI agent
  console.log(`[Step 1] Running AI agent with sandbox tools...`)
  const logAnalysis = clsData ? JSON.stringify(clsData, null, 2) : "No CLS data captured"

  const agentAnalysis = await runAgentWithSandboxTools(sandbox, mcpUrl, devUrl, logAnalysis)
  console.log(`[Step 1] Agent analysis: ${agentAnalysis.length} chars`)

  // Check for git diff to see if changes were made
  console.log(`[Step 1] Checking for git diff...`)
  const diffResult = await runSandboxCommand(sandbox, "sh", [
    "-c",
    "cd /vercel/sandbox && git diff --no-color 2>/dev/null || echo ''"
  ])

  const gitDiff = diffResult.stdout.trim() || null
  const hasChanges = !!gitDiff && gitDiff.length > 0

  console.log(`[Step 1] Has changes: ${hasChanges}`)
  if (hasChanges) {
    console.log(`[Step 1] Git diff: ${gitDiff?.length || 0} chars`)
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
  _devUrl: string,
  beforeClsScore: number | null,
  projectName: string
): Promise<VerificationResult> {
  console.log(`[Step 2] Reconnecting to sandbox: ${sandboxId}`)

  // Reconnect to existing sandbox
  const sandbox = await Sandbox.get({ sandboxId })
  console.log(`[Step 2] Sandbox status: ${sandbox.status}`)

  if (sandbox.status !== "running") {
    throw new Error(`Sandbox ${sandboxId} is not running (status: ${sandbox.status})`)
  }

  // Wait for HMR to apply changes
  console.log(`[Step 2] Waiting 3s for HMR to apply changes...`)
  await new Promise((resolve) => setTimeout(resolve, 3000))

  // Clear d3k logs before verification to get fresh CLS measurement
  console.log(`[Step 2] Clearing d3k logs for fresh measurement...`)
  await runSandboxCommand(sandbox, "sh", [
    "-c",
    "rm -f /home/vercel-sandbox/.d3k/logs/*.log 2>/dev/null; echo 'Logs cleared'"
  ])

  // Navigate browser to reload the page
  console.log(`[Step 2] Reloading page for verification...`)
  const navCommand = `curl -s -X POST http://localhost:3684/mcp -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"execute_browser_action","arguments":{"action":"navigate","params":{"url":"http://localhost:3000"}}}}'`
  await runSandboxCommand(sandbox, "bash", ["-c", navCommand])

  // Wait for page to load and CLS to be captured
  console.log(`[Step 2] Waiting 5s for page load and CLS capture...`)
  await new Promise((resolve) => setTimeout(resolve, 5000))

  // Fetch fresh d3k artifacts
  console.log(`[Step 2] Fetching after-fix d3k artifacts...`)
  const afterArtifacts = await fetchAndUploadD3kArtifacts(sandbox, mcpUrl, `${projectName}-after`)

  // Extract after CLS score
  let afterClsScore = 0
  if (afterArtifacts.metadata) {
    const meta = afterArtifacts.metadata as { totalCLS?: number }
    afterClsScore = meta.totalCLS ?? 0
  }
  console.log(`[Step 2] After CLS: ${afterClsScore}`)

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

  console.log(`[Step 2] Verification: ${verificationStatus} (before: ${beforeScore}, after: ${afterClsScore})`)

  // Map screenshots to afterScreenshots format
  const afterScreenshots = afterArtifacts.clsScreenshots.map((s) => ({
    timestamp: s.timestamp,
    blobUrl: s.blobUrl,
    label: s.label
  }))
  console.log(`[Step 2] After Screenshots: ${afterScreenshots.length}`)

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
  console.log(`[Step 3] Compiling report: ${reportId}`)

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
  console.log(`[Step 3] Report saved: ${blobUrl}`)

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
  console.log(`[Step 4] Creating PR for ${repoOwner}/${repoName}...`)

  // TODO: Implement actual PR creation via GitHub API
  // For now, just log and return success
  console.log(`[Step 4] Git diff length: ${gitDiff.length}`)
  console.log(`[Step 4] Report URL: ${reportBlobUrl}`)
  console.log(`[Step 4] Base branch: ${baseBranch}`)

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
  console.log(`[Cleanup] Stopping sandbox: ${sandboxId}`)

  try {
    const sandbox = await Sandbox.get({ sandboxId })
    if (sandbox.status === "running") {
      await sandbox.stop()
      console.log(`[Cleanup] Sandbox stopped`)
    } else {
      console.log(`[Cleanup] Sandbox already stopped (status: ${sandbox.status})`)
    }
  } catch (error) {
    console.log(`[Cleanup] Error stopping sandbox: ${error instanceof Error ? error.message : String(error)}`)
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
 */
async function fetchAndUploadD3kArtifacts(
  sandbox: Sandbox,
  mcpUrl: string,
  projectName: string
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
    // Call fix_my_jank MCP tool to get CLS data
    console.log(`[D3k Artifacts] Calling fix_my_jank...`)
    const response = await fetch(`${mcpUrl}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "fix_my_jank",
          arguments: { timeRangeMinutes: 5 }
        }
      })
    })

    if (response.ok) {
      const text = await response.text()
      // Parse SSE response
      for (const line of text.split("\n")) {
        if (line.startsWith("data: ")) {
          try {
            const json = JSON.parse(line.substring(6))
            if (json.result?.content) {
              for (const content of json.result.content) {
                if (content.type === "text") {
                  // Try to parse as JSON metadata
                  try {
                    const parsed = JSON.parse(content.text)
                    if (parsed.clsScore !== undefined || parsed.totalCLS !== undefined) {
                      result.metadata = parsed
                    }
                  } catch {
                    // Not JSON, might be diagnostic text
                  }
                } else if (content.type === "image") {
                  // Upload screenshot to blob
                  const imageData = content.data
                  const timestamp = Date.now()
                  const filename = `cls-screenshot-${projectName}-${timestamp}.png`
                  const imageBuffer = Buffer.from(imageData, "base64")
                  const blob = await put(filename, imageBuffer, {
                    access: "public",
                    contentType: "image/png"
                  })
                  result.clsScreenshots.push({
                    label: `cls-${timestamp}`,
                    blobUrl: blob.url,
                    timestamp
                  })
                }
              }
            }
          } catch {
            // Parse error, continue
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
    }

    // If no screenshots from MCP response, try to fetch them from the d3k server
    if (result.clsScreenshots.length === 0) {
      console.log(`[D3k Artifacts] No screenshots in MCP response, fetching from d3k server...`)
      const screenshots = await fetchScreenshotsFromD3k(mcpUrl, projectName)
      result.clsScreenshots = screenshots
    }

    console.log(
      `[D3k Artifacts] Summary: ${result.clsScreenshots.length} screenshots, metadata: ${result.metadata ? "yes" : "no"}`
    )
  } catch (error) {
    console.log(`[D3k Artifacts] Error: ${error instanceof Error ? error.message : String(error)}`)
  }

  return result
}

/**
 * Fetch screenshots from d3k server's screenshot API and upload to blob storage
 */
async function fetchScreenshotsFromD3k(
  mcpUrl: string,
  projectName: string
): Promise<Array<{ label: string; blobUrl: string; timestamp: number }>> {
  const screenshots: Array<{ label: string; blobUrl: string; timestamp: number }> = []

  try {
    // d3k MCP server runs on a different port - extract base URL
    // mcpUrl is like https://sb-xxxxx.vercel.run (the MCP sandbox URL)
    // The d3k server API endpoints are at the same host
    const baseUrl = mcpUrl.replace(/\/mcp$/, "")

    // Fetch list of screenshots from d3k API
    console.log(`[D3k Screenshots] Fetching screenshot list from ${baseUrl}/api/screenshots/list`)
    const listResponse = await fetch(`${baseUrl}/api/screenshots/list`, {
      method: "GET",
      headers: { Accept: "application/json" }
    })

    if (!listResponse.ok) {
      console.log(`[D3k Screenshots] List API returned ${listResponse.status}`)
      return screenshots
    }

    // The API returns { files: ["filename1.png", "filename2.png", ...] }
    const listData = (await listResponse.json()) as { files?: string[] }
    const screenshotFiles = listData.files || []

    console.log(`[D3k Screenshots] Found ${screenshotFiles.length} screenshots`)

    // Fetch and upload each screenshot (limit to most recent 5)
    const recentScreenshots = screenshotFiles.slice(-5)
    for (const filename of recentScreenshots) {
      try {
        console.log(`[D3k Screenshots] Fetching ${filename}...`)

        const imageResponse = await fetch(`${baseUrl}/api/screenshots/${filename}`)
        if (!imageResponse.ok) {
          console.log(`[D3k Screenshots] Failed to fetch ${filename}: ${imageResponse.status}`)
          continue
        }

        const imageBuffer = Buffer.from(await imageResponse.arrayBuffer())
        // Extract timestamp from filename if it has ISO format, otherwise use current time
        // Filenames are like: 2025-12-11T18-57-08-789Z-page-loaded.png
        const timestampMatch = filename.match(/^(\d{4}-\d{2}-\d{2}T[\d-]+Z)/)
        const timestamp = timestampMatch
          ? new Date(timestampMatch[1].replace(/-(\d{2})-(\d{2})-(\d{3})Z/, ":$1:$2.$3Z")).getTime()
          : Date.now()
        const blobFilename = `cls-screenshot-${projectName}-${timestamp}.png`

        const blob = await put(blobFilename, imageBuffer, {
          access: "public",
          contentType: "image/png"
        })

        screenshots.push({
          label: filename.replace(".png", ""),
          blobUrl: blob.url,
          timestamp
        })

        console.log(`[D3k Screenshots] Uploaded ${filename} to ${blob.url}`)
      } catch (err) {
        console.log(
          `[D3k Screenshots] Error processing screenshot: ${err instanceof Error ? err.message : String(err)}`
        )
      }
    }
  } catch (error) {
    console.log(
      `[D3k Screenshots] Error fetching screenshots: ${error instanceof Error ? error.message : String(error)}`
    )
  }

  return screenshots
}

/**
 * Create tools for AI agent to use in sandbox
 */
function createD3kSandboxTools(sandbox: Sandbox, _mcpUrl: string) {
  const SANDBOX_CWD = "/vercel/sandbox"

  return {
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
  logAnalysis: string
): Promise<string> {
  console.log("[Agent] Starting AI agent with d3k sandbox tools...")

  const gateway = createGateway({
    apiKey: process.env.AI_GATEWAY_API_KEY,
    baseURL: "https://ai-gateway.vercel.sh/v1/ai"
  })

  const model = gateway("anthropic/claude-sonnet-4-20250514")
  const tools = createD3kSandboxTools(sandbox, mcpUrl)

  const systemPrompt = `You are a CLS (Cumulative Layout Shift) specialist engineer. Your ONLY focus is fixing layout shift issues.

## TOOLS AVAILABLE
- readFile: Read source files
- globSearch: Find files by pattern
- grepSearch: Search for code patterns
- listDirectory: Explore project structure
- writeFile: Write fixes to files
- verifyChanges: Check if changes work
- getGitDiff: Review your changes

## WORKFLOW
1. Understand the CLS issue from diagnostic data
2. Find the source files causing the issue
3. Read the relevant files
4. Write fixes using writeFile
5. Call verifyChanges to check for errors
6. If errors, fix them and verify again
7. Call getGitDiff at the end

## CLS KNOWLEDGE
CLS measures visual stability. Good score is 0.1 or less.

Causes:
- Images without dimensions
- Dynamic content insertion
- Web fonts causing FOIT/FOUT
- Async components without placeholders

Fixes:
- Add width/height to images
- Reserve space with min-height or skeleton loaders
- Use font-display: optional
- Wrap async components with sized Suspense fallbacks

## OUTPUT FORMAT
After fixing, provide:
- Summary of what was fixed
- Root cause
- Verification result
- Git diff

## RULES
1. Only fix CLS issues
2. If CLS < 0.05, report "NO CLS ISSUES"
3. Always read files before modifying
4. Make minimal, targeted fixes
5. Always verify changes work`

  const userPrompt = `Dev server: ${devUrl}

Diagnostic data:
${logAnalysis}

Please investigate and fix any CLS issues.`

  const { text, steps } = await generateText({
    model,
    system: systemPrompt,
    prompt: userPrompt,
    tools,
    stopWhen: stepCountIs(20)
  })

  console.log(`[Agent] Completed in ${steps.length} step(s)`)

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
