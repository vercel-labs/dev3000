import { ArrowLeft, ChevronRight, ExternalLink, ShieldCheck } from "lucide-react"
import type { Metadata } from "next"
import Image from "next/image"
import { redirect } from "next/navigation"
import { type ReactNode, Suspense } from "react"
import { DevAgentsDashboardShell } from "@/components/dev-agents/dashboard-shell"
import { ThemeToggle } from "@/components/theme-toggle"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { getCurrentUser } from "@/lib/auth"
import { getSignInPath } from "@/lib/auth-redirect"
import { getDefaultDevAgentsRouteContext } from "@/lib/dev-agents-route"
import type { WorkflowRun } from "@/lib/workflow-storage"
import { getPublicWorkflowRun, getWorkflowRun } from "@/lib/workflow-storage"
import type { WebVitals, WorkflowReport } from "@/types"
import { AgentAnalysis } from "./agent-analysis"
import { CoordinatedPlayers } from "./coordinated-players"
import { DiffSection } from "./diff-section"
import { ReportPending } from "./report-pending"
import { ScreenshotPlayer } from "./screenshot-player"
import { ShareButton } from "./share-button"

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const publicRun = await getPublicWorkflowRun(id)

  const title = publicRun ? `${publicRun.projectName} - d3k report` : "d3k report"
  const description = "AI-powered dev agent report from d3k."

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

  const ogImageUrl = `/api/og/dev-agents/runs/${id}`

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
          alt: `${publicRun.projectName} report`
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
const IMPACT_BYTES_LARGE = 1024 * 1024

type ImpactBucket = "S" | "M" | "L"
type MetricKey = keyof WebVitals

interface MetricDefinition {
  key: MetricKey
  label: string
  description: string
}

interface MetricSnapshot {
  value: number
  grade?: "good" | "needs-improvement" | "poor"
}

interface MetricRow extends MetricDefinition {
  before?: MetricSnapshot
  after?: MetricSnapshot
  current?: MetricSnapshot
}

const METRIC_DEFINITIONS: MetricDefinition[] = [
  { key: "lcp", label: "LCP", description: "Largest Contentful Paint" },
  { key: "fcp", label: "FCP", description: "First Contentful Paint" },
  { key: "ttfb", label: "TTFB", description: "Time to First Byte" },
  { key: "inp", label: "INP", description: "Interaction to Next Paint" },
  { key: "cls", label: "CLS", description: "Cumulative Layout Shift" }
]

function calculateImpactfulness(
  compressedBytes: number,
  beforeWebVitals?: WorkflowReport["beforeWebVitals"],
  afterWebVitals?: WorkflowReport["afterWebVitals"]
): {
  score: number
  bucket: ImpactBucket
  direction: "decrease" | "increase" | "neutral"
  cwvVerified: boolean
  cwvMetricsCompared: number
  cwvMetricsImproved: number
} {
  const clamp01 = (value: number) => Math.max(0, Math.min(1, value))
  const metricDeltaImpact = (before: number | undefined, after: number | undefined, largeDelta: number): number => {
    if (typeof before !== "number" || typeof after !== "number" || before <= 0) return 0
    const improvement = before - after
    if (improvement <= 0) return 0
    return clamp01(Math.max(improvement / before, improvement / largeDelta))
  }

  const cwvMetricScores = [
    metricDeltaImpact(beforeWebVitals?.lcp?.value, afterWebVitals?.lcp?.value, 500),
    metricDeltaImpact(beforeWebVitals?.inp?.value, afterWebVitals?.inp?.value, 100),
    metricDeltaImpact(beforeWebVitals?.cls?.value, afterWebVitals?.cls?.value, 0.05)
  ]
  const cwvMetricsCompared = [
    [beforeWebVitals?.lcp?.value, afterWebVitals?.lcp?.value],
    [beforeWebVitals?.inp?.value, afterWebVitals?.inp?.value],
    [beforeWebVitals?.cls?.value, afterWebVitals?.cls?.value]
  ].filter(([before, after]) => typeof before === "number" && typeof after === "number").length

  const cwvMetricsImproved = cwvMetricScores.filter((score) => score > 0).length
  const cwvVerified = cwvMetricsCompared > 0
  const cwvScore =
    cwvMetricScores.length > 0 ? cwvMetricScores.reduce((sum, value) => sum + value, 0) / cwvMetricScores.length : 0

  const bundleScore = clamp01(Math.abs(compressedBytes) / IMPACT_BYTES_LARGE)
  const score = cwvVerified ? clamp01(cwvScore * 0.8 + bundleScore * 0.2) : clamp01(bundleScore * 0.35)
  const bucket: ImpactBucket = score < 0.34 ? "S" : score < 0.67 ? "M" : "L"
  const direction = compressedBytes < 0 ? "decrease" : compressedBytes > 0 ? "increase" : "neutral"
  return { score, bucket, direction, cwvVerified, cwvMetricsCompared, cwvMetricsImproved }
}

