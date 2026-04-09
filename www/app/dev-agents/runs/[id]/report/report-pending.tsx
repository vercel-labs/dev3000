"use client"

import { AlertCircle, CheckCircle2 } from "lucide-react"
import { useRouter } from "next/navigation"
import { useEffect, useRef, useState } from "react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { CoordinatedPlayers } from "./coordinated-players"
import { ScreenshotPlayer } from "./screenshot-player"

interface ReportPendingProps {
  runId: string
  userId?: string
  workflowType?: string
  projectName?: string
  devAgentName?: string
  runnerKind?: "dev-agent" | "skill-runner"
  embedded?: boolean
}

interface Screenshot {
  timestamp: number
  blobUrl: string
  label?: string
}

const STEP_LABELS = [
  "Creating or reusing ASH app",
  "Creating sandbox",
  "Capturing baseline",
  "Agent in progress",
  "Generating report",
  "Finishing up"
]
const PROGRESS_LOG_DELIMITER = "||"

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

function parseProgressLogLine(value: string): { timestamp: string | null; message: string } {
  const sanitized = sanitizeDisplayText(value)
  const delimiterIndex = sanitized.indexOf(PROGRESS_LOG_DELIMITER)
  if (delimiterIndex > 0) {
    const timestamp = sanitized.slice(0, delimiterIndex).trim()
    const message = sanitized.slice(delimiterIndex + PROGRESS_LOG_DELIMITER.length).trim()
    if (timestamp && message) {
      return { timestamp, message }
    }
  }

  return { timestamp: null, message: sanitized }
}

function formatProgressTimestamp(value: string | null): string | null {
  if (!value) return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(parsed)
}

function normalizeStepNumber(stepNumber: number | null): number | null {
  if (stepNumber === null) return null
  if (stepNumber >= 0 && stepNumber < STEP_LABELS.length) return stepNumber
  if (stepNumber >= 1 && stepNumber < STEP_LABELS.length) return stepNumber
  if (stepNumber === STEP_LABELS.length) return STEP_LABELS.length - 1
  return null
}

function getPendingReportLabel(
  workflowType?: string,
  devAgentName?: string,
  runnerKind: "dev-agent" | "skill-runner" = "dev-agent"
) {
  if (runnerKind === "skill-runner") return "Skill Run Report"
  if (devAgentName?.trim()) return `${devAgentName.trim()} Dev Agent Report`
  if (workflowType === "turbopack-bundle-analyzer") return "Turbopack Bundle Analyzer Report"
  if (workflowType === "design-guidelines") return "Design Guidelines Report"
  if (workflowType === "react-performance") return "React Performance Report"
  if (workflowType === "url-audit") return "URL Audit Report"
  if (workflowType === "prompt") return "Custom Prompt Report"
  return "Dev Agent Report"
}

function getLegacyWorkflowLabel(workflowType?: string, runnerKind: "dev-agent" | "skill-runner" = "dev-agent") {
  if (runnerKind === "skill-runner") return "Skill Runner"
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
  runnerKind = "dev-agent",
  embedded = false
}: ReportPendingProps) {
  const router = useRouter()
  const [status, setStatus] = useState<string>("Creating sandbox...")
  const [hasError, setHasError] = useState(false)
  const [sandboxUrl, setSandboxUrl] = useState<string | null>(null)
  const [stepNumber, setStepNumber] = useState<number | null>(null)
  const [progressLogs, setProgressLogs] = useState<string[]>([])
  const [beforeScreenshots, setBeforeScreenshots] = useState<Screenshot[]>([])
  const [afterScreenshots, setAfterScreenshots] = useState<Screenshot[]>([])
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
            beforeScreenshots?: Screenshot[]
            afterScreenshots?: Screenshot[]
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
          setBeforeScreenshots(Array.isArray(run.beforeScreenshots) ? run.beforeScreenshots : [])
          setAfterScreenshots(Array.isArray(run.afterScreenshots) ? run.afterScreenshots : [])
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
  const workflowLabel = devAgentName?.trim() || getLegacyWorkflowLabel(workflowType, runnerKind)
  const pendingLabel = getPendingReportLabel(workflowType, devAgentName, runnerKind)
  const pendingReportTitle =
    runnerKind === "skill-runner" ? `Run Report: ${workflowLabel}` : `Run Report: ${workflowLabel} Dev Agent`
  const formattedProgressLogs = progressLogs.map((line) => {
    const parsed = parseProgressLogLine(line)
    const formattedTimestamp = formatProgressTimestamp(parsed.timestamp)
    return formattedTimestamp ? `[${formattedTimestamp}] ${parsed.message}` : parsed.message
  })
  const hasScreenshots = beforeScreenshots.length > 0 || afterScreenshots.length > 0
  const shouldExpandLogs = !hasError && !hasScreenshots && progressLogs.length > 0

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

      {hasError ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{statusText}</AlertDescription>
        </Alert>
      ) : null}

      <div
        className={`bg-card border border-border rounded-lg p-4 ${shouldExpandLogs ? "flex min-h-[calc(100vh-240px)] flex-col" : ""}`}
      >
        <div className="text-sm font-medium text-foreground mb-3">Progress</div>
        {sandboxUrl && !hasError && (
          <div className="mb-3 text-xs text-muted-foreground">
            <span className="font-medium">Sandbox:</span>{" "}
            <a href={sandboxUrl} target="_blank" rel="noopener noreferrer" className="font-mono hover:underline">
              {sandboxUrl}
            </a>
          </div>
        )}
        {!hasError && showStatus ? <div className="mb-3 text-xs text-muted-foreground">{statusText}</div> : null}
        <div className="space-y-2">
          {STEP_LABELS.map((label, index) => {
            const isDone = activeIndex !== null && index < activeIndex
            const isActive = activeIndex !== null && index === activeIndex
            return (
              <div key={label} className="flex items-center gap-3 text-sm">
                {isDone ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-foreground/80" />
                ) : (
                  <span className={`h-2.5 w-2.5 rounded-full ${isActive ? "bg-blue-500" : "bg-muted"}`} />
                )}
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
          <div className={`mt-4 ${shouldExpandLogs ? "flex min-h-0 flex-1 flex-col" : ""}`}>
            <div className="text-xs font-medium text-muted-foreground mb-2">Live Logs</div>
            <textarea
              ref={logsRef}
              readOnly
              value={formattedProgressLogs.join("\n")}
              className={`w-full rounded-md border border-border bg-muted/30 px-3 py-2 text-xs font-mono leading-relaxed resize-none ${
                shouldExpandLogs ? "min-h-[320px] flex-1" : "h-28"
              }`}
            />
          </div>
        )}
      </div>

      {hasScreenshots ? (
        <div className="space-y-3">
          <div className="text-sm font-medium text-foreground">Screenshots</div>
          {beforeScreenshots.length > 0 && afterScreenshots.length > 0 ? (
            <CoordinatedPlayers
              beforeScreenshots={beforeScreenshots}
              afterScreenshots={afterScreenshots}
              fps={2}
              loopDelayMs={10000}
            />
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {beforeScreenshots.length > 0 ? (
                <ScreenshotPlayer screenshots={beforeScreenshots} title="Before" autoPlay={true} fps={2} loop={true} />
              ) : null}
              {afterScreenshots.length > 0 ? (
                <ScreenshotPlayer screenshots={afterScreenshots} title="After" autoPlay={true} fps={2} loop={true} />
              ) : null}
            </div>
          )}
        </div>
      ) : null}
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
