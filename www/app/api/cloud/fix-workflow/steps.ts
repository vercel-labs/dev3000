/**
 * Steps for Cloud Fix Workflow - Simplified "Local-style" Architecture
 *
 * The agent has a `diagnose` tool that gives real-time CLS feedback,
 * just like the local `fix_my_app` experience. This lets the agent
 * iterate internally instead of external workflow orchestration.
 */

import { put } from "@vercel/blob"
import { Sandbox } from "@vercel/sandbox"
import { createGateway, generateText, stepCountIs, tool } from "ai"
import { z } from "zod"
import { createD3kSandbox as createD3kSandboxUtil } from "@/lib/cloud/d3k-sandbox"
import { saveWorkflowRun, type WorkflowType } from "@/lib/workflow-storage"
import type { WorkflowReport } from "@/types"

const workflowLog = console.log

// Progress context for updating workflow status
interface ProgressContext {
  userId: string
  timestamp: string
  runId: string
  projectName: string
  workflowType?: string
}

// Helper to update workflow progress
async function updateProgress(
  ctx: ProgressContext | null | undefined,
  stepNumber: number,
  currentStep: string,
  sandboxUrl?: string
) {
  if (!ctx) return
  try {
    await saveWorkflowRun({
      id: ctx.runId,
      userId: ctx.userId,
      projectName: ctx.projectName,
      timestamp: ctx.timestamp,
      status: "running",
      type: (ctx.workflowType as WorkflowType) || "cls-fix",
      stepNumber,
      currentStep,
      sandboxUrl
    })
    workflowLog(`[Progress] Updated: Step ${stepNumber} - ${currentStep}`)
  } catch (err) {
    workflowLog(`[Progress] Failed to update: ${err instanceof Error ? err.message : String(err)}`)
  }
}

// ============================================================
// STEP 1: Init Sandbox
// ============================================================

export async function initSandboxStep(
  repoUrl: string,
  branch: string,
  projectName: string,
  reportId: string,
  startPath: string,
  vercelOidcToken?: string,
  progressContext?: ProgressContext | null
): Promise<{
  sandboxId: string
  devUrl: string
  mcpUrl: string
  reportId: string
  beforeCls: number | null
  beforeGrade: "good" | "needs-improvement" | "poor" | null
  beforeScreenshots: Array<{ timestamp: number; blobUrl: string; label?: string }>
  initD3kLogs: string
}> {
  workflowLog(`[Init] Creating sandbox for ${projectName}...`)
  await updateProgress(progressContext, 1, "Creating sandbox environment...")

  if (vercelOidcToken && !process.env.VERCEL_OIDC_TOKEN) {
    process.env.VERCEL_OIDC_TOKEN = vercelOidcToken
  }

  // Create sandbox
  const sandboxResult = await createD3kSandboxUtil({
    repoUrl,
    branch,
    projectDir: "",
    packageManager: "pnpm",
    timeout: "30m",
    debug: true
  })

  workflowLog(`[Init] Sandbox: ${sandboxResult.sandbox.sandboxId}`)
  workflowLog(`[Init] Dev URL: ${sandboxResult.devUrl}`)
  await updateProgress(progressContext, 1, "Sandbox created, starting dev server...", sandboxResult.devUrl)

  // Wait for d3k to capture initial CLS
  workflowLog(`[Init] Waiting for d3k CLS capture...`)
  await updateProgress(progressContext, 1, "Dev server running, capturing initial CLS...")
  await new Promise((resolve) => setTimeout(resolve, 5000))

  // Get CLS data from d3k
  const clsData = await fetchClsData(sandboxResult.sandbox, sandboxResult.mcpUrl, projectName)

  workflowLog(`[Init] Before CLS: ${clsData.clsScore} (${clsData.clsGrade})`)
  workflowLog(`[Init] Captured ${clsData.d3kLogs.length} chars of d3k logs`)
  await updateProgress(
    progressContext,
    1,
    `Initial CLS: ${clsData.clsScore?.toFixed(3) || "unknown"} (${clsData.clsGrade || "measuring..."})`,
    sandboxResult.devUrl
  )

  return {
    sandboxId: sandboxResult.sandbox.sandboxId,
    devUrl: sandboxResult.devUrl,
    mcpUrl: sandboxResult.mcpUrl,
    reportId,
    beforeCls: clsData.clsScore,
    beforeGrade: clsData.clsGrade,
    beforeScreenshots: clsData.screenshots,
    initD3kLogs: clsData.d3kLogs
  }
}

// ============================================================
// STEP 2: Agent Fix Loop (with internal iteration)
// ============================================================

