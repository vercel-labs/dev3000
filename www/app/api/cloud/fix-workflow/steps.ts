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
import type { WorkflowReport } from "@/types"

const workflowLog = console.log

// ============================================================
// STEP 1: Init Sandbox
// ============================================================

export async function initSandboxStep(
  repoUrl: string,
  branch: string,
  projectName: string,
  reportId: string,
  vercelOidcToken?: string
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

  // Wait for d3k to capture initial CLS
  workflowLog(`[Init] Waiting for d3k CLS capture...`)
  await new Promise((resolve) => setTimeout(resolve, 5000))

  // Get CLS data from d3k
  const clsData = await fetchClsData(sandboxResult.sandbox, sandboxResult.mcpUrl, projectName)

  workflowLog(`[Init] Before CLS: ${clsData.clsScore} (${clsData.clsGrade})`)
  workflowLog(`[Init] Captured ${clsData.d3kLogs.length} chars of d3k logs`)

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
  reportId: string
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

  const sandbox = await Sandbox.get({ sandboxId })
  if (sandbox.status !== "running") {
    throw new Error(`Sandbox not running: ${sandbox.status}`)
  }

  // Run the agent with the new "diagnose" tool
  const agentResult = await runAgentWithDiagnoseTool(sandbox, devUrl, mcpUrl, beforeCls, beforeGrade)

  // Get final CLS measurement
  const finalCls = await fetchClsData(sandbox, mcpUrl, `${projectName}-after`)

  // Get git diff
  const diffResult = await runSandboxCommand(sandbox, "sh", [
    "-c",
    "cd /vercel/sandbox && git diff --no-color 2>/dev/null || echo ''"
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

  // Combine d3k logs from init and after agent run
  const combinedD3kLogs = `=== Step 1: Init (before agent) ===\n${initD3kLogs}\n\n=== Step 2: After agent fix ===\n${finalCls.d3kLogs}`

  // Generate report inline
  const report: WorkflowReport = {
    id: reportId,
    projectName,
    timestamp: new Date().toISOString(),
    sandboxDevUrl: devUrl,
    sandboxMcpUrl: mcpUrl,
    clsScore: beforeCls ?? undefined,
    clsGrade: beforeGrade ?? undefined,
    beforeScreenshots,
    afterClsScore: finalCls.clsScore ?? undefined,
    afterClsGrade: finalCls.clsGrade ?? undefined,
    afterScreenshots: finalCls.screenshots,
    verificationStatus: status === "no-changes" ? "unchanged" : status,
    agentAnalysis: agentResult.transcript,
    agentAnalysisModel: "anthropic/claude-sonnet-4-20250514",
    gitDiff: gitDiff ?? undefined,
    d3kLogs: combinedD3kLogs
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
  beforeGrade: "good" | "needs-improvement" | "poor" | null
): Promise<{ transcript: string; summary: string }> {
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

        // Navigate away and back to trigger fresh CLS capture
        const blankCmd = `curl -s -m 30 -X POST http://localhost:${D3K_MCP_PORT}/mcp -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"execute_browser_action","arguments":{"action":"navigate","params":{"url":"about:blank"}}}}'`
        await runSandboxCommand(sandbox, "bash", ["-c", blankCmd])
        await new Promise((resolve) => setTimeout(resolve, 500))

        const navCmd = `curl -s -m 30 -X POST http://localhost:${D3K_MCP_PORT}/mcp -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"execute_browser_action","arguments":{"action":"navigate","params":{"url":"${devUrl}"}}}}'`
        await runSandboxCommand(sandbox, "bash", ["-c", navCmd])

        await new Promise((resolve) => setTimeout(resolve, 4000))

        // Read d3k logs for CLS data
        const logsResult = await runSandboxCommand(sandbox, "sh", [
          "-c",
          'for log in /home/vercel-sandbox/.d3k/logs/*.log; do [ -f "$log" ] && tail -100 "$log" || true; done 2>/dev/null'
        ])
        const logs = logsResult.stdout || ""

        // Parse CLS
        const clsMatch = logs.match(/\[CDP\] Detected (\d+) layout shifts \(CLS: ([\d.]+)\)/)
        if (clsMatch) {
          const shiftCount = parseInt(clsMatch[1], 10)
          const clsScore = parseFloat(clsMatch[2])
          const grade = clsScore <= 0.1 ? "GOOD" : clsScore <= 0.25 ? "NEEDS-IMPROVEMENT" : "POOR"

          // Parse shift details
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
        }

        return `## CLS Diagnosis

No layout shifts detected in logs. Either:
1. CLS is 0 (good!)
2. Page didn't fully load
3. Try diagnose again`
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

  const systemPrompt = `You are a CLS fix specialist. Your job is simple:

1. **diagnose** - See current CLS score and which elements shifted
2. **Find the code** - Use globSearch/grepSearch/readFile to find the components
3. **Fix it** - Use writeFile to fix the layout shift
4. **Verify** - Run diagnose again to confirm CLS improved

## CLS Fix Patterns
- Elements shifting right: Add fixed width/margin from initial render
- Elements shifting down: Reserve space with min-height or skeleton
- Delayed content: Use visibility:hidden instead of conditional rendering
- Images: Add explicit width/height

## Key Rule
ALWAYS run diagnose after making changes to verify they worked!
Keep iterating until CLS is ≤0.1 (GOOD).

## Current Status
Before CLS: ${beforeCls?.toFixed(4) || "unknown"} (${beforeGrade || "unknown"})
Target: CLS ≤ 0.1 (GOOD)

Start by running diagnose to see the current state.`

  const { text, steps } = await generateText({
    model,
    system: systemPrompt,
    prompt: `Fix the CLS issues in this app. Dev URL: ${devUrl}

Start with diagnose to see what's shifting, then fix it.`,
    tools,
    stopWhen: stepCountIs(10) // Reduced for debugging - increase when things work
  })

  workflowLog(`[Agent] Completed in ${steps.length} steps`)

  // Build transcript
  const transcript: string[] = []
  transcript.push(`## Agent Execution (${steps.length} steps)\n`)

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]
    transcript.push(`### Step ${i + 1}`)

    if (step.text) transcript.push(step.text)

    if (step.toolCalls?.length) {
      for (let j = 0; j < step.toolCalls.length; j++) {
        const tc = step.toolCalls[j] as unknown as { toolName: string; input?: unknown }
        const tr = step.toolResults?.[j] as unknown as { output?: unknown } | undefined

        transcript.push(`\n**${tc.toolName}**`)
        if (tc.input && Object.keys(tc.input as object).length > 0) {
          transcript.push("```json")
          transcript.push(JSON.stringify(tc.input, null, 2))
          transcript.push("```")
        }

        let result =
          tr?.output !== undefined
            ? typeof tr.output === "string"
              ? tr.output
              : JSON.stringify(tr.output)
            : "[no result]"
        if (result.length > 1500) result = `${result.substring(0, 1500)}\n...[truncated]`
        transcript.push("```")
        transcript.push(result)
        transcript.push("```")
      }
    }
    transcript.push("")
  }

  transcript.push("## Summary")
  transcript.push(text)

  return {
    transcript: transcript.join("\n"),
    summary: text
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

    const clsMatch = logsResult.stdout.match(/\[CDP\] Detected (\d+) layout shifts \(CLS: ([\d.]+)\)/)
    if (clsMatch) {
      result.clsScore = parseFloat(clsMatch[2])
      result.clsGrade = result.clsScore <= 0.1 ? "good" : result.clsScore <= 0.25 ? "needs-improvement" : "poor"
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
