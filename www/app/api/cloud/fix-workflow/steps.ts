/**
 * Steps for Cloud Fix Workflow - Simplified "Local-style" Architecture
 *
 * The agent has a `diagnose` tool that gives real-time CLS feedback,
 * just like the local `fix_my_app` experience. This lets the agent
 * iterate internally instead of external workflow orchestration.
 */

import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { put } from "@vercel/blob"
import { Sandbox } from "@vercel/sandbox"
import { createGateway, generateText, stepCountIs, tool } from "ai"
import { z } from "zod"
import { getOrCreateD3kSandbox, type SandboxTimingData, StepTimer } from "@/lib/cloud/d3k-sandbox"
import { SandboxAgentBrowser } from "@/lib/cloud/sandbox-agent-browser"
import { skillFallbacks } from "@/lib/skills/fallbacks"
import { saveWorkflowRun, type WorkflowType } from "@/lib/workflow-storage"
import type { WorkflowReport } from "@/types"

const workflowLog = console.log

// Cache for agent-browser instance per sandbox
const agentBrowserCache = new Map<string, SandboxAgentBrowser>()

/**
 * Get or create an agent-browser instance for the sandbox
 * Uses agent-browser CLI for browser automation (preferred over CDP in cloud)
 */
async function getAgentBrowser(sandbox: Sandbox, debug = false): Promise<SandboxAgentBrowser> {
  const cacheKey = sandbox.sandboxId
  let browser = agentBrowserCache.get(cacheKey)
  if (!browser) {
    browser = await SandboxAgentBrowser.create(sandbox, {
      profile: "/tmp/agent-browser-profile",
      debug
    })
    agentBrowserCache.set(cacheKey, browser)
  }
  return browser
}

/**
 * Navigate browser to URL using agent-browser CLI
 */
async function navigateBrowser(
  sandbox: Sandbox,
  url: string,
  debug = false
): Promise<{ success: boolean; error?: string }> {
  try {
    const browser = await getAgentBrowser(sandbox, debug)
    const result = await browser.open(url)
    if (result.success) {
      workflowLog(`[Browser] Navigated to ${url} via agent-browser`)
      return { success: true }
    }
    workflowLog(`[Browser] agent-browser navigation failed: ${result.error}`)
  } catch (error) {
    workflowLog(`[Browser] agent-browser error: ${error instanceof Error ? error.message : String(error)}`)
  }

  return { success: false, error: "agent-browser navigation failed" }
}

/**
 * Reload browser page using agent-browser CLI
 */
async function reloadBrowser(sandbox: Sandbox, debug = false): Promise<{ success: boolean; error?: string }> {
  try {
    const browser = await getAgentBrowser(sandbox, debug)
    const result = await browser.reload()
    if (result.success) {
      workflowLog("[Browser] Page reloaded via agent-browser")
      return { success: true }
    }
    workflowLog(`[Browser] agent-browser reload failed: ${result.error}`)
  } catch (error) {
    workflowLog(`[Browser] agent-browser error: ${error instanceof Error ? error.message : String(error)}`)
  }

  return { success: false, error: "agent-browser reload failed" }
}

/**
 * Evaluate JavaScript in browser using agent-browser CLI
 */
