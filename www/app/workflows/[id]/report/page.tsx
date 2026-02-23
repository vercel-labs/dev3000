import { ArrowLeft, ChevronRight } from "lucide-react"
import type { Metadata } from "next"
import Image from "next/image"
import { redirect } from "next/navigation"
import { Suspense } from "react"
import { ThemeToggle } from "@/components/theme-toggle"
import { Skeleton } from "@/components/ui/skeleton"
import { getCurrentUser } from "@/lib/auth"
import type { WorkflowRun } from "@/lib/workflow-storage"
import { getPublicWorkflowRun, getWorkflowRun } from "@/lib/workflow-storage"
import type { WorkflowReport } from "@/types"
import { AgentAnalysis } from "./agent-analysis"
import { CoordinatedPlayers } from "./coordinated-players"
import { DiffSection } from "./diff-section"
import { ReportPending } from "./report-pending"
import { ScreenshotPlayer } from "./screenshot-player"
import { ShareButton } from "./share-button"

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const publicRun = await getPublicWorkflowRun(id)

  const title = publicRun ? `${publicRun.projectName} - d3k workflow report` : "d3k workflow report"
  const description = "AI-powered workflow report from dev3000."

  if (!publicRun) {
    return {
      title,
      description,
      openGraph: {
        title,
        description,
        images: []
      },
      twitter: {
        card: "summary",
        title,
        description,
        images: []
      }
    }
  }

  const ogImageUrl = `/api/og/workflows/${id}`

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "website",
      images: [
        {
          url: ogImageUrl,
          width: 1200,
          height: 630,
          alt: `${publicRun.projectName} workflow report`
        }
      ]
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [ogImageUrl]
    }
  }
}

const MIN_ROUTE_DELTA_BYTES = 10 * 1024
const IMPACT_BYTES_LARGE = 150 * 1024
const IMPACT_PERCENT_LARGE = 2

type ImpactBucket = "S" | "M" | "L"

function calculateImpactfulness(
  compressedBytes: number,
  compressedPercent?: number | null
): {
  score: number
  bucket: ImpactBucket
  direction: "decrease" | "increase" | "neutral"
} {
  const bytesRatio = Math.abs(compressedBytes) / IMPACT_BYTES_LARGE
  const percentRatio = typeof compressedPercent === "number" ? Math.abs(compressedPercent) / IMPACT_PERCENT_LARGE : 0
  const score = Math.max(0, Math.min(1, Math.max(bytesRatio, percentRatio)))
  const bucket: ImpactBucket = score < 0.34 ? "S" : score < 0.67 ? "M" : "L"
  const direction = compressedBytes < 0 ? "decrease" : compressedBytes > 0 ? "increase" : "neutral"
  return { score, bucket, direction }
}

function ImpactfulnessGauge({
  score,
  bucket,
  direction
}: {
  score: number
  bucket: ImpactBucket
  direction: "decrease" | "increase" | "neutral"
}) {
  const angle = 180 - score * 180
  const rad = (angle * Math.PI) / 180
  const cx = 110
  const cy = 110
  const radius = 78
  const x2 = cx + Math.cos(rad) * radius
  const y2 = cy - Math.sin(rad) * radius
  const title = bucket === "S" ? "Small" : bucket === "M" ? "Medium" : "Large"

  return (
    <div className="rounded-lg border border-border bg-muted/20 p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">Impactfulness</div>
        <div className="text-xs text-muted-foreground">
          {direction === "decrease" ? "Bundle reduced" : direction === "increase" ? "Bundle increased" : "No change"}
        </div>
      </div>
      <svg viewBox="0 0 220 130" className="w-full max-w-[340px] h-auto">
        <path d="M20 110 A90 90 0 0 1 200 110" stroke="currentColor" strokeWidth="10" fill="none" className="text-border" />
        <line x1="20" y1="110" x2="20" y2="102" className="text-muted-foreground" stroke="currentColor" strokeWidth="2" />
        <line x1="110" y1="20" x2="110" y2="28" className="text-muted-foreground" stroke="currentColor" strokeWidth="2" />
        <line x1="200" y1="110" x2="200" y2="102" className="text-muted-foreground" stroke="currentColor" strokeWidth="2" />
        <line
          x1={cx}
          y1={cy}
          x2={x2}
          y2={y2}
          stroke="currentColor"
          strokeWidth="3"
          className={direction === "increase" ? "text-red-500" : "text-green-500"}
        />
        <circle cx={cx} cy={cy} r="4" className={direction === "increase" ? "fill-red-500" : "fill-green-500"} />
        <text x="20" y="124" textAnchor="middle" className="fill-muted-foreground text-[10px]">
          S
        </text>
        <text x="110" y="12" textAnchor="middle" className="fill-muted-foreground text-[10px]">
          M
        </text>
        <text x="200" y="124" textAnchor="middle" className="fill-muted-foreground text-[10px]">
          L
        </text>
      </svg>
      <div className="text-sm mt-2">
        <span className="font-medium">{title}</span>
        <span className="text-muted-foreground"> impact</span>
      </div>
    </div>
  )
}

