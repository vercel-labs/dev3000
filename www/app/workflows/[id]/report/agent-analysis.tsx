"use client"

import { ChevronDown, ChevronRight } from "lucide-react"
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

/**
 * Simplify tool names for display
 */
function formatToolName(name: string): string {
  const toolNameMap: Record<string, string> = {
    grepSearch: "grep",
    globSearch: "glob",
    listDirectory: "ls",
    readFile: "read",
    writeFile: "write",
    findComponentSource: "find-component",
    getGitDiff: "git-diff"
  }
  return toolNameMap[name] || name
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
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-muted/50 transition-colors text-sm"
      >
        <div className="flex items-center gap-2">
          {isOpen ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
          <span className="font-medium">{title}</span>
        </div>
        <div className="flex items-center gap-2">
          {headerAction}
          {badge && <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">{badge}</span>}
        </div>
      </button>
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
          className="text-xs text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 hover:underline"
        >
          download .diff
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
    return parsed.finalOutput.replace(/## Git Diff[\s\S]*$/, "").trim()
  }, [parsed.finalOutput])

  // If we couldn't parse the transcript structure, fall back to raw rendering
  if (!parsed.finalOutput && parsed.steps.length === 0) {
    return <Streamdown mode="static">{content}</Streamdown>
  }

  // Count steps with meaningful content
  const stepsWithContent = parsed.steps.filter((s) => s.hasContent)
  const emptySteps = parsed.steps.length - stepsWithContent.length

  return (
    <div className="space-y-4">
      {/* Final Output - shown prominently at the top (with Git Diff section stripped) */}
      {cleanedFinalOutput && (
        <div className="prose prose-sm dark:prose-invert max-w-none">
          <Streamdown mode="static">{cleanedFinalOutput}</Streamdown>
        </div>
      )}

      {/* Git Diff - shown with download link in title bar */}
      {gitDiff && (
        <div className="mt-4 pt-4 border-t border-border">
          <DiffSection gitDiff={gitDiff} projectName={projectName || "project"} />
        </div>
      )}

      {/* Collapsible Agent Execution Details */}
      {parsed.steps.length > 0 && (
        <StepSection
          title="Agent Execution Transcript"
          badge={`${stepsWithContent.length} steps${emptySteps > 0 ? ` (${emptySteps} empty)` : ""}`}
        >
          <div className="mt-3 space-y-3">
            {/* System Prompt - collapsed */}
            {parsed.systemPrompt && (
              <StepSection title="System Prompt">
                <pre className="mt-2 text-xs bg-muted/50 p-2 rounded overflow-x-auto whitespace-pre-wrap max-h-48 overflow-y-auto">
                  {parsed.systemPrompt}
                </pre>
              </StepSection>
            )}

            {/* User Prompt - collapsed */}
            {parsed.userPrompt && (
              <StepSection title="User Prompt">
                <pre className="mt-2 text-xs bg-muted/50 p-2 rounded overflow-x-auto whitespace-pre-wrap max-h-48 overflow-y-auto">
                  {parsed.userPrompt}
                </pre>
              </StepSection>
            )}

            {/* Steps - filter out empty ones or collapse them */}
            {stepsWithContent.map((step) => {
              // Determine badge: tool names if has tools, "conclusion" if final step with just text
              const isLastStep = step.stepNumber === Math.max(...stepsWithContent.map((s) => s.stepNumber))
              const badge =
                step.toolCalls.length > 0
                  ? step.toolCalls.map((tc) => formatToolName(tc.name)).join(", ")
                  : isLastStep && step.assistantText
                    ? "conclusion"
                    : undefined

              return (
                <StepSection key={step.stepNumber} title={`Step ${step.stepNumber}`} badge={badge}>
                  <div className="mt-2 space-y-2">
                    {step.assistantText && (
                      <div className="text-sm prose prose-sm dark:prose-invert max-w-none">
                        <Streamdown mode="static">{step.assistantText}</Streamdown>
                      </div>
                    )}
                    {step.toolCalls.map((tc, i) => (
                      <div key={`tc-${step.stepNumber}-${i}`} className="text-xs space-y-1">
                        <div className="font-medium text-muted-foreground">
                          Tool: <span className="text-foreground">{formatToolName(tc.name)}</span>
                        </div>
                        {tc.args && tc.args !== "{}" && (
                          <pre className="bg-muted/50 p-2 rounded overflow-x-auto">{tc.args}</pre>
                        )}
                        {tc.result && tc.result !== "[undefined]" && (
                          <pre className="bg-muted/50 p-2 rounded overflow-x-auto whitespace-pre-wrap max-h-32 overflow-y-auto">
                            {tc.result}
                          </pre>
                        )}
                      </div>
                    ))}
                  </div>
                </StepSection>
              )
            })}

            {/* Summary of empty steps */}
            {emptySteps > 0 && (
              <p className="text-xs text-muted-foreground italic">
                {emptySteps} step{emptySteps > 1 ? "s" : ""} with empty or undefined results hidden
              </p>
            )}
          </div>
        </StepSection>
      )}
    </div>
  )
}
