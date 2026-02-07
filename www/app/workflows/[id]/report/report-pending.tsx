"use client"

import { AlertCircle } from "lucide-react"
import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Skeleton } from "@/components/ui/skeleton"

interface ReportPendingProps {
  runId: string
  userId?: string
  projectName?: string
}

const STEP_LABELS = ["Creating sandbox", "Capturing baseline", "Agent in progress", "Generating report", "Finishing up"]

export function ReportPending({ runId, userId, projectName }: ReportPendingProps) {
  const router = useRouter()
  const [status, setStatus] = useState<string>("Generating report...")
  const [hasError, setHasError] = useState(false)
  const [sandboxUrl, setSandboxUrl] = useState<string | null>(null)
  const [stepNumber, setStepNumber] = useState<number | null>(null)

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

  const activeStepLabel = typeof stepNumber === "number" ? STEP_LABELS[stepNumber] : null
  const showStatus = !activeStepLabel || status.trim() !== activeStepLabel
  const statusText = showStatus ? status : "In progress..."

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8 max-w-4xl space-y-6">
        <div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Workflow Report</div>
          <h1 className="text-3xl font-bold mt-2">{projectName || "Preparing your report"}</h1>
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
              const isDone = stepNumber !== null && index < stepNumber
              const isActive = stepNumber !== null && index === stepNumber
              return (
                <div key={label} className="flex items-center gap-3 text-sm">
                  <span
                    className={`h-2.5 w-2.5 rounded-full ${
                      isDone ? "bg-green-500" : isActive ? "bg-blue-500" : "bg-muted"
                    }`}
                  />
                  <span className={isActive ? "text-foreground font-medium" : "text-muted-foreground"}>{label}</span>
                </div>
              )
            })}
          </div>
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