async function evaluateInBrowser(
  sandbox: Sandbox,
  expression: string,
  debug = false
): Promise<{ success: boolean; result?: unknown; error?: string }> {
  try {
    const browser = await getAgentBrowser(sandbox, debug)
    const result = await browser.evaluate(expression)
    if (result.success) {
      return { success: true, result: result.data }
    }
    return { success: false, error: result.error }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

function buildWebVitalsInitScript(): string {
  return `(function() {
    const supported = (PerformanceObserver && PerformanceObserver.supportedEntryTypes) || []
    const store = (window.__d3kVitals = window.__d3kVitals || {
      lcp: [],
      cls: [],
      event: [],
      paint: [],
      nav: null
    })

    const addEntries = (target, entries) => {
      if (!entries) return
      for (const entry of entries) target.push(entry)
    }

    try {
      addEntries(store.lcp, performance.getEntriesByType('largest-contentful-paint'))
      addEntries(store.cls, performance.getEntriesByType('layout-shift'))
      addEntries(store.event, performance.getEntriesByType('event'))
      addEntries(store.paint, performance.getEntriesByType('paint'))
      store.nav = performance.getEntriesByType('navigation')[0] || performance.timing || null
    } catch {}

    try {
      if (supported.includes('largest-contentful-paint')) {
        const observer = new PerformanceObserver((list) => addEntries(store.lcp, list.getEntries()))
        observer.observe({ type: 'largest-contentful-paint', buffered: true })
      }
      if (supported.includes('layout-shift')) {
        const observer = new PerformanceObserver((list) => addEntries(store.cls, list.getEntries()))
        observer.observe({ type: 'layout-shift', buffered: true })
      }
      if (supported.includes('event')) {
        const observer = new PerformanceObserver((list) => addEntries(store.event, list.getEntries()))
        observer.observe({ type: 'event', buffered: true, durationThreshold: 0 })
      }
      if (supported.includes('paint')) {
        const observer = new PerformanceObserver((list) => addEntries(store.paint, list.getEntries()))
        observer.observe({ type: 'paint', buffered: true })
      }
    } catch {}

    return 'ok'
  })()`
}

function buildWebVitalsReadScript(): string {
  return `(function() {
    const result = { lcp: null, fcp: null, ttfb: null, cls: 0, fid: null, inp: null }
    const store = window.__d3kVitals || {}
    const navTiming = store.nav || performance.getEntriesByType('navigation')[0] || performance.timing
    result.ttfb = navTiming?.responseStart
      ? (navTiming.responseStart - (navTiming.startTime || navTiming.navigationStart || 0))
      : null

    const lcpEntries = (store.lcp || []).concat(performance.getEntriesByType('largest-contentful-paint') || [])
    const paintEntries = (store.paint || []).concat(performance.getEntriesByType('paint') || [])
    const fcpEntries = paintEntries.filter((entry) => entry.name === 'first-contentful-paint')
    const clsEntries = (store.cls || []).concat(performance.getEntriesByType('layout-shift') || [])
    const fidEntries = performance.getEntriesByType('first-input')
    const eventEntries = (store.event || []).concat(performance.getEntriesByType('event') || [])

    if (lcpEntries.length > 0) {
      result.lcp = lcpEntries[lcpEntries.length - 1].startTime
    }
    if (fcpEntries.length > 0) {
      result.fcp = fcpEntries[0].startTime
    }
    result.cls = clsEntries.reduce((sum, e) => sum + (e.hadRecentInput ? 0 : e.value), 0)
    if (fidEntries.length > 0) {
      result.fid = fidEntries[0].processingStart - fidEntries[0].startTime
    }

    if (eventEntries.length > 0) {
      const byInteraction = new Map()
      for (const entry of eventEntries) {
        if (!('interactionId' in entry) || entry.interactionId === 0) continue
        const existing = byInteraction.get(entry.interactionId)
        if (!existing || entry.duration > existing.duration) {
          byInteraction.set(entry.interactionId, entry)
        }
      }
      let maxDuration = 0
      for (const entry of byInteraction.values()) {
        if (entry.duration > maxDuration) maxDuration = entry.duration
      }
      if (maxDuration > 0) {
        result.inp = maxDuration
      }
    }

    return JSON.stringify(result)
  })()`
}

function extractWebVitalsResultString(evalResult: { success: boolean; result?: unknown }): string | null {
  if (!evalResult.success || !evalResult.result) return null

  if (typeof evalResult.result === "string") return evalResult.result

  if (typeof evalResult.result === "object" && evalResult.result !== null) {
    const result = evalResult.result as {
      result?: string
      value?: string
      data?: { result?: string; value?: string }
    }
    if (typeof result.result === "string") return result.result
    if (typeof result.value === "string") return result.value
    if (typeof result.data?.result === "string") return result.data.result
    if (typeof result.data?.value === "string") return result.data.value
  }

  return null
}

/**
 * Take a screenshot using agent-browser CLI
 */
async function _screenshotBrowser(
  sandbox: Sandbox,
  outputPath: string,
  options: { fullPage?: boolean } = {},
  debug = false
): Promise<{ success: boolean; error?: string }> {
  try {
    const browser = await getAgentBrowser(sandbox, debug)
    const result = await browser.screenshot(outputPath, options)
    if (result.success) {
      workflowLog(`[Browser] Screenshot saved to ${outputPath} via agent-browser`)
      return { success: true }
    }
    workflowLog(`[Browser] agent-browser screenshot failed: ${result.error}`)
    return { success: false, error: result.error }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

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

/** Timing data for init step */
export interface InitStepTiming {
  totalMs: number
  sandboxCreation: SandboxTimingData
  steps: { name: string; durationMs: number; startedAt: string }[]
}

export async function initSandboxStep(
  repoUrl: string,
  branch: string,
  projectDir: string | undefined,
  projectName: string,
  reportId: string,
  _startPath: string,
  vercelOidcToken?: string,
  progressContext?: ProgressContext | null
): Promise<{
  sandboxId: string
  devUrl: string
  reportId: string
  beforeCls: number | null
  beforeGrade: "good" | "needs-improvement" | "poor" | null
  beforeScreenshots: Array<{ timestamp: number; blobUrl: string; label?: string }>
  initD3kLogs: string
  timing: InitStepTiming
  fromSnapshot: boolean
  snapshotId?: string
}> {
  const timer = new StepTimer()
  const isTurbopackBundleAnalyzer = progressContext?.workflowType === "turbopack-bundle-analyzer"
  const preStartBackgroundCommand = isTurbopackBundleAnalyzer
    ? "${packageManager} run next experimental-analyze"
    : undefined
  const preStartWaitPort = isTurbopackBundleAnalyzer ? 4000 : undefined

  workflowLog(`[Init] Creating sandbox for ${projectName}...`)
  await updateProgress(progressContext, 1, "Creating sandbox environment...")
  if (isTurbopackBundleAnalyzer) {
    await updateProgress(progressContext, 1, "Starting Turbopack bundle analyzer server (localhost:4000)...")
  }

  if (vercelOidcToken && !process.env.VERCEL_OIDC_TOKEN) {
    process.env.VERCEL_OIDC_TOKEN = vercelOidcToken
  }

  // Create sandbox using base snapshot (Chrome + d3k pre-installed)
  // The base snapshot is shared across ALL projects for fast startup
  timer.start("Create sandbox (getOrCreateD3kSandbox)")
  const sandboxResult = await getOrCreateD3kSandbox({
    repoUrl,
    branch,
    projectDir: projectDir || "",
    preStartBackgroundCommand,
    preStartWaitPort,
    timeout: "30m",
    debug: true
  })

  workflowLog(`[Init] Sandbox: ${sandboxResult.sandbox.sandboxId}`)
  workflowLog(`[Init] Dev URL: ${sandboxResult.devUrl}`)
  workflowLog(`[Init] From base snapshot: ${sandboxResult.fromSnapshot}`)
  await updateProgress(
    progressContext,
    1,
    sandboxResult.fromSnapshot ? "Sandbox restored from base snapshot!" : "Sandbox created from scratch",
    sandboxResult.devUrl
  )

  // Wait for d3k to capture initial CLS
  timer.start("Wait for CLS capture (5s)")
  workflowLog(`[Init] Waiting for d3k CLS capture...`)
  await updateProgress(progressContext, 1, "Dev server running, capturing initial CLS...")
  await new Promise((resolve) => setTimeout(resolve, 5000))

  // Get CLS data from d3k
  timer.start("Fetch CLS data from d3k")
  const clsData = await fetchClsData(sandboxResult.sandbox)

  workflowLog(`[Init] Before CLS: ${clsData.clsScore} (${clsData.clsGrade})`)
  workflowLog(`[Init] Captured ${clsData.d3kLogs.length} chars of d3k logs`)
  await updateProgress(
    progressContext,
    1,
    `Initial CLS: ${clsData.clsScore?.toFixed(3) || "unknown"} (${clsData.clsGrade || "measuring..."})`,
    sandboxResult.devUrl
  )

  timer.end()

  // Log timing breakdown
  const timingData = timer.getData()
  workflowLog(`[Init] ⏱️ TIMING BREAKDOWN (total: ${(timingData.totalMs / 1000).toFixed(1)}s)`)
  for (const step of timingData.steps) {
    const secs = (step.durationMs / 1000).toFixed(1)
    const pct = ((step.durationMs / timingData.totalMs) * 100).toFixed(0)
    workflowLog(`[Init]   ${step.name}: ${secs}s (${pct}%)`)
  }

  return {
    sandboxId: sandboxResult.sandbox.sandboxId,
    devUrl: sandboxResult.devUrl,
    reportId,
    beforeCls: clsData.clsScore,
    beforeGrade: clsData.clsGrade,
    beforeScreenshots: clsData.screenshots,
    initD3kLogs: clsData.d3kLogs,
    timing: {
      totalMs: timingData.totalMs,
      sandboxCreation: sandboxResult.timing,
      steps: timingData.steps
    },
    fromSnapshot: sandboxResult.fromSnapshot,
    snapshotId: sandboxResult.snapshotId
  }
}

// ============================================================
// STEP 2: Agent Fix Loop (with internal iteration)
// ============================================================

/** Timing data for agent fix loop step */
export interface AgentStepTiming {
  totalMs: number
  steps: { name: string; durationMs: number; startedAt: string }[]
}

export async function agentFixLoopStep(
  sandboxId: string,
  devUrl: string,
  beforeCls: number | null,
  beforeGrade: "good" | "needs-improvement" | "poor" | null,
  beforeScreenshots: Array<{ timestamp: number; blobUrl: string; label?: string }>,
  initD3kLogs: string,
  projectName: string,
  reportId: string,
  startPath: string,
  repoUrl: string,
  repoBranch: string,
  projectDir?: string,
  repoOwner?: string,
  repoName?: string,
  customPrompt?: string,
  crawlDepth?: number | "all",
  progressContext?: ProgressContext | null,
  initTiming?: InitStepTiming,
  fromSnapshot?: boolean,
  snapshotId?: string
): Promise<{
  reportBlobUrl: string
  reportId: string
  beforeCls: number | null
  afterCls: number | null
  status: "improved" | "unchanged" | "degraded" | "no-changes"
  agentSummary: string
  gitDiff: string | null
  timing: AgentStepTiming
}> {
  const timer = new StepTimer()

  timer.start("Reconnect to sandbox")
  workflowLog(`[Agent] Reconnecting to sandbox: ${sandboxId}`)
  await updateProgress(progressContext, 2, "AI agent analyzing CLS issues...", devUrl)

  const sandbox = await Sandbox.get({ sandboxId })
  if (sandbox.status !== "running") {
    throw new Error(`Sandbox not running: ${sandbox.status}`)
  }

  // Capture "before" Web Vitals via CDP before the agent makes any changes
  timer.start("Capture before Web Vitals")
  workflowLog("[Agent] Capturing before Web Vitals via CDP...")
  const { vitals: capturedBeforeWebVitals, diagnosticLogs: beforeWebVitalsDiagnostics } =
    await fetchWebVitalsViaCDP(sandbox)
  workflowLog(`[Agent] Before Web Vitals captured: ${JSON.stringify(capturedBeforeWebVitals)}`)

  // Run the agent with the new "diagnose" tool
  timer.start("Run AI agent (with tools)")
  const agentResult = await runAgentWithDiagnoseTool(
    sandbox,
    devUrl,
    beforeCls,
    beforeGrade,
    startPath,
    customPrompt,
    progressContext?.workflowType,
    crawlDepth
  )
  await updateProgress(progressContext, 3, "Agent finished, verifying CLS improvements...", devUrl)

  // Force a fresh page reload to capture new CLS measurement
  // The agent might not have called diagnose after its last change
  //
  // IMPORTANT: We use Page.reload instead of navigating to about:blank and back.
  // Reason: d3k's screencast manager checks window.location.href when navigation starts.
  // When navigating FROM about:blank TO localhost, the URL check still sees about:blank
  // (because the navigation just started), so it SKIPS capture. Page.reload avoids this.
  timer.start("Reload page for final CLS")
  workflowLog("[Agent] Forcing page reload to capture final CLS...")

  // First navigate to localhost (NOT the public devUrl!) so CLS capture works
  // The screencast-manager only captures for localhost:3000, not the public sb-xxx.vercel.run URL
  const targetUrl = `http://localhost:3000${startPath}`

  // Use agent-browser CLI for navigation (preferred over CDP in cloud)
  const navResult = await navigateBrowser(sandbox, targetUrl)
  workflowLog(
    `[Agent] Navigate to devUrl result: success=${navResult.success}${navResult.error ? `, error=${navResult.error}` : ""}`
  )
  await new Promise((resolve) => setTimeout(resolve, 2000))

  // Now reload the page to trigger fresh CLS capture
  // Use agent-browser reload (preferred over CDP in cloud)
  const reloadResult = await reloadBrowser(sandbox)
  workflowLog(
    `[Agent] Page reload result: success=${reloadResult.success}${reloadResult.error ? `, error=${reloadResult.error}` : ""}`
  )
  workflowLog("[Agent] Waiting for CLS to be captured...")
  await new Promise((resolve) => setTimeout(resolve, 8000)) // 8 seconds for CLS to be detected

  // Get final CLS measurement
  timer.start("Fetch final CLS data")
  const finalCls = await fetchClsData(sandbox)

  // Get git diff (exclude package.json which gets modified by sandbox initialization)
  timer.start("Get git diff")
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
  const workflowType =
    (progressContext?.workflowType as
      | "cls-fix"
      | "prompt"
      | "design-guidelines"
      | "react-performance"
      | "url-audit"
      | "turbopack-bundle-analyzer") || "cls-fix"

  // Fetch "after" Web Vitals directly from browser via CDP (more reliable than parsing logs)
  timer.start("Fetch after Web Vitals")
  workflowLog("[Agent] Fetching after Web Vitals via CDP...")
  const { vitals: afterWebVitalsResult, diagnosticLogs: afterWebVitalsDiagnostics } =
    await fetchWebVitalsViaCDP(sandbox)

  // Use the capturedBeforeWebVitals we got at the start of this function
  // Merge with the beforeCls we got from init step if CDP didn't capture it
  const beforeWebVitals: import("@/types").WebVitals = { ...capturedBeforeWebVitals }
  const afterWebVitals = afterWebVitalsResult
  if (!beforeWebVitals.cls && beforeCls !== null) {
    beforeWebVitals.cls = {
      value: beforeCls,
      grade: beforeCls <= 0.1 ? "good" : beforeCls <= 0.25 ? "needs-improvement" : "poor"
    }
  }

  workflowLog(`[Agent] Before Web Vitals: ${JSON.stringify(beforeWebVitals)}`)
  workflowLog(`[Agent] After Web Vitals: ${JSON.stringify(afterWebVitals)}`)

  // Generate report inline
  timer.start("Generate and upload report")

  // Get agent timing data before creating the report
  const agentTimingData = timer.getData()

  // Build timing object for report
  const initMs = initTiming?.totalMs ?? 0
  const agentMs = agentTimingData.totalMs
  const reportTiming: WorkflowReport["timing"] = {
    total: {
      initMs,
      agentMs,
      totalMs: initMs + agentMs
    },
    init: initTiming
      ? {
          sandboxCreationMs: initTiming.sandboxCreation.totalMs,
          fromSnapshot: fromSnapshot ?? false,
          steps: initTiming.steps.map((s) => ({ name: s.name, durationMs: s.durationMs }))
        }
      : undefined,
    agent: {
      steps: agentTimingData.steps.map((s) => ({ name: s.name, durationMs: s.durationMs }))
    }
  }

  const { skillsInstalled } = await readSandboxSkillsInfo(sandbox)

  const report: WorkflowReport = {
    id: reportId,
    projectName,
    timestamp: new Date().toISOString(),
    workflowType,
    analysisTargetType: "vercel-project",
    customPrompt: customPrompt ?? undefined,
    systemPrompt: agentResult.systemPrompt,
    sandboxDevUrl: devUrl,
    repoUrl,
    repoBranch,
    projectDir: projectDir || undefined,
    repoOwner: repoOwner || undefined,
    repoName: repoName || undefined,
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
    agentAnalysisModel: "openai/gpt-5.2",
    skillsInstalled: skillsInstalled.length > 0 ? skillsInstalled : undefined,
    skillsLoaded: agentResult.skillsLoaded.length > 0 ? agentResult.skillsLoaded : undefined,
    gitDiff: gitDiff ?? undefined,
    d3kLogs: combinedD3kLogs,
    initD3kLogs: initD3kLogs,
    afterD3kLogs: afterD3kLogs,
    webVitalsDiagnostics: {
      before: beforeWebVitalsDiagnostics,
      after: afterWebVitalsDiagnostics
    },
    // Sandbox and timing info
    fromSnapshot: fromSnapshot ?? false,
    snapshotId,
    timing: reportTiming
  }

  const blob = await put(`report-${reportId}.json`, JSON.stringify(report, null, 2), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true
  })

  workflowLog(`[Agent] Report saved: ${blob.url}`)

  timer.end()

  // Log timing breakdown
  const timingData = timer.getData()
  workflowLog(`[Agent] ⏱️ TIMING BREAKDOWN (total: ${(timingData.totalMs / 1000).toFixed(1)}s)`)
  for (const step of timingData.steps) {
    const secs = (step.durationMs / 1000).toFixed(1)
    const pct = ((step.durationMs / timingData.totalMs) * 100).toFixed(0)
    workflowLog(`[Agent]   ${step.name}: ${secs}s (${pct}%)`)
  }

  return {
    reportBlobUrl: blob.url,
    reportId,
    beforeCls,
    afterCls: finalCls.clsScore,
    status,
    agentSummary: agentResult.summary,
    gitDiff,
    timing: timingData
  }
}

export async function urlAuditStep(
  sandboxId: string,
  sandboxDevUrl: string,
  targetUrl: string,
  workflowType: string | undefined,
  customPrompt: string | undefined,
  projectName: string,
  reportId: string,
  progressContext?: ProgressContext | null,
  initTiming?: InitStepTiming,
  fromSnapshot?: boolean,
  snapshotId?: string
): Promise<{
  reportBlobUrl: string
  reportId: string
  beforeCls: number | null
  afterCls: number | null
  status: "improved" | "unchanged" | "degraded" | "no-changes"
  agentSummary: string
  gitDiff: string | null
}> {
  const timer = new StepTimer()
  timer.start("Reconnect to sandbox")
  await updateProgress(progressContext, 2, "Launching external URL audit...", targetUrl)

  const sandbox = await Sandbox.get({ sandboxId })
  if (sandbox.status !== "running") {
    throw new Error(`Sandbox not running: ${sandbox.status}`)
  }

  timer.start("Navigate to target URL")
  const navResult = await navigateBrowser(sandbox, targetUrl)
  if (!navResult.success) {
    throw new Error(`Failed to open target URL: ${navResult.error || "unknown error"}`)
  }
  await new Promise((resolve) => setTimeout(resolve, 3000))

  timer.start("Capture Web Vitals")
  const { vitals, diagnosticLogs } = await fetchWebVitalsViaCDP(sandbox)

  timer.start("Collect page diagnostics")
  const diagnosticsResult = await evaluateInBrowser(
    sandbox,
    `(() => {
      const scripts = Array.from(document.querySelectorAll("script[src]")).map((el) => el.getAttribute("src") || "")
      const stylesheets = Array.from(document.querySelectorAll('link[rel="stylesheet"]')).map((el) => el.getAttribute("href") || "")
      const images = Array.from(document.images || [])
      const imagesWithoutAlt = images.filter((img) => !img.getAttribute("alt")).length
      const imagesWithoutSize = images.filter((img) => !img.getAttribute("width") && !img.getAttribute("height")).length
      const sourceMapCandidates = scripts
        .filter(Boolean)
        .map((src) => src.startsWith("http") ? src : new URL(src, window.location.href).href)
        .map((src) => src + ".map")
        .slice(0, 20)
      const resources = performance
        .getEntriesByType("resource")
        .filter((entry) => typeof entry.transferSize === "number")
        .sort((a, b) => (b.transferSize || 0) - (a.transferSize || 0))
        .slice(0, 10)
        .map((entry) => ({
          name: entry.name,
          initiatorType: entry.initiatorType,
          transferSize: entry.transferSize || 0,
          duration: entry.duration || 0
        }))

      return JSON.stringify({
        url: window.location.href,
        title: document.title || null,
        htmlLang: document.documentElement.lang || null,
        scriptsCount: scripts.length,
        stylesheetsCount: stylesheets.length,
        imagesCount: images.length,
        imagesWithoutAlt,
        imagesWithoutSize,
        sourceMapCandidates,
        topResources: resources
      })
    })()`
  )

  const diagnosticsRaw = extractWebVitalsResultString(diagnosticsResult)
  let pageDiagnostics: Record<string, unknown> = {}
  if (diagnosticsRaw) {
    try {
      pageDiagnostics = JSON.parse(diagnosticsRaw) as Record<string, unknown>
    } catch {
      pageDiagnostics = {}
    }
  }

  timer.start("Generate audit analysis")
  const gateway = createGateway({
    apiKey: process.env.AI_GATEWAY_API_KEY,
    baseURL: "https://ai-gateway.vercel.sh/v1/ai"
  })

  const analysisResponse = await generateText({
    model: gateway("openai/gpt-5.2"),
    prompt:
      workflowType === "prompt" && customPrompt
        ? `You are a senior web analyst operating in read-only mode on a public URL.
Follow the user's instructions exactly while being explicit about uncertainty.

Context:
- Target URL: ${targetUrl}
- Custom Instructions: ${customPrompt}
- Web Vitals: ${JSON.stringify(vitals)}
- Page diagnostics: ${JSON.stringify(pageDiagnostics)}
- Diagnostic logs: ${JSON.stringify(diagnosticLogs.slice(-20))}

Output format:
1) Executive Summary (2-4 bullets)
2) Findings (ordered by impact, each with confidence High/Med/Low)
3) Recommendations (specific, prioritized, practical)
4) Limitations (what could not be verified from external-only access)

Constraints:
- This is read-only external analysis (no code access).
- Do not claim certainty where evidence is weak.
- Keep recommendations practical and specific.
`
        : `You are a senior web performance and UX auditor.
Generate a concise, actionable report for an external URL audit.

Context:
- Target URL: ${targetUrl}
- Workflow Type: ${workflowType || "design-guidelines"}
- Web Vitals: ${JSON.stringify(vitals)}
- Page diagnostics: ${JSON.stringify(pageDiagnostics)}
- Diagnostic logs: ${JSON.stringify(diagnosticLogs.slice(-20))}

Output format:
1) Executive Summary (2-4 bullets)
2) Highest-Impact Issues (ordered by impact, include confidence High/Med/Low)${
            workflowType === "react-performance"
              ? " with emphasis on React render patterns, hydration, bundle loading, and runtime interactivity."
              : workflowType === "design-guidelines"
                ? " with emphasis on usability, information hierarchy, accessibility, and visual consistency."
                : ""
          }
3) Suggested Fixes (prioritized, implementation-ready guidance)${
            workflowType === "react-performance"
              ? " with likely React/Next.js implementation patterns where inferable."
              : workflowType === "design-guidelines"
                ? " tied to concrete UX and design guideline outcomes."
                : ""
          }
4) Sourcemap Guidance (what was inferred externally, limitations)
5) What Cannot Be Confirmed Without Repo Access

Constraints:
- This is read-only external analysis (no code access).
- Do not claim certainty where evidence is weak.
- Keep recommendations practical and specific.
`
  })

  const initMs = initTiming?.totalMs ?? 0
  const agentMs = timer.getData().totalMs
  const reportTiming: WorkflowReport["timing"] = {
    total: {
      initMs,
      agentMs,
      totalMs: initMs + agentMs
    },
    init: initTiming
      ? {
          sandboxCreationMs: initTiming.sandboxCreation.totalMs,
          fromSnapshot: fromSnapshot ?? false,
          steps: initTiming.steps.map((s) => ({ name: s.name, durationMs: s.durationMs }))
        }
      : undefined,
    agent: {
      steps: timer.getData().steps.map((s) => ({ name: s.name, durationMs: s.durationMs }))
    }
  }

  const report: WorkflowReport = {
    id: reportId,
    projectName,
    timestamp: new Date().toISOString(),
    workflowType: (workflowType as WorkflowType) || "design-guidelines",
    customPrompt: workflowType === "prompt" ? customPrompt : undefined,
    analysisTargetType: "url",
    targetUrl,
    sandboxDevUrl,
    beforeWebVitals: Object.keys(vitals).length > 0 ? vitals : undefined,
    afterWebVitals: Object.keys(vitals).length > 0 ? vitals : undefined,
    agentAnalysis: analysisResponse.text,
    agentAnalysisModel: "openai/gpt-5.2",
    d3kLogs: diagnosticLogs.join("\n"),
    initD3kLogs: diagnosticLogs.join("\n"),
    webVitalsDiagnostics: {
      before: diagnosticLogs,
      after: diagnosticLogs
    },
    timing: reportTiming,
    fromSnapshot: fromSnapshot ?? false,
    snapshotId
  }

  const blob = await put(`report-${reportId}.json`, JSON.stringify(report, null, 2), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true
  })

  await updateProgress(progressContext, 4, "URL audit complete. Preparing report...", targetUrl)

  return {
    reportBlobUrl: blob.url,
    reportId,
    beforeCls: null,
    afterCls: null,
    status: "unchanged",
    agentSummary:
      workflowType === "react-performance"
        ? "URL React performance audit completed"
        : workflowType === "prompt"
          ? "URL custom prompt analysis completed"
          : "URL design audit completed",
    gitDiff: null
  }
}

// ============================================================
// Agent with Diagnose Tool
// ============================================================

async function runAgentWithDiagnoseTool(
  sandbox: Sandbox,
  devUrl: string,
  beforeCls: number | null,
  beforeGrade: "good" | "needs-improvement" | "poor" | null,
  startPath: string,
  customPrompt?: string,
  workflowType?: string,
  crawlDepth?: number | "all"
): Promise<{ transcript: string; summary: string; systemPrompt: string; skillsLoaded: string[] }> {
  const SANDBOX_CWD = "/vercel/sandbox"
  const skillAliases: Record<string, string> = {
    "react-performance": "vercel-react-best-practices",
    "vercel-design-guidelines": "web-design-guidelines",
    "design-guidelines": "web-design-guidelines"
  }
  const skillsLoaded = new Set<string>()

  const gateway = createGateway({
    apiKey: process.env.AI_GATEWAY_API_KEY,
    baseURL: "https://ai-gateway.vercel.sh/v1/ai"
  })

  const model = gateway("openai/gpt-5.2")

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

        // Use agent-browser CLI for navigation (preferred over CDP in cloud)
        await navigateBrowser(sandbox, diagnoseUrl)
        await new Promise((resolve) => setTimeout(resolve, 1000))

        // Use agent-browser reload
        await reloadBrowser(sandbox)

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

    get_skill: tool({
      description: `Load a d3k skill by name and return its contents (SKILL.md).
Use this before audits or performance reviews to get the full guidelines.`,
      inputSchema: z.object({
        name: z.string().describe("Skill name (e.g. react-performance, vercel-design-guidelines)")
      }),
      execute: async ({ name }: { name: string }) => {
        const normalized = name.trim().toLowerCase()
        const resolved = skillAliases[normalized] ?? normalized
        skillsLoaded.add(normalized)

        const safeName = resolved.replace(/[^a-z0-9-]/g, "")
        if (!safeName) {
          return `ERROR: Invalid skill name "${name}".`
        }

        const skillPath = `${SANDBOX_CWD}/.agents/skills/${safeName}/SKILL.md`
        const skillResult = await runSandboxCommand(sandbox, "sh", [
          "-c",
          `cat "${skillPath}" 2>/dev/null || echo "ERROR: Skill not found at ${skillPath}"`
        ])

        if (skillResult.stdout.startsWith("ERROR:")) {
          const localSkillPath = join(process.cwd(), ".agents", "skills", safeName, "SKILL.md")
          if (existsSync(localSkillPath)) {
            return readFileSync(localSkillPath, "utf8")
          }
          if (skillFallbacks[safeName]) {
            return skillFallbacks[safeName]
          }

          const listResult = await runSandboxCommand(sandbox, "sh", [
            "-c",
            `ls -1 "${SANDBOX_CWD}/.agents/skills" 2>/dev/null || true`
          ])
          const available = listResult.stdout.trim()
          return `${skillResult.stdout}\nAvailable skills (sandbox):\n${available || "(none found)"}`
        }

        return skillResult.stdout
      }
    }),

    openUrl: tool({
      description: "Open a URL in the browser. Supports https:// and file:// URLs.",
      inputSchema: z.object({
        url: z.string().describe("URL to open")
      }),
      execute: async ({ url }: { url: string }) => {
        const result = await navigateBrowser(sandbox, url)
        if (!result.success) return `Failed to open URL: ${result.error || "unknown error"}`
        return `Opened ${url}`
      }
    }),

    browserSnapshot: tool({
      description: "Capture interactive page snapshot and element refs for clicking.",
      inputSchema: z.object({}),
      execute: async () => {
        const browser = await getAgentBrowser(sandbox)
        const snapshot = await browser.snapshot({ interactive: true })
        return snapshot.raw.substring(0, 6000)
      }
    }),

    browserClick: tool({
      description: "Click a page element using a snapshot ref (for example, @e12).",
      inputSchema: z.object({
        ref: z.string().describe("Snapshot element ref, such as @e12")
      }),
      execute: async ({ ref }: { ref: string }) => {
        const browser = await getAgentBrowser(sandbox)
        const result = await browser.click(ref)
        return result.success ? `Clicked ${ref}` : `Failed to click ${ref}: ${result.error || "unknown error"}`
      }
    }),

    browserScroll: tool({
      description: "Scroll the page to inspect additional content.",
      inputSchema: z.object({
        direction: z.enum(["up", "down", "left", "right"]),
        amount: z.number().optional()
      }),
      execute: async ({ direction, amount }: { direction: "up" | "down" | "left" | "right"; amount?: number }) => {
        const browser = await getAgentBrowser(sandbox)
        const result = await browser.scroll(direction, amount)
        return result.success
          ? `Scrolled ${direction}${amount ? ` by ${amount}` : ""}`
          : `Failed to scroll: ${result.error || "unknown error"}`
      }
    }),

    runProjectCommand: tool({
      description: "Run a shell command in the project root (/vercel/sandbox) for verification tasks.",
      inputSchema: z.object({
        command: z.string().describe("Shell command to run from project root")
      }),
      execute: async ({ command }: { command: string }) => {
        const result = await runSandboxCommand(sandbox, "sh", [
          "-c",
          `export PATH=$HOME/.bun/bin:/usr/local/bin:$PATH; cd ${SANDBOX_CWD} && ${command}`
        ])
        const stdout = result.stdout.trim()
        const stderr = result.stderr.trim()
        const output = [stdout, stderr].filter(Boolean).join("\n")
        const capped = output.length > 6000 ? `${output.substring(0, 6000)}\n...[truncated]` : output
        return `Exit code: ${result.exitCode}\n${capped || "(no output)"}`
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

        // Navigate to get fresh metrics using agent-browser
        const diagnoseUrl = `http://localhost:3000${startPath}`
        await navigateBrowser(sandbox, diagnoseUrl)
        await new Promise((resolve) => setTimeout(resolve, 3000))

        // Prime vitals observers, then read after a short delay
        await evaluateInBrowser(sandbox, buildWebVitalsInitScript())
        await new Promise((resolve) => setTimeout(resolve, 1500))

        const evalResult = await evaluateInBrowser(sandbox, buildWebVitalsReadScript())
        workflowLog(`[getWebVitals] Eval result: ${JSON.stringify(evalResult).substring(0, 500)}`)

        // Parse the result
        let vitals: {
          lcp: number | null
          fcp: number | null
          ttfb: number | null
          cls: number
          fid: number | null
          inp: number | null
        } = { lcp: null, fcp: null, ttfb: null, cls: 0, fid: null, inp: null }

        try {
          const resultStr = extractWebVitalsResultString(evalResult)
          if (resultStr) {
            vitals = JSON.parse(resultStr)
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
        if (vitals.inp !== null) {
          const grade = vitals.inp <= 200 ? "GOOD ✅" : vitals.inp <= 500 ? "NEEDS IMPROVEMENT ⚠️" : "POOR ❌"
          metrics.INP = { value: `${vitals.inp.toFixed(0)}ms`, grade }
        }

        // Build report
        let report = "## Web Vitals Report\n\n"
        if (Object.keys(metrics).length === 0) {
          report += "No Web Vitals entries found. Try reloading the page or interacting with it.\n"
        }
        for (const [name, data] of Object.entries(metrics)) {
          report += `**${name}:** ${data.value} (${data.grade})\n`
        }
        if (!metrics.LCP) report += "**LCP:** not available (no entry captured)\n"
        if (!metrics.FCP) report += "**FCP:** not available (no entry captured)\n"
        if (!metrics.TTFB) report += "**TTFB:** not available (no entry captured)\n"
        if (!metrics.INP && !metrics.FID) report += "**INP:** not available (no interaction captured)\n"

        // Add thresholds reference
        report += `
### Thresholds Reference
- **LCP** (Largest Contentful Paint): Good ≤2.5s, Needs Improvement ≤4s
- **FCP** (First Contentful Paint): Good ≤1.8s, Needs Improvement ≤3s
- **TTFB** (Time to First Byte): Good ≤800ms, Needs Improvement ≤1.8s
- **CLS** (Cumulative Layout Shift): Good ≤0.1, Needs Improvement ≤0.25
- **INP** (Interaction to Next Paint): Good ≤200ms, Needs Improvement ≤500ms
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

  // Determine workflow type
  const workflowTypeForPrompt = workflowType || "cls-fix"

  // Build system prompt based on workflow type
  let systemPrompt: string
  if (workflowTypeForPrompt === "design-guidelines") {
    systemPrompt = buildDesignGuidelinesPrompt(startPath, devUrl, crawlDepth)
  } else if (workflowTypeForPrompt === "react-performance") {
    systemPrompt = buildReactPerformancePrompt(startPath, devUrl)
  } else if (workflowTypeForPrompt === "turbopack-bundle-analyzer") {
    systemPrompt = buildTurbopackBundleAnalyzerPrompt(startPath, devUrl)
  } else if (customPrompt) {
    systemPrompt = buildEnhancedPrompt(customPrompt, startPath, devUrl)
  } else {
    systemPrompt = buildClsFixPrompt(beforeCls, beforeGrade, startPath)
  }

  // Build user prompt based on workflow type
  let userPromptMessage: string
  if (workflowTypeForPrompt === "design-guidelines") {
    const crawlInfo =
      crawlDepth && crawlDepth !== 1
        ? ` Then use crawl_app with depth=${crawlDepth} to discover all pages to audit.`
        : ""
    userPromptMessage = `Evaluate and fix design guideline violations on the ${startPath} page. Dev URL: ${devUrl}\n\nFirst, call get_skill({ name: "d3k" }) then get_skill({ name: "vercel-design-guidelines" }) to load the skills.${crawlInfo} Then read and audit the code.`
  } else if (workflowTypeForPrompt === "react-performance") {
    userPromptMessage = `Analyze and optimize React/Next.js performance on the ${startPath} page. Dev URL: ${devUrl}\n\nFirst, call get_skill({ name: "d3k" }) then get_skill({ name: "react-performance" }) to load the skills. Then use getWebVitals to capture current metrics, and analyze the codebase for optimization opportunities.`
  } else if (workflowTypeForPrompt === "turbopack-bundle-analyzer") {
    userPromptMessage = `Analyze Turbopack bundle analyzer output for this project and produce prioritized optimization opportunities.

Workflow:
1) Call get_skill({ name: "d3k" }) first.
2) Open the live analyzer at http://localhost:4000 with openUrl and inspect it using browserSnapshot/browserClick/browserScroll.
3) Open the app at ${devUrl}${startPath} and inspect the runtime behavior there as well.
4) Implement high-impact fixes in code (do not stop at recommendations).
5) Validate changes did not break the app (diagnose and/or getWebVitals).
6) Re-run bundle analysis at the end using runProjectCommand and verify production bundle improvements.
7) Summarize what changed, what improved, and any remaining tradeoffs.

Constraints:
- Prioritize concrete fixes over generic advice.
- Prefer improvements that reduce shipped JS, duplicate modules, and initial route payload.
`
  } else if (customPrompt) {
    userPromptMessage = `Proceed with the task. First, call get_skill({ name: "d3k" }) to load the skill. The dev server is running at ${devUrl}`
  } else {
    userPromptMessage = `Fix the CLS issues on the ${startPath} page of this app. Dev URL: ${devUrl}\n\nFirst, call get_skill({ name: "d3k" }), then start with diagnose to see what's shifting, and fix it.`
  }

  const maxSteps = workflowTypeForPrompt === "turbopack-bundle-analyzer" ? 25 : 15
  const { text, steps } = await generateText({
    model,
    system: systemPrompt,
    prompt: userPromptMessage,
    tools,
    stopWhen: stepCountIs(maxSteps)
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
    systemPrompt,
    skillsLoaded: Array.from(skillsLoaded)
  }
}

