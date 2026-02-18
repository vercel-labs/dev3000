"use client"

import { ChevronDown, ChevronRight, Download } from "lucide-react"
import { type ReactNode, useMemo, useState } from "react"
import { Streamdown } from "streamdown"

interface ParsedStep {
  stepNumber: number
  assistantText?: string
  toolCalls: Array<{
    name: string
    args: string
    result: string
  }>
  hasContent: boolean // True if step has meaningful content (non-empty results)
}

interface ParsedTranscript {
  systemPrompt?: string
  userPrompt?: string
  steps: ParsedStep[]
  finalOutput?: string
}

function normalizeReportMarkdown(text: string): string {
  return text.replace(/(^|\n)(\d+)\.\s*\n+\s*(?![-*]\s)(?!\d+\.\s)([^\n]+?)(?=\n|$)/g, "$1$2. $3")
}

/**
 * Parse the agent transcript markdown into structured data
 */
function parseTranscript(content: string): ParsedTranscript {
  const result: ParsedTranscript = {
    steps: []
  }

  // Extract system prompt
  const systemMatch = content.match(/## System Prompt\n```\n([\s\S]*?)\n```/)
  if (systemMatch) {
    result.systemPrompt = systemMatch[1]
  }

  // Extract user prompt
  const userMatch = content.match(/## User Prompt\n```\n([\s\S]*?)\n```/)
  if (userMatch) {
    result.userPrompt = userMatch[1]
  }

  // Extract final output (after "## Final Output")
  const finalMatch = content.match(/## Final Output\n\n([\s\S]*)$/)
  if (finalMatch) {
    result.finalOutput = finalMatch[1]
  }

  // Extract steps
  const stepRegex = /### Step (\d+)\n([\s\S]*?)(?=### Step \d+|## Final Output|$)/g
  const stepMatches = [...content.matchAll(stepRegex)]

  for (const stepMatch of stepMatches) {
    const stepNumber = parseInt(stepMatch[1], 10)
    const stepContent = stepMatch[2]

    const step: ParsedStep = {
      stepNumber,
      toolCalls: [],
      hasContent: false
    }

    // Extract assistant text
    const assistantMatch = stepContent.match(/\*\*Assistant:\*\*\n([\s\S]*?)(?=\*\*Tool Call:|$)/)
    if (assistantMatch) {
      step.assistantText = assistantMatch[1].trim()
      if (step.assistantText && step.assistantText.length > 10) {
        step.hasContent = true
      }
    }

    // Extract tool calls and results
    const toolCallRegex = /\*\*Tool Call: (\w+)\*\*\n```json\n([\s\S]*?)\n```/g
    const toolResultRegex = /\*\*Tool Result:\*\*\n```\n([\s\S]*?)\n```/g

    const toolCallMatches = [...stepContent.matchAll(toolCallRegex)]
    const toolResultMatches = [...stepContent.matchAll(toolResultRegex)]

    for (let i = 0; i < toolCallMatches.length; i++) {
      const tcMatch = toolCallMatches[i]
      const trMatch = toolResultMatches[i]

      const toolCall = {
        name: tcMatch[1],
        args: tcMatch[2].trim(),
        result: trMatch ? trMatch[1].trim() : ""
      }

      step.toolCalls.push(toolCall)

      // Check if result has meaningful content
      if (
        toolCall.result &&
        toolCall.result !== "[undefined]" &&
        toolCall.result !== "{}" &&
        toolCall.result !== "null" &&
        toolCall.result.length > 5
      ) {
        step.hasContent = true
      }
    }

    result.steps.push(step)
  }

  return result
}

/**
 * Collapsible section for steps
 */
function StepSection({
  title,
  children,
  defaultOpen = false,
  badge,
  headerAction
}: {
  title: string
  children: ReactNode
  defaultOpen?: boolean
  badge?: string
  headerAction?: ReactNode
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen)

  return (
    <div className="border border-border rounded mb-2">
      <div className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-muted/50 transition-colors text-sm">
        <button type="button" onClick={() => setIsOpen(!isOpen)} className="flex items-center gap-2 flex-1">
          {isOpen ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
          <span className="font-medium">{title}</span>
        </button>
        <div className="flex items-center gap-2">
          {headerAction}
          {badge && <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">{badge}</span>}
        </div>
      </div>
      {isOpen && <div className="px-3 pb-3 border-t border-border">{children}</div>}
    </div>
  )
}

/**
 * Git Diff section with collapsible diff and download link in title bar
 */
function DiffSection({ gitDiff, projectName }: { gitDiff: string; projectName: string }) {
  const handleDownload = (e: React.MouseEvent) => {
    e.stopPropagation() // Prevent collapsible toggle
    const cleanName = projectName.replace(/[^a-zA-Z0-9-_]/g, "-").toLowerCase()
    const filename = `d3k-fix-${cleanName}.diff`
    const blob = new Blob([gitDiff], { type: "text/plain" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  return (
    <StepSection
      title="View Diff"
      headerAction={
        <button
          type="button"
          onClick={handleDownload}
          className="inline-flex items-center justify-center p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors"
          title="Download .diff file"
        >
          <Download className="h-4 w-4" />
        </button>
      }
    >
      <pre className="mt-2 text-xs bg-muted/50 p-2 rounded overflow-x-auto whitespace-pre-wrap max-h-96 overflow-y-auto">
        {gitDiff}
      </pre>
    </StepSection>
  )
}

export function AgentAnalysis({
  content,
  gitDiff,
  projectName
}: {
  content: string
  gitDiff?: string
  projectName?: string
}) {
  const parsed = useMemo(() => parseTranscript(content), [content])

  // Strip "## Git Diff" section from finalOutput if present (we'll show it separately)
  const cleanedFinalOutput = useMemo(() => {
    if (!parsed.finalOutput) return undefined
    // Remove ## Git Diff section and everything after it (the diff block)
    const withoutDiff = parsed.finalOutput.replace(/## Git Diff[\s\S]*$/, "").trim()
    // Normalize list formatting from model output like:
    // "1.\n\nTitle" or "1.\n\n**Title**" -> "1. Title"
    return normalizeReportMarkdown(withoutDiff)
  }, [parsed.finalOutput])

  const normalizedRawContent = useMemo(() => normalizeReportMarkdown(content), [content])

  const analysisClassName =
    "prose prose-sm dark:prose-invert max-w-none prose-p:my-2 prose-ol:my-3 prose-ul:my-2 prose-li:my-1 [&_ol]:!list-outside [&_ul]:!list-outside [&_ol]:!pl-7 [&_ul]:!pl-7 [&_ol>li]:pl-0 [&_ul>li]:pl-0 [&_li>p]:inline [&_li>p]:my-0"

  // If we couldn't parse the transcript structure, fall back to raw rendering
  if (!parsed.finalOutput && parsed.steps.length === 0) {
    return (
      <div className={analysisClassName}>
        <Streamdown mode="static">{normalizedRawContent}</Streamdown>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Git Diff - shown with download link in title bar */}
      {gitDiff && <DiffSection gitDiff={gitDiff} projectName={projectName || "project"} />}

      {/* Final Output - shown prominently at the top (with Git Diff section stripped) */}
      {cleanedFinalOutput && (
        <div className={analysisClassName}>
          <Streamdown mode="static">{cleanedFinalOutput}</Streamdown>
        </div>
      )}

      {/* Parsed execution trace */}
      {parsed.steps.length > 0 && (
        <StepSection title="Agent Transcript" badge={`${parsed.steps.length} steps`}>
          <div className="space-y-4 mt-2">
            {parsed.steps.map((step) => (
              <div key={`step-${step.stepNumber}`} className="border-b border-border pb-4 last:border-b-0 last:pb-0">
                <div className="text-sm font-medium mb-2">
                  Step {step.stepNumber}
                  <span className="text-xs text-muted-foreground ml-2">({step.toolCalls.length} tools)</span>
                </div>

                <div className="space-y-3">
                  {step.assistantText && (
                    <div>
                      <div className="text-xs font-medium text-muted-foreground mb-1">Assistant</div>
                      <div className={analysisClassName}>
                        <Streamdown mode="static">{normalizeReportMarkdown(step.assistantText)}</Streamdown>
                      </div>
                    </div>
                  )}

                  {step.toolCalls.map((toolCall, idx) => (
                    <div key={`step-${step.stepNumber}-tool-${idx}`} className="border border-border rounded p-2">
                      <div className="text-xs font-medium text-muted-foreground mb-1">Tool: {toolCall.name}</div>
                      <pre className="text-xs bg-muted/50 p-2 rounded overflow-x-auto whitespace-pre-wrap max-h-40 overflow-y-auto">
                        {toolCall.args || "{}"}
                      </pre>
                      {toolCall.result && (
                        <>
                          <div className="text-xs font-medium text-muted-foreground mt-2 mb-1">Result</div>
                          <pre className="text-xs bg-muted/50 p-2 rounded overflow-x-auto whitespace-pre-wrap max-h-64 overflow-y-auto">
                            {toolCall.result}
                          </pre>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </StepSection>
      )}
    </div>
  )
}