export async function agentFixLoopStep(
  sandboxId: string,
  devUrl: string,
  mcpUrl: string,
  beforeCls: number | null,
  beforeGrade: "good" | "needs-improvement" | "poor" | null,
  beforeScreenshots: Array<{ timestamp: number; blobUrl: string; label?: string }>,
  initD3kLogs: string,
  projectName: string,
  reportId: string,
  startPath: string,
  customPrompt?: string,
  progressContext?: ProgressContext | null
): Promise<{
  reportBlobUrl: string
  reportId: string
  beforeCls: number | null
  afterCls: number | null
  status: "improved" | "unchanged" | "degraded" | "no-changes"
  agentSummary: string
  gitDiff: string | null
}> {
  workflowLog(`[Agent] Reconnecting to sandbox: ${sandboxId}`)
  await updateProgress(progressContext, 2, "AI agent analyzing CLS issues...", devUrl)

  const sandbox = await Sandbox.get({ sandboxId })
  if (sandbox.status !== "running") {
    throw new Error(`Sandbox not running: ${sandbox.status}`)
  }

  // Capture "before" Web Vitals via CDP before the agent makes any changes
  workflowLog("[Agent] Capturing before Web Vitals via CDP...")
  const capturedBeforeWebVitals = await fetchWebVitalsViaCDP(sandbox)
  workflowLog(`[Agent] Before Web Vitals captured: ${JSON.stringify(capturedBeforeWebVitals)}`)

  // Run the agent with the new "diagnose" tool
  const agentResult = await runAgentWithDiagnoseTool(
    sandbox,
    devUrl,
    mcpUrl,
    beforeCls,
    beforeGrade,
    startPath,
    customPrompt
  )
  await updateProgress(progressContext, 3, "Agent finished, verifying CLS improvements...", devUrl)

  // Force a fresh page reload to capture new CLS measurement
  // The agent might not have called diagnose after its last change
  //
  // IMPORTANT: We use Page.reload instead of navigating to about:blank and back.
  // Reason: d3k's screencast manager checks window.location.href when navigation starts.
  // When navigating FROM about:blank TO localhost, the URL check still sees about:blank
  // (because the navigation just started), so it SKIPS capture. Page.reload avoids this.
  workflowLog("[Agent] Forcing page reload to capture final CLS...")
  const D3K_MCP_PORT = 3684

  // First navigate to localhost (NOT the public devUrl!) so CLS capture works
  // The screencast-manager only captures for localhost:3000, not the public sb-xxx.vercel.run URL
  const targetUrl = `http://localhost:3000${startPath}`
  const navCmd = `curl -s -m 30 -X POST http://localhost:${D3K_MCP_PORT}/mcp -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"execute_browser_action","arguments":{"action":"navigate","params":{"url":"${targetUrl}"}}}}'`
  const navResult = await runSandboxCommand(sandbox, "bash", ["-c", navCmd])
  workflowLog(
    `[Agent] Navigate to devUrl result: exit=${navResult.exitCode}, stdout=${navResult.stdout.substring(0, 200)}`
  )
  await new Promise((resolve) => setTimeout(resolve, 2000))

  // Now reload the page to trigger fresh CLS capture
  // Use native CDP Page.reload action for reliable page refresh
  const reloadCmd = `curl -s -m 30 -X POST http://localhost:${D3K_MCP_PORT}/mcp -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"execute_browser_action","arguments":{"action":"reload"}}}'`
  const reloadResult = await runSandboxCommand(sandbox, "bash", ["-c", reloadCmd])
  workflowLog(
    `[Agent] Page.reload result: exit=${reloadResult.exitCode}, stdout=${reloadResult.stdout.substring(0, 200)}`
  )
  workflowLog("[Agent] Waiting for CLS to be captured...")
  await new Promise((resolve) => setTimeout(resolve, 8000)) // 8 seconds for CLS to be detected

  // Get final CLS measurement
  const finalCls = await fetchClsData(sandbox, mcpUrl, `${projectName}-after`)

  // Get git diff (exclude package.json which gets modified by sandbox initialization)
  const diffResult = await runSandboxCommand(sandbox, "sh", [
    "-c",
    "cd /vercel/sandbox && git diff --no-color -- . ':!package.json' ':!package-lock.json' ':!pnpm-lock.yaml' 2>/dev/null || echo ''"
  ])
  const gitDiff = diffResult.stdout.trim() || null
  const hasChanges = !!gitDiff && gitDiff.length > 0

  // Determine status
  let status: "improved" | "unchanged" | "degraded" | "no-changes"
  if (!hasChanges) {
    status = "no-changes"
  } else if (finalCls.clsScore !== null && beforeCls !== null) {
    if (finalCls.clsScore < beforeCls * 0.9) {
      status = "improved"
    } else if (finalCls.clsScore > beforeCls * 1.1) {
      status = "degraded"
    } else {
      status = "unchanged"
    }
  } else {
    status = "unchanged"
  }

  workflowLog(`[Agent] Status: ${status}, Before: ${beforeCls}, After: ${finalCls.clsScore}`)
  await updateProgress(
    progressContext,
    4,
    `Generating report... (CLS: ${beforeCls?.toFixed(3) || "?"} → ${finalCls.clsScore?.toFixed(3) || "?"})`,
    devUrl
  )

  // Separate d3k logs for Step 1 (init) and Step 2 (after fix)
  const afterD3kLogs = finalCls.d3kLogs.replace(initD3kLogs, "").trim() || "(no new logs)"
  const combinedD3kLogs = `=== Step 1: Init (before agent) ===\n${initD3kLogs}\n\n=== Step 2: After agent fix ===\n${afterD3kLogs}`

  // Determine workflow type from progress context
  const workflowType = (progressContext?.workflowType as "cls-fix" | "prompt") || "cls-fix"

  // Fetch "after" Web Vitals directly from browser via CDP (more reliable than parsing logs)
  workflowLog("[Agent] Fetching after Web Vitals via CDP...")
  const afterWebVitals = await fetchWebVitalsViaCDP(sandbox)

  // Use the capturedBeforeWebVitals we got at the start of this function
  // Merge with the beforeCls we got from init step if CDP didn't capture it
  const beforeWebVitals: import("@/types").WebVitals = { ...capturedBeforeWebVitals }
  if (!beforeWebVitals.cls && beforeCls !== null) {
    beforeWebVitals.cls = {
      value: beforeCls,
      grade: beforeCls <= 0.1 ? "good" : beforeCls <= 0.25 ? "needs-improvement" : "poor"
    }
  }

  workflowLog(`[Agent] Before Web Vitals: ${JSON.stringify(beforeWebVitals)}`)
  workflowLog(`[Agent] After Web Vitals: ${JSON.stringify(afterWebVitals)}`)

  // Generate report inline
  const report: WorkflowReport = {
    id: reportId,
    projectName,
    timestamp: new Date().toISOString(),
    workflowType,
    customPrompt: customPrompt ?? undefined,
    systemPrompt: agentResult.systemPrompt,
    sandboxDevUrl: devUrl,
    sandboxMcpUrl: mcpUrl,
    clsScore: beforeCls ?? undefined,
    clsGrade: beforeGrade ?? undefined,
    beforeScreenshots,
    beforeWebVitals: Object.keys(beforeWebVitals).length > 0 ? beforeWebVitals : undefined,
    afterClsScore: finalCls.clsScore ?? undefined,
    afterClsGrade: finalCls.clsGrade ?? undefined,
    afterScreenshots: finalCls.screenshots,
    afterWebVitals: Object.keys(afterWebVitals).length > 0 ? afterWebVitals : undefined,
    verificationStatus: status === "no-changes" ? "unchanged" : status,
    agentAnalysis: agentResult.transcript,
    agentAnalysisModel: "anthropic/claude-sonnet-4-20250514",
    gitDiff: gitDiff ?? undefined,
    d3kLogs: combinedD3kLogs,
    initD3kLogs: initD3kLogs,
    afterD3kLogs: afterD3kLogs
  }

  const blob = await put(`report-${reportId}.json`, JSON.stringify(report, null, 2), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true
  })

  workflowLog(`[Agent] Report saved: ${blob.url}`)

  return {
    reportBlobUrl: blob.url,
    reportId,
    beforeCls,
    afterCls: finalCls.clsScore,
    status,
    agentSummary: agentResult.summary,
    gitDiff
  }
}

// ============================================================
// Agent with Diagnose Tool
// ============================================================