// ============================================================
// Helper Functions
// ============================================================

async function readSandboxSkillsInfo(
  sandbox: Sandbox
): Promise<{ skillsInstalled: string[]; skillsAgentId?: string | null }> {
  try {
    const sessionPathResult = await runSandboxCommand(sandbox, "sh", [
      "-c",
      "ls -t /home/vercel-sandbox/.d3k/*/session.json 2>/dev/null | head -1"
    ])
    const sessionPath = sessionPathResult.stdout.trim().split("\n")[0]
    if (!sessionPath) {
      return { skillsInstalled: [] }
    }

    const sessionResult = await runSandboxCommand(sandbox, "sh", ["-c", `cat "${sessionPath}" 2>/dev/null`])
    const parsed = JSON.parse(sessionResult.stdout) as { skillsInstalled?: string[]; skillsAgentId?: string | null }

    return {
      skillsInstalled: Array.isArray(parsed.skillsInstalled) ? parsed.skillsInstalled : [],
      skillsAgentId: parsed.skillsAgentId ?? null
    }
  } catch (error) {
    workflowLog(
      `[Agent] Failed to read skills from sandbox session: ${error instanceof Error ? error.message : String(error)}`
    )
    return { skillsInstalled: [] }
  }
}

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

async function fetchClsData(sandbox: Sandbox): Promise<{
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

    // Screenshot capture is handled by d3k locally; no tools server in cloud.
  } catch (err) {
    workflowLog(`[fetchClsData] Error: ${err instanceof Error ? err.message : String(err)}`)
  }

  return result
}

