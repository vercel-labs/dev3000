"use client"

import { ComarkClient } from "@comark/react"
import security from "@comark/react/plugins/security"
import { textContent, visit } from "@comark/react/utils"
import { ChevronDown, ChevronRight } from "lucide-react"
import { type ComponentProps, type ReactNode, useMemo, useState } from "react"
import { cn } from "@/lib/utils"

type ComarkVisitNode = Parameters<Parameters<typeof visit>[2]>[0]
type ComarkElementNode = [string, Record<string, unknown>, ...ComarkVisitNode[]]
type ComarkTree = Parameters<typeof visit>[0]

const SAFE_REPORT_HTML_TAGS = new Set(["br"])
const DROP_REPORT_HTML_TAGS = new Set(["iframe", "object", "script", "style"])
const COMARK_OPTIONS = { html: true } as const
const COMARK_PLUGINS = [
  {
    name: "safe-report-html",
    post(state: { tree: ComarkTree }) {
      visit(state.tree, isHtmlElementNode, (node) => {
        if (!isHtmlElementNode(node)) {
          return
        }

        const tag = node[0].toLowerCase()

        if (SAFE_REPORT_HTML_TAGS.has(tag)) {
          return node
        }

        if (DROP_REPORT_HTML_TAGS.has(tag)) {
          return false
        }

        return textContent(node)
      })
    }
  },
  security({
    allowedProtocols: ["http", "https", "mailto", "tel"],
    allowDataImages: false,
    blockedTags: ["iframe", "object", "script", "style"]
  })
]

function isHtmlElementNode(node: ComarkVisitNode): node is ComarkElementNode {
  if (!Array.isArray(node) || typeof node[0] !== "string") {
    return false
  }

  const attributes = node[1]
  const metadata = attributes?.$

  return (
    typeof metadata === "object" &&
    metadata !== null &&
    "html" in metadata &&
    (metadata as { html?: unknown }).html === 1
  )
}

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

type TranscriptPhase = "analysis" | "changes" | "verification"

function normalizeReportMarkdown(text: string): string {
  return text.replace(/(^|\n)(\d+)\.\s*\n+\s*(?![-*]\s)(?!\d+\.\s)([^\n]+?)(?=\n|$)/g, "$1$2. $3")
}

function splitMarkdownTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "")
  return trimmed.split("|").map((cell) => cell.trim())
}

function isMarkdownTableDivider(line: string): boolean {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line)
}

