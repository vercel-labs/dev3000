"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { AlertCircle } from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Skeleton } from "@/components/ui/skeleton"

interface ReportPendingProps {
  runId: string
  userId?: string
  projectName?: string
}

export function ReportPending({ runId, userId, projectName }: ReportPendingProps) {
  const router = useRouter()
  const [status, setStatus] = useState<string>("Generating report...")
  const [hasError, setHasError] = useState(false)

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

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8 max-w-4xl space-y-6">
        <div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Workflow Report</div>
          <h1 className="text-3xl font-bold mt-2">{projectName || "Preparing your report"}</h1>
          <p className="text-muted-foreground mt-1">We&apos;re assembling the results and will show them here shortly.</p>
        </div>

        <Alert
          variant={hasError ? "destructive" : "default"}
          className={hasError ? "" : "bg-blue-50 border-blue-200 dark:bg-blue-950 dark:border-blue-800"}
        >
          {hasError && <AlertCircle className="h-4 w-4" />}
          <AlertDescription className={hasError ? "" : "text-blue-900 dark:text-blue-100"}>{status}</AlertDescription>
        </Alert>

        <div className="grid gap-4">
          <Skeleton className="h-10 w-2/3" />
          <Skeleton className="h-6 w-1/2" />
          <Skeleton className="h-40 w-full" />
          <div className="grid grid-cols-2 gap-4">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
          <Skeleton className="h-32 w-full" />
        </div>
      </div>
    </div>
  )
}