/**
 * Fetch Web Vitals using agent-browser evaluation.
 * This avoids any dependency on external tools services.
 */
async function fetchWebVitalsViaCDP(
  sandbox: Sandbox
): Promise<{ vitals: import("@/types").WebVitals; diagnosticLogs: string[] }> {
  const vitals: import("@/types").WebVitals = {}
  const diagnosticLogs: string[] = []

  // Helper to log and capture diagnostics
  const diagLog = (msg: string) => {
    workflowLog(msg)
    diagnosticLogs.push(msg)
  }

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
    diagLog("[fetchWebVitals] Capturing Web Vitals via agent-browser evaluate...")

    const finalizeLcpScript = `
      document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      document.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      'lcp-finalized'
    `
    await evaluateInBrowser(sandbox, finalizeLcpScript)
    await new Promise((resolve) => setTimeout(resolve, 500))

    await evaluateInBrowser(sandbox, buildWebVitalsInitScript())
    await new Promise((resolve) => setTimeout(resolve, 1500))

    const evalResult = await evaluateInBrowser(sandbox, buildWebVitalsReadScript())
    diagLog(`[fetchWebVitals] Eval result: ${JSON.stringify(evalResult).substring(0, 500)}`)

    if (evalResult.success && evalResult.result) {
      let rawVitals: {
        lcp: number | null
        fcp: number | null
        ttfb: number | null
        cls: number
        inp: number | null
      } | null = null
      try {
        const resultStr = extractWebVitalsResultString(evalResult)
        if (resultStr) {
          rawVitals = JSON.parse(resultStr)
        }
      } catch (err) {
        diagLog(`[fetchWebVitals] Failed to parse result: ${err instanceof Error ? err.message : String(err)}`)
      }

      if (rawVitals) {
        if (rawVitals.lcp !== null) {
          vitals.lcp = { value: rawVitals.lcp, grade: gradeValue(rawVitals.lcp, 2500, 4000) }
        }
        if (rawVitals.fcp !== null) {
          vitals.fcp = { value: rawVitals.fcp, grade: gradeValue(rawVitals.fcp, 1800, 3000) }
        }
        if (rawVitals.ttfb !== null) {
          vitals.ttfb = { value: rawVitals.ttfb, grade: gradeValue(rawVitals.ttfb, 800, 1800) }
        }
        if (rawVitals.cls !== null) {
          vitals.cls = { value: rawVitals.cls, grade: gradeValue(rawVitals.cls, 0.1, 0.25) }
        }
        if (rawVitals.inp !== null) {
          vitals.inp = { value: rawVitals.inp, grade: gradeValue(rawVitals.inp, 200, 500) }
        }
      }
    }
  } catch (err) {
    diagLog(`[fetchWebVitals] Error: ${err instanceof Error ? err.message : String(err)}`)
  }

  diagLog(`[fetchWebVitals] Final result: ${JSON.stringify(vitals)}`)
  return { vitals, diagnosticLogs }
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