async function runAgentWithDiagnoseTool(
  sandbox: Sandbox,
  devUrl: string,
  _mcpUrl: string,
  beforeCls: number | null,
  beforeGrade: "good" | "needs-improvement" | "poor" | null,
  startPath: string,
  customPrompt?: string
): Promise<{ transcript: string; summary: string; systemPrompt: string }> {
  const SANDBOX_CWD = "/vercel/sandbox"
  const D3K_MCP_PORT = 3684

  const gateway = createGateway({
    apiKey: process.env.AI_GATEWAY_API_KEY,
    baseURL: "https://ai-gateway.vercel.sh/v1/ai"
  })

  const model = gateway("anthropic/claude-sonnet-4-20250514")

  // Create tools - the key new one is `diagnose`
  const tools = {
    // THE KEY NEW TOOL: Like local fix_my_app
    diagnose: tool({
      description: `Get current CLS status from d3k - like running "fix_my_app" locally.
Returns real-time CLS score, which elements shifted, and jank screenshots.
USE THIS AFTER EVERY FIX to verify your changes worked!
This navigates the page fresh to get accurate measurements.`,
      inputSchema: z.object({
        reason: z.string().describe("Why you're running diagnosis (e.g., 'verify fix', 'initial check')")
      }),
      execute: async ({ reason }: { reason: string }) => {
        workflowLog(`[diagnose] Running: ${reason}`)

        // Reload the page to trigger fresh CLS capture
        // NOTE: Navigate to localhost:3000 + startPath, not the public devUrl!
        // The screencast-manager only captures CLS for localhost:3000, not sb-xxx.vercel.run
        const diagnoseUrl = `http://localhost:3000${startPath}`
        const navCmd = `curl -s -m 30 -X POST http://localhost:${D3K_MCP_PORT}/mcp -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"execute_browser_action","arguments":{"action":"navigate","params":{"url":"${diagnoseUrl}"}}}}'`
        await runSandboxCommand(sandbox, "bash", ["-c", navCmd])
        await new Promise((resolve) => setTimeout(resolve, 1000))

        const reloadCmd = `curl -s -m 30 -X POST http://localhost:${D3K_MCP_PORT}/mcp -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"execute_browser_action","arguments":{"action":"reload"}}}'`
        await runSandboxCommand(sandbox, "bash", ["-c", reloadCmd])

        await new Promise((resolve) => setTimeout(resolve, 5000))

        // Read d3k logs for CLS data
        const logsResult = await runSandboxCommand(sandbox, "sh", [
          "-c",
          'for log in /home/vercel-sandbox/.d3k/logs/*.log; do [ -f "$log" ] && tail -200 "$log" || true; done 2>/dev/null'
        ])
        const logs = logsResult.stdout || ""

        // Use timestamp-based logic to get CLS from the MOST RECENT page load
        // When CLS = 0, there's no "Detected" line - only "CLS observer installed"
        const observerMatches = [...logs.matchAll(/\[(\d{2}:\d{2}:\d{2}\.\d{3})\].*CLS observer installed/g)]
        const clsMatches = [
          ...logs.matchAll(/\[(\d{2}:\d{2}:\d{2}\.\d{3})\].*\[CDP\] Detected (\d+) layout shifts \(CLS: ([\d.]+)\)/g)
        ]

        if (observerMatches.length > 0) {
          const lastObserverTime = observerMatches[observerMatches.length - 1][1]
          const clsAfterObserver = clsMatches.filter((m) => m[1] > lastObserverTime)

          if (clsAfterObserver.length > 0) {
            // CLS detected after page load
            const lastCls = clsAfterObserver[clsAfterObserver.length - 1]
            const shiftCount = parseInt(lastCls[2], 10)
            const clsScore = parseFloat(lastCls[3])
            const grade = clsScore <= 0.1 ? "GOOD" : clsScore <= 0.25 ? "NEEDS-IMPROVEMENT" : "POOR"

            // Parse shift details from recent logs
            const shiftDetailRegex = /\[CDP\]\s+-\s+<(\w+)>\s+shifted\s+(.+)/g
            const shifts: string[] = []
            for (const match of logs.matchAll(shiftDetailRegex)) {
              shifts.push(`  - <${match[1]}> shifted ${match[2]}`)
            }

            const emoji = clsScore <= 0.1 ? "✅" : clsScore <= 0.25 ? "⚠️" : "❌"

            return `## CLS Diagnosis ${emoji}

**Score: ${clsScore.toFixed(4)}** (${grade})
**Shifts: ${shiftCount}**
${shifts.length > 0 ? `\n### Elements that shifted:\n${shifts.join("\n")}` : ""}

${clsScore <= 0.1 ? "🎉 CLS is GOOD! Fix successful!" : `⚠️ CLS still ${grade}. Before was: ${beforeCls?.toFixed(4) || "unknown"}`}`
          } else {
            // No CLS detected after observer = CLS is 0!
            return `## CLS Diagnosis ✅

**Score: 0.0000** (GOOD)
**Shifts: 0**

🎉 CLS is GOOD! No layout shifts detected. Fix successful!`
          }
        }

        // Fallback: no observer found
        return `## CLS Diagnosis

No CLS observer found in logs. Page may not have fully loaded.
Try running diagnose again.`
      }
    }),

    // Get all Core Web Vitals (LCP, FCP, TTFB, CLS, INP)
    getWebVitals: tool({
      description: `Get all Core Web Vitals performance metrics from the page.
Returns LCP (Largest Contentful Paint), FCP (First Contentful Paint), TTFB (Time to First Byte), CLS (Cumulative Layout Shift), and INP (Interaction to Next Paint) if available.
Use this to diagnose and verify performance improvements.`,
      inputSchema: z.object({
        reason: z.string().describe("Why you're checking performance metrics")
      }),
      execute: async ({ reason }: { reason: string }) => {
        workflowLog(`[getWebVitals] Running: ${reason}`)

        // Navigate to get fresh metrics
        const diagnoseUrl = `http://localhost:3000${startPath}`
        const navCmd = `curl -s -m 30 -X POST http://localhost:${D3K_MCP_PORT}/mcp -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"execute_browser_action","arguments":{"action":"navigate","params":{"url":"${diagnoseUrl}"}}}}'`
        await runSandboxCommand(sandbox, "bash", ["-c", navCmd])
        await new Promise((resolve) => setTimeout(resolve, 3000))

        // Get Web Vitals directly from browser using execute_browser_action with evaluate
        const webVitalsScript = `(function() {
          const lcpEntries = performance.getEntriesByType('largest-contentful-paint');
          const fcpEntries = performance.getEntriesByName('first-contentful-paint');
          const clsEntries = performance.getEntriesByType('layout-shift');
          const fidEntries = performance.getEntriesByType('first-input');
          const navTiming = performance.getEntriesByType('navigation')[0] || performance.timing;
          return JSON.stringify({
            lcp: lcpEntries.length > 0 ? lcpEntries[lcpEntries.length - 1].startTime : null,
            fcp: fcpEntries.length > 0 ? fcpEntries[0].startTime : null,
            ttfb: navTiming.responseStart ? (navTiming.responseStart - (navTiming.startTime || navTiming.navigationStart || 0)) : null,
            cls: clsEntries.reduce((sum, e) => sum + (e.hadRecentInput ? 0 : e.value), 0),
            fid: fidEntries.length > 0 ? fidEntries[0].processingStart - fidEntries[0].startTime : null
          });
        })()`

        const evalCmd = `curl -s -m 30 -X POST http://localhost:${D3K_MCP_PORT}/mcp -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" -d '${JSON.stringify(
          {
            jsonrpc: "2.0",
            id: 1,
            method: "tools/call",
            params: {
              name: "execute_browser_action",
              arguments: {
                action: "evaluate",
                params: { expression: webVitalsScript }
              }
            }
          }
        ).replace(/'/g, "'\\''")}'`

        const evalResult = await runSandboxCommand(sandbox, "bash", ["-c", evalCmd])
        workflowLog(`[getWebVitals] Eval result: ${evalResult.stdout.substring(0, 500)}`)

        // Parse the result
        let vitals: { lcp: number | null; fcp: number | null; ttfb: number | null; cls: number; fid: number | null } = {
          lcp: null,
          fcp: null,
          ttfb: null,
          cls: 0,
          fid: null
        }

        try {
          // Parse MCP response to get the evaluate result
          const mcpResponse = JSON.parse(evalResult.stdout)
          if (mcpResponse.result?.content?.[0]?.text) {
            const resultText = mcpResponse.result.content[0].text
            // Extract the JSON object after "Result:" - use a more robust regex that handles nested JSON
            const resultJsonMatch = resultText.match(/Result:\s*(\{[\s\S]*\})/)
            if (resultJsonMatch) {
              const innerResult = JSON.parse(resultJsonMatch[1])
              // The execute_browser_action tool returns {value: "<json>"}, not {result: {value: ...}}
              if (innerResult.value) {
                vitals = JSON.parse(innerResult.value)
              }
            }
          }
        } catch (e) {
          workflowLog(`[getWebVitals] Failed to parse result: ${e}`)
        }

        // Build report with grades
        const metrics: Record<string, { value: string; grade: string }> = {}

        // LCP (Largest Contentful Paint) - good: ≤2.5s, needs improvement: ≤4s, poor: >4s
        if (vitals.lcp !== null) {
          const grade = vitals.lcp <= 2500 ? "GOOD ✅" : vitals.lcp <= 4000 ? "NEEDS IMPROVEMENT ⚠️" : "POOR ❌"
          metrics.LCP = { value: `${vitals.lcp.toFixed(0)}ms`, grade }
        }

        // FCP (First Contentful Paint) - good: ≤1.8s, needs improvement: ≤3s, poor: >3s
        if (vitals.fcp !== null) {
          const grade = vitals.fcp <= 1800 ? "GOOD ✅" : vitals.fcp <= 3000 ? "NEEDS IMPROVEMENT ⚠️" : "POOR ❌"
          metrics.FCP = { value: `${vitals.fcp.toFixed(0)}ms`, grade }
        }

        // TTFB (Time to First Byte) - good: ≤800ms, needs improvement: ≤1800ms, poor: >1800ms
        if (vitals.ttfb !== null) {
          const grade = vitals.ttfb <= 800 ? "GOOD ✅" : vitals.ttfb <= 1800 ? "NEEDS IMPROVEMENT ⚠️" : "POOR ❌"
          metrics.TTFB = { value: `${vitals.ttfb.toFixed(0)}ms`, grade }
        }

        // CLS (Cumulative Layout Shift) - good: ≤0.1, needs improvement: ≤0.25, poor: >0.25
        const clsGrade = vitals.cls <= 0.1 ? "GOOD ✅" : vitals.cls <= 0.25 ? "NEEDS IMPROVEMENT ⚠️" : "POOR ❌"
        metrics.CLS = { value: vitals.cls.toFixed(4), grade: clsGrade }

        // FID/INP (First Input Delay) - good: ≤100ms, needs improvement: ≤300ms, poor: >300ms
        if (vitals.fid !== null) {
          const grade = vitals.fid <= 100 ? "GOOD ✅" : vitals.fid <= 300 ? "NEEDS IMPROVEMENT ⚠️" : "POOR ❌"
          metrics.FID = { value: `${vitals.fid.toFixed(0)}ms`, grade }
        }

        // Build report
        let report = "## Web Vitals Report\n\n"
        for (const [name, data] of Object.entries(metrics)) {
          report += `**${name}:** ${data.value} (${data.grade})\n`
        }

        // Add thresholds reference
        report += `
### Thresholds Reference
- **LCP** (Largest Contentful Paint): Good ≤2.5s, Needs Improvement ≤4s
- **FCP** (First Contentful Paint): Good ≤1.8s, Needs Improvement ≤3s
- **TTFB** (Time to First Byte): Good ≤800ms, Needs Improvement ≤1.8s
- **CLS** (Cumulative Layout Shift): Good ≤0.1, Needs Improvement ≤0.25
- **FID** (First Input Delay): Good ≤100ms, Needs Improvement ≤300ms`

        return report
      }
    }),

    readFile: tool({
      description: "Read a file from the codebase.",
      inputSchema: z.object({
        path: z.string().describe("File path relative to project root")
      }),
      execute: async ({ path }: { path: string }) => {
        const result = await runSandboxCommand(sandbox, "sh", [
          "-c",
          `head -n 500 "${SANDBOX_CWD}/${path}" 2>&1 || echo "ERROR: File not found"`
        ])
        return result.stdout.startsWith("ERROR:") ? result.stdout : `\`\`\`\n${result.stdout}\n\`\`\``
      }
    }),

    writeFile: tool({
      description: "Write/overwrite a file. Use this to fix CLS issues.",
      inputSchema: z.object({
        path: z.string().describe("File path relative to project root"),
        content: z.string().describe("Complete file content")
      }),
      execute: async ({ path, content }: { path: string; content: string }) => {
        const result = await runSandboxCommand(sandbox, "sh", [
          "-c",
          `cat > "${SANDBOX_CWD}/${path}" << 'FILEEOF'\n${content}\nFILEEOF`
        ])
        if (result.exitCode !== 0) return `Failed: ${result.stderr}`
        // Wait for HMR
        await new Promise((resolve) => setTimeout(resolve, 2000))
        return `✅ Wrote ${content.length} chars to ${path}. HMR should apply changes. Run diagnose to verify!`
      }
    }),

    globSearch: tool({
      description: "Find files by pattern.",
      inputSchema: z.object({
        pattern: z.string().describe("Glob pattern like '*.tsx' or 'layout.*'")
      }),
      execute: async ({ pattern }: { pattern: string }) => {
        const result = await runSandboxCommand(sandbox, "sh", [
          "-c",
          `cd ${SANDBOX_CWD} && find . -type f -name "${pattern}" 2>/dev/null | head -20 | sed 's|^\\./||'`
        ])
        return result.stdout.trim() || "No files found"
      }
    }),

    grepSearch: tool({
      description: "Search for text in files.",
      inputSchema: z.object({
        pattern: z.string().describe("Search pattern"),
        fileGlob: z.string().optional().describe("File pattern to search in")
      }),
      execute: async ({ pattern, fileGlob }: { pattern: string; fileGlob?: string }) => {
        const include = fileGlob ? `--include="${fileGlob}"` : ""
        const result = await runSandboxCommand(sandbox, "sh", [
          "-c",
          `cd ${SANDBOX_CWD} && grep -rn ${include} "${pattern}" . 2>/dev/null | head -20`
        ])
        return result.stdout.trim() || "No matches"
      }
    }),

    listDir: tool({
      description: "List directory contents.",
      inputSchema: z.object({
        path: z.string().optional().describe("Directory path")
      }),
      execute: async ({ path = "" }: { path?: string }) => {
        const result = await runSandboxCommand(sandbox, "sh", [
          "-c",
          `ls -la "${path ? `${SANDBOX_CWD}/${path}` : SANDBOX_CWD}" 2>&1`
        ])
        return result.stdout
      }
    }),

    gitDiff: tool({
      description: "Get git diff of your changes.",
      inputSchema: z.object({}),
      execute: async () => {
        const result = await runSandboxCommand(sandbox, "sh", [
          "-c",
          `cd ${SANDBOX_CWD} && git diff --no-color 2>/dev/null || echo "No changes"`
        ])
        return result.stdout.trim() || "No changes"
      }
    })
  }

  // Build system prompt based on whether this is a custom prompt or CLS fix
  const systemPrompt = customPrompt
    ? buildEnhancedPrompt(customPrompt, startPath, devUrl)
    : buildClsFixPrompt(beforeCls, beforeGrade, startPath)

  // Build user prompt based on workflow type
  const userPromptMessage = customPrompt
    ? `Proceed with the task. The dev server is running at ${devUrl}`
    : `Fix the CLS issues on the ${startPath} page of this app. Dev URL: ${devUrl}\n\nStart with diagnose to see what's shifting, then fix it.`

  const { text, steps } = await generateText({
    model,
    system: systemPrompt,
    prompt: userPromptMessage,
    tools,
    stopWhen: stepCountIs(15) // Enough for: diagnose + find(2) + read + write + diagnose + buffer
  })

  workflowLog(`[Agent] Completed in ${steps.length} steps`)

  // Build transcript in format expected by agent-analysis.tsx parser
  const transcript: string[] = []

  // Include system prompt for full transparency
  transcript.push("## System Prompt")
  transcript.push("```")
  transcript.push(systemPrompt)
  transcript.push("```")
  transcript.push("")

  // Include user prompt
  transcript.push("## User Prompt")
  transcript.push("```")
  transcript.push(userPromptMessage)
  transcript.push("```")
  transcript.push("")

  transcript.push(`## Agent Execution (${steps.length} steps)\n`)

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]
    transcript.push(`### Step ${i + 1}`)

    // Assistant text (reasoning/thinking)
    if (step.text) {
      transcript.push("**Assistant:**")
      transcript.push(step.text)
    }

    // Tool calls and results
    if (step.toolCalls?.length) {
      for (let j = 0; j < step.toolCalls.length; j++) {
        const tc = step.toolCalls[j] as unknown as { toolName: string; input?: unknown }
        const tr = step.toolResults?.[j] as unknown as { output?: unknown } | undefined

        transcript.push(`\n**Tool Call: ${tc.toolName}**`)
        transcript.push("```json")
        transcript.push(JSON.stringify(tc.input || {}, null, 2))
        transcript.push("```")

        let result =
          tr?.output !== undefined
            ? typeof tr.output === "string"
              ? tr.output
              : JSON.stringify(tr.output)
            : "[no result]"
        if (result.length > 1500) result = `${result.substring(0, 1500)}\n...[truncated]`
        transcript.push("**Tool Result:**")
        transcript.push("```")
        transcript.push(result)
        transcript.push("```")
      }
    }
    transcript.push("")
  }

  transcript.push("## Final Output")
  transcript.push("")
  transcript.push(text)

  return {
    transcript: transcript.join("\n"),
    summary: text,
    systemPrompt
  }
}

