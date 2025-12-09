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

        <div className="flex items-center justify-between mb-4">
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

        {/* Sandbox Info (at top, always visible) */}
        {(report.sandboxDevUrl || report.sandboxMcpUrl) && (
          <div className="text-sm text-muted-foreground mb-6">
            <ul className="flex flex-wrap gap-x-6 gap-y-1">
              {report.sandboxDevUrl && (
                <li>
                  <span className="text-muted-foreground">Dev: </span>
                  <a
                    href={report.sandboxDevUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-xs hover:underline"
                  >
                    {report.sandboxDevUrl}
                  </a>
                </li>
              )}
              {report.sandboxMcpUrl && (
                <li>
                  <span className="text-muted-foreground">MCP: </span>
                  <a
                    href={report.sandboxMcpUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-xs hover:underline"
                  >
                    {report.sandboxMcpUrl}
                  </a>
                </li>
              )}
            </ul>
          </div>
        )}

        {/* CLS Score Section - Before/After Comparison */}
        {report.clsScore !== undefined && (
          <div className="bg-card border border-border rounded-lg p-6 mb-6">
            <h2 className="text-xl font-semibold mb-4">Cumulative Layout Shift (CLS)</h2>

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
                      ? `CLS reduced by ${(((report.clsScore - report.afterClsScore) / report.clsScore) * 100).toFixed(0)}%`
                      : report.verificationStatus === "degraded"
                        ? `CLS increased by ${(((report.afterClsScore - report.clsScore) / report.clsScore) * 100).toFixed(0)}%`
                        : "The fix did not significantly impact CLS score"}
                  </p>
                </div>

                {/* Before / After Comparison */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="text-center p-4 bg-muted/30 rounded-lg">
                    <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Before</div>
                    <div className="text-3xl font-bold">{report.clsScore.toFixed(4)}</div>
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
                    <div className="text-3xl font-bold">{report.afterClsScore.toFixed(4)}</div>
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
                <div className="text-4xl font-bold">{report.clsScore.toFixed(4)}</div>
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

            {/* Screenshots embedded in CLS section */}
            {(report.beforeScreenshotUrl ||
              report.afterScreenshotUrl ||
              (report.clsScreenshots && report.clsScreenshots.length > 0)) && (
              <div className="mt-6 pt-4 border-t border-border">
                <h3 className="text-sm font-medium text-muted-foreground mb-3">Screenshots</h3>

                {/* Before/After comparison if we have both */}
                {report.beforeScreenshotUrl && report.afterScreenshotUrl ? (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <div className="text-xs text-muted-foreground uppercase tracking-wide mb-2">Before Fix</div>
                        <a href={report.beforeScreenshotUrl} target="_blank" rel="noopener noreferrer">
                          <Image
                            src={report.beforeScreenshotUrl}
                            alt="Before fix screenshot"
                            width={400}
                            height={225}
                            unoptimized
                            className="w-full h-auto rounded border border-border hover:border-primary transition-colors cursor-pointer"
                          />
                        </a>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground uppercase tracking-wide mb-2">After Fix</div>
                        <a href={report.afterScreenshotUrl} target="_blank" rel="noopener noreferrer">
                          <Image
                            src={report.afterScreenshotUrl}
                            alt="After fix screenshot"
                            width={400}
                            height={225}
                            unoptimized
                            className="w-full h-auto rounded border border-border hover:border-primary transition-colors cursor-pointer"
                          />
                        </a>
                      </div>
                    </div>

                    {/* CLS timeline screenshots if available */}
                    {report.clsScreenshots && report.clsScreenshots.length > 0 && (
                      <CollapsibleSection title="CLS Timeline Screenshots" defaultOpen={false}>
                        <div className="flex flex-wrap gap-2 mt-2">
                          {report.clsScreenshots.map((screenshot) => (
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
                              <span className="text-xs text-muted-foreground mt-1 block">
                                {screenshot.label || "Shift"}
                              </span>
                            </a>
                          ))}
                        </div>
                      </CollapsibleSection>
                    )}
                  </div>
                ) : (
                  /* Original layout if we don't have both before/after */
                  <div className="flex flex-wrap gap-2">
                    {report.beforeScreenshotUrl && (
                      <a
                        href={report.beforeScreenshotUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-block"
                      >
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
                    {report.afterScreenshotUrl && (
                      <a
                        href={report.afterScreenshotUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-block"
                      >
                        <Image
                          src={report.afterScreenshotUrl}
                          alt="After screenshot"
                          width={192}
                          height={108}
                          unoptimized
                          className="w-48 h-auto rounded border border-border hover:border-primary transition-colors cursor-pointer"
                        />
                        <span className="text-xs text-muted-foreground mt-1 block">After</span>
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
                )}
              </div>
            )}
          </div>
        )}

        {/* d3k Agent Analysis Section */}
        <div className="bg-card border border-border rounded-lg p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold">d3k Agent Analysis</h2>
            {report.agentAnalysisModel && (
              <span className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded">
                {report.agentAnalysisModel}
              </span>
            )}
          </div>
          <AgentAnalysis content={report.agentAnalysis} gitDiff={report.gitDiff} projectName={report.projectName} />
        </div>

        {/* D3k Logs Section (Collapsible) */}
        {report.d3kLogs && (
          <CollapsibleSection title="d3k Debug Logs" defaultOpen={false}>
            <pre className="bg-muted/50 rounded p-4 text-xs font-mono overflow-x-auto whitespace-pre-wrap max-h-96 overflow-y-auto">
              {report.d3kLogs}
            </pre>
          </CollapsibleSection>
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