/** Timing data for PR creation step */
export interface PRStepTiming {
  totalMs: number
  steps: { name: string; durationMs: number; startedAt: string }[]
}

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
  progressContext?: ProgressContext | null,
  prScreenshots?: Array<{ route: string; beforeBlobUrl: string | null; afterBlobUrl: string | null }>
): Promise<{ prUrl: string; prNumber: number; branch: string; timing: PRStepTiming } | { error: string } | null> {
  const timer = new StepTimer()

  workflowLog(`[PR] Creating PR for ${repoOwner}/${repoName}...`)
  await updateProgress(progressContext, 5, "Creating GitHub PR...")

  try {
    timer.start("Get sandbox")
    workflowLog(`[PR] Getting sandbox ${sandboxId}...`)
    const sandbox = await Sandbox.get({ sandboxId })
    workflowLog(`[PR] Sandbox status: ${sandbox.status}`)
    if (sandbox.status !== "running") {
      throw new Error(`Sandbox not running: ${sandbox.status}`)
    }

    const SANDBOX_CWD = "/vercel/sandbox"
    const branchName = `d3k/fix-cls-${Date.now()}`

    // Configure git user (required for commits)
    timer.start("Configure git")
    workflowLog(`[PR] Configuring git user...`)
    const gitConfigResult = await runSandboxCommand(sandbox, "sh", [
      "-c",
      `cd ${SANDBOX_CWD} && git config user.email "d3k-bot@vercel.com" && git config user.name "d3k bot"`
    ])
    workflowLog(`[PR] Git config result: exit=${gitConfigResult.exitCode}`)

    // Create and checkout new branch
    timer.start("Create branch")
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
    timer.start("Stage and commit")
    await runSandboxCommand(sandbox, "sh", [
      "-c",
      `cd ${SANDBOX_CWD} && git add -A && git reset -- package-lock.json pnpm-lock.yaml yarn.lock 2>/dev/null || true`
    ])

    // Create commit message
    const clsImprovement =
      typeof beforeCls === "number" && typeof afterCls === "number"
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
    timer.start("Push to GitHub")
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
    timer.start("Create PR via GitHub API")
    workflowLog("[PR] Creating pull request...")
    const prTitle = `fix: Reduce CLS (${beforeCls?.toFixed(3) || "?"} → ${afterCls?.toFixed(3) || "?"})`

    // Build visual comparison section if screenshots available
    let visualComparisonSection = ""
    if (prScreenshots && prScreenshots.length > 0) {
      const screenshotRows = prScreenshots
        .map((s) => {
          const beforeImg = s.beforeBlobUrl ? `![Before](${s.beforeBlobUrl})` : "_New page_"
          const afterImg = s.afterBlobUrl ? `![After](${s.afterBlobUrl})` : "_Failed_"
          return `| \`${s.route}\` | ${beforeImg} | ${afterImg} |`
        })
        .join("\n")

      visualComparisonSection = `

### Visual Comparison
| Route | Before | After |
|-------|--------|-------|
${screenshotRows}
`
    }

    const prBody = `## 🎯 CLS Fix by d3k

This PR contains automated fixes to reduce Cumulative Layout Shift (CLS).

### Results
| Metric | Before | After |
|--------|--------|-------|
| CLS Score | ${beforeCls?.toFixed(3) || "unknown"} | ${afterCls?.toFixed(3) || "unknown"} |
| Grade | ${beforeCls !== null ? (beforeCls <= 0.1 ? "Good ✅" : beforeCls <= 0.25 ? "Needs Improvement ⚠️" : "Poor ❌") : "unknown"} | ${afterCls !== null ? (afterCls <= 0.1 ? "Good ✅" : afterCls <= 0.25 ? "Needs Improvement ⚠️" : "Poor ❌") : "unknown"} |
${visualComparisonSection}
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
    timer.start("Update report with PR URL")
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

    timer.end()

    // Log timing breakdown
    const timingData = timer.getData()
    workflowLog(`[PR] ⏱️ TIMING BREAKDOWN (total: ${(timingData.totalMs / 1000).toFixed(1)}s)`)
    for (const step of timingData.steps) {
      const secs = (step.durationMs / 1000).toFixed(1)
      const pct = ((step.durationMs / timingData.totalMs) * 100).toFixed(0)
      workflowLog(`[PR]   ${step.name}: ${secs}s (${pct}%)`)
    }

    return {
      prUrl: prData.html_url,
      prNumber: prData.number,
      branch: branchName,
      timing: timingData
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    workflowLog(`[PR] Error: ${errorMsg}`)
    return { error: `Exception: ${errorMsg}` }
  }
}

// ============================================================
// Screenshot Capture for PR
// ============================================================

/**
 * Capture before/after screenshots for routes affected by the PR.
 * - Gets changed files from git diff
 * - Maps them to URL routes
 * - Screenshots production (before) and localhost (after)
 * - Uploads to blob storage for PR embedding
 */
export async function captureScreenshotsForPRStep(
  sandboxId: string,
  productionUrl: string,
  localhostUrl: string,
  projectName: string,
  _progressContext?: ProgressContext | null
): Promise<Array<{ route: string; beforeBlobUrl: string | null; afterBlobUrl: string | null }>> {
  workflowLog(`[Screenshots] Capturing before/after screenshots...`)
  workflowLog(`[Screenshots] Production: ${productionUrl}`)
  workflowLog(`[Screenshots] Localhost: ${localhostUrl}`)

  try {
    // Get sandbox
    const sandbox = await Sandbox.get({ sandboxId })
    if (sandbox.status !== "running") {
      workflowLog(`[Screenshots] Sandbox not running: ${sandbox.status}`)
      return []
    }

    // Get changed files from git
    const SANDBOX_CWD = "/vercel/sandbox"
    const diffResult = await runSandboxCommand(sandbox, "sh", ["-c", `cd ${SANDBOX_CWD} && git diff --name-only HEAD`])

    if (diffResult.exitCode !== 0) {
      workflowLog(`[Screenshots] Failed to get git diff: ${diffResult.stderr}`)
      return []
    }

    const changedFiles = diffResult.stdout.trim().split("\n").filter(Boolean)
    workflowLog(`[Screenshots] Changed files: ${changedFiles.length}`)

    if (changedFiles.length === 0) {
      return []
    }

    // Map files to routes
    const { mapFilesToRoutes, filterPageRoutes } = await import("@/lib/file-to-route")
    const routeMappings = mapFilesToRoutes(changedFiles)
    const routes = filterPageRoutes(routeMappings, 3)

    workflowLog(`[Screenshots] Routes to capture: ${routes.join(", ") || "(none)"}`)

    if (routes.length === 0) {
      return []
    }

    // Capture screenshots
    const { captureBeforeAfterScreenshots } = await import("@/lib/cloud/pr-screenshot-service")
    const screenshots = await captureBeforeAfterScreenshots({
      sandbox,
      productionUrl,
      localhostUrl,
      routes,
      projectName
    })

    workflowLog(`[Screenshots] Captured ${screenshots.length} screenshot set(s)`)
    return screenshots
  } catch (err) {
    workflowLog(`[Screenshots] Error: ${err instanceof Error ? err.message : String(err)}`)
    return []
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

## FIRST STEP - LOAD THE SKILL

**IMPORTANT:** Before doing anything else, call the \`get_skill\` tool to load the d3k skill:

\`\`\`
get_skill({ name: "d3k" })
\`\`\`

## CRITICAL: You MUST write a fix!
Your goal is to WRITE CODE that fixes the CLS issue, not just analyze it.
You have limited steps - be efficient and focused.

## Workflow (5-7 steps max):
1. **Load skill** - Call \`get_skill({ name: "d3k" })\`
2. **diagnose** - See what's shifting (1 step)
3. **Find code** - Search for the shifting element in code (1-2 steps)
4. **writeFile** - FIX THE CODE (1 step) ← THIS IS REQUIRED!
5. **diagnose** - Verify fix worked (1 step)

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
 * Build system prompt for the design-guidelines workflow type
 * This instructs the agent to use the get_skill tool to load the vercel-design-guidelines skill
 */
function buildDesignGuidelinesPrompt(startPath: string, devUrl: string, crawlDepth?: number | "all"): string {
  // Determine if we should crawl multiple pages
  const shouldCrawl = crawlDepth && crawlDepth !== 1
  const crawlInstructions = shouldCrawl
    ? `
## MULTI-PAGE CRAWL MODE

You are in **multi-page crawl mode** with depth=${crawlDepth}. This means you should audit MULTIPLE pages, not just the start page.

### Crawl Workflow:
1. **FIRST: Use crawl_app** - Run \`crawl_app\` with depth=${crawlDepth} to discover all pages on the site
2. **Review the discovered URLs** - The crawl_app tool returns a list of all pages found
3. **Audit each important page** - Read the code and check against the design guidelines
4. **Aggregate findings** - Combine issues from all pages before fixing
5. **Fix common issues first** - Issues appearing on multiple pages (like global CSS, layout, nav) should be fixed first

`
    : ""

  return `You are a design guidelines auditor. Your task is to evaluate this web interface against Vercel's design guidelines and implement fixes.

## FIRST STEP - LOAD THE SKILLS

**IMPORTANT:** Before doing anything else, you MUST call the \`get_skill\` tool to load the d3k skill and the design-guidelines skill:

\`\`\`
get_skill({ name: "d3k" })
get_skill({ name: "vercel-design-guidelines" })
\`\`\`

This will give you the complete design guidelines audit instructions, including:
- All audit categories (Interactions, Animations, Layout, Content, Forms, Performance, Design, Copywriting)
- Severity levels (Critical, Warning, Suggestion)
- Quick checklist of high-impact items
- Output format for reporting issues
- Example violations and fixes

${crawlInstructions}
## YOUR MISSION

${shouldCrawl ? `1. **Load skills** - Call \`get_skill({ name: "d3k" })\` then \`get_skill({ name: "vercel-design-guidelines" })\`` : '1. **Load skills** - Call `get_skill({ name: "d3k" })` then `get_skill({ name: "vercel-design-guidelines" })`'}
${shouldCrawl ? `2. **Use crawl_app** to discover all pages on the site (depth=${crawlDepth})` : ""}
${shouldCrawl ? "3" : "2"}. **Read the code** - Use readFile, globSearch to examine components, styles, HTML
${shouldCrawl ? "4" : "3"}. **Audit against guidelines** - Check each category, note violations with file:line references
${shouldCrawl ? "5" : "4"}. **IMPLEMENT FIXES** - Write code to fix Critical issues first, then Warnings
${shouldCrawl ? "6" : "5"}. **Verify** - Use diagnose to confirm changes work
${shouldCrawl ? "7" : "6"}. **Document** - Track what you fixed in your summary

## AVAILABLE TOOLS

### Skill Tool (USE THIS FIRST!)
- **get_skill** - Load a d3k skill to get detailed instructions. Call with \`{ name: "d3k" }\` then \`{ name: "vercel-design-guidelines" }\`
${
  shouldCrawl
    ? `
### Site Crawler (USE AFTER LOADING SKILL!)
- **crawl_app** - Crawls the site to discover all pages.
`
    : ""
}
### Code Tools
- **readFile** - Read any file in the codebase
- **writeFile** - Create or modify files (HMR applies changes immediately)
- **globSearch** - Find files by pattern (e.g., "**/*.tsx", "layout.*")
- **grepSearch** - Search file contents for patterns
- **listDir** - List directory contents
- **gitDiff** - See your changes

### Browser Tools
- **diagnose** - Navigate and get CLS measurements + screenshots
- **getWebVitals** - Get all Core Web Vitals (LCP, FCP, TTFB, CLS, INP)

## IMPORTANT RULES

1. **START by calling get_skill({ name: "d3k" }) then get_skill({ name: "vercel-design-guidelines" })**${
    shouldCrawl ? ", then crawl_app" : ""
  }
2. **YOU MUST WRITE CODE** - Don't just analyze, actually fix issues!
3. **Prioritize Critical issues first** - Then Warnings, then Suggestions
4. **Be efficient** - You have limited steps (15 max), focus on high-impact fixes
5. **Verify your fixes** - Run diagnose after making changes

## DEVELOPMENT ENVIRONMENT
- **App URL**: ${devUrl}
- **Start Page**: ${startPath}
- **Working Directory**: /vercel/sandbox
${shouldCrawl ? `- **Crawl Depth**: ${crawlDepth}` : ""}

${shouldCrawl ? `Start by calling get_skill to load the d3k skill and design guidelines, then use crawl_app to discover all pages.` : `Start by calling get_skill({ name: "d3k" }) then get_skill({ name: "vercel-design-guidelines" }) to load the full design guidelines, then read the code and audit it.`}`
}

