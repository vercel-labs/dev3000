"use client"

import { AlertCircle } from "lucide-react"
import { useRouter } from "next/navigation"
import { useEffect, useRef, useState } from "react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Skeleton } from "@/components/ui/skeleton"

interface ReportPendingProps {
  runId: string
  userId?: string
  workflowType?: string
  projectName?: string
  devAgentName?: string
  embedded?: boolean
}

const STEP_LABELS = ["Creating sandbox", "Capturing baseline", "Agent in progress", "Generating report", "Finishing up"]

function stripAnsi(value: string): string {
  let result = ""

  for (let index = 0; index < value.length; index++) {
    const charCode = value.charCodeAt(index)
    if (charCode === 27 && value[index + 1] === "[") {
      while (index < value.length && value[index] !== "m") {
        index++
      }
      continue
    }
    result += value[index]
  }

  return result
}

function sanitizeDisplayText(value: string): string {
  const stripped = stripAnsi(value)
  let printable = ""

  for (let index = 0; index < stripped.length; index++) {
    const charCode = stripped.charCodeAt(index)
    const isDisallowedControl =
      (charCode >= 0 && charCode <= 8) || (charCode >= 11 && charCode <= 31) || (charCode >= 127 && charCode <= 159)
    if (!isDisallowedControl) {
      printable += stripped[index]
    }
  }

  return printable.replace(/\s+/g, " ").trim()
}

function normalizeStepNumber(stepNumber: number | null): number | null {
  if (stepNumber === null) return null
  if (stepNumber >= 1 && stepNumber <= STEP_LABELS.length) return stepNumber - 1
  if (stepNumber >= 0 && stepNumber < STEP_LABELS.length) return stepNumber
  return null
}

function getPendingReportLabel(workflowType?: string, devAgentName?: string) {
  if (devAgentName?.trim()) return `${devAgentName.trim()} Dev Agent Report`
  if (workflowType === "turbopack-bundle-analyzer") return "Turbopack Bundle Analyzer Report"
  if (workflowType === "design-guidelines") return "Design Guidelines Report"
  if (workflowType === "react-performance") return "React Performance Report"
  if (workflowType === "url-audit") return "URL Audit Report"
  if (workflowType === "prompt") return "Custom Prompt Report"
  return "Dev Agent Report"
}

function getLegacyWorkflowLabel(workflowType?: string) {
  if (workflowType === "turbopack-bundle-analyzer") return "Turbopack Bundle Analyzer"
  if (workflowType === "design-guidelines") return "Design Guidelines Review"
  if (workflowType === "react-performance") return "React Performance Review"
  if (workflowType === "url-audit") return "URL Audit"
  if (workflowType === "prompt") return "Custom Prompt"
  return "Dev Agent"
}