// ============================================================
// Helper Functions
// ============================================================

async function runSandboxCommand(
  sandbox: Sandbox,
  cmd: string,
  args: string[]
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const result = await sandbox.runCommand({ cmd, args })
  let stdout = ""
  let stderr = ""
  for await (const log of result.logs()) {
    if (log.stream === "stdout") stdout += log.data
    else stderr += log.data
  }
  await result.wait()
  return { exitCode: result.exitCode, stdout, stderr }
}

async function fetchClsData(
  sandbox: Sandbox,
  mcpUrl: string,
  projectName: string
): Promise<{
  clsScore: number | null
  clsGrade: "good" | "needs-improvement" | "poor" | null
  screenshots: Array<{ timestamp: number; blobUrl: string; label?: string }>
  d3kLogs: string
}> {
  const result = {
    clsScore: null as number | null,
    clsGrade: null as "good" | "needs-improvement" | "poor" | null,
    screenshots: [] as Array<{ timestamp: number; blobUrl: string; label?: string }>,
    d3kLogs: ""
  }

  try {
    // Read d3k logs for CLS
    const logsResult = await runSandboxCommand(sandbox, "sh", [
      "-c",
      'for log in /home/vercel-sandbox/.d3k/logs/*.log; do [ -f "$log" ] && cat "$log"; done 2>/dev/null || echo ""'
    ])

    // Store the full logs
    result.d3kLogs = logsResult.stdout || ""

    // Log diagnostic info about the log file
    workflowLog(`[fetchClsData] Log file size: ${result.d3kLogs.length} chars`)
    // Show last 500 chars of logs for debugging
    const logTail = result.d3kLogs.slice(-500)
    workflowLog(`[fetchClsData] Log tail: ${logTail.replace(/\n/g, "\\n").substring(0, 300)}...`)

    // CRITICAL: We need to determine CLS from the MOST RECENT page load.
    // When CLS = 0, there's NO "Detected X layout shifts" line - only "CLS observer installed".
    // So we need to:
    // 1. Find the LAST "CLS observer installed" entry (marks a new page load)
    // 2. Check if there are any "Detected X layout shifts" entries AFTER it
    // 3. If none, CLS = 0 (no shifts detected on that page load)

    const logs = logsResult.stdout

    // Find all timestamps for "CLS observer installed" (marks new page loads)
    const observerMatches = [...logs.matchAll(/\[(\d{2}:\d{2}:\d{2}\.\d{3})\].*CLS observer installed/g)]
    // Find all CLS detection entries with timestamps
    const clsMatches = [
      ...logs.matchAll(/\[(\d{2}:\d{2}:\d{2}\.\d{3})\].*\[CDP\] Detected (\d+) layout shifts \(CLS: ([\d.]+)\)/g)
    ]

    workflowLog(`[fetchClsData] Found ${observerMatches.length} observer installs, ${clsMatches.length} CLS entries`)

    if (observerMatches.length > 0) {
      const lastObserverTime = observerMatches[observerMatches.length - 1][1]
      workflowLog(`[fetchClsData] Last observer install at: ${lastObserverTime}`)

      // Find CLS entries AFTER the last observer install
      const clsAfterObserver = clsMatches.filter((m) => m[1] > lastObserverTime)
      workflowLog(`[fetchClsData] CLS entries after last observer: ${clsAfterObserver.length}`)

      if (clsAfterObserver.length > 0) {
        // Use the LAST CLS entry after the observer
        const lastCls = clsAfterObserver[clsAfterObserver.length - 1]
        result.clsScore = parseFloat(lastCls[3])
        result.clsGrade = result.clsScore <= 0.1 ? "good" : result.clsScore <= 0.25 ? "needs-improvement" : "poor"
        workflowLog(`[fetchClsData] CLS after observer: ${result.clsScore} (${result.clsGrade})`)
      } else {
        // No CLS detected after observer = CLS is 0!
        result.clsScore = 0
        result.clsGrade = "good"
        workflowLog("[fetchClsData] No CLS detected after observer install = CLS is 0! (GOOD)")
      }
    } else if (clsMatches.length > 0) {
      // Fallback: no observer found, use last CLS entry
      const lastCls = clsMatches[clsMatches.length - 1]
      result.clsScore = parseFloat(lastCls[3])
      result.clsGrade = result.clsScore <= 0.1 ? "good" : result.clsScore <= 0.25 ? "needs-improvement" : "poor"
      workflowLog(`[fetchClsData] Fallback - using LAST CLS: ${result.clsScore} (${result.clsGrade})`)
    } else {
      workflowLog("[fetchClsData] No CLS entries found in logs!")
    }

    // Fetch screenshots
    const baseUrl = mcpUrl.replace(/\/mcp$/, "")
    const listResponse = await fetch(`${baseUrl}/api/screenshots/list`)
    if (listResponse.ok) {
      const listData = (await listResponse.json()) as { files?: string[] }
      const files = (listData.files || []).slice(-10) // Last 10 screenshots

      for (const filename of files) {
        try {
          const imageResponse = await fetch(`${baseUrl}/api/screenshots/${filename}`)
          if (imageResponse.ok) {
            const imageBuffer = Buffer.from(await imageResponse.arrayBuffer())
            const blob = await put(`cls-${projectName}-${Date.now()}-${filename}`, imageBuffer, {
              access: "public",
              contentType: "image/png"
            })
            result.screenshots.push({
              timestamp: Date.now(),
              blobUrl: blob.url,
              label: filename.replace(".png", "")
            })
          }
        } catch {
          // Skip failed uploads
        }
      }
    }
  } catch (err) {
    workflowLog(`[fetchClsData] Error: ${err instanceof Error ? err.message : String(err)}`)
  }

  return result
}