/**
 * Build system prompt for the react-performance workflow type
 * This instructs the agent to use the get_skill tool to load the react-performance skill
 */
function buildReactPerformancePrompt(startPath: string, devUrl: string): string {
  return `You are a React/Next.js performance optimization specialist. Your task is to analyze this codebase for performance issues and implement fixes.

## FIRST STEP - LOAD THE SKILLS

**IMPORTANT:** Before doing anything else, you MUST call the \`get_skill\` tool to load the d3k skill and the react-performance skill:

\`\`\`
get_skill({ name: "d3k" })
get_skill({ name: "react-performance" })
\`\`\`

This will give you the complete React Performance Guidelines, including:
- Eliminating waterfalls (CRITICAL - 2-10x improvement)
- Bundle size optimization (CRITICAL)
- Server-side performance (HIGH impact)
- Client-side data fetching (MEDIUM-HIGH)
- Re-render optimization (MEDIUM)
- Rendering performance (MEDIUM)
- JavaScript micro-optimizations (LOW-MEDIUM)
- Advanced patterns (LOW)

## YOUR MISSION

1. **Load skills** - Call \`get_skill({ name: "d3k" })\` then \`get_skill({ name: "react-performance" })\`
2. **Capture baseline** - Use \`getWebVitals\` to measure current performance
3. **Analyze code** - Use readFile, globSearch to examine components, data fetching, imports
4. **Identify issues** - Check for waterfalls, large bundles, unnecessary re-renders
5. **IMPLEMENT FIXES** - Write code to fix high-impact issues first
6. **Verify** - Use getWebVitals to confirm improvements
7. **Document** - Track what you optimized in your summary

## AVAILABLE TOOLS

### Skill Tool (USE THIS FIRST!)
- **get_skill** - Load a d3k skill to get detailed instructions. Call with \`{ name: "d3k" }\` then \`{ name: "react-performance" }\`

### Code Tools
- **readFile** - Read any file in the codebase
- **writeFile** - Create or modify files (HMR applies changes immediately)
- **globSearch** - Find files by pattern (e.g., "**/*.tsx", "layout.*")
- **grepSearch** - Search file contents for patterns
- **listDir** - List directory contents
- **gitDiff** - See your changes

### Performance Tools
- **getWebVitals** - Get all Core Web Vitals (LCP, FCP, TTFB, CLS, INP)
- **diagnose** - Navigate and get CLS measurements + screenshots

## HIGH-IMPACT PATTERNS TO LOOK FOR

1. **Sequential awaits** → Use Promise.all() for independent operations
2. **Large imports** → Use dynamic imports with next/dynamic
3. **Missing memoization** → Add React.memo, useMemo, useCallback where needed
4. **Prop drilling objects** → Narrow to specific fields to prevent re-renders
5. **Client-side fetching without SWR** → Add deduplication with SWR

## IMPORTANT RULES

1. **START by calling get_skill({ name: "d3k" }) then get_skill({ name: "react-performance" })**
2. **YOU MUST WRITE CODE** - Don't just analyze, actually implement fixes!
3. **Prioritize by impact** - CRITICAL issues first (waterfalls, bundles), then lower
4. **Be efficient** - You have limited steps (15 max), focus on high-impact fixes
5. **Verify with getWebVitals** - Run after making changes to measure improvement

## DEVELOPMENT ENVIRONMENT
- **App URL**: ${devUrl}
- **Start Page**: ${startPath}
- **Working Directory**: /vercel/sandbox

Start by calling get_skill({ name: "d3k" }) then get_skill({ name: "react-performance" }) to load the full performance guidelines, then use getWebVitals to capture baseline metrics.`
}