function normalizeMarkdownTableHeaderCell(cell: string): string {
  return cell.replace(/[`*_]/g, "").replace(/\s+/g, " ").trim().toLowerCase()
}

function hasMarkdownTableHeaderColumn(
  content: string,
  columnNumber: number | undefined,
  expectedHeader: string
): boolean {
  if (!columnNumber || columnNumber < 1) return false

  const lines = content.split("\n")
  for (let index = 0; index < lines.length - 1; index += 1) {
    const headerLine = lines[index]
    const dividerLine = lines[index + 1]
    if (!headerLine.includes("|") || !isMarkdownTableDivider(dividerLine)) continue

    const headerCells = splitMarkdownTableRow(headerLine)
    const headerCell = headerCells[columnNumber - 1]
    if (normalizeMarkdownTableHeaderCell(headerCell || "") === expectedHeader) {
      return true
    }
  }

  return false
}

function MarkdownLink({ children, href, rel, target, ...props }: ComponentProps<"a">) {
  if (!href) {
    return (
      <a className={cn("wrap-anywhere font-medium text-primary underline", props.className)} {...props}>
        {children}
      </a>
    )
  }

  const isInternalHref = href.startsWith("#") || href.startsWith("/")

  return (
    <a
      className={cn("wrap-anywhere font-medium text-primary underline", props.className)}
      href={href}
      rel={isInternalHref ? rel : (rel ?? "noopener noreferrer")}
      target={isInternalHref ? target : (target ?? "_blank")}
      {...props}
    >
      {children}
    </a>
  )
}

function Heading1({ children, className, ...props }: ComponentProps<"h1">) {
  return (
    <h1 className={cn("mt-6 mb-2 font-semibold text-3xl", className)} {...props}>
      {children}
    </h1>
  )
}

function Heading2({ children, className, ...props }: ComponentProps<"h2">) {
  return (
    <h2 className={cn("mt-6 mb-2 font-semibold text-2xl", className)} {...props}>
      {children}
    </h2>
  )
}

function Heading3({ children, className, ...props }: ComponentProps<"h3">) {
  return (
    <h3 className={cn("mt-6 mb-2 font-semibold text-xl", className)} {...props}>
      {children}
    </h3>
  )
}

function Heading4({ children, className, ...props }: ComponentProps<"h4">) {
  return (
    <h4 className={cn("mt-6 mb-2 font-semibold text-lg", className)} {...props}>
      {children}
    </h4>
  )
}

function Heading5({ children, className, ...props }: ComponentProps<"h5">) {
  return (
    <h5 className={cn("mt-6 mb-2 font-semibold text-base", className)} {...props}>
      {children}
    </h5>
  )
}

function Heading6({ children, className, ...props }: ComponentProps<"h6">) {
  return (
    <h6 className={cn("mt-6 mb-2 font-semibold text-sm", className)} {...props}>
      {children}
    </h6>
  )
}

function PlainPre({ children, className: _className, ...props }: ComponentProps<"pre">) {
  return (
    <pre
      className="overflow-x-auto rounded-md border border-border bg-transparent px-4 py-3 font-mono text-sm leading-relaxed"
      {...props}
    >
      {children}
    </pre>
  )
}

function PlainTable({ children, className, ...props }: ComponentProps<"table">) {
  return (
    <div className="my-4 overflow-x-hidden rounded-md border border-border bg-background">
      <table className={cn("w-full divide-y divide-border", className)} {...props}>
        {children}
      </table>
    </div>
  )
}

function TableHead({ children, className, ...props }: ComponentProps<"thead">) {
  return (
    <thead className={cn("bg-muted/80", className)} {...props}>
      {children}
    </thead>
  )
}

function TableBody({ children, className, ...props }: ComponentProps<"tbody">) {
  return (
    <tbody className={cn("divide-y divide-border", className)} {...props}>
      {children}
    </tbody>
  )
}

function TableRow({ children, className, ...props }: ComponentProps<"tr">) {
  return (
    <tr className={cn("border-border", className)} {...props}>
      {children}
    </tr>
  )
}

function TableHeaderCell({ children, className, ...props }: ComponentProps<"th">) {
  return (
    <th className={cn("whitespace-nowrap px-4 py-2 text-left font-semibold text-sm", className)} {...props}>
      {children}
    </th>
  )
}

function TableCell({ children, className, ...props }: ComponentProps<"td">) {
  return (
    <td className={cn("px-4 py-2 text-sm", className)} {...props}>
      {children}
    </td>
  )
}

function Blockquote({ children, className, ...props }: ComponentProps<"blockquote">) {
  return (
    <blockquote
      className={cn("my-4 border-muted-foreground/30 border-l-4 pl-4 text-muted-foreground italic", className)}
      {...props}
    >
      {children}
    </blockquote>
  )
}

function InlineCode({ children, className, ...props }: ComponentProps<"code">) {
  return (
    <code className={cn("rounded bg-muted px-1.5 py-0.5 font-mono text-sm", className)} {...props}>
      {children}
    </code>
  )
}

function getStableKey(value: string): string {
  let hash = 0
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0
  }
  return Math.abs(hash).toString(36)
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

function getStepPhase(step: ParsedStep): TranscriptPhase {
  const toolNames = step.toolCalls.map((tool) => tool.name.toLowerCase())

  if (toolNames.some((name) => name === "writefile")) {
    return "changes"
  }

  if (toolNames.some((name) => name === "runprojectcommand" || name === "gitdiff" || name === "diagnose")) {
    return "verification"
  }

  return "analysis"
}

export function AgentAnalysis({
  content,
  nowrapTableColumn,
  plainCodeBlocks = false,
  plainTables = false,
  compactLists = false,
  topAlignTables = false
}: {
  content: string
  controls?: unknown
  nowrapTableColumn?: number
  plainCodeBlocks?: boolean
  plainTables?: boolean
  compactLists?: boolean
  topAlignTables?: boolean
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
  const shouldNowrapTableColumn = useMemo(
    () => hasMarkdownTableHeaderColumn(normalizedRawContent, nowrapTableColumn, "slug"),
    [normalizedRawContent, nowrapTableColumn]
  )

  const nowrapTableColumnClassName =
    nowrapTableColumn === 3 && shouldNowrapTableColumn
      ? "[&_table_th:nth-child(1)]:w-px [&_table_td:nth-child(1)]:w-px [&_table_th:nth-child(1)]:!whitespace-nowrap [&_table_td:nth-child(1)]:!whitespace-nowrap [&_table_th:nth-child(2)]:w-px [&_table_td:nth-child(2)]:w-px [&_table_th:nth-child(2)]:!whitespace-nowrap [&_table_td:nth-child(2)]:!whitespace-nowrap [&_table_th:nth-child(3)]:w-px [&_table_td:nth-child(3)]:w-px [&_table_th:nth-child(3)]:!whitespace-nowrap [&_table_td:nth-child(3)]:!whitespace-nowrap [&_table_th:nth-child(3)]:text-left [&_table_td:nth-child(3)]:text-left [&_table_td:nth-child(3)]:align-top [&_table_td:nth-child(3)_code]:!whitespace-nowrap [&_table_td:nth-child(3)_code]:bg-transparent [&_table_td:nth-child(3)_code]:px-0 [&_table_th:nth-child(4)]:w-auto [&_table_td:nth-child(4)]:w-auto [&_table_th:nth-child(4)]:!whitespace-normal [&_table_td:nth-child(4)]:!whitespace-normal [&_table_td:nth-child(4)]:break-words [&_table_td:nth-child(4)]:[overflow-wrap:anywhere]"
      : ""
  const plainTableClassName = plainTables
    ? "[&_table]:table-auto [&_table]:w-full [&_table_th]:whitespace-normal [&_table_td]:whitespace-normal [&_table_th]:break-words [&_table_td]:break-words"
    : ""
  const listClassName = compactLists
    ? "[&_ul]:!my-2 [&_ol]:!my-2 [&_ul]:!pl-0 [&_ol]:!pl-0 [&_li]:!list-none [&_li]:!pl-0 [&_li]:text-[0.95em] [&_li]:leading-relaxed [&_li>p]:inline [&_li>p]:my-0"
    : "prose-ol:my-3 prose-ul:my-2 prose-li:my-1 [&_ol]:!list-outside [&_ul]:!list-outside [&_ol]:!pl-7 [&_ul]:!pl-7 [&_ol>li]:pl-0 [&_ul>li]:pl-0 [&_li>p]:inline [&_li>p]:my-0"
  const topAlignTablesClassName = topAlignTables ? "[&_table_th]:align-top [&_table_td]:align-top" : ""
  const analysisClassName = [
    "prose prose-sm dark:prose-invert max-w-none prose-p:my-2",
    listClassName,
    plainTableClassName,
    nowrapTableColumnClassName,
    topAlignTablesClassName
  ]
    .filter(Boolean)
    .join(" ")
  const markdownComponents = useMemo(() => {
    return {
      a: MarkdownLink,
      blockquote: Blockquote,
      code: InlineCode,
      h1: Heading1,
      h2: Heading2,
      h3: Heading3,
      h4: Heading4,
      h5: Heading5,
      h6: Heading6,
      tbody: TableBody,
      td: TableCell,
      th: TableHeaderCell,
      thead: TableHead,
      tr: TableRow,
      ...(plainCodeBlocks ? { pre: PlainPre } : {}),
      ...(plainTables ? { table: PlainTable } : {})
    }
  }, [plainCodeBlocks, plainTables])

  const groupedSteps = useMemo(() => {
    const groups: Record<TranscriptPhase, ParsedStep[]> = {
      analysis: [],
      changes: [],
      verification: []
    }

    for (const step of parsed.steps) {
      groups[getStepPhase(step)].push(step)
    }

    return groups
  }, [parsed.steps])

  const phaseMeta: Array<{ key: TranscriptPhase; title: string }> = [
    { key: "analysis", title: "Analysis" },
    { key: "changes", title: "Code Changes" },
    { key: "verification", title: "Verification" }
  ]

  // If we couldn't parse the transcript structure, fall back to raw rendering
  if (!parsed.finalOutput && parsed.steps.length === 0) {
    return (
      <div className={analysisClassName}>
        <ComarkClient
          className="space-y-4 whitespace-normal *:first:mt-0 *:last:mb-0"
          components={markdownComponents}
          markdown={normalizedRawContent}
          options={COMARK_OPTIONS}
          plugins={COMARK_PLUGINS}
        />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Final Output - shown prominently at the top (with Git Diff section stripped) */}
      {cleanedFinalOutput && (
        <div className={analysisClassName}>
          <ComarkClient
            className="space-y-4 whitespace-normal *:first:mt-0 *:last:mb-0"
            components={markdownComponents}
            markdown={cleanedFinalOutput}
            options={COMARK_OPTIONS}
            plugins={COMARK_PLUGINS}
          />
        </div>
      )}

      {/* Parsed execution trace (max 3 collapsible groups) */}
      {parsed.steps.length > 0 && (
        <div className="space-y-2">
          {phaseMeta.map(({ key, title }) => {
            const steps = groupedSteps[key]
            if (steps.length === 0) return null

            return (
              <StepSection key={key} title={title} badge={`${steps.length} steps`}>
                <div className="space-y-4 mt-2">
                  {steps.map((step) => (
                    <div
                      key={`step-${step.stepNumber}`}
                      className="border-b border-border pb-4 last:border-b-0 last:pb-0"
                    >
                      <div className="text-sm font-medium mb-2">
                        Step {step.stepNumber}
                        <span className="text-xs text-muted-foreground ml-2">({step.toolCalls.length} tools)</span>
                      </div>

                      <div className="space-y-3">
                        {step.assistantText && (
                          <div>
                            <div className="text-xs font-medium text-muted-foreground mb-1">Assistant</div>
                            <div className={analysisClassName}>
                              <ComarkClient
                                className="space-y-4 whitespace-normal *:first:mt-0 *:last:mb-0"
                                components={markdownComponents}
                                markdown={normalizeReportMarkdown(step.assistantText)}
                                options={COMARK_OPTIONS}
                                plugins={COMARK_PLUGINS}
                              />
                            </div>
                          </div>
                        )}

                        {step.toolCalls.map((toolCall) => (
                          <div
                            key={`step-${step.stepNumber}-tool-${getStableKey(
                              `${toolCall.name}\n${toolCall.args}\n${toolCall.result}`
                            )}`}
                            className="border border-border rounded p-2"
                          >
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
            )
          })}
        </div>
      )}
    </div>
  )
}
