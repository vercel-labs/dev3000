import { ArrowLeft, Download } from "lucide-react"
import type { Metadata } from "next"
import Image from "next/image"
import { redirect } from "next/navigation"
import { Suspense } from "react"
import { getCurrentUser } from "@/lib/auth"
import type { WorkflowRun } from "@/lib/workflow-storage"
import { getPublicWorkflowRun, getWorkflowRun } from "@/lib/workflow-storage"
import type { WorkflowReport } from "@/types"
import { AgentAnalysis } from "./agent-analysis"
import { CollapsibleSection } from "./collapsible-section"
import { CoordinatedPlayers } from "./coordinated-players"
import { ReportPending } from "./report-pending"
import { ScreenshotPlayer } from "./screenshot-player"
import { ShareButton } from "./share-button"

export const metadata: Metadata = {
  title: "d3k workflow report"
}

export default async function WorkflowReportPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  const { id } = await params

  // Prefer owner lookup first when authenticated (much faster than global public scan).
  let run = user ? await getWorkflowRun(user.id, id) : null
  let isOwner = false

  // Fall back to public report lookup when owner lookup misses (or user is signed out).
  if (!run) {
    run = await getPublicWorkflowRun(id)
    if (!run && !user) {
      redirect("/signin")
    }
  }

  if (user && run) {
    isOwner = run.userId === user.id
  }

  const isPublicView = !isOwner && !!run?.isPublic

  if (!run) {
    redirect("/workflows")
  }

  if (!run.reportBlobUrl) {
    if (user && isOwner) {
      return <ReportPending runId={id} userId={user.id} />
    }
    return <ReportPending runId={id} />
  }

  const reportBlobUrl = run.reportBlobUrl

  return (
    <Suspense fallback={<ReportLoading isPublicView={isPublicView} />}>
      <ReportContent id={id} run={run} isOwner={isOwner} isPublicView={isPublicView} reportBlobUrl={reportBlobUrl} />
    </Suspense>
  )
}