export function ReportPending({
  runId,
  userId,
  workflowType,
  projectName,
  devAgentName,
  embedded = false
}: ReportPendingProps) {
  const router = useRouter()
  const [status, setStatus] = useState<string>("Creating sandbox...")
  const [hasError, setHasError] = useState(false)
  const [sandboxUrl, setSandboxUrl] = useState<string | null>(null)
  const [stepNumber, setStepNumber] = useState<number | null>(null)
  const [progressLogs, setProgressLogs] = useState<string[]>([])
  const logsRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    let isActive = true

    const poll = async () => {
      if (!userId) {
        router.refresh()
        return
      }

      try {
        const response = await fetch(`/api/dev-agents/runs?userId=${userId}`)
        if (!response.ok) {
          throw new Error(`Failed to load run status (${response.status})`)
        }

        const data = (await response.json()) as {
          success?: boolean
          runs?: Array<{
            id: string
            status?: string
            currentStep?: string
            reportBlobUrl?: string
            error?: string
            stepNumber?: number
            sandboxUrl?: string
            progressLogs?: string[]
          }>
        }

        if (!data.success || !Array.isArray(data.runs)) {
          throw new Error("Invalid run status response")
        }

        const run = data.runs.find((item) => item.id === runId)
        if (!run) {
          return
        }

        if (run.status === "failure") {
          if (isActive) {
            setHasError(true)
            setStatus(sanitizeDisplayText(run.error || "Failed to generate report."))
          }
          return
        }

        if (run.reportBlobUrl && run.status === "done") {
          router.refresh()
          return
        }

        if (isActive) {
          setHasError(false)
          setStatus(sanitizeDisplayText(run.currentStep || "Generating report..."))
          setStepNumber(typeof run.stepNumber === "number" ? run.stepNumber : null)
          setSandboxUrl(run.sandboxUrl || null)
          setProgressLogs(
            Array.isArray(run.progressLogs) ? run.progressLogs.map((line) => sanitizeDisplayText(line)) : []
          )
        }
      } catch (error) {
        if (!isActive) return
        setHasError(true)
        setStatus(sanitizeDisplayText(error instanceof Error ? error.message : "Unable to load run status."))
      }
    }

    const interval = setInterval(poll, 5000)
    poll()

    return () => {
      isActive = false
      clearInterval(interval)
    }
  }, [runId, userId, router])

  useEffect(() => {
    if (progressLogs.length === 0) return
    if (!logsRef.current) return
    logsRef.current.scrollTop = logsRef.current.scrollHeight
  }, [progressLogs])

  const normalizedStepNumber = normalizeStepNumber(stepNumber)
  const activeStepLabel = typeof normalizedStepNumber === "number" ? STEP_LABELS[normalizedStepNumber] : null
  const showStatus = !activeStepLabel || status.trim() !== activeStepLabel
  const statusText = showStatus ? status : "In progress..."
  const normalizeStatus = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, "")
      .trim()
  const normalizedStatus = normalizeStatus(status)
  const statusMatchIndex = STEP_LABELS.findIndex((label) => {
    const normalizedLabel = normalizeStatus(label)
    return normalizedStatus.startsWith(normalizedLabel) || normalizedLabel.startsWith(normalizedStatus)
  })
  const fallbackActiveIndex = statusMatchIndex >= 0 ? statusMatchIndex : -1
  const activeIndex = fallbackActiveIndex >= 0 ? fallbackActiveIndex : normalizedStepNumber
  const workflowLabel = devAgentName?.trim() || getLegacyWorkflowLabel(workflowType)
  const pendingLabel = getPendingReportLabel(workflowType, devAgentName)
  const pendingReportTitle = `Run Report: ${workflowLabel} Dev Agent`

  const content = (
    <div className="space-y-6">
      {!embedded && (
        <div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">{pendingLabel}</div>
          <h1 className="text-3xl font-bold mt-2">{pendingReportTitle}</h1>
          {projectName ? <p className="mt-1 text-sm text-muted-foreground">Project: {projectName}</p> : null}
          <p className="text-muted-foreground mt-2">
            We&apos;re assembling the results and will show them here shortly.
          </p>
        </div>
      )}

      <Alert variant={hasError ? "destructive" : "default"} className={hasError ? "" : "bg-card border-border"}>
        {hasError && <AlertCircle className="h-4 w-4" />}
        <AlertDescription>{statusText}</AlertDescription>
      </Alert>

      <div className="bg-card border border-border rounded-lg p-4">
        <div className="text-sm font-medium text-foreground mb-3">Progress</div>
        {sandboxUrl && !hasError && (
          <div className="mb-3 text-xs text-muted-foreground">
            <span className="font-medium">Sandbox:</span>{" "}
            <a href={sandboxUrl} target="_blank" rel="noopener noreferrer" className="font-mono hover:underline">
              {sandboxUrl}
            </a>
          </div>
        )}
        <div className="space-y-2">
          {STEP_LABELS.map((label, index) => {
            const isDone = activeIndex !== null && index < activeIndex
            const isActive = activeIndex !== null && index === activeIndex
            return (
              <div key={label} className="flex items-center gap-3 text-sm">
                <span
                  className={`h-2.5 w-2.5 rounded-full ${isDone ? "bg-green-500" : isActive ? "bg-blue-500" : "bg-muted"}`}
                />
                <span
                  className={
                    isActive && !hasError
                      ? "text-shimmer font-medium inline-block"
                      : isDone
                        ? "text-foreground"
                        : "text-muted-foreground"
                  }
                >
                  {label}
                </span>
              </div>
            )
          })}
        </div>
        {progressLogs.length > 0 && (
          <div className="mt-4">
            <div className="text-xs font-medium text-muted-foreground mb-2">Live Logs</div>
            <textarea
              ref={logsRef}
              readOnly
              value={progressLogs.join("\n")}
              className="w-full h-28 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs font-mono leading-relaxed resize-none"
            />
          </div>
        )}
      </div>

      <div className="grid gap-4">
        <div>
          <div className="text-sm font-medium text-foreground mb-2">Sandbox Summary</div>
          <Skeleton className="h-10 w-2/3" />
        </div>
        <div>
          <div className="text-sm font-medium text-foreground mb-2">Timing Breakdown</div>
          <Skeleton className="h-6 w-1/2" />
        </div>
        <Skeleton className="h-40 w-full" />
        <div className="grid grid-cols-2 gap-4">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
        <div>
          <div className="text-sm font-medium text-foreground mb-2">d3k Diagnostic Transcript</div>
          <Skeleton className="h-32 w-full" />
        </div>
        <div>
          <div className="text-sm font-medium text-foreground mb-2">Agent Analysis</div>
          <Skeleton className="h-32 w-full" />
        </div>
      </div>
    </div>
  )

  if (embedded) {
    return content
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8 max-w-4xl">{content}</div>
    </div>
  )
}
