import { Download } from "lucide-react"
import { redirect } from "next/navigation"
import { Streamdown } from "streamdown"
import { getCurrentUser } from "@/lib/auth"
import { getWorkflowRun } from "@/lib/workflow-storage"

export default async function WorkflowReportPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  const { id } = await params

  if (!user) {
    redirect("/signin")
  }

  const run = await getWorkflowRun(user.id, id)

  if (!run || !run.reportBlobUrl) {
    redirect("/workflows")
  }

  // Fetch the markdown report from the blob URL
  const response = await fetch(run.reportBlobUrl)
  const markdown = await response.text()

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold">Fix Report</h1>
            <p className="text-muted-foreground mt-1">
              {run.projectName} • {new Date(run.timestamp).toLocaleString()}
            </p>
          </div>
          <a
            href={run.reportBlobUrl}
            download
            className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
          >
            <Download className="h-4 w-4" />
            Download
          </a>
        </div>

        <div className="bg-card border border-border rounded-lg p-8">
          <Streamdown mode="static">
            {markdown}
          </Streamdown>
        </div>

        <div className="mt-6 flex gap-4">
          <a href="/workflows" className="px-4 py-2 border border-border rounded-md hover:bg-muted transition-colors">
            ← Back to Workflows
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