async function ReportContent({
  id,
  run,
  isOwner,
  isPublicView,
  reportBlobUrl
}: {
  id: string
  run: WorkflowRun
  isOwner: boolean
  isPublicView: boolean
  reportBlobUrl: string
}) {
  // Fetch the JSON report from the blob URL
  const response = await fetch(reportBlobUrl)
  const report: WorkflowReport = await response.json()

  // Use report's workflowType, fallback to run's type (for backward compat with old reports)
  const workflowType = report.workflowType || run.type || "cls-fix"
  const workflowLabel =
    workflowType === "prompt"
      ? "Custom Prompt"
      : workflowType === "design-guidelines"
        ? "Design Guidelines"
        : workflowType === "react-performance"
          ? "React Performance"
          : workflowType === "turbopack-bundle-analyzer"
            ? "Turbopack Bundle Analyzer"
          : workflowType === "url-audit"
            ? "URL Audit"
            : "CLS Fix"
  const reportCrumbLabel = workflowType === "cls-fix" ? "Fix Report" : "Workflow Report"
  const step2Description =
    workflowType === "prompt"
      ? "AI agent executed your custom task and generated this report."
      : workflowType === "design-guidelines"
        ? "Read-only design and UX analysis of the target URL."
      : workflowType === "react-performance"
        ? "Read-only React performance analysis of the target URL."
      : workflowType === "turbopack-bundle-analyzer"
        ? "AI explored Turbopack bundle analyzer output and generated optimization guidance."
      : workflowType === "url-audit"
        ? "Read-only UX and performance analysis of the target URL."
        : "AI agent attempted to fix CLS issues (up to 3 retries)."
  const reportHeading =
    workflowType === "design-guidelines"
      ? "Report: Vercel Web Design Guidelines Audit"
      : workflowType === "turbopack-bundle-analyzer"
        ? "Report: Turbopack Bundle Analyzer"
      : `Report Results: ${workflowLabel}`

  // Helper to format CLS grade
  const gradeColor = (grade?: string) => {
    switch (grade) {
      case "good":
        return "text-green-600 bg-green-100"
      case "needs-improvement":
        return "text-yellow-600 bg-yellow-100"
      case "poor":
        return "text-red-600 bg-red-100"
      default:
        return "text-gray-600 bg-gray-100"
    }
  }

  const formatSeconds = (ms?: number) => (typeof ms === "number" ? `${(ms / 1000).toFixed(1)}s` : "—")
  const formatMs = (ms?: number) => (typeof ms === "number" ? `${ms.toFixed(0)}ms` : "—")
  const formatClsValue = (value?: number) => (typeof value === "number" ? value.toFixed(4) : "—")
  const formatClsDeltaPercent = (before?: number, after?: number) => {
    if (typeof before !== "number" || typeof after !== "number" || before === 0) {
      return "—"
    }
    return `${((Math.abs(after - before) / before) * 100).toFixed(0)}%`
  }
  const hasWebVitalsData =
    !!report.beforeWebVitals ||
    !!report.afterWebVitals ||
    report.clsScore !== undefined ||
    report.afterClsScore !== undefined
  const isReadOnlyUrlWorkflow = workflowType === "url-audit" || report.analysisTargetType === "url"
  const showBeforeAfterVitals =
    !isReadOnlyUrlWorkflow &&
    workflowType === "cls-fix" &&
    (!!report.afterWebVitals || report.afterClsScore !== undefined)
  const skillLink = (skill: string) => {
    const normalized = skill.trim().toLowerCase()
    if (normalized === "d3k" || normalized.includes("d3k")) return "https://dev3000.ai"
    if (normalized.includes("web-design-guidelines") || normalized.includes("vercel web design guidelines")) {
      return "https://skills.sh/vercel-labs/agent-skills/web-design-guidelines"
    }
    return `https://skills.sh/vercel-labs/agent-skills/${normalized.replace(/\s+/g, "-")}`
  }
  const normalizeSkillLabel = (skill: string) => {
    const normalized = skill.trim().toLowerCase()
    if (normalized.includes("web-design-guidelines")) return "Vercel Web Design Guidelines"
    if (normalized === "d3k" || normalized.includes("d3k")) return "d3k"
    return skill
  }
  const explicitSkills = [...(report.skillsLoaded || []), ...(report.skillsInstalled || [])]
  const inferredSkills: string[] = ["d3k"]
  if (workflowType === "design-guidelines") inferredSkills.unshift("Vercel Web Design Guidelines")
  const skillsUsed = Array.from(
    new Map(
      [...explicitSkills, ...inferredSkills].map((skill) => {
        const label = normalizeSkillLabel(skill)
        return [label.toLowerCase(), { label, url: skillLink(skill) }]
      })
    ).values()
  )
  const reportTitle = report.targetUrl || report.projectName

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 pt-8 pb-24 max-w-4xl">
        <div className="flex items-center gap-4 mb-6">
          {isPublicView ? (
            <span className="inline-flex items-center gap-2 text-muted-foreground">
              <span className="font-semibold">d3k</span>
              <span>/</span>
              <span>Public Report</span>
            </span>
          ) : (
            <>
              <a
                href="/workflows"
                className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
              >
                <ArrowLeft className="h-4 w-4" />
                <span className="font-semibold">d3k</span>
              </a>
              <span className="text-muted-foreground">/</span>
              <span className="text-muted-foreground">{reportCrumbLabel}</span>
            </>
          )}
        </div>

        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-3xl font-bold">{reportTitle}</h1>
            <p className="text-muted-foreground mt-1">{new Date(report.timestamp).toLocaleString()}</p>
          </div>
          <div className="flex items-center gap-3">
            {isOwner && <ShareButton runId={id} initialIsPublic={run.isPublic ?? false} />}
            <a
              href={reportBlobUrl}
              download
              className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
            >
              <Download className="h-4 w-4" />
              JSON
            </a>
          </div>
        </div>

        <div className="text-sm text-muted-foreground mb-4">
          <span>Skills Used: </span>
          {skillsUsed.length > 0 ? (
            <span>
              {skillsUsed.map((skill, index) => (
                <span key={`skills-used-${skill.label}`}>
                  <a href={skill.url} target="_blank" rel="noopener noreferrer" className="hover:underline font-medium">
                    {skill.label}
                  </a>
                  {index < skillsUsed.length - 1 ? ", " : ""}
                </span>
              ))}
            </span>
          ) : (
            <span>None recorded</span>
          )}
        </div>

        {/* d3k agent transcript */}
        {(report.timing || report.initD3kLogs || report.d3kLogs || report.afterD3kLogs) && (
          <div className="mb-5">
            <details>
              <summary className="text-sm text-muted-foreground cursor-pointer hover:text-foreground select-none">
                d3k agent transcript
              </summary>
              <div className="mt-3 space-y-4">
                {(report.sandboxDevUrl ||
                  report.targetUrl ||
                  report.repoUrl ||
                  report.repoBranch ||
                  report.projectDir) && (
                  <div className="text-xs text-muted-foreground">
                    <ul className="flex flex-wrap gap-x-6 gap-y-1">
                      {report.sandboxDevUrl && (
                        <li>
                          <span>{report.analysisTargetType === "url" ? "Sandbox: " : "Dev: "}</span>
                          <a
                            href={report.sandboxDevUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-mono hover:underline"
                          >
                            {report.sandboxDevUrl}
                          </a>
                        </li>
                      )}
                      {report.targetUrl && (
                        <li>
                          <span>Target: </span>
                          <a
                            href={report.targetUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-mono hover:underline"
                          >
                            {report.targetUrl}
                          </a>
                        </li>
                      )}
                      {report.repoUrl && (
                        <li>
                          <span>Repo: </span>
                          <a
                            href={report.repoUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-mono hover:underline"
                          >
                            {report.repoUrl}
                          </a>
                        </li>
                      )}
                      {report.repoBranch && (
                        <li>
                          <span>Ref: </span>
                          <span className="font-mono">{report.repoBranch}</span>
                        </li>
                      )}
                      {report.projectDir && (
                        <li>
                          <span>Dir: </span>
                          <span className="font-mono">{report.projectDir}</span>
                        </li>
                      )}
                    </ul>
                  </div>
                )}

                {report.timing && (
                  <>
                    <div className="flex flex-wrap items-center gap-4">
                      <div className="flex items-center gap-2">
                        <span
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
                            report.fromSnapshot
                              ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
                              : "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200"
                          }`}
                        >
                          {report.fromSnapshot ? "Snapshot Reused" : "Fresh Sandbox"}
                        </span>
                      </div>
                      <div className="flex items-center gap-4 text-sm">
                        <span className="text-muted-foreground">
                          Total:{" "}
                          <span className="font-medium text-foreground">
                            {formatSeconds(report.timing?.total?.totalMs)}
                          </span>
                        </span>
                        <span className="text-muted-foreground">
                          Init: <span className="font-mono text-xs">{formatSeconds(report.timing?.total?.initMs)}</span>
                        </span>
                        <span className="text-muted-foreground">
                          Agent:{" "}
                          <span className="font-mono text-xs">{formatSeconds(report.timing?.total?.agentMs)}</span>
                        </span>
                        {report.timing?.total?.prMs && (
                          <span className="text-muted-foreground">
                            PR: <span className="font-mono text-xs">{formatSeconds(report.timing?.total?.prMs)}</span>
                          </span>
                        )}
                      </div>
                    </div>

                    <details className="pt-1">
                      <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                        View step-by-step timing breakdown
                      </summary>
                      <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                        {report.timing.init?.steps && report.timing.init.steps.length > 0 && (
                          <div>
                            <div className="font-medium text-muted-foreground mb-1">Init Steps</div>
                            <ul className="space-y-0.5 font-mono">
                              {report.timing.init.steps.map((step) => (
                                <li key={`init-${step.name}`} className="flex justify-between">
                                  <span className="truncate mr-2">{step.name}</span>
                                  <span className="text-muted-foreground">{formatSeconds(step.durationMs)}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {report.timing.agent?.steps && report.timing.agent.steps.length > 0 && (
                          <div>
                            <div className="font-medium text-muted-foreground mb-1">Agent Steps</div>
                            <ul className="space-y-0.5 font-mono">
                              {report.timing.agent.steps.map((step) => (
                                <li key={`agent-${step.name}`} className="flex justify-between">
                                  <span className="truncate mr-2">{step.name}</span>
                                  <span className="text-muted-foreground">{formatSeconds(step.durationMs)}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    </details>
                  </>
                )}

                {(report.initD3kLogs || report.d3kLogs) && (
                  <div>
                    <div className="text-xs font-medium text-muted-foreground mb-1">Init</div>
                    <pre className="bg-muted/50 rounded p-4 text-xs font-mono overflow-x-auto whitespace-pre-wrap max-h-96 overflow-y-auto">
                      {report.initD3kLogs || report.d3kLogs}
                    </pre>
                  </div>
                )}

                {report.afterD3kLogs && (
                  <div>
                    <div className="text-xs font-medium text-muted-foreground mb-1">After</div>
                    <pre className="bg-muted/50 rounded p-4 text-xs font-mono overflow-x-auto whitespace-pre-wrap max-h-96 overflow-y-auto">
                      {report.afterD3kLogs}
                    </pre>
                  </div>
                )}
              </div>
            </details>
          </div>
        )}

        {/* Report */}
        <div className="bg-card border border-border rounded-lg p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">{reportHeading}</h2>
          <p className="text-sm text-muted-foreground mb-4">{step2Description}</p>

          {/* Custom Prompt Section (for prompt workflow type) */}
          {workflowType === "prompt" && report.customPrompt && (
            <div className="mb-4">
              <h3 className="text-sm font-medium text-muted-foreground mb-2">Your Task</h3>
              <div className="bg-muted/50 rounded p-4 text-sm whitespace-pre-wrap">{report.customPrompt}</div>
            </div>
          )}

          {/* System Prompt (always shown in collapsible) */}
          {report.systemPrompt && (
            <CollapsibleSection title="System Prompt" defaultOpen={false}>
              <pre className="bg-muted/50 rounded p-4 text-xs font-mono overflow-x-auto whitespace-pre-wrap max-h-96 overflow-y-auto">
                {report.systemPrompt}
              </pre>
            </CollapsibleSection>
          )}

          {/* CLS Results - only show for cls-fix workflow type */}
          {workflowType === "cls-fix" && report.clsScore !== undefined && (
            <>
              <h3 className="text-lg font-medium mb-3">CLS Results</h3>

              {/* Show before/after if we have verification data */}
              {report.afterClsScore !== undefined ? (
                <div className="space-y-4">
                  {/* Verification Status Banner */}
                  <div
                    className={`rounded-lg p-4 ${
                      report.verificationStatus === "improved"
                        ? "bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800"
                        : report.verificationStatus === "degraded"
                          ? "bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800"
                          : "bg-yellow-50 dark:bg-yellow-950 border border-yellow-200 dark:border-yellow-800"
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-lg">
                        {report.verificationStatus === "improved"
                          ? "✅"
                          : report.verificationStatus === "degraded"
                            ? "❌"
                            : "⚠️"}
                      </span>
                      <span className="font-semibold">
                        {report.verificationStatus === "improved"
                          ? "Fix Verified - CLS Improved!"
                          : report.verificationStatus === "degraded"
                            ? "Fix May Have Caused Regression"
                            : "CLS Unchanged After Fix"}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {report.verificationStatus === "improved"
                        ? `CLS reduced by ${formatClsDeltaPercent(report.clsScore, report.afterClsScore)}`
                        : report.verificationStatus === "degraded"
                          ? `CLS increased by ${formatClsDeltaPercent(report.clsScore, report.afterClsScore)}`
                          : "The fix did not significantly impact CLS score"}
                    </p>
                  </div>

                  {/* Before / After Comparison */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="text-center p-4 bg-muted/30 rounded-lg">
                      <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Before</div>
                      <div className="text-3xl font-bold">{formatClsValue(report.clsScore)}</div>
                      {report.clsGrade && (
                        <span
                          className={`inline-block mt-2 px-2 py-0.5 rounded-full text-xs font-medium ${gradeColor(report.clsGrade)}`}
                        >
                          {report.clsGrade}
                        </span>
                      )}
                    </div>
                    <div className="text-center p-4 bg-muted/30 rounded-lg">
                      <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">After</div>
                      <div className="text-3xl font-bold">{formatClsValue(report.afterClsScore)}</div>
                      {report.afterClsGrade && (
                        <span
                          className={`inline-block mt-2 px-2 py-0.5 rounded-full text-xs font-medium ${gradeColor(report.afterClsGrade)}`}
                        >
                          {report.afterClsGrade}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                /* Original display if no verification data */
                <div className="flex items-center gap-4 mb-4">
                  <div className="text-4xl font-bold">{formatClsValue(report.clsScore)}</div>
                  {report.clsGrade && (
                    <span className={`px-3 py-1 rounded-full text-sm font-medium ${gradeColor(report.clsGrade)}`}>
                      {report.clsGrade}
                    </span>
                  )}
                </div>
              )}

              {/* Verification Error */}
              {report.verificationError && (
                <div className="mt-4 p-3 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded text-sm text-red-800 dark:text-red-200">
                  <span className="font-medium">Verification Error: </span>
                  {report.verificationError}
                </div>
              )}

              {/* Layout Shifts Details */}
              {report.layoutShifts && report.layoutShifts.length > 0 && (
                <div className="mt-4">
                  <h3 className="text-sm font-medium text-muted-foreground mb-2">Layout Shift Details</h3>
                  <div className="space-y-2">
                    {report.layoutShifts.map((shift, i) => (
                      <div key={`shift-${shift.timestamp}`} className="bg-muted/50 rounded p-3 text-sm">
                        <div className="flex justify-between mb-1">
                          <span className="font-medium">Shift #{i + 1}</span>
                          <span className="text-muted-foreground">score: {formatClsValue(shift.score)}</span>
                        </div>
                        {shift.elements.length > 0 && (
                          <div className="text-muted-foreground text-xs">Elements: {shift.elements.join(", ")}</div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {/* Screenshots - shown for ALL workflow types */}
          {(report.beforeScreenshots?.length ||
            report.afterScreenshots?.length ||
            report.clsScreenshots?.length ||
            report.beforeScreenshotUrl ||
            report.afterScreenshotUrl) && (
            <div className="mt-6 pt-4 border-t border-border">
              <h3 className="text-lg font-medium mb-3">Screenshots</h3>

              {/* Animated players for before/after screenshot sequences */}
              {(report.beforeScreenshots?.length || report.clsScreenshots?.length) &&
              report.afterScreenshots?.length ? (
                /* Both before and after have animated screenshots - use coordinated player */
                <CoordinatedPlayers
                  beforeScreenshots={report.beforeScreenshots || report.clsScreenshots || []}
                  afterScreenshots={report.afterScreenshots}
                  fps={2}
                  loopDelayMs={10000}
                />
              ) : report.beforeScreenshots?.length ||
                report.afterScreenshots?.length ||
                report.clsScreenshots?.length ? (
                /* Only one side has animated screenshots - use individual players */
                <div className="grid grid-cols-2 gap-4">
                  {/* Before - use beforeScreenshots or fallback to clsScreenshots */}
                  {report.beforeScreenshots?.length || report.clsScreenshots?.length ? (
                    <ScreenshotPlayer
                      screenshots={report.beforeScreenshots || report.clsScreenshots || []}
                      title="Before"
                      autoPlay={true}
                      fps={2}
                      loop={true}
                    />
                  ) : report.beforeScreenshotUrl ? (
                    <div className="bg-muted/30 rounded-lg overflow-hidden">
                      <div className="px-3 py-2 border-b border-border bg-muted/50">
                        <span className="text-xs text-muted-foreground uppercase tracking-wide">Before</span>
                      </div>
                      <a href={report.beforeScreenshotUrl} target="_blank" rel="noopener noreferrer">
                        <Image
                          src={report.beforeScreenshotUrl}
                          alt="Before screenshot"
                          width={400}
                          height={225}
                          unoptimized
                          className="w-full h-auto"
                        />
                      </a>
                    </div>
                  ) : null}

                  {/* After */}
                  {report.afterScreenshots?.length ? (
                    <ScreenshotPlayer
                      screenshots={report.afterScreenshots}
                      title="After"
                      autoPlay={true}
                      fps={2}
                      loop={true}
                    />
                  ) : report.afterScreenshotUrl ? (
                    <div className="bg-muted/30 rounded-lg overflow-hidden">
                      <div className="px-3 py-2 border-b border-border bg-muted/50">
                        <span className="text-xs text-muted-foreground uppercase tracking-wide">After</span>
                      </div>
                      <a href={report.afterScreenshotUrl} target="_blank" rel="noopener noreferrer">
                        <Image
                          src={report.afterScreenshotUrl}
                          alt="After screenshot"
                          width={400}
                          height={225}
                          unoptimized
                          className="w-full h-auto"
                        />
                      </a>
                    </div>
                  ) : null}
                </div>
              ) : (
                /* Fallback: static images only */
                <div className="grid grid-cols-2 gap-4">
                  {report.beforeScreenshotUrl && (
                    <div className="bg-muted/30 rounded-lg overflow-hidden">
                      <div className="px-3 py-2 border-b border-border bg-muted/50">
                        <span className="text-xs text-muted-foreground uppercase tracking-wide">Before</span>
                      </div>
                      <a href={report.beforeScreenshotUrl} target="_blank" rel="noopener noreferrer">
                        <Image
                          src={report.beforeScreenshotUrl}
                          alt="Before screenshot"
                          width={400}
                          height={225}
                          unoptimized
                          className="w-full h-auto"
                        />
                      </a>
                    </div>
                  )}
                  {report.afterScreenshotUrl && (
                    <div className="bg-muted/30 rounded-lg overflow-hidden">
                      <div className="px-3 py-2 border-b border-border bg-muted/50">
                        <span className="text-xs text-muted-foreground uppercase tracking-wide">After</span>
                      </div>
                      <a href={report.afterScreenshotUrl} target="_blank" rel="noopener noreferrer">
                        <Image
                          src={report.afterScreenshotUrl}
                          alt="After screenshot"
                          width={400}
                          height={225}
                          unoptimized
                          className="w-full h-auto"
                        />
                      </a>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Web Vitals - shown for all workflow types when we have metrics or CLS scores */}
          {hasWebVitalsData && (
            <div className="mt-6 pt-6 border-t border-border">
              <h3 className="text-lg font-medium mb-4">Core Web Vitals</h3>
              {showBeforeAfterVitals ? (
                <div className="grid grid-cols-2 gap-4">
                  {/* Before */}
                  <div className="bg-muted/30 rounded-lg p-4">
                    <div className="text-xs text-muted-foreground uppercase tracking-wide mb-3">Before</div>
                    <div className="space-y-2">
                      {report.beforeWebVitals?.lcp && (
                        <div className="flex justify-between items-center">
                          <span className="text-sm" title="Largest Contentful Paint">
                            LCP
                          </span>
                          <span
                            className={`text-sm font-medium ${report.beforeWebVitals.lcp.grade === "good" ? "text-green-600" : report.beforeWebVitals.lcp.grade === "needs-improvement" ? "text-yellow-600" : "text-red-600"}`}
                          >
                            {formatMs(report.beforeWebVitals.lcp.value)}
                          </span>
                        </div>
                      )}
                      {report.beforeWebVitals?.fcp && (
                        <div className="flex justify-between items-center">
                          <span className="text-sm" title="First Contentful Paint">
                            FCP
                          </span>
                          <span
                            className={`text-sm font-medium ${report.beforeWebVitals.fcp.grade === "good" ? "text-green-600" : report.beforeWebVitals.fcp.grade === "needs-improvement" ? "text-yellow-600" : "text-red-600"}`}
                          >
                            {formatMs(report.beforeWebVitals.fcp.value)}
                          </span>
                        </div>
                      )}
                      {report.beforeWebVitals?.ttfb && (
                        <div className="flex justify-between items-center">
                          <span className="text-sm" title="Time to First Byte">
                            TTFB
                          </span>
                          <span
                            className={`text-sm font-medium ${report.beforeWebVitals.ttfb.grade === "good" ? "text-green-600" : report.beforeWebVitals.ttfb.grade === "needs-improvement" ? "text-yellow-600" : "text-red-600"}`}
                          >
                            {formatMs(report.beforeWebVitals.ttfb.value)}
                          </span>
                        </div>
                      )}
                      {(report.beforeWebVitals?.cls || report.clsScore !== undefined) && (
                        <div className="flex justify-between items-center">
                          <span className="text-sm" title="Cumulative Layout Shift">
                            CLS
                          </span>
                          <span
                            className={`text-sm font-medium ${
                              (report.beforeWebVitals?.cls?.grade || report.clsGrade) === "good"
                                ? "text-green-600"
                                : (report.beforeWebVitals?.cls?.grade || report.clsGrade) === "needs-improvement"
                                  ? "text-yellow-600"
                                  : "text-red-600"
                            }`}
                          >
                            {formatClsValue(report.beforeWebVitals?.cls?.value ?? report.clsScore)}
                          </span>
                        </div>
                      )}
                      {report.beforeWebVitals?.inp && (
                        <div className="flex justify-between items-center">
                          <span className="text-sm" title="Interaction to Next Paint">
                            INP
                          </span>
                          <span
                            className={`text-sm font-medium ${report.beforeWebVitals.inp.grade === "good" ? "text-green-600" : report.beforeWebVitals.inp.grade === "needs-improvement" ? "text-yellow-600" : "text-red-600"}`}
                          >
                            {formatMs(report.beforeWebVitals.inp.value)}
                          </span>
                        </div>
                      )}
                      {!report.beforeWebVitals?.lcp &&
                        !report.beforeWebVitals?.fcp &&
                        !report.beforeWebVitals?.ttfb &&
                        !report.beforeWebVitals?.cls &&
                        !report.beforeWebVitals?.inp &&
                        report.clsScore === undefined && (
                          <span className="text-sm text-muted-foreground">No metrics captured</span>
                        )}
                    </div>
                  </div>
                  {/* After */}
                  <div className="bg-muted/30 rounded-lg p-4">
                    <div className="text-xs text-muted-foreground uppercase tracking-wide mb-3">After</div>
                    <div className="space-y-2">
                      {report.afterWebVitals?.lcp && (
                        <div className="flex justify-between items-center">
                          <span className="text-sm" title="Largest Contentful Paint">
                            LCP
                          </span>
                          <span
                            className={`text-sm font-medium ${report.afterWebVitals.lcp.grade === "good" ? "text-green-600" : report.afterWebVitals.lcp.grade === "needs-improvement" ? "text-yellow-600" : "text-red-600"}`}
                          >
                            {formatMs(report.afterWebVitals.lcp.value)}
                          </span>
                        </div>
                      )}
                      {report.afterWebVitals?.fcp && (
                        <div className="flex justify-between items-center">
                          <span className="text-sm" title="First Contentful Paint">
                            FCP
                          </span>
                          <span
                            className={`text-sm font-medium ${report.afterWebVitals.fcp.grade === "good" ? "text-green-600" : report.afterWebVitals.fcp.grade === "needs-improvement" ? "text-yellow-600" : "text-red-600"}`}
                          >
                            {formatMs(report.afterWebVitals.fcp.value)}
                          </span>
                        </div>
                      )}
                      {report.afterWebVitals?.ttfb && (
                        <div className="flex justify-between items-center">
                          <span className="text-sm" title="Time to First Byte">
                            TTFB
                          </span>
                          <span
                            className={`text-sm font-medium ${report.afterWebVitals.ttfb.grade === "good" ? "text-green-600" : report.afterWebVitals.ttfb.grade === "needs-improvement" ? "text-yellow-600" : "text-red-600"}`}
                          >
                            {formatMs(report.afterWebVitals.ttfb.value)}
                          </span>
                        </div>
                      )}
                      {(report.afterWebVitals?.cls || report.afterClsScore !== undefined) && (
                        <div className="flex justify-between items-center">
                          <span className="text-sm" title="Cumulative Layout Shift">
                            CLS
                          </span>
                          <span
                            className={`text-sm font-medium ${
                              (report.afterWebVitals?.cls?.grade || report.afterClsGrade) === "good"
                                ? "text-green-600"
                                : (report.afterWebVitals?.cls?.grade || report.afterClsGrade) === "needs-improvement"
                                  ? "text-yellow-600"
                                  : "text-red-600"
                            }`}
                          >
                            {formatClsValue(report.afterWebVitals?.cls?.value ?? report.afterClsScore)}
                          </span>
                        </div>
                      )}
                      {report.afterWebVitals?.inp && (
                        <div className="flex justify-between items-center">
                          <span className="text-sm" title="Interaction to Next Paint">
                            INP
                          </span>
                          <span
                            className={`text-sm font-medium ${report.afterWebVitals.inp.grade === "good" ? "text-green-600" : report.afterWebVitals.inp.grade === "needs-improvement" ? "text-yellow-600" : "text-red-600"}`}
                          >
                            {formatMs(report.afterWebVitals.inp.value)}
                          </span>
                        </div>
                      )}
                      {!report.afterWebVitals?.lcp &&
                        !report.afterWebVitals?.fcp &&
                        !report.afterWebVitals?.ttfb &&
                        !report.afterWebVitals?.cls &&
                        !report.afterWebVitals?.inp &&
                        report.afterClsScore === undefined && (
                          <span className="text-sm text-muted-foreground">No metrics captured</span>
                        )}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="bg-muted/30 rounded-lg p-4">
                  {!isReadOnlyUrlWorkflow && (
                    <div className="text-xs text-muted-foreground uppercase tracking-wide mb-3">Current</div>
                  )}
                  <div className="space-y-2 md:space-y-0 md:flex md:flex-wrap md:items-center md:gap-x-8 md:gap-y-2">
                    {(report.beforeWebVitals?.lcp || report.afterWebVitals?.lcp) && (
                      <div className="flex justify-between items-center md:justify-start md:gap-2">
                        <span className="text-sm" title="Largest Contentful Paint">
                          LCP
                        </span>
                        <span
                          className={`text-sm font-medium ${(report.beforeWebVitals?.lcp?.grade || report.afterWebVitals?.lcp?.grade) === "good" ? "text-green-600" : (report.beforeWebVitals?.lcp?.grade || report.afterWebVitals?.lcp?.grade) === "needs-improvement" ? "text-yellow-600" : "text-red-600"}`}
                        >
                          {formatMs(report.beforeWebVitals?.lcp?.value ?? report.afterWebVitals?.lcp?.value)}
                        </span>
                      </div>
                    )}
                    {(report.beforeWebVitals?.fcp || report.afterWebVitals?.fcp) && (
                      <div className="flex justify-between items-center md:justify-start md:gap-2">
                        <span className="text-sm" title="First Contentful Paint">
                          FCP
                        </span>
                        <span
                          className={`text-sm font-medium ${(report.beforeWebVitals?.fcp?.grade || report.afterWebVitals?.fcp?.grade) === "good" ? "text-green-600" : (report.beforeWebVitals?.fcp?.grade || report.afterWebVitals?.fcp?.grade) === "needs-improvement" ? "text-yellow-600" : "text-red-600"}`}
                        >
                          {formatMs(report.beforeWebVitals?.fcp?.value ?? report.afterWebVitals?.fcp?.value)}
                        </span>
                      </div>
                    )}
                    {(report.beforeWebVitals?.ttfb || report.afterWebVitals?.ttfb) && (
                      <div className="flex justify-between items-center md:justify-start md:gap-2">
                        <span className="text-sm" title="Time to First Byte">
                          TTFB
                        </span>
                        <span
                          className={`text-sm font-medium ${(report.beforeWebVitals?.ttfb?.grade || report.afterWebVitals?.ttfb?.grade) === "good" ? "text-green-600" : (report.beforeWebVitals?.ttfb?.grade || report.afterWebVitals?.ttfb?.grade) === "needs-improvement" ? "text-yellow-600" : "text-red-600"}`}
                        >
                          {formatMs(report.beforeWebVitals?.ttfb?.value ?? report.afterWebVitals?.ttfb?.value)}
                        </span>
                      </div>
                    )}
                    {(report.beforeWebVitals?.cls ||
                      report.afterWebVitals?.cls ||
                      report.clsScore !== undefined ||
                      report.afterClsScore !== undefined) && (
                      <div className="flex justify-between items-center md:justify-start md:gap-2">
                        <span className="text-sm" title="Cumulative Layout Shift">
                          CLS
                        </span>
                        <span
                          className={`text-sm font-medium ${
                            (
                              report.beforeWebVitals?.cls?.grade ||
                                report.afterWebVitals?.cls?.grade ||
                                report.clsGrade ||
                                report.afterClsGrade
                            ) === "good"
                              ? "text-green-600"
                              : (report.beforeWebVitals?.cls?.grade ||
                                    report.afterWebVitals?.cls?.grade ||
                                    report.clsGrade ||
                                    report.afterClsGrade) === "needs-improvement"
                                ? "text-yellow-600"
                                : "text-red-600"
                          }`}
                        >
                          {formatClsValue(
                            report.beforeWebVitals?.cls?.value ??
                              report.afterWebVitals?.cls?.value ??
                              report.clsScore ??
                              report.afterClsScore
                          )}
                        </span>
                      </div>
                    )}
                    {(report.beforeWebVitals?.inp || report.afterWebVitals?.inp) && (
                      <div className="flex justify-between items-center md:justify-start md:gap-2">
                        <span className="text-sm" title="Interaction to Next Paint">
                          INP
                        </span>
                        <span
                          className={`text-sm font-medium ${(report.beforeWebVitals?.inp?.grade || report.afterWebVitals?.inp?.grade) === "good" ? "text-green-600" : (report.beforeWebVitals?.inp?.grade || report.afterWebVitals?.inp?.grade) === "needs-improvement" ? "text-yellow-600" : "text-red-600"}`}
                        >
                          {formatMs(report.beforeWebVitals?.inp?.value ?? report.afterWebVitals?.inp?.value)}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Agent Analysis - shown for all workflow types */}
          <div className="mt-6 pt-6 border-t border-border">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-medium">Agent Analysis</h3>
              {report.agentAnalysisModel && (
                <span className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded">
                  {report.agentAnalysisModel}
                </span>
              )}
            </div>
            <AgentAnalysis content={report.agentAnalysis} gitDiff={report.gitDiff} projectName={report.projectName} />
          </div>
        </div>

        <div className="mt-6 mb-4 flex gap-4">
          {!isPublicView && (
            <a href="/workflows" className="px-4 py-2 border border-border rounded-md hover:bg-muted transition-colors">
              ← Back to Workflows
            </a>
          )}
          {run.prUrl && (
            <a
              href={run.prUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
            >
              View Pull Request →
            </a>
          )}
        </div>
      </div>
    </div>
  )
}

function ReportLoading({ isPublicView }: { isPublicView: boolean }) {
  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <div className="flex items-center gap-4 mb-6">
          {isPublicView ? (
            <span className="inline-flex items-center gap-2 text-muted-foreground">
              <span className="font-semibold">d3k</span>
              <span>/</span>
              <span>Public Report</span>
            </span>
          ) : (
            <>
              <span className="inline-flex items-center gap-2 text-muted-foreground">
                <span className="font-semibold">d3k</span>
              </span>
              <span className="text-muted-foreground">/</span>
              <span className="text-muted-foreground">Loading report...</span>
            </>
          )}
        </div>
        <div className="h-8 w-2/3 bg-muted/40 rounded-md" />
        <div className="mt-4 h-4 w-1/3 bg-muted/30 rounded-md" />
        <div className="mt-8 space-y-4">
          <div className="h-24 bg-muted/20 rounded-md" />
          <div className="h-24 bg-muted/20 rounded-md" />
          <div className="h-24 bg-muted/20 rounded-md" />
        </div>
      </div>
    </div>
  )
}
