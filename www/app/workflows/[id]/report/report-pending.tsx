"use client"

import { AlertCircle, ArrowLeft } from "lucide-react"
import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Skeleton } from "@/components/ui/skeleton"

interface ReportPendingProps {
  runId: string
  userId?: string
}

const STEP_LABELS = ["Creating sandbox", "Capturing baseline", "Agent in progress", "Generating report", "Finishing up"]

function normalizeStepNumber(stepNumber: number | null): number | null {
  if (stepNumber === null) return null
  if (stepNumber >= 1 && stepNumber <= STEP_LABELS.length) return stepNumber - 1
  if (stepNumber >= 0 && stepNumber < STEP_LABELS.length) return stepNumber
  return null
}

export function ReportPending({ runId, userId }: ReportPendingProps) {
  const router = useRouter()
  const [status, setStatus] = useState<string>("Creating sandbox...")
  const [hasError, setHasError] = useState(false)
  const [sandboxUrl, setSandboxUrl] = useState<string | null>(null)
  const [stepNumber, setStepNumber] = useState<number | null>(null)
  const [progressLogs, setProgressLogs] = useState<string[]>([])

  useEffect(() => {
    let isActive = true

    const poll = async () => {
      if (!userId) {
        router.refresh()
        return
      }

      try {
        const response = await fetch(`/api/workflows?userId=${userId}`)
        if (!response.ok) {
          throw new Error(`Failed to load workflow status (${response.status})`)
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
          throw new Error("Invalid workflow status response")
        }

        const run = data.runs.find((item) => item.id === runId)
        if (!run) {
          return
        }

        if (run.status === "failure") {
          if (isActive) {
            setHasError(true)
            setStatus(run.error || "Workflow failed to generate report.")
          }
          return
        }

        if (run.reportBlobUrl && run.status === "done") {
          router.refresh()
          return
        }

        if (isActive) {
          setHasError(false)
          setStatus(run.currentStep || "Generating report...")
          setStepNumber(typeof run.stepNumber === "number" ? run.stepNumber : null)
          setSandboxUrl(run.sandboxUrl || null)
          setProgressLogs(Array.isArray(run.progressLogs) ? run.progressLogs : [])
        }
      } catch (error) {
        if (!isActive) return
        setHasError(true)
        setStatus(error instanceof Error ? error.message : "Unable to load workflow status.")
      }
    }

    const interval = setInterval(poll, 5000)
    poll()

    return () => {
      isActive = false
      clearInterval(interval)
    }
  }, [runId, userId, router])

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

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8 max-w-4xl space-y-6">
        <div className="flex items-center gap-4">
          <a
            href="/workflows"
            className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="font-semibold">d3k</span>
          </a>
          <span className="text-muted-foreground">/</span>
          <span className="text-muted-foreground">Workflow Report</span>
        </div>

        <div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Workflow Report</div>
          <h1 className="text-3xl font-bold mt-2">d3k Workflow Report</h1>
          <p className="text-muted-foreground mt-1">
            We&apos;re assembling the results and will show them here shortly.
          </p>
        </div>

        <Alert
          variant={hasError ? "destructive" : "default"}
          className={hasError ? "" : "bg-blue-50 border-blue-200 dark:bg-blue-950 dark:border-blue-800"}
        >
          {hasError && <AlertCircle className="h-4 w-4" />}
          <AlertDescription className={hasError ? "" : "text-blue-900 dark:text-blue-100"}>
            {statusText}
          </AlertDescription>
        </Alert>

        {sandboxUrl && !hasError && (
          <Alert className="bg-yellow-50 border-yellow-200 dark:bg-yellow-950 dark:border-yellow-800">
            <AlertDescription className="text-yellow-900 dark:text-yellow-100">
              <span className="font-medium">Sandbox:</span>{" "}
              <a
                href={sandboxUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:underline font-mono text-sm"
              >
                {sandboxUrl}
              </a>
            </AlertDescription>
          </Alert>
        )}

        <div className="bg-card border border-border rounded-lg p-4">
          <div className="text-sm font-medium text-foreground mb-3">Progress</div>
          <div className="space-y-2">
            {STEP_LABELS.map((label, index) => {
              const isDone = activeIndex !== null && index < activeIndex
              const isActive = activeIndex !== null && index === activeIndex
              return (
                <div key={label} className="flex items-center gap-3 text-sm">
                  <span
                    className={`h-2.5 w-2.5 rounded-full ${
                      isDone ? "bg-green-500" : isActive ? "bg-blue-500" : "bg-muted"
                    }`}
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
    </div>
  )
}