/**
 * Build system prompt for the turbopack-bundle-analyzer workflow type.
 */
function buildTurbopackBundleAnalyzerPrompt(startPath: string, devUrl: string): string {
  return `You are a Turbopack bundle optimization specialist.

Your mission is to inspect Turbopack bundle analyzer output, implement concrete optimizations, and verify bundle improvements without breaking the app.

## FIRST STEP - LOAD THE SKILL

Before doing anything else, call:
\`\`\`
get_skill({ name: "d3k" })
\`\`\`

## ANALYSIS WORKFLOW
1. Open \`http://localhost:4000\` and inspect bundle analyzer findings.
2. Open \`${devUrl}${startPath}\` and inspect app/runtime behavior.
3. Identify highest-impact bundle issues.
4. Implement fixes with code changes.
5. Validate app health after changes.
6. Re-run bundle analysis and verify improvements before final summary.

## RULES
- You are expected to make code changes when clear optimization opportunities exist.
- Be explicit about confidence and uncertainty.
- Prefer optimizations that reduce JavaScript shipped, duplicate modules, and initial route payload.
- Use \`runProjectCommand\` for verification commands (including re-running bundle analysis).

## ENVIRONMENT
- App URL: ${devUrl}
- Start Path: ${startPath}
- Working Directory: /vercel/sandbox
`
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

### Skill Tool (USE THIS FIRST!)
- **get_skill** - Load a d3k skill to get detailed instructions. Call with \`{ name: "d3k" }\`

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

1. **Start by loading the d3k skill** - Call \`get_skill({ name: "d3k" })\`
2. **Start with getWebVitals or diagnose** - Capture the initial performance metrics
3. **Explore first** - Use readFile, searchFiles, and grep to understand the codebase
4. **Make targeted changes** - Edit only what's necessary
5. **Verify with diagnose** - After changes, use diagnose to confirm they work
6. **Be efficient** - You have limited steps, so be focused

## IMPORTANT NOTES
- Changes are saved immediately when you use writeFile
- Hot Module Replacement (HMR) applies changes without full page reload
- Always use diagnose after making changes to capture the "after" state
- The diagnose tool will show you any console errors or layout shifts

Now, complete the task described above. Start by calling get_skill({ name: "d3k" }) and then use diagnose to capture the current state of the page.`
}
