import { ArrowLeft, Download } from "lucide-react"
import Image from "next/image"
import { redirect } from "next/navigation"
import { getCurrentUser } from "@/lib/auth"
import { getWorkflowRun } from "@/lib/workflow-storage"
import type { WorkflowReport } from "@/types"
import { AgentAnalysis } from "./agent-analysis"
import { CollapsibleSection } from "./collapsible-section"

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

  // Fetch the JSON report from the blob URL
  const response = await fetch(run.reportBlobUrl)
  const report: WorkflowReport = await response.json()

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

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <div className="flex items-center gap-4 mb-6">
          <a
            href="/workflows"
            className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="font-semibold">d3k</span>
          </a>
          <span className="text-muted-foreground">/</span>
          <span className="text-muted-foreground">Fix Report</span>
        </div>

        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold">{report.projectName}</h1>
            <p className="text-muted-foreground mt-1">{new Date(report.timestamp).toLocaleString()}</p>
          </div>
          <a
            href={run.reportBlobUrl}
            download
            className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
          >
            <Download className="h-4 w-4" />
            Download JSON
          </a>
        </div>

        {/* CLS Score Section */}
        {report.clsScore !== undefined && (
          <div className="bg-card border border-border rounded-lg p-6 mb-6">
            <h2 className="text-xl font-semibold mb-4">Cumulative Layout Shift (CLS)</h2>
            <div className="flex items-center gap-4 mb-4">
              <div className="text-4xl font-bold">{report.clsScore.toFixed(4)}</div>
              {report.clsGrade && (
                <span className={`px-3 py-1 rounded-full text-sm font-medium ${gradeColor(report.clsGrade)}`}>
                  {report.clsGrade}
                </span>
              )}
            </div>

            {/* Layout Shifts Details */}
            {report.layoutShifts && report.layoutShifts.length > 0 && (
              <div className="mt-4">
                <h3 className="text-sm font-medium text-muted-foreground mb-2">Layout Shift Details</h3>
                <div className="space-y-2">
                  {report.layoutShifts.map((shift, i) => (
                    <div key={`shift-${shift.timestamp}`} className="bg-muted/50 rounded p-3 text-sm">
                      <div className="flex justify-between mb-1">
                        <span className="font-medium">Shift #{i + 1}</span>
                        <span className="text-muted-foreground">score: {shift.score.toFixed(4)}</span>
                      </div>
                      {shift.elements.length > 0 && (
                        <div className="text-muted-foreground text-xs">Elements: {shift.elements.join(", ")}</div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Screenshots Section */}
        {(report.beforeScreenshotUrl || (report.clsScreenshots && report.clsScreenshots.length > 0)) && (
          <div className="bg-card border border-border rounded-lg p-6 mb-6">
            <h2 className="text-xl font-semibold mb-4">Screenshots</h2>
            <div className="flex flex-wrap gap-2">
              {report.beforeScreenshotUrl && (
                <a href={report.beforeScreenshotUrl} target="_blank" rel="noopener noreferrer" className="inline-block">
                  <Image
                    src={report.beforeScreenshotUrl}
                    alt="Before screenshot"
                    width={192}
                    height={108}
                    unoptimized
                    className="w-48 h-auto rounded border border-border hover:border-primary transition-colors cursor-pointer"
                  />
                  <span className="text-xs text-muted-foreground mt-1 block">Before</span>
                </a>
              )}
              {report.clsScreenshots?.map((screenshot) => (
                <a
                  key={`screenshot-${screenshot.timestamp}`}
                  href={screenshot.blobUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block"
                >
                  <Image
                    src={screenshot.blobUrl}
                    alt={screenshot.label || "CLS Screenshot"}
                    width={192}
                    height={108}
                    unoptimized
                    className="w-48 h-auto rounded border border-border hover:border-primary transition-colors cursor-pointer"
                  />
                  <span className="text-xs text-muted-foreground mt-1 block">{screenshot.label || "Shift"}</span>
                </a>
              ))}
            </div>
          </div>
        )}

        {/* AI Agent Analysis Section */}
        <div className="bg-card border border-border rounded-lg p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold">AI Agent Analysis</h2>
            {report.agentAnalysisModel && (
              <span className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded">
                {report.agentAnalysisModel}
              </span>
            )}
          </div>
          <AgentAnalysis content={report.agentAnalysis} />
        </div>

        {/* Git Diff Section */}
        {report.gitDiff && (
          <div className="bg-card border border-border rounded-lg p-6 mb-6">
            <h2 className="text-xl font-semibold mb-4">Changes Made</h2>
            <pre className="bg-muted/50 rounded p-4 text-xs font-mono overflow-x-auto whitespace-pre-wrap">
              {report.gitDiff}
            </pre>
          </div>
        )}

        {/* D3k Logs Section (Collapsible) */}
        {report.d3kLogs && (
          <CollapsibleSection title="d3k Debug Logs" defaultOpen={false}>
            <pre className="bg-muted/50 rounded p-4 text-xs font-mono overflow-x-auto whitespace-pre-wrap max-h-96 overflow-y-auto">
              {report.d3kLogs}
            </pre>
          </CollapsibleSection>
        )}

        {/* Sandbox Info */}
        {(report.sandboxDevUrl || report.sandboxMcpUrl) && (
          <div className="bg-card border border-border rounded-lg p-6 mb-6">
            <h2 className="text-xl font-semibold mb-4">Sandbox Details</h2>
            <dl className="space-y-2 text-sm">
              {report.sandboxDevUrl && (
                <div className="flex gap-2">
                  <dt className="text-muted-foreground w-24">Dev URL:</dt>
                  <dd className="font-mono text-xs">{report.sandboxDevUrl}</dd>
                </div>
              )}
              {report.sandboxMcpUrl && (
                <div className="flex gap-2">
                  <dt className="text-muted-foreground w-24">MCP URL:</dt>
                  <dd className="font-mono text-xs">{report.sandboxMcpUrl}</dd>
                </div>
              )}
            </dl>
          </div>
        )}

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