export default function WorkflowReportPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<ReportLoading reportCrumbLabel="Workflow Report" />}>
      <WorkflowReportPageData params={params} />
    </Suspense>
  )
}

async function WorkflowReportPageData({ params }: { params: Promise<{ id: string }> }) {
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

  if (!run) {
    redirect("/workflows")
  }

  if (!run.reportBlobUrl) {
    if (user && isOwner) {
      return <ReportPending runId={id} userId={user.id} workflowType={run.type} projectName={run.projectName} />
    }
    return <ReportPending runId={id} workflowType={run.type} projectName={run.projectName} />
  }

  const reportBlobUrl = run.reportBlobUrl

  return <ReportContent id={id} run={run} isOwner={isOwner} reportBlobUrl={reportBlobUrl} />
}

async function ReportContent({
  id,
  run,
  isOwner,
  reportBlobUrl
}: {
  id: string
  run: WorkflowRun
  isOwner: boolean
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
  const formatBytes = (bytes?: number) => {
    if (typeof bytes !== "number") return "—"
    const abs = Math.abs(bytes)
    if (abs >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
    return `${(bytes / 1024).toFixed(1)} KB`
  }
  const formatSignedBytes = (bytes?: number) => {
    if (typeof bytes !== "number") return "—"
    const sign = bytes > 0 ? "+" : ""
    return `${sign}${formatBytes(bytes)}`
  }
  const formatSignedPercent = (value?: number | null) => {
    if (typeof value !== "number") return "—"
    const sign = value > 0 ? "+" : ""
    return `${sign}${value.toFixed(1)}%`
  }
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
  const bundleComparison = report.turbopackBundleComparison
  const impactfulness = bundleComparison
    ? calculateImpactfulness(bundleComparison.delta.compressedBytes, bundleComparison.delta.compressedPercent)
    : null
  const bundleRouteDeltas = bundleComparison
    ? Array.from(
        new Set([
          ...bundleComparison.before.topRoutes.map((route) => route.route),
          ...bundleComparison.after.topRoutes.map((route) => route.route)
        ])
      )
        .map((route) => {
          const beforeRoute = bundleComparison.before.topRoutes.find((item) => item.route === route)
          const afterRoute = bundleComparison.after.topRoutes.find((item) => item.route === route)
          const beforeCompressedBytes = beforeRoute?.compressedBytes ?? 0
          const afterCompressedBytes = afterRoute?.compressedBytes ?? 0
          const compressedDelta = afterCompressedBytes - beforeCompressedBytes
          return {
            route,
            beforeCompressedBytes,
            afterCompressedBytes,
            compressedDelta
          }
        })
        .filter((route) => Math.abs(route.compressedDelta) >= MIN_ROUTE_DELTA_BYTES)
        .sort((a, b) => a.compressedDelta - b.compressedDelta)
        .slice(0, 5)
    : []
  const skillLink = (skill: string) => {
    const normalized = skill.trim().toLowerCase()
    if (normalized === "d3k" || normalized.includes("d3k")) {
      return "https://github.com/vercel-labs/dev3000/blob/main/www/.agents/skills/d3k/SKILL.md"
    }
    if (
      normalized === "analyze-bundle" ||
      normalized.includes("bundle-analyzer-agentic") ||
      normalized.includes("bundle-analyzer")
    ) {
      return "https://github.com/vercel-labs/dev3000/blob/main/www/.agents/skills/analyze-bundle/SKILL.md"
    }
    if (normalized.includes("web-design-guidelines") || normalized.includes("vercel web design guidelines")) {
      return "https://skills.sh/vercel-labs/agent-skills/web-design-guidelines"
    }
    return `https://skills.sh/vercel-labs/agent-skills/${normalized.replace(/\s+/g, "-")}`
  }
  const normalizeSkillLabel = (skill: string) => {
    const normalized = skill.trim().toLowerCase()
    if (normalized.includes("web-design-guidelines")) return "Vercel Web Design Guidelines"
    if (
      normalized === "analyze-bundle" ||
      normalized.includes("bundle-analyzer-agentic") ||
      normalized.includes("bundle-analyzer")
    ) {
      return "analyze-bundle"
    }
    if (normalized === "d3k" || normalized.includes("d3k")) return "d3k"
    return skill
  }
  const explicitSkills = [...(report.skillsLoaded || []), ...(report.skillsInstalled || [])]
  const inferredSkills: string[] = ["d3k"]
  if (workflowType === "design-guidelines") inferredSkills.unshift("Vercel Web Design Guidelines")
  if (workflowType === "turbopack-bundle-analyzer") inferredSkills.unshift("analyze-bundle")
  const skillsUsed = Array.from(
    new Map(
      [...explicitSkills, ...inferredSkills].map((skill) => {
        const label = normalizeSkillLabel(skill)
        return [label.toLowerCase(), { label, url: skillLink(skill) }]
      })
    ).values()
  )
  const reportRepoTitle =
    report.repoOwner && report.repoName
      ? `${report.repoOwner}/${report.repoName}`
      : report.repoUrl
          ?.match(/github\.com\/([^/]+)\/([^/.]+)(?:\.git)?$/)
          ?.slice(1, 3)
          .join("/")
  const reportTitle = report.targetUrl || reportRepoTitle || report.projectName
  const prDiffUrl = run.prUrl ? `${run.prUrl}.diff` : undefined
  const inlineDiffUrl = report.gitDiff
    ? `data:text/plain;charset=utf-8,${encodeURIComponent(report.gitDiff)}`
    : undefined
  const runStartedAt = new Date(run.timestamp)
  const runEndedAt = run.completedAt ? new Date(run.completedAt) : null
  const hasValidRunTiming =
    !Number.isNaN(runStartedAt.getTime()) &&
    !!runEndedAt &&
    !Number.isNaN(runEndedAt.getTime()) &&
    runEndedAt >= runStartedAt
  const formatRunDuration = (durationMs: number) => {
    const totalSeconds = Math.floor(durationMs / 1000)
    const hours = Math.floor(totalSeconds / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    const seconds = totalSeconds % 60
    if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`
    if (minutes > 0) return `${minutes}m ${seconds}s`
    return `${seconds}s`
  }
  const formatRunTimeRange = (start: Date, end: Date) => {
    const startLabel = start.toLocaleTimeString()
    const endLabel = end.toLocaleTimeString()
    const startMeridiem = startLabel.match(/\s(AM|PM)$/)?.[1]
    const endMeridiem = endLabel.match(/\s(AM|PM)$/)?.[1]

    if (startMeridiem && endMeridiem && startMeridiem === endMeridiem) {
      return `${startLabel.replace(/\s(AM|PM)$/, "")} → ${endLabel}`
    }

    return `${startLabel} → ${endLabel}`
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 pt-8 pb-24 max-w-4xl">
        <div className="mb-6 flex items-center justify-between gap-3">
          <ReportBreadcrumb reportCrumbLabel="Workflow Report" />
          <div className="flex items-center gap-3">
            {isOwner && <ShareButton runId={id} initialIsPublic={run.isPublic ?? false} />}
            <ThemeToggle />
          </div>
        </div>

        <div className="mb-4">
          <h1 className="text-3xl font-bold">{reportTitle}</h1>
          <p className="text-muted-foreground mt-1">{new Date(report.timestamp).toLocaleDateString()}</p>
          {hasValidRunTiming && runEndedAt && (
            <p className="text-sm text-muted-foreground mt-1">
              Run time: {formatRunTimeRange(runStartedAt, runEndedAt)} (
              {formatRunDuration(runEndedAt.getTime() - runStartedAt.getTime())})
            </p>
          )}
        </div>

        <div className="text-sm text-muted-foreground mb-1">
          <span>Model: </span>
          <span className="font-medium text-foreground">{report.agentAnalysisModel || "unknown"}</span>
        </div>

        <div className="text-sm text-muted-foreground mb-4">
          <span>Skills Used: </span>
          {skillsUsed.length > 0 ? (
            <span>
              {skillsUsed.map((skill, index) => (
                <span key={`skills-used-${skill.label}`}>
                  <a
                    href={skill.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:underline font-medium text-foreground"
                  >
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

          {workflowType === "turbopack-bundle-analyzer" && bundleComparison && (
            <div className="mb-6">
              <h3 className="text-lg font-medium mb-4">Bundle Delta (Before vs After)</h3>
              {impactfulness && (
                <div className="mb-3">
                  <ImpactfulnessGauge
                    score={impactfulness.score}
                    bucket={impactfulness.bucket}
                    direction={impactfulness.direction}
                  />
                </div>
              )}
              <div
                className={`mb-3 rounded-lg border px-3 py-2 text-sm ${
                  bundleComparison.delta.compressedBytes <= 0
                    ? "border-green-200 bg-green-50 text-green-800 dark:border-green-700/40 dark:bg-green-900/20 dark:text-green-200"
                    : "border-red-200 bg-red-50 text-red-800 dark:border-red-700/40 dark:bg-red-900/20 dark:text-red-200"
                }`}
              >
                {bundleComparison.delta.compressedBytes <= 0 ? "Reduced shipped JS by " : "Increased shipped JS by "}
                <span className="font-semibold">{formatBytes(Math.abs(bundleComparison.delta.compressedBytes))}</span>
                {" ("}
                <span className="font-semibold">
                  {formatSignedPercent(bundleComparison.delta.compressedPercent)?.replace("+", "")}
                </span>
                {") across "}
                <span className="font-semibold">{bundleComparison.before.routeCount}</span>
                {" analyzed route"}
                {bundleComparison.before.routeCount === 1 ? "" : "s"}.
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded-lg border border-border bg-muted/20 p-3">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Compressed JS</div>
                  <div className="text-sm">
                    {formatBytes(bundleComparison.before.totalCompressedBytes)} →{" "}
                    {formatBytes(bundleComparison.after.totalCompressedBytes)}
                  </div>
                  <div
                    className={`text-sm font-medium ${bundleComparison.delta.compressedBytes <= 0 ? "text-green-600" : "text-red-600"}`}
                  >
                    {formatSignedBytes(bundleComparison.delta.compressedBytes)} (
                    {formatSignedPercent(bundleComparison.delta.compressedPercent)})
                  </div>
                </div>
                <div className="rounded-lg border border-border bg-muted/20 p-3">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Raw JS</div>
                  <div className="text-sm">
                    {formatBytes(bundleComparison.before.totalRawBytes)} →{" "}
                    {formatBytes(bundleComparison.after.totalRawBytes)}
                  </div>
                  <div
                    className={`text-sm font-medium ${bundleComparison.delta.rawBytes <= 0 ? "text-green-600" : "text-red-600"}`}
                  >
                    {formatSignedBytes(bundleComparison.delta.rawBytes)} (
                    {formatSignedPercent(bundleComparison.delta.rawPercent)})
                  </div>
                </div>
                <div className="rounded-lg border border-border bg-muted/20 p-3">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Coverage</div>
                  <div className="text-sm">Routes: {bundleComparison.before.routeCount}</div>
                  <div className="text-sm">Output files: {bundleComparison.before.outputFileCount}</div>
                </div>
              </div>
              {bundleRouteDeltas.length > 0 && (
                <div className="mt-4 rounded-lg border border-border bg-muted/20 p-3">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
                    Top Route-Level Compressed JS Changes
                  </div>
                  <div className="space-y-2">
                    {bundleRouteDeltas.map((routeDelta) => (
                      <div
                        key={routeDelta.route}
                        className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] gap-3 text-sm items-center"
                      >
                        <span className="font-mono truncate">{routeDelta.route}</span>
                        <span className="text-muted-foreground">{formatBytes(routeDelta.beforeCompressedBytes)}</span>
                        <span className="text-muted-foreground">→ {formatBytes(routeDelta.afterCompressedBytes)}</span>
                        <span className={routeDelta.compressedDelta <= 0 ? "text-green-600" : "text-red-600"}>
                          {formatSignedBytes(routeDelta.compressedDelta)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {report.gitDiff && (
                <DiffSection patch={report.gitDiff} prDiffUrl={prDiffUrl} inlineDiffUrl={inlineDiffUrl} />
              )}
            </div>
          )}

          {/* Agent Transcript - shown for all workflow types */}
          <div className="mt-6 pt-6 border-t border-border">
            <details className="group">
              <summary className="inline-flex items-center gap-2 cursor-pointer text-sm hover:text-foreground text-muted-foreground">
                <span className="font-medium inline-flex items-center gap-2">
                  <ChevronRight className="h-4 w-4 transition-transform group-open:rotate-90" />
                  Show analysis details
                </span>
              </summary>
              <div className="mt-4 space-y-5">
                {(report.timing || report.initD3kLogs || report.d3kLogs || report.afterD3kLogs) && (
                  <div className="rounded-lg border border-border bg-muted/20 p-4 space-y-4">
                    <div className="text-sm font-medium">d3k agent transcript</div>
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
                              Init:{" "}
                              <span className="font-mono text-xs">{formatSeconds(report.timing?.total?.initMs)}</span>
                            </span>
                            <span className="text-muted-foreground">
                              Agent:{" "}
                              <span className="font-mono text-xs">{formatSeconds(report.timing?.total?.agentMs)}</span>
                            </span>
                            {report.timing?.total?.prMs && (
                              <span className="text-muted-foreground">
                                PR:{" "}
                                <span className="font-mono text-xs">{formatSeconds(report.timing?.total?.prMs)}</span>
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
                      <details>
                        <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                          Init logs
                        </summary>
                        <pre className="mt-2 bg-muted/50 rounded p-4 text-xs font-mono overflow-x-auto whitespace-pre-wrap max-h-96 overflow-y-auto">
                          {report.initD3kLogs || report.d3kLogs}
                        </pre>
                      </details>
                    )}

                    {report.afterD3kLogs && (
                      <details>
                        <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                          After logs
                        </summary>
                        <pre className="mt-2 bg-muted/50 rounded p-4 text-xs font-mono overflow-x-auto whitespace-pre-wrap max-h-96 overflow-y-auto">
                          {report.afterD3kLogs}
                        </pre>
                      </details>
                    )}
                  </div>
                )}

                <AgentAnalysis content={report.agentAnalysis} />
              </div>
            </details>
          </div>
        </div>

        <div className="mt-6 mb-4 flex gap-4">
          <a href="/workflows" className="px-4 py-2 border border-border rounded-md hover:bg-muted transition-colors">
            ← Workflows
          </a>
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

function ReportLoading({ reportCrumbLabel }: { reportCrumbLabel: string }) {
  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <div className="mb-6 flex items-center justify-between gap-3">
          <ReportBreadcrumb reportCrumbLabel={reportCrumbLabel} />
          <div className="flex items-center gap-3">
            <Skeleton className="h-9 w-28" />
            <Skeleton className="h-9 w-12" />
          </div>
        </div>
        <Skeleton className="h-9 w-2/3" />
        <Skeleton className="mt-4 h-4 w-1/3" />
        <div className="mt-8 space-y-4">
          <Skeleton className="h-24 rounded-md" />
          <Skeleton className="h-24 rounded-md" />
          <Skeleton className="h-24 rounded-md" />
        </div>
      </div>
    </div>
  )
}

function ReportBreadcrumb({ reportCrumbLabel }: { reportCrumbLabel: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-muted-foreground">
      <a href="/workflows" className="inline-flex items-center gap-2 hover:text-foreground transition-colors">
        <ArrowLeft className="h-4 w-4" />
        <span className="font-semibold">d3k</span>
      </a>
      <span>/</span>
      <span>{reportCrumbLabel}</span>
    </span>
  )
}