function ImpactfulnessGauge({
  score,
  bucket,
  direction,
  cwvVerified,
  cwvMetricsCompared,
  cwvMetricsImproved
}: {
  score: number
  bucket: ImpactBucket
  direction: "decrease" | "increase" | "neutral"
  cwvVerified: boolean
  cwvMetricsCompared: number
  cwvMetricsImproved: number
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
    <div className="inline-flex flex-col rounded-lg border border-border bg-muted/20 p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">Impactfulness</div>
        <div className="text-xs text-muted-foreground">
          {direction === "decrease" ? "Bundle reduced" : direction === "increase" ? "Bundle increased" : "No change"}
        </div>
      </div>
      <svg viewBox="0 0 220 130" className="h-auto w-[220px]">
        <path
          d="M20 110 A90 90 0 0 1 200 110"
          stroke="currentColor"
          strokeWidth="10"
          fill="none"
          className="text-border"
        />
        <line
          x1="20"
          y1="110"
          x2="20"
          y2="102"
          className="text-muted-foreground"
          stroke="currentColor"
          strokeWidth="2"
        />
        <line
          x1="110"
          y1="20"
          x2="110"
          y2="28"
          className="text-muted-foreground"
          stroke="currentColor"
          strokeWidth="2"
        />
        <line
          x1="200"
          y1="110"
          x2="200"
          y2="102"
          className="text-muted-foreground"
          stroke="currentColor"
          strokeWidth="2"
        />
        <line x1={cx} y1={cy} x2={x2} y2={y2} stroke="currentColor" strokeWidth="3" className="text-foreground" />
        <circle cx={cx} cy={cy} r="4" className="fill-foreground" />
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
      <div className="mt-2 text-sm">
        <span className="font-medium">{title}</span>
        <span className="text-muted-foreground"> impact</span>
      </div>
      <div className="mt-1 text-xs text-muted-foreground">
        {cwvVerified
          ? `CWV verified (${cwvMetricsImproved}/${cwvMetricsCompared} improved)`
          : "CWV verification unavailable"}
      </div>
    </div>
  )
}

function formatMs(value?: number) {
  return typeof value === "number" ? `${value.toFixed(0)}ms` : "—"
}

function formatClsValue(value?: number) {
  return typeof value === "number" ? value.toFixed(4) : "—"
}

function formatMetricValue(key: MetricKey, value?: number) {
  return key === "cls" ? formatClsValue(value) : formatMs(value)
}

function formatMetricDelta(key: MetricKey, before: number, after: number) {
  const delta = after - before
  const sign = delta > 0 ? "+" : ""
  return key === "cls" ? `${sign}${delta.toFixed(4)}` : `${sign}${delta.toFixed(0)}ms`
}

function formatSeconds(ms?: number) {
  return typeof ms === "number" ? `${(ms / 1000).toFixed(1)}s` : "—"
}

function formatBytes(bytes?: number) {
  if (typeof bytes !== "number") return "—"
  const absolute = Math.abs(bytes)
  if (absolute >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
  return `${(bytes / 1024).toFixed(1)} KB`
}

function formatSignedBytes(bytes?: number) {
  if (typeof bytes !== "number") return "—"
  const sign = bytes > 0 ? "+" : ""
  return `${sign}${formatBytes(bytes)}`
}

function formatSignedPercent(value?: number | null) {
  if (typeof value !== "number") return "—"
  const sign = value > 0 ? "+" : ""
  return `${sign}${value.toFixed(1)}%`
}

function formatUsd(value?: number) {
  if (typeof value !== "number") return "—"
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: value < 1 ? 3 : 2,
    maximumFractionDigits: value < 1 ? 3 : 2
  }).format(value)
}

function formatGrade(grade?: MetricSnapshot["grade"]) {
  if (!grade) return null
  return grade === "needs-improvement" ? "Needs improvement" : grade[0].toUpperCase() + grade.slice(1)
}

function getMetricSnapshot(
  report: WorkflowReport,
  key: MetricKey,
  phase: "before" | "after"
): MetricSnapshot | undefined {
  const vitals = phase === "before" ? report.beforeWebVitals : report.afterWebVitals
  const fromVitals = vitals?.[key]
  if (fromVitals) {
    return fromVitals
  }

  if (key === "cls") {
    const value = phase === "before" ? report.clsScore : report.afterClsScore
    const grade = phase === "before" ? report.clsGrade : report.afterClsGrade
    if (typeof value === "number") {
      return { value, grade }
    }
  }

  return undefined
}

function buildMetricRows(report: WorkflowReport): MetricRow[] {
  const rows: MetricRow[] = []

  for (const definition of METRIC_DEFINITIONS) {
    const before = getMetricSnapshot(report, definition.key, "before")
    const after = getMetricSnapshot(report, definition.key, "after")
    const current = after || before

    if (!current) {
      continue
    }

    rows.push({
      ...definition,
      before,
      after,
      current
    })
  }

  return rows
}