/**
 * Fetch Web Vitals using Chrome DevTools MCP performance trace
 * Uses performance_start_trace/performance_stop_trace for reliable metrics
 * Falls back to Performance API evaluation if trace fails
 */
async function fetchWebVitalsViaCDP(sandbox: Sandbox): Promise<import("@/types").WebVitals> {
  const vitals: import("@/types").WebVitals = {}
  const D3K_MCP_PORT = 3684

  // Helper to determine grade
  const gradeValue = (
    value: number,
    goodThreshold: number,
    needsImprovementThreshold: number
  ): "good" | "needs-improvement" | "poor" => {
    if (value <= goodThreshold) return "good"
    if (value <= needsImprovementThreshold) return "needs-improvement"
    return "poor"
  }

  try {
    // Method 1: Try Chrome DevTools MCP performance trace (most reliable for LCP, CLS, INP)
    workflowLog("[fetchWebVitals] Starting Chrome DevTools performance trace...")
    const startTraceCmd = `curl -s -m 60 -X POST http://localhost:${D3K_MCP_PORT}/mcp -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" -d '${JSON.stringify(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "chrome-devtools_performance_start_trace",
          arguments: {
            reload: true, // Reload page to capture fresh metrics
            autoStop: true // Automatically stop after page load
          }
        }
      }
    ).replace(/'/g, "'\\''")}'`

    const startTraceResult = await runSandboxCommand(sandbox, "bash", ["-c", startTraceCmd])
    workflowLog(`[fetchWebVitals] Start trace result: ${startTraceResult.stdout.substring(0, 500)}`)

    // Wait for the trace to capture page load and auto-stop (up to 15 seconds)
    workflowLog("[fetchWebVitals] Waiting for trace to complete...")
    await new Promise((resolve) => setTimeout(resolve, 8000))

    // Stop the trace and get results (in case autoStop didn't trigger)
    workflowLog("[fetchWebVitals] Stopping performance trace...")
    const stopTraceCmd = `curl -s -m 60 -X POST http://localhost:${D3K_MCP_PORT}/mcp -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" -d '${JSON.stringify(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "chrome-devtools_performance_stop_trace",
          arguments: {}
        }
      }
    ).replace(/'/g, "'\\''")}'`

    const stopTraceResult = await runSandboxCommand(sandbox, "bash", ["-c", stopTraceCmd])
    workflowLog(`[fetchWebVitals] Stop trace result: ${stopTraceResult.stdout.substring(0, 1000)}`)

    // Parse the trace results for Web Vitals
    try {
      const traceResponse = JSON.parse(stopTraceResult.stdout)
      const resultText = traceResponse.result?.content?.[0]?.text || ""
      workflowLog(`[fetchWebVitals] Trace result text: ${resultText.substring(0, 500)}`)

      // Parse LCP from trace (format: "LCP: 1234ms" or similar)
      const lcpMatch = resultText.match(/LCP[:\s]+(\d+(?:\.\d+)?)\s*(?:ms|milliseconds)/i)
      if (lcpMatch) {
        const lcpValue = parseFloat(lcpMatch[1])
        vitals.lcp = { value: lcpValue, grade: gradeValue(lcpValue, 2500, 4000) }
        workflowLog(`[fetchWebVitals] Extracted LCP from trace: ${lcpValue}ms`)
      }

      // Parse CLS from trace (format: "CLS: 0.123" or similar)
      const clsMatch = resultText.match(/CLS[:\s]+(\d+(?:\.\d+)?)/i)
      if (clsMatch) {
        const clsValue = parseFloat(clsMatch[1])
        vitals.cls = { value: clsValue, grade: gradeValue(clsValue, 0.1, 0.25) }
        workflowLog(`[fetchWebVitals] Extracted CLS from trace: ${clsValue}`)
      }

      // Parse FCP from trace
      const fcpMatch = resultText.match(/FCP[:\s]+(\d+(?:\.\d+)?)\s*(?:ms|milliseconds)/i)
      if (fcpMatch) {
        const fcpValue = parseFloat(fcpMatch[1])
        vitals.fcp = { value: fcpValue, grade: gradeValue(fcpValue, 1800, 3000) }
        workflowLog(`[fetchWebVitals] Extracted FCP from trace: ${fcpValue}ms`)
      }

      // Parse TTFB from trace
      const ttfbMatch = resultText.match(/TTFB[:\s]+(\d+(?:\.\d+)?)\s*(?:ms|milliseconds)/i)
      if (ttfbMatch) {
        const ttfbValue = parseFloat(ttfbMatch[1])
        vitals.ttfb = { value: ttfbValue, grade: gradeValue(ttfbValue, 800, 1800) }
        workflowLog(`[fetchWebVitals] Extracted TTFB from trace: ${ttfbValue}ms`)
      }

      // Parse INP from trace
      const inpMatch = resultText.match(/INP[:\s]+(\d+(?:\.\d+)?)\s*(?:ms|milliseconds)/i)
      if (inpMatch) {
        const inpValue = parseFloat(inpMatch[1])
        vitals.inp = { value: inpValue, grade: gradeValue(inpValue, 200, 500) }
        workflowLog(`[fetchWebVitals] Extracted INP from trace: ${inpValue}ms`)
      }
    } catch (traceParseErr) {
      workflowLog(`[fetchWebVitals] Trace parse error: ${traceParseErr}`)
    }

    // Method 2: Fallback to Performance API if trace didn't provide metrics
    if (!vitals.lcp || !vitals.cls) {
      workflowLog("[fetchWebVitals] Trace incomplete, falling back to Performance API...")

      // Trigger user interaction to finalize LCP (required for Performance API)
      const finalizeLcpCmd = `curl -s -m 30 -X POST http://localhost:${D3K_MCP_PORT}/mcp -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" -d '${JSON.stringify(
        {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            name: "execute_browser_action",
            arguments: {
              action: "evaluate",
              params: {
                expression: `
                  document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                  document.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                  'lcp-finalized'
                `
              }
            }
          }
        }
      ).replace(/'/g, "'\\''")}'`

      await runSandboxCommand(sandbox, "bash", ["-c", finalizeLcpCmd])
      await new Promise((resolve) => setTimeout(resolve, 500))

      // Get Web Vitals from Performance API
      const webVitalsScript = `(function() {
        const lcpEntries = performance.getEntriesByType('largest-contentful-paint');
        const fcpEntries = performance.getEntriesByName('first-contentful-paint');
        const clsEntries = performance.getEntriesByType('layout-shift');
        const navTiming = performance.getEntriesByType('navigation')[0] || performance.timing;
        return JSON.stringify({
          lcp: lcpEntries.length > 0 ? lcpEntries[lcpEntries.length - 1].startTime : null,
          fcp: fcpEntries.length > 0 ? fcpEntries[0].startTime : null,
          ttfb: navTiming.responseStart ? (navTiming.responseStart - (navTiming.startTime || navTiming.navigationStart || 0)) : null,
          cls: clsEntries.reduce((sum, e) => sum + (e.hadRecentInput ? 0 : e.value), 0)
        });
      })()`

      const evalCmd = `curl -s -m 30 -X POST http://localhost:${D3K_MCP_PORT}/mcp -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" -d '${JSON.stringify(
        {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            name: "execute_browser_action",
            arguments: {
              action: "evaluate",
              params: { expression: webVitalsScript }
            }
          }
        }
      ).replace(/'/g, "'\\''")}'`

      const evalResult = await runSandboxCommand(sandbox, "bash", ["-c", evalCmd])
      workflowLog(`[fetchWebVitals] Fallback CDP result: ${evalResult.stdout.substring(0, 500)}`)

      try {
        const mcpResponse = JSON.parse(evalResult.stdout)
        if (mcpResponse.result?.content?.[0]?.text) {
          const resultText = mcpResponse.result.content[0].text
          const resultJsonMatch = resultText.match(/Result:\s*(\{[\s\S]*\})/)
          if (resultJsonMatch) {
            const innerResult = JSON.parse(resultJsonMatch[1])
            // The execute_browser_action tool returns {value: "<json>"}, not {result: {value: ...}}
            if (innerResult.value) {
              const rawVitals = JSON.parse(innerResult.value)
              workflowLog(`[fetchWebVitals] Fallback vitals: ${JSON.stringify(rawVitals)}`)

              // Only use fallback values if we don't already have them from trace
              if (!vitals.lcp && rawVitals.lcp !== null) {
                vitals.lcp = { value: rawVitals.lcp, grade: gradeValue(rawVitals.lcp, 2500, 4000) }
              }
              if (!vitals.fcp && rawVitals.fcp !== null) {
                vitals.fcp = { value: rawVitals.fcp, grade: gradeValue(rawVitals.fcp, 1800, 3000) }
              }
              if (!vitals.ttfb && rawVitals.ttfb !== null) {
                vitals.ttfb = { value: rawVitals.ttfb, grade: gradeValue(rawVitals.ttfb, 800, 1800) }
              }
              if (!vitals.cls && rawVitals.cls !== null) {
                vitals.cls = { value: rawVitals.cls, grade: gradeValue(rawVitals.cls, 0.1, 0.25) }
              }
            }
          }
        }
      } catch (fallbackErr) {
        workflowLog(`[fetchWebVitals] Fallback parse error: ${fallbackErr}`)
      }
    }
  } catch (err) {
    workflowLog(`[fetchWebVitals] Error: ${err instanceof Error ? err.message : String(err)}`)
  }

  workflowLog(`[fetchWebVitals] Final result: ${JSON.stringify(vitals)}`)
  return vitals
}

