"use client"

import {
  ArrowLeft,
  ArrowUpRight,
  CheckCircle2,
  Clock,
  DollarSign,
  ExternalLink,
  GitPullRequest,
  Minus,
  TrendingDown,
  TrendingUp,
  Zap
} from "lucide-react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MetricSnapshot {
  label: string
  before: number
  after: number
  unit: string
  lowerIsBetter: boolean
}

interface WorkflowStep {
  name: string
  durationMs: number
  status: "completed" | "skipped"
  detail?: string
}

interface DevAgentRunReport {
  // Run metadata
  runId: string
  agentName: string
  agentOwner: string
  agentOwnerAvatar?: string
  projectName: string
  teamSlug: string
  timestamp: string
  durationMs: number
  costUsd: number
  status: "success" | "failure" | "partial"

  // Improvement headline
  headlineMetric: string
  headlineImprovement: number // percentage

  // Metrics before/after
  metrics: MetricSnapshot[]

  // Workflow step timing
  steps: WorkflowStep[]

  // Iterations
  iterations: number

  // PR info
  prUrl?: string
  prTitle?: string
  filesChanged?: number
  linesAdded?: number
  linesRemoved?: number

  // Agent summary
  summary: string
}

// ---------------------------------------------------------------------------
// Demo data — Request Deduper on gecko-cam
// ---------------------------------------------------------------------------

const DEMO_REPORT: DevAgentRunReport = {
  runId: "run_demo_shuding_rd_001",
  agentName: "Request Deduper",
  agentOwner: "shuding",
  agentOwnerAvatar: "https://github.com/shuding.png?size=64",
  projectName: "gecko-cam",
  teamSlug: "elsigh-pro",
  timestamp: "2026-03-27T09:14:00Z",
  durationMs: 270000, // 4m30s
  costUsd: 8.43,
  status: "success",

  headlineMetric: "Duplicate Requests",
  headlineImprovement: 70,

  metrics: [
    { label: "Duplicate Fetches", before: 23, after: 7, unit: "", lowerIsBetter: true },
    { label: "Total Requests", before: 84, after: 47, unit: "", lowerIsBetter: true },
    { label: "Page Load (LCP)", before: 2840, after: 1620, unit: "ms", lowerIsBetter: true },
    { label: "Time to Interactive", before: 3200, after: 1980, unit: "ms", lowerIsBetter: true },
    { label: "Transfer Size", before: 1.8, after: 1.1, unit: "MB", lowerIsBetter: true },
    { label: "Cache Hit Rate", before: 31, after: 78, unit: "%", lowerIsBetter: false }
  ],

  steps: [
    {
      name: "Load target URL & capture baseline metrics",
      durationMs: 18200,
      status: "completed",
      detail: "gecko-cam.vercel.app"
    },
    {
      name: "Clone repo & start dev server in sandbox",
      durationMs: 42300,
      status: "completed",
      detail: "next dev on port 3000"
    },
    {
      name: "Agent analysis — identify duplicate fetches",
      durationMs: 31400,
      status: "completed",
      detail: "Found 23 duplicate fetches across 6 routes"
    },
    {
      name: "Agent edit — deduplicate & add caching",
      durationMs: 68700,
      status: "completed",
      detail: "Modified 8 files, added SWR cache layer"
    },
    {
      name: "Recapture metrics & verify improvement",
      durationMs: 22100,
      status: "completed",
      detail: "70% reduction in duplicate requests"
    },
    {
      name: "Agent edit — additional optimization pass",
      durationMs: 44800,
      status: "completed",
      detail: "Collapsed 3 redundant API routes"
    },
    {
      name: "Final metrics capture & delta comparison",
      durationMs: 16500,
      status: "completed",
      detail: "All metrics improved"
    },
    { name: "Generate PR with changes", durationMs: 26000, status: "completed", detail: "PR #247 created" }
  ],

  iterations: 3,

  prUrl: "https://github.com/elsigh/gecko-cam/pull/247",
  prTitle: "fix: deduplicate fetches and add request caching",
  filesChanged: 8,
  linesAdded: 142,
  linesRemoved: 67,

  summary:
    "Identified 23 duplicate fetch calls across 6 route handlers in the gecko-cam app. The agent collapsed redundant requests using a shared SWR cache layer, merged 3 overlapping API routes into a single data-fetching utility, and added `Cache-Control` headers for static asset responses. After 3 iterations, duplicate fetches dropped from 23 to 7 (70% reduction), page load improved by 43%, and overall transfer size decreased by 39%."
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes === 0) return `${seconds}s`
  return `${minutes}m ${seconds}s`
}

function formatCost(usd: number): string {
  return `$${usd.toFixed(2)}`
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  })
}