function getWorkflowLabel(report: WorkflowReport, run: WorkflowRun): string {
  const workflowType = report.workflowType || run.type || "cls-fix"

  if (report.devAgentName || run.devAgentName) {
    return report.devAgentName || run.devAgentName || "Dev Agent"
  }

  switch (workflowType) {
    case "prompt":
      return "Custom Prompt"
    case "design-guidelines":
      return "Design Guidelines"
    case "react-performance":
      return "React Performance"
    case "turbopack-bundle-analyzer":
      return "Turbopack Bundle Analyzer"
    case "url-audit":
      return "URL Audit"
    case "cls-fix":
      return "CLS Fix"
    default:
      return "Dev Agent"
  }
}

function getWorkflowDescription(report: WorkflowReport, workflowLabel: string): string {
  if (report.devAgentDescription) {
    return report.devAgentDescription
  }

  if (report.devAgentExecutionMode === "preview-pr") {
    return `${workflowLabel} ran in preview-and-PR mode and generated this report.`
  }

  switch (report.workflowType) {
    case "design-guidelines":
      return "Read-only design and UX analysis of the target URL."
    case "react-performance":
      return "Read-only React performance analysis of the target URL."
    case "turbopack-bundle-analyzer":
      return "Bundle analysis with before/after metrics and optimization guidance."
    case "url-audit":
      return "Read-only UX and performance analysis of the target URL."
    case "prompt":
      return "AI agent executed your custom task and generated this report."
    default:
      return "AI agent completed a run and generated this report."
  }
}

function getVerificationSummary(report: WorkflowReport, metricRows: MetricRow[]) {
  const comparedMetrics = metricRows.flatMap((row) =>
    row.before && row.after ? [{ before: row.before, after: row.after }] : []
  )
  const improvedMetrics = comparedMetrics.filter((row) => row.after.value < row.before.value)
  const degradedMetrics = comparedMetrics.filter((row) => row.after.value > row.before.value)

  if (report.verificationError) {
    return {
      title: "Verification hit an error",
      description: report.verificationError
    }
  }

  if (report.verificationStatus === "improved") {
    return {
      title: "Post-run verification captured an improvement",
      description:
        comparedMetrics.length > 0
          ? `Compared ${comparedMetrics.length} metric${comparedMetrics.length === 1 ? "" : "s"} with ${improvedMetrics.length} improvement${improvedMetrics.length === 1 ? "" : "s"}.`
          : "The report recorded an improved verification result."
    }
  }

  if (report.verificationStatus === "degraded") {
    return {
      title: "Post-run verification captured a regression",
      description:
        comparedMetrics.length > 0
          ? `Compared ${comparedMetrics.length} metric${comparedMetrics.length === 1 ? "" : "s"} and detected ${degradedMetrics.length} regression${degradedMetrics.length === 1 ? "" : "s"}.`
          : "The report recorded a degraded verification result."
    }
  }

  if (report.verificationStatus === "unchanged") {
    return {
      title: "Post-run verification was stable",
      description:
        comparedMetrics.length > 0
          ? `Compared ${comparedMetrics.length} metric${comparedMetrics.length === 1 ? "" : "s"} and found no material change.`
          : "The report recorded an unchanged verification result."
    }
  }

  if (comparedMetrics.length > 0) {
    return {
      title: "Before and after metrics were captured",
      description: `${improvedMetrics.length} improved, ${degradedMetrics.length} regressed, ${comparedMetrics.length - improvedMetrics.length - degradedMetrics.length} unchanged.`
    }
  }

  return null
}

function getEarlyExitSummary(report: WorkflowReport) {
  if (!report.earlyExitResult?.shouldExit) {
    return null
  }

  return {
    title: "Early Exit",
    description: report.earlyExitResult.reason
  }
}

function skillLink(skill: string) {
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

function normalizeSkillLabel(skill: string) {
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

function ReportSection({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-card p-6">
      <div className="mb-4">
        <h2 className="text-lg font-semibold">{title}</h2>
        {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {children}
    </section>
  )
}

function MetricGradeBadge({ grade }: { grade?: MetricSnapshot["grade"] }) {
  const label = formatGrade(grade)
  if (!label) return null

  return (
    <span className="rounded-full border border-[#333] bg-[#111] px-2 py-0.5 text-[11px] text-[#888]">{label}</span>
  )
}

function ReportLoading({ reportCrumbLabel }: { reportCrumbLabel: string }) {
  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto max-w-4xl px-4 py-8">
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
      <a href="/dev-agents/runs" className="inline-flex items-center gap-2 transition-colors hover:text-foreground">
        <ArrowLeft className="h-4 w-4" />
        <span className="font-semibold">Dev Agent Runs</span>
      </a>
      <span>/</span>
      <span>{reportCrumbLabel}</span>
    </span>
  )
}

function StandaloneReportFrame({
  title,
  subtitle,
  description,
  actions,
  children
}: {
  title: ReactNode
  subtitle?: ReactNode
  description?: ReactNode
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto max-w-5xl px-4 py-8">
        <div className="mb-6 flex items-center justify-between gap-3">
          <ReportBreadcrumb reportCrumbLabel="Report" />
          <div className="flex items-center gap-3">
            {actions}
            <ThemeToggle />
          </div>
        </div>
        <div className="mb-6">
          <h1 className="text-3xl font-bold">{title}</h1>
          {subtitle ? <div className="mt-1 text-sm text-muted-foreground">{subtitle}</div> : null}
          {description ? <div className="mt-2 text-sm text-muted-foreground">{description}</div> : null}
        </div>
        <div className="space-y-6">{children}</div>
      </div>
    </div>
  )
}

export default function WorkflowReportPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<ReportLoading reportCrumbLabel="Report" />}>
      <WorkflowReportPageData params={params} />
    </Suspense>
  )
}