// ============================================================
// CLEANUP
// ============================================================

export async function cleanupSandbox(sandboxId: string): Promise<void> {
  workflowLog(`[Cleanup] Stopping sandbox ${sandboxId}`)
  try {
    const sandbox = await Sandbox.get({ sandboxId })
    await sandbox.stop()
    workflowLog("[Cleanup] Sandbox stopped")
  } catch (err) {
    workflowLog(`[Cleanup] Error stopping sandbox: ${err instanceof Error ? err.message : String(err)}`)
  }
}

// ============================================================
// STEP 3: Create Pull Request
// ============================================================

export async function createPullRequestStep(
  sandboxId: string,
  githubPat: string,
  repoOwner: string,
  repoName: string,
  baseBranch: string,
  _projectName: string,
  beforeCls: number | null,
  afterCls: number | null,
  reportId: string,
  progressContext?: ProgressContext | null
): Promise<{ prUrl: string; prNumber: number; branch: string } | { error: string } | null> {
  workflowLog(`[PR] Creating PR for ${repoOwner}/${repoName}...`)
  await updateProgress(progressContext, 5, "Creating GitHub PR...")

  try {
    workflowLog(`[PR] Getting sandbox ${sandboxId}...`)
    const sandbox = await Sandbox.get({ sandboxId })
    workflowLog(`[PR] Sandbox status: ${sandbox.status}`)
    if (sandbox.status !== "running") {
      throw new Error(`Sandbox not running: ${sandbox.status}`)
    }

    const SANDBOX_CWD = "/vercel/sandbox"
    const branchName = `d3k/fix-cls-${Date.now()}`

    // Configure git user (required for commits)
    workflowLog(`[PR] Configuring git user...`)
    const gitConfigResult = await runSandboxCommand(sandbox, "sh", [
      "-c",
      `cd ${SANDBOX_CWD} && git config user.email "d3k-bot@vercel.com" && git config user.name "d3k bot"`
    ])
    workflowLog(`[PR] Git config result: exit=${gitConfigResult.exitCode}`)

    // Create and checkout new branch
    workflowLog(`[PR] Creating branch: ${branchName}`)
    const branchResult = await runSandboxCommand(sandbox, "sh", [
      "-c",
      `cd ${SANDBOX_CWD} && git checkout -b "${branchName}"`
    ])
    if (branchResult.exitCode !== 0) {
      workflowLog(`[PR] Failed to create branch: ${branchResult.stderr}`)
      return { error: `Failed to create branch: ${branchResult.stderr || branchResult.stdout}` }
    }

    // Stage all changes (excluding package manager lock files which may have been modified)
    await runSandboxCommand(sandbox, "sh", [
      "-c",
      `cd ${SANDBOX_CWD} && git add -A && git reset -- package-lock.json pnpm-lock.yaml yarn.lock 2>/dev/null || true`
    ])

    // Create commit message
    const clsImprovement =
      beforeCls !== null && afterCls !== null
        ? `CLS: ${beforeCls.toFixed(3)} → ${afterCls.toFixed(3)}`
        : "CLS improvements"

    const commitMessage = `fix: ${clsImprovement}

Automated CLS fix by d3k

- Before CLS: ${beforeCls?.toFixed(3) || "unknown"}
- After CLS: ${afterCls?.toFixed(3) || "unknown"}

🤖 Generated with d3k (https://d3k.dev)`

    // Commit changes
    workflowLog("[PR] Committing changes...")
    const commitResult = await runSandboxCommand(sandbox, "sh", [
      "-c",
      `cd ${SANDBOX_CWD} && git commit -m '${commitMessage.replace(/'/g, "'\\''")}'`
    ])
    if (commitResult.exitCode !== 0) {
      workflowLog(`[PR] Failed to commit: ${commitResult.stderr}`)
      return { error: `Failed to commit: ${commitResult.stderr || commitResult.stdout}` }
    }

    // Configure git to use PAT for authentication
    // Use the PAT in the remote URL for pushing
    const authUrl = `https://x-access-token:${githubPat}@github.com/${repoOwner}/${repoName}.git`

    // Push to GitHub
    workflowLog("[PR] Pushing to GitHub...")
    const pushResult = await runSandboxCommand(sandbox, "sh", [
      "-c",
      `cd ${SANDBOX_CWD} && git push "${authUrl}" "${branchName}" 2>&1`
    ])
    if (pushResult.exitCode !== 0) {
      workflowLog(`[PR] Failed to push: ${pushResult.stderr || pushResult.stdout}`)
      return { error: `Failed to push: ${pushResult.stderr || pushResult.stdout}` }
    }

    // Create PR via GitHub API
    workflowLog("[PR] Creating pull request...")
    const prTitle = `fix: Reduce CLS (${beforeCls?.toFixed(3) || "?"} → ${afterCls?.toFixed(3) || "?"})`
    const prBody = `## 🎯 CLS Fix by d3k

This PR contains automated fixes to reduce Cumulative Layout Shift (CLS).

### Results
| Metric | Before | After |
|--------|--------|-------|
| CLS Score | ${beforeCls?.toFixed(3) || "unknown"} | ${afterCls?.toFixed(3) || "unknown"} |
| Grade | ${beforeCls !== null ? (beforeCls <= 0.1 ? "Good ✅" : beforeCls <= 0.25 ? "Needs Improvement ⚠️" : "Poor ❌") : "unknown"} | ${afterCls !== null ? (afterCls <= 0.1 ? "Good ✅" : afterCls <= 0.25 ? "Needs Improvement ⚠️" : "Poor ❌") : "unknown"} |

### What was fixed
The AI agent analyzed the page for layout shifts and applied fixes to reduce CLS.

---
🤖 Generated with [d3k](https://d3k.dev)`

    const prResponse = await fetch(`https://api.github.com/repos/${repoOwner}/${repoName}/pulls`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${githubPat}`,
        Accept: "application/vnd.github.v3+json",
        "Content-Type": "application/json",
        "User-Agent": "d3k-workflow"
      },
      body: JSON.stringify({
        title: prTitle,
        body: prBody,
        head: branchName,
        base: baseBranch
      })
    })

    if (!prResponse.ok) {
      const errorText = await prResponse.text()
      workflowLog(`[PR] GitHub API error: ${prResponse.status} - ${errorText}`)
      return { error: `GitHub API error ${prResponse.status}: ${errorText}` }
    }

    const prData = (await prResponse.json()) as { html_url: string; number: number }
    workflowLog(`[PR] Created: ${prData.html_url}`)
    await updateProgress(progressContext, 5, `PR created: #${prData.number}`)

    // Update the report blob to include the PR URL
    try {
      workflowLog(`[PR] Updating report ${reportId} with PR URL...`)
      const reportBlobUrl = `https://qkkfhcqmsjpmk4fp.public.blob.vercel-storage.com/report-${reportId}.json`
      const reportResponse = await fetch(reportBlobUrl)
      if (reportResponse.ok) {
        const report = (await reportResponse.json()) as Record<string, unknown>
        report.prUrl = prData.html_url

        // Re-upload the updated report
        await put(`report-${reportId}.json`, JSON.stringify(report, null, 2), {
          access: "public",
          contentType: "application/json",
          addRandomSuffix: false,
          allowOverwrite: true
        })
        workflowLog(`[PR] Report updated with PR URL`)
      } else {
        workflowLog(`[PR] Could not fetch report to update: ${reportResponse.status}`)
      }
    } catch (reportErr) {
      workflowLog(
        `[PR] Failed to update report with PR URL: ${reportErr instanceof Error ? reportErr.message : String(reportErr)}`
      )
      // Don't fail the whole step, PR was still created successfully
    }

    return {
      prUrl: prData.html_url,
      prNumber: prData.number,
      branch: branchName
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    workflowLog(`[PR] Error: ${errorMsg}`)
    return { error: `Exception: ${errorMsg}` }
  }
}

// ============================================================
// Prompt Builders
// ============================================================

/**
 * Build the CLS-specific system prompt (default for cls-fix workflow type)
 */
function buildClsFixPrompt(
  beforeCls: number | null,
  beforeGrade: "good" | "needs-improvement" | "poor" | null,
  startPath: string
): string {
  return `You are a CLS fix specialist. Fix the layout shift issue efficiently.

## CRITICAL: You MUST write a fix!
Your goal is to WRITE CODE that fixes the CLS issue, not just analyze it.
You have limited steps - be efficient and focused.

## Workflow (4-6 steps max):
1. **diagnose** - See what's shifting (1 step)
2. **Find code** - Search for the shifting element in code (1-2 steps)
3. **writeFile** - FIX THE CODE (1 step) ← THIS IS REQUIRED!
4. **diagnose** - Verify fix worked (1 step)

## CLS Fix Patterns (use these!):
- Conditional rendering causing shift → Use \`visibility: hidden\` instead of \`return null\`
- Delayed content appearing → Reserve space with min-height or fixed dimensions
- Elements shifting down → Add height/min-height from initial render
- Images without dimensions → Add explicit width/height

## Example Fix:
BEFORE (causes CLS):
\`\`\`tsx
if (!show) return null
return <div style={{height: '200px'}}>Content</div>
\`\`\`

AFTER (no CLS):
\`\`\`tsx
return <div style={{height: '200px', visibility: show ? 'visible' : 'hidden'}}>Content</div>
\`\`\`

## Current Status
Before CLS: ${beforeCls?.toFixed(4) || "unknown"} (${beforeGrade || "unknown"})
Target: CLS ≤ 0.1 (GOOD)
Page: ${startPath}

Start with diagnose, then QUICKLY find and fix the code. Do not over-analyze!`
}

/**
 * Build an enhanced system prompt that wraps the user's custom instructions
 * with d3k tooling guidance and best practices
 */
function buildEnhancedPrompt(userPrompt: string, startPath: string, devUrl: string): string {
  return `You are an AI developer assistant with access to a live development environment.
You can make changes to the codebase and see results in real-time.

## YOUR TASK
${userPrompt}

## DEVELOPMENT ENVIRONMENT
- **App URL**: ${devUrl}
- **Start Page**: ${startPath}
- **Working Directory**: /vercel/sandbox (this is a git repository)

## AVAILABLE TOOLS

### Code Tools
- **readFile** - Read any file in the codebase
- **writeFile** - Create or modify files (changes are applied immediately via Hot Module Replacement)
- **searchFiles** - Search for files by glob pattern (e.g., "**/*.tsx")
- **grep** - Search file contents for text patterns
- **listDir** - List directory contents
- **gitDiff** - See your changes so far

### Browser & Debugging Tools
- **diagnose** - Navigate to the page and get CLS (layout shift) measurements
  Use this for CLS-specific debugging
- **getWebVitals** - Get all Core Web Vitals performance metrics:
  - LCP (Largest Contentful Paint) - loading performance
  - FCP (First Contentful Paint) - initial render time
  - TTFB (Time to First Byte) - server response time
  - CLS (Cumulative Layout Shift) - visual stability
  - INP (Interaction to Next Paint) - interactivity
  Use this for performance optimization tasks!

## WORKFLOW GUIDELINES

1. **Start with getWebVitals or diagnose** - Capture the initial performance metrics
2. **Explore first** - Use readFile, searchFiles, and grep to understand the codebase
3. **Make targeted changes** - Edit only what's necessary
4. **Verify with diagnose** - After changes, use diagnose to confirm they work
5. **Be efficient** - You have limited steps, so be focused

## IMPORTANT NOTES
- Changes are saved immediately when you use writeFile
- Hot Module Replacement (HMR) applies changes without full page reload
- Always use diagnose after making changes to capture the "after" state
- The diagnose tool will show you any console errors or layout shifts

Now, complete the task described above. Start by using the diagnose tool to capture the current state of the page.`
}