function metricDelta(m: MetricSnapshot): { value: number; improved: boolean } {
  const delta = m.lowerIsBetter ? m.before - m.after : m.after - m.before
  const pct = m.before === 0 ? 0 : Math.round((delta / m.before) * 100)
  return { value: Math.abs(pct), improved: delta > 0 }
}

function formatMetricValue(val: number, unit: string): string {
  if (unit === "ms" && val >= 1000) {
    return `${(val / 1000).toFixed(2)}s`
  }
  if (unit === "MB") {
    return `${val.toFixed(1)} MB`
  }
  if (unit === "%") {
    return `${val}%`
  }
  return `${val}${unit}`
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

function VercelTriangle({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" fill="currentColor" viewBox="0 0 75 65" className={className}>
      <path d="M37.59.25l36.95 64H.64l36.95-64z" />
    </svg>
  )
}

function HeroStats({ report }: { report: DevAgentRunReport }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {/* Improvement */}
      <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-4">
        <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-emerald-400/70">
          <TrendingDown className="size-3.5" />
          Improvement
        </div>
        <div className="mt-1.5 text-[28px] font-semibold tracking-tight text-emerald-400">
          {report.headlineImprovement}%
        </div>
        <div className="mt-0.5 text-[12px] text-emerald-400/50">{report.headlineMetric}</div>
      </div>

      {/* Duration */}
      <div className="rounded-lg border border-[#1f1f1f] bg-[#111] p-4">
        <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-[#555]">
          <Clock className="size-3.5" />
          Duration
        </div>
        <div className="mt-1.5 text-[28px] font-semibold tracking-tight text-[#ededed]">
          {formatDuration(report.durationMs)}
        </div>
        <div className="mt-0.5 text-[12px] text-[#555]">{report.iterations} iterations</div>
      </div>

      {/* Cost */}
      <div className="rounded-lg border border-[#1f1f1f] bg-[#111] p-4">
        <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-[#555]">
          <DollarSign className="size-3.5" />
          Cost
        </div>
        <div className="mt-1.5 text-[28px] font-semibold tracking-tight text-[#ededed]">
          {formatCost(report.costUsd)}
        </div>
        <div className="mt-0.5 text-[12px] text-[#555]">tokens + compute</div>
      </div>

      {/* Status */}
      <div className="rounded-lg border border-[#1f1f1f] bg-[#111] p-4">
        <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-[#555]">
          <CheckCircle2 className="size-3.5" />
          Status
        </div>
        <div className="mt-1.5 text-[28px] font-semibold tracking-tight text-[#ededed]">
          {report.status === "success" ? "Passed" : report.status === "partial" ? "Partial" : "Failed"}
        </div>
        <div className="mt-0.5 text-[12px] text-[#555]">{report.filesChanged} files changed</div>
      </div>
    </div>
  )
}

function MetricsTable({ metrics }: { metrics: MetricSnapshot[] }) {
  return (
    <div className="overflow-hidden rounded-lg border border-[#1f1f1f]">
      <div className="border-b border-[#1f1f1f] bg-[#111] px-4 py-2.5">
        <span className="text-[13px] font-medium text-[#ededed]">Before / After Comparison</span>
      </div>
      <div className="divide-y divide-[#1f1f1f]">
        {/* Header */}
        <div className="grid grid-cols-4 gap-4 bg-[#0d0d0d] px-4 py-2">
          <div className="text-[11px] uppercase tracking-wider text-[#555]">Metric</div>
          <div className="text-right text-[11px] uppercase tracking-wider text-[#555]">Before</div>
          <div className="text-right text-[11px] uppercase tracking-wider text-[#555]">After</div>
          <div className="text-right text-[11px] uppercase tracking-wider text-[#555]">Change</div>
        </div>
        {metrics.map((m) => {
          const delta = metricDelta(m)
          return (
            <div key={m.label} className="grid grid-cols-4 items-center gap-4 px-4 py-3">
              <div className="text-[13px] text-[#ededed]">{m.label}</div>
              <div className="text-right font-mono text-[13px] text-[#888]">{formatMetricValue(m.before, m.unit)}</div>
              <div className="text-right font-mono text-[13px] text-[#ededed]">
                {formatMetricValue(m.after, m.unit)}
              </div>
              <div className="flex items-center justify-end gap-1">
                {delta.improved ? (
                  <>
                    <TrendingDown className="size-3 text-emerald-400" />
                    <span className="font-mono text-[13px] text-emerald-400">{delta.value}%</span>
                  </>
                ) : delta.value === 0 ? (
                  <>
                    <Minus className="size-3 text-[#555]" />
                    <span className="font-mono text-[13px] text-[#555]">0%</span>
                  </>
                ) : (
                  <>
                    <TrendingUp className="size-3 text-red-400" />
                    <span className="font-mono text-[13px] text-red-400">{delta.value}%</span>
                  </>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function WorkflowTimeline({ steps, totalMs }: { steps: WorkflowStep[]; totalMs: number }) {
  return (
    <div className="overflow-hidden rounded-lg border border-[#1f1f1f]">
      <div className="border-b border-[#1f1f1f] bg-[#111] px-4 py-2.5">
        <span className="text-[13px] font-medium text-[#ededed]">Workflow Steps</span>
      </div>
      <div className="divide-y divide-[#1f1f1f]">
        {steps.map((step, i) => {
          const pct = totalMs > 0 ? (step.durationMs / totalMs) * 100 : 0
          return (
            <div key={step.name} className="relative px-4 py-3">
              {/* Background bar */}
              <div className="absolute inset-y-0 left-0 bg-[#1a1a1a]" style={{ width: `${pct}%` }} />
              <div className="relative flex items-center justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="flex size-5 shrink-0 items-center justify-center rounded-full border border-[#333] bg-[#111] text-[10px] font-medium text-[#888]">
                      {i + 1}
                    </span>
                    <span className="truncate text-[13px] text-[#ededed]">{step.name}</span>
                  </div>
                  {step.detail ? <div className="mt-0.5 pl-7 text-[12px] text-[#555]">{step.detail}</div> : null}
                </div>
                <span className="shrink-0 font-mono text-[13px] text-[#888]">{formatDuration(step.durationMs)}</span>
              </div>
            </div>
          )
        })}
      </div>
      {/* Total */}
      <div className="flex items-center justify-between border-t border-[#333] bg-[#111] px-4 py-2.5">
        <span className="text-[13px] font-medium text-[#ededed]">Total</span>
        <span className="font-mono text-[13px] font-medium text-[#ededed]">{formatDuration(totalMs)}</span>
      </div>
    </div>
  )
}

function PRCard({ report }: { report: DevAgentRunReport }) {
  if (!report.prUrl) return null

  return (
    <div className="overflow-hidden rounded-lg border border-[#1f1f1f]">
      <div className="border-b border-[#1f1f1f] bg-[#111] px-4 py-2.5">
        <span className="text-[13px] font-medium text-[#ededed]">Pull Request</span>
      </div>
      <div className="p-4">
        <div className="flex items-start gap-3">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-full border border-emerald-500/20 bg-emerald-500/10">
            <GitPullRequest className="size-4 text-emerald-400" />
          </div>
          <div className="min-w-0 flex-1">
            <a
              href={report.prUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex items-center gap-1.5 text-[14px] font-medium text-[#ededed] hover:text-white"
            >
              <span className="truncate">{report.prTitle}</span>
              <ExternalLink className="size-3 shrink-0 text-[#555] group-hover:text-[#888]" />
            </a>
            <div className="mt-1 flex items-center gap-3 text-[12px] text-[#555]">
              <span>
                <span className="text-emerald-400">+{report.linesAdded}</span>{" "}
                <span className="text-red-400">-{report.linesRemoved}</span>
              </span>
              <span>{report.filesChanged} files</span>
              <span>#{report.prUrl?.split("/").pop()}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function AgentSummary({ report }: { report: DevAgentRunReport }) {
  return (
    <div className="overflow-hidden rounded-lg border border-[#1f1f1f]">
      <div className="border-b border-[#1f1f1f] bg-[#111] px-4 py-2.5">
        <span className="text-[13px] font-medium text-[#ededed]">Agent Summary</span>
      </div>
      <div className="p-4">
        <p className="text-[14px] leading-[22px] text-[#888]">{report.summary}</p>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function DevAgentRunReportPage() {
  const params = useParams<{ team: string; runId: string }>()
  const report = DEMO_REPORT

  return (
    <div className="min-h-screen bg-[#0a0a0a] font-sans text-[#ededed]">
      {/* Top nav */}
      <header className="sticky top-0 z-10 border-b border-[#1f1f1f] bg-[#0a0a0a]/80 backdrop-blur-sm">
        <div className="mx-auto flex h-[52px] max-w-[1100px] items-center justify-between px-6">
          <div className="flex items-center gap-3">
            <Link
              href={`/${params.team}/dev-agents`}
              className="flex items-center gap-1.5 text-[13px] text-[#888] transition-colors hover:text-[#ededed]"
            >
              <ArrowLeft className="size-3.5" />
              Dev Agents
            </Link>
            <span className="text-[#333]">/</span>
            <span className="text-[13px] text-[#888]">{report.agentName}</span>
            <span className="text-[#333]">/</span>
            <span className="text-[13px] text-[#ededed]">Run Report</span>
          </div>
          <div className="flex items-center gap-2 text-[12px] text-[#555]">
            <span>{formatTimestamp(report.timestamp)}</span>
          </div>
        </div>
      </header>

      {/* Content */}
      <div className="mx-auto max-w-[1100px] px-6 py-8">
        {/* Title row */}
        <div className="mb-8 flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-[24px] font-semibold tracking-[-0.020em] text-[#ededed]">{report.projectName}</h1>
              <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-medium text-emerald-400">
                {report.headlineImprovement}% improved
              </span>
            </div>
            <div className="mt-2 flex items-center gap-3">
              {/* Agent + owner */}
              <div className="flex items-center gap-1.5">
                <Zap className="size-3.5 text-[#555]" />
                <span className="text-[13px] text-[#888]">{report.agentName}</span>
                <span className="text-[13px] text-[#555]">by</span>
                <span className="inline-flex items-center gap-1.5 text-[13px] text-[#888]">
                  {report.agentOwnerAvatar ? (
                    <Avatar className="size-4 border border-[#333]">
                      <AvatarImage src={report.agentOwnerAvatar} alt={report.agentOwner} />
                      <AvatarFallback className="bg-[#1a1a1a] text-[9px] font-medium text-[#888]">
                        {report.agentOwner.slice(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                  ) : (
                    <VercelTriangle className="size-3 text-[#888]" />
                  )}
                  {report.agentOwner}
                </span>
              </div>
            </div>
          </div>

          {report.prUrl ? (
            <Button
              asChild
              size="sm"
              className="h-8 rounded-md bg-[#ededed] px-3 text-[13px] font-medium text-[#0a0a0a] hover:bg-white"
            >
              <a href={report.prUrl} target="_blank" rel="noopener noreferrer">
                <GitPullRequest className="size-3.5" />
                View PR
                <ArrowUpRight className="size-3" />
              </a>
            </Button>
          ) : null}
        </div>

        {/* Hero stats */}
        <HeroStats report={report} />

        {/* Main content */}
        <div className="mt-6 space-y-6">
          {/* Agent Summary */}
          <AgentSummary report={report} />

          {/* Metrics table */}
          <MetricsTable metrics={report.metrics} />

          {/* Two-column: Timeline + PR */}
          <div className="grid gap-6 lg:grid-cols-5">
            <div className="lg:col-span-3">
              <WorkflowTimeline steps={report.steps} totalMs={report.durationMs} />
            </div>
            <div className="space-y-6 lg:col-span-2">
              <PRCard report={report} />

              {/* Iteration summary */}
              <div className="overflow-hidden rounded-lg border border-[#1f1f1f]">
                <div className="border-b border-[#1f1f1f] bg-[#111] px-4 py-2.5">
                  <span className="text-[13px] font-medium text-[#ededed]">Iterations</span>
                </div>
                <div className="divide-y divide-[#1f1f1f]">
                  <div className="flex items-center justify-between px-4 py-3">
                    <span className="text-[13px] text-[#888]">Baseline capture</span>
                    <span className="rounded-full bg-[#1a1a1a] px-2 py-0.5 text-[11px] text-[#666]">Iteration 0</span>
                  </div>
                  <div className="flex items-center justify-between px-4 py-3">
                    <div className="space-y-0.5">
                      <span className="text-[13px] text-[#888]">Deduplicate fetch calls</span>
                      <div className="text-[11px] text-[#555]">23 → 12 duplicate fetches</div>
                    </div>
                    <span className="rounded-full bg-[#1a1a1a] px-2 py-0.5 text-[11px] text-[#666]">Iteration 1</span>
                  </div>
                  <div className="flex items-center justify-between px-4 py-3">
                    <div className="space-y-0.5">
                      <span className="text-[13px] text-[#888]">Add SWR cache layer</span>
                      <div className="text-[11px] text-[#555]">12 → 9 duplicate fetches</div>
                    </div>
                    <span className="rounded-full bg-[#1a1a1a] px-2 py-0.5 text-[11px] text-[#666]">Iteration 2</span>
                  </div>
                  <div className="flex items-center justify-between px-4 py-3">
                    <div className="space-y-0.5">
                      <span className="text-[13px] text-[#888]">Collapse redundant API routes</span>
                      <div className="text-[11px] text-[#555]">9 → 7 duplicate fetches</div>
                    </div>
                    <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-400">
                      Iteration 3 — goal met
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-12 border-t border-[#1f1f1f] pt-4">
          <div className="flex items-center justify-between text-[12px] text-[#555]">
            <span>
              Run {report.runId} · {formatTimestamp(report.timestamp)}
            </span>
            <div className="flex items-center gap-1.5">
              <VercelTriangle className="size-2.5" />
              <span>Powered by Vercel Dev Agents</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