async function WorkflowReportPageData({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  const { id } = await params

  let run = user ? await getWorkflowRun(user.id, id) : null
  let isOwner = false

  if (!run) {
    run = await getPublicWorkflowRun(id)
    if (!run && !user) {
      redirect(getSignInPath(`/dev-agents/runs/${id}/report`))
    }
  }

  if (user && run) {
    isOwner = run.userId === user.id
  }

  if (!run) {
    redirect("/dev-agents/runs")
  }

  const ownerRouteContext = isOwner ? await getDefaultDevAgentsRouteContext() : null
  const canUseDashboardShell = Boolean(ownerRouteContext?.selectedTeam)

  if (!run.reportBlobUrl) {
    const pending = (
      <ReportPending
        runId={id}
        userId={isOwner && user ? user.id : undefined}
        workflowType={run.type}
        projectName={run.projectName}
        embedded={canUseDashboardShell}
      />
    )

    if (canUseDashboardShell && ownerRouteContext?.selectedTeam) {
      return (
        <DevAgentsDashboardShell
          teams={ownerRouteContext.teams}
          selectedTeam={ownerRouteContext.selectedTeam}
          title={run.projectName}
          subtitle="Run in progress"
        >
          {pending}
        </DevAgentsDashboardShell>
      )
    }

    return pending
  }

  const response = await fetch(run.reportBlobUrl, { cache: "no-store" })
  const report: WorkflowReport = await response.json()

  const workflowLabel = getWorkflowLabel(report, run)
  const reportDescription = getWorkflowDescription(report, workflowLabel)
  const devAgentId = report.devAgentId || run.devAgentId
  const devAgentHref =
    ownerRouteContext?.selectedTeam && devAgentId
      ? `/${ownerRouteContext.selectedTeam.slug}/dev-agents/${devAgentId}`
      : null
  const primaryHeading = devAgentHref ? (
    <>
      Run Report:{" "}
      <a href={devAgentHref} className="underline decoration-[#333] underline-offset-4 hover:decoration-[#666]">
        {workflowLabel} Dev Agent
      </a>
    </>
  ) : (
    `Run Report: ${workflowLabel} Dev Agent`
  )
  const pageActions = (
    <>
      {isOwner ? <ShareButton runId={id} initialIsPublic={run.isPublic ?? false} /> : null}
      {run.prUrl ? (
        <Button asChild size="sm" className="h-8 rounded-md px-3 text-[13px]">
          <a href={run.prUrl} target="_blank" rel="noopener noreferrer">
            View PR
            <ExternalLink className="ml-1 size-3.5" />
          </a>
        </Button>
      ) : null}
    </>
  )

  const reportBody = <ReportContentBody run={run} report={report} />

  if (canUseDashboardShell && ownerRouteContext?.selectedTeam) {
    return (
      <DevAgentsDashboardShell
        teams={ownerRouteContext.teams}
        selectedTeam={ownerRouteContext.selectedTeam}
        title={primaryHeading}
        subtitle={report.projectName}
        description={reportDescription}
        actions={pageActions}
      >
        {reportBody}
      </DevAgentsDashboardShell>
    )
  }

  return (
    <StandaloneReportFrame
      title={primaryHeading}
      subtitle={report.projectName}
      description={reportDescription}
      actions={isOwner || run.prUrl ? pageActions : undefined}
    >
      {reportBody}
    </StandaloneReportFrame>
  )
}

function ReportContentBody({ run, report }: { run: WorkflowRun; report: WorkflowReport }) {
  const workflowType = report.workflowType || run.type || "cls-fix"
  const metricRows = buildMetricRows(report)
  const isEarlyExit = Boolean(report.earlyExitResult?.shouldExit)
  const hasMetricComparison = metricRows.some((row) => row.before && row.after)
  const showMetricComparisonTable = hasMetricComparison || (isEarlyExit && metricRows.some((row) => row.before))
  const metricsWithCurrentValues = metricRows.filter((row) => row.current)
  const earlyExitSummary = getEarlyExitSummary(report)
  const verificationSummary = getVerificationSummary(report, metricRows)
  const secondarySummary = earlyExitSummary ?? verificationSummary
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
  const isMarketplaceAgent = report.isMarketplaceAgent || report.devAgentId?.startsWith("r_mp_") || false
  const bundleComparison = report.turbopackBundleComparison
  const impactfulness = bundleComparison
    ? calculateImpactfulness(bundleComparison.delta.compressedBytes, report.beforeWebVitals, report.afterWebVitals)
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
          return {
            route,
            beforeCompressedBytes,
            afterCompressedBytes,
            compressedDelta: afterCompressedBytes - beforeCompressedBytes
          }
        })
        .filter((route) => Math.abs(route.compressedDelta) >= MIN_ROUTE_DELTA_BYTES)
        .sort((a, b) => a.compressedDelta - b.compressedDelta)
        .slice(0, 5)
    : []
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
  const shouldAutoOpenAnalysis =
    workflowType === "turbopack-bundle-analyzer" &&
    !bundleComparison &&
    metricRows.length === 0 &&
    Boolean(report.agentAnalysis)

  return (
    <div className="space-y-6">
      {(report.successEvalResult != null || secondarySummary) && (
        <div className="grid gap-4 md:grid-cols-2">
          {report.successEvalResult != null && (
            <div className="rounded-lg border border-[#1f1f1f] bg-[#0a0a0a] p-4">
              <div className="flex items-center gap-2">
                <ShieldCheck className="size-4 text-[#888]" />
                <span className="text-sm font-medium text-[#ededed]">
                  Success Eval: {report.successEvalResult ? "Pass" : "Fail"}
                </span>
              </div>
              {report.successEval ? <p className="mt-1 text-sm text-[#666]">{report.successEval}</p> : null}
            </div>
          )}
          {secondarySummary && (
            <div className="rounded-lg border border-[#1f1f1f] bg-[#0a0a0a] p-4">
              <div className="text-sm font-medium text-[#ededed]">{secondarySummary.title}</div>
              <p className="mt-1 text-sm text-[#666]">{secondarySummary.description}</p>
            </div>
          )}
        </div>
      )}

      {metricsWithCurrentValues.length > 0 ? (
        <ReportSection
          title="Web Vitals"
          description="Baseline and follow-up web vitals captured during the run when available."
        >
          {showMetricComparisonTable ? (
            <div className="overflow-hidden rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/30 text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium">Metric</th>
                    <th className="px-4 py-3 text-left font-medium">Before</th>
                    <th className="px-4 py-3 text-left font-medium">After</th>
                    <th className="px-4 py-3 text-left font-medium">Change</th>
                  </tr>
                </thead>
                <tbody>
                  {metricsWithCurrentValues.map((row) => {
                    const afterSnapshot = isEarlyExit ? undefined : row.after

                    return (
                      <tr key={row.key} className="border-t border-border">
                        <td className="px-4 py-3 align-top">
                          <div className="font-medium">{row.label}</div>
                          <div className="text-xs text-muted-foreground">{row.description}</div>
                        </td>
                        <td className="px-4 py-3 align-top">
                          {row.before ? (
                            <div className="space-y-1">
                              <div>{formatMetricValue(row.key, row.before.value)}</div>
                              <MetricGradeBadge grade={row.before.grade} />
                            </div>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 align-top">
                          {afterSnapshot ? (
                            <div className="space-y-1">
                              <div>{formatMetricValue(row.key, afterSnapshot.value)}</div>
                              <MetricGradeBadge grade={afterSnapshot.grade} />
                            </div>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 align-top">
                          {row.before && afterSnapshot ? (
                            <div className="space-y-1">
                              <div>{formatMetricDelta(row.key, row.before.value, afterSnapshot.value)}</div>
                              <div className="text-xs text-muted-foreground">
                                {afterSnapshot.value < row.before.value
                                  ? "Improved"
                                  : afterSnapshot.value > row.before.value
                                    ? "Regressed"
                                    : "Unchanged"}
                              </div>
                            </div>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {metricsWithCurrentValues.map((row) => (
                <div key={row.key} className="rounded-lg border border-border bg-muted/20 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium">{row.label}</div>
                      <div className="text-xs text-muted-foreground">{row.description}</div>
                    </div>
                    <MetricGradeBadge grade={row.current?.grade} />
                  </div>
                  <div className="mt-4 text-2xl font-semibold">{formatMetricValue(row.key, row.current?.value)}</div>
                </div>
              ))}
            </div>
          )}
        </ReportSection>
      ) : null}

      <ReportSection title="Run Context" description="Compact run metadata and environment details.">
        <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2 xl:grid-cols-3">
          <SummaryItem
            label="Date"
            value={new Date(report.timestamp).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric"
            })}
          />
          {!isMarketplaceAgent ? <SummaryItem label="Model" value={report.agentAnalysisModel || "unknown"} /> : null}
          {hasValidRunTiming && runEndedAt ? (
            <SummaryItem label="Run time" value={formatRunDuration(runEndedAt.getTime() - runStartedAt.getTime())} />
          ) : null}
          {typeof report.costUsd === "number" && report.costUsd > 0 ? (
            <SummaryItem label="Cost" value={formatUsd(report.costUsd)} />
          ) : null}
          {report.targetUrl ? (
            <SummaryItem label="Target URL" value={report.targetUrl} mono href={report.targetUrl} />
          ) : null}
          {report.repoUrl ? <SummaryItem label="Repository" value={report.repoUrl} mono href={report.repoUrl} /> : null}
          {report.repoBranch ? <SummaryItem label="Branch" value={report.repoBranch} mono /> : null}
          {report.projectDir ? <SummaryItem label="Directory" value={report.projectDir} mono /> : null}
          {report.startPath ? <SummaryItem label="Path" value={report.startPath} mono /> : null}
          {report.gatewayUsage?.totalTokens ? (
            <SummaryItem
              label="Tokens"
              value={Intl.NumberFormat("en-US").format(report.gatewayUsage.totalTokens)}
              detail={
                [
                  typeof report.gatewayUsage.promptTokens === "number"
                    ? `prompt ${Intl.NumberFormat("en-US").format(report.gatewayUsage.promptTokens)}`
                    : null,
                  typeof report.gatewayUsage.completionTokens === "number"
                    ? `completion ${Intl.NumberFormat("en-US").format(report.gatewayUsage.completionTokens)}`
                    : null,
                  typeof report.gatewayUsage.cacheReadTokens === "number" && report.gatewayUsage.cacheReadTokens > 0
                    ? `cache read ${Intl.NumberFormat("en-US").format(report.gatewayUsage.cacheReadTokens)}`
                    : null,
                  typeof report.gatewayUsage.cacheCreationTokens === "number" &&
                  report.gatewayUsage.cacheCreationTokens > 0
                    ? `cache write ${Intl.NumberFormat("en-US").format(report.gatewayUsage.cacheCreationTokens)}`
                    : null
                ]
                  .filter(Boolean)
                  .join(" · ") || undefined
              }
            />
          ) : null}
          {!isMarketplaceAgent && skillsUsed.length > 0 ? (
            <div className="sm:col-span-2 xl:col-span-3">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Skills</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {skillsUsed.map((skill) => (
                  <a
                    key={skill.label}
                    href={skill.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-full border border-[#333] bg-[#111] px-2.5 py-1 text-xs text-[#888] hover:text-[#ededed]"
                  >
                    {skill.label}
                  </a>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </ReportSection>

      {workflowType === "prompt" && report.customPrompt ? (
        <ReportSection title="Requested Task" description="The custom task supplied when this run was started.">
          <div className="whitespace-pre-wrap rounded-lg border border-border bg-muted/20 p-4 text-sm">
            {report.customPrompt}
          </div>
        </ReportSection>
      ) : null}

      {report.layoutShifts && report.layoutShifts.length > 0 ? (
        <ReportSection
          title="Layout Shift Evidence"
          description="Detailed layout shift events captured during the run."
        >
          <div className="space-y-3">
            {report.layoutShifts.map((shift, index) => (
              <div key={`shift-${shift.timestamp}`} className="rounded-lg border border-border bg-muted/20 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="font-medium">Shift #{index + 1}</div>
                  <div className="text-sm text-muted-foreground">{formatClsValue(shift.score)}</div>
                </div>
                <div className="mt-2 text-xs text-muted-foreground">
                  Timestamp: {shift.timestamp}
                  {shift.elements.length > 0 ? ` · Elements: ${shift.elements.join(", ")}` : ""}
                </div>
              </div>
            ))}
          </div>
        </ReportSection>
      ) : null}

      {(report.beforeScreenshots?.length ||
        report.afterScreenshots?.length ||
        report.clsScreenshots?.length ||
        report.beforeScreenshotUrl ||
        report.afterScreenshotUrl) && (
        <ReportSection title="Screenshots" description="Visual evidence captured before and after the run.">
          {(report.beforeScreenshots?.length || report.clsScreenshots?.length) && report.afterScreenshots?.length ? (
            <CoordinatedPlayers
              beforeScreenshots={report.beforeScreenshots || report.clsScreenshots || []}
              afterScreenshots={report.afterScreenshots}
              fps={2}
              loopDelayMs={10000}
            />
          ) : report.beforeScreenshots?.length || report.afterScreenshots?.length || report.clsScreenshots?.length ? (
            <div className="grid gap-4 md:grid-cols-2">
              {report.beforeScreenshots?.length || report.clsScreenshots?.length ? (
                <ScreenshotPlayer
                  screenshots={report.beforeScreenshots || report.clsScreenshots || []}
                  title="Before"
                  autoPlay={true}
                  fps={2}
                  loop={true}
                />
              ) : report.beforeScreenshotUrl ? (
                <StaticScreenshot title="Before" url={report.beforeScreenshotUrl} />
              ) : null}
              {report.afterScreenshots?.length ? (
                <ScreenshotPlayer
                  screenshots={report.afterScreenshots}
                  title="After"
                  autoPlay={true}
                  fps={2}
                  loop={true}
                />
              ) : report.afterScreenshotUrl ? (
                <StaticScreenshot title="After" url={report.afterScreenshotUrl} />
              ) : null}
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {report.beforeScreenshotUrl ? <StaticScreenshot title="Before" url={report.beforeScreenshotUrl} /> : null}
              {report.afterScreenshotUrl ? <StaticScreenshot title="After" url={report.afterScreenshotUrl} /> : null}
            </div>
          )}
        </ReportSection>
      )}

      {bundleComparison ? (
        <ReportSection title="Bundle Delta" description="Before and after bundle output captured for the run.">
          {impactfulness ? (
            <div className="mb-4">
              <ImpactfulnessGauge
                score={impactfulness.score}
                bucket={impactfulness.bucket}
                direction={impactfulness.direction}
                cwvVerified={impactfulness.cwvVerified}
                cwvMetricsCompared={impactfulness.cwvMetricsCompared}
                cwvMetricsImproved={impactfulness.cwvMetricsImproved}
              />
            </div>
          ) : null}
          <div className="mb-4 rounded-lg border border-border bg-muted/20 px-4 py-3 text-sm">
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
            <BundleSummaryCard
              label="Compressed JS"
              before={formatBytes(bundleComparison.before.totalCompressedBytes)}
              after={formatBytes(bundleComparison.after.totalCompressedBytes)}
              delta={`${formatSignedBytes(bundleComparison.delta.compressedBytes)} (${formatSignedPercent(bundleComparison.delta.compressedPercent)})`}
            />
            <BundleSummaryCard
              label="Raw JS"
              before={formatBytes(bundleComparison.before.totalRawBytes)}
              after={formatBytes(bundleComparison.after.totalRawBytes)}
              delta={`${formatSignedBytes(bundleComparison.delta.rawBytes)} (${formatSignedPercent(bundleComparison.delta.rawPercent)})`}
            />
            <div className="rounded-lg border border-border bg-muted/20 p-3">
              <div className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">Coverage</div>
              <div className="text-sm">Routes: {bundleComparison.before.routeCount}</div>
              <div className="text-sm">Output files: {bundleComparison.before.outputFileCount}</div>
            </div>
          </div>
          {bundleRouteDeltas.length > 0 ? (
            <div className="mt-4 rounded-lg border border-border bg-muted/20 p-3">
              <div className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
                Top Route-Level Compressed JS Changes
              </div>
              <div className="space-y-2">
                {bundleRouteDeltas.map((routeDelta) => (
                  <div
                    key={routeDelta.route}
                    className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center gap-3 text-sm"
                  >
                    <span className="truncate font-mono">{routeDelta.route}</span>
                    <span className="text-muted-foreground">{formatBytes(routeDelta.beforeCompressedBytes)}</span>
                    <span className="text-muted-foreground">→ {formatBytes(routeDelta.afterCompressedBytes)}</span>
                    <span>{formatSignedBytes(routeDelta.compressedDelta)}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </ReportSection>
      ) : null}

      {report.gitDiff ? (
        <ReportSection title="Code Diff" description="Patch output captured for this run.">
          <DiffSection patch={report.gitDiff} prDiffUrl={prDiffUrl} inlineDiffUrl={inlineDiffUrl} />
        </ReportSection>
      ) : null}

      <ReportSection title="Analysis" description="The final agent output for this run.">
        <AgentAnalysis content={report.agentAnalysis} />
        {!isMarketplaceAgent && (report.timing || report.initD3kLogs || report.d3kLogs || report.afterD3kLogs) ? (
          <details className="group mt-6" open={shouldAutoOpenAnalysis}>
            <summary className="inline-flex cursor-pointer items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
              <span className="inline-flex items-center gap-2 font-medium">
                <ChevronRight className="h-4 w-4 transition-transform group-open:rotate-90" />
                Show diagnostic transcript
              </span>
            </summary>
            <div className="mt-4 space-y-4 rounded-lg border border-border bg-muted/20 p-4">
              {(report.sandboxDevUrl ||
                report.targetUrl ||
                report.repoUrl ||
                report.repoBranch ||
                report.projectDir) && (
                <div className="text-xs text-muted-foreground">
                  <ul className="flex flex-wrap gap-x-6 gap-y-1">
                    {report.sandboxDevUrl ? (
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
                    ) : null}
                    {report.targetUrl ? (
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
                    ) : null}
                    {report.repoUrl ? (
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
                    ) : null}
                    {report.repoBranch ? (
                      <li>
                        <span>Ref: </span>
                        <span className="font-mono">{report.repoBranch}</span>
                      </li>
                    ) : null}
                    {report.projectDir ? (
                      <li>
                        <span>Dir: </span>
                        <span className="font-mono">{report.projectDir}</span>
                      </li>
                    ) : null}
                  </ul>
                </div>
              )}

              {report.timing ? (
                <>
                  <div className="flex flex-wrap items-center gap-4">
                    <div className="rounded-full border border-[#333] bg-[#111] px-2.5 py-1 text-xs text-[#888]">
                      {report.fromSnapshot ? "Snapshot Reused" : "Fresh Sandbox"}
                    </div>
                    <div className="flex flex-wrap items-center gap-4 text-sm">
                      <span className="text-muted-foreground">
                        Total: <span className="text-foreground">{formatSeconds(report.timing.total.totalMs)}</span>
                      </span>
                      <span className="text-muted-foreground">
                        Init: <span className="font-mono text-xs">{formatSeconds(report.timing.total.initMs)}</span>
                      </span>
                      <span className="text-muted-foreground">
                        Agent: <span className="font-mono text-xs">{formatSeconds(report.timing.total.agentMs)}</span>
                      </span>
                      {report.timing.total.prMs ? (
                        <span className="text-muted-foreground">
                          PR: <span className="font-mono text-xs">{formatSeconds(report.timing.total.prMs)}</span>
                        </span>
                      ) : null}
                    </div>
                  </div>

                  <details className="pt-1">
                    <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                      View step-by-step timing breakdown
                    </summary>
                    <div className="mt-2 grid gap-4 text-xs md:grid-cols-2">
                      {report.timing.init?.steps && report.timing.init.steps.length > 0 ? (
                        <div>
                          <div className="mb-1 font-medium text-muted-foreground">Init Steps</div>
                          <ul className="space-y-0.5 font-mono">
                            {report.timing.init.steps.map((step) => (
                              <li key={`init-${step.name}`} className="flex justify-between">
                                <span className="mr-2 truncate">{step.name}</span>
                                <span className="text-muted-foreground">{formatSeconds(step.durationMs)}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                      {report.timing.agent?.steps && report.timing.agent.steps.length > 0 ? (
                        <div>
                          <div className="mb-1 font-medium text-muted-foreground">Agent Steps</div>
                          <ul className="space-y-0.5 font-mono">
                            {report.timing.agent.steps.map((step) => (
                              <li key={`agent-${step.name}`} className="flex justify-between">
                                <span className="mr-2 truncate">{step.name}</span>
                                <span className="text-muted-foreground">{formatSeconds(step.durationMs)}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                    </div>
                  </details>
                </>
              ) : null}

              {report.initD3kLogs || report.d3kLogs ? (
                <details>
                  <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                    Init logs
                  </summary>
                  <pre className="mt-2 max-h-96 overflow-x-auto overflow-y-auto whitespace-pre-wrap rounded p-4 font-mono text-xs bg-muted/50">
                    {report.initD3kLogs || report.d3kLogs}
                  </pre>
                </details>
              ) : null}

              {report.afterD3kLogs ? (
                <details>
                  <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                    After logs
                  </summary>
                  <pre className="mt-2 max-h-96 overflow-x-auto overflow-y-auto whitespace-pre-wrap rounded p-4 font-mono text-xs bg-muted/50">
                    {report.afterD3kLogs}
                  </pre>
                </details>
              ) : null}
            </div>
          </details>
        ) : null}
      </ReportSection>

      <div className="flex flex-wrap gap-3">
        <Button asChild variant="outline">
          <a href="/dev-agents/runs">Back to runs</a>
        </Button>
        {run.prUrl ? (
          <Button asChild>
            <a href={run.prUrl} target="_blank" rel="noopener noreferrer">
              View Pull Request
              <ExternalLink className="ml-1 size-3.5" />
            </a>
          </Button>
        ) : null}
      </div>
    </div>
  )
}

function SummaryItem({
  label,
  value,
  detail,
  mono = false,
  href
}: {
  label: string
  value: string
  detail?: string
  mono?: boolean
  href?: string
}) {
  const valueClassName = mono ? "font-mono text-sm text-foreground" : "text-sm text-foreground"

  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className={`${valueClassName} mt-1 block break-all hover:underline`}
        >
          {value}
        </a>
      ) : (
        <div className={`${valueClassName} mt-1 break-all`}>{value}</div>
      )}
      {detail ? <div className="mt-1 text-xs text-muted-foreground">{detail}</div> : null}
    </div>
  )
}

function StaticScreenshot({ title, url }: { title: string; url: string }) {
  return (
    <div className="overflow-hidden rounded-lg bg-muted/30">
      <div className="border-b border-border bg-muted/50 px-3 py-2">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">{title}</span>
      </div>
      <a href={url} target="_blank" rel="noopener noreferrer">
        <Image src={url} alt={`${title} screenshot`} width={400} height={225} unoptimized className="h-auto w-full" />
      </a>
    </div>
  )
}

function BundleSummaryCard({
  label,
  before,
  after,
  delta
}: {
  label: string
  before: string
  after: string
  delta: string
}) {
  return (
    <div className="rounded-lg border border-border bg-muted/20 p-3">
      <div className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-sm">
        {before} → {after}
      </div>
      <div className="text-sm font-medium">{delta}</div>
    </div>
  )
}
