import type { WorkflowReport } from "@/types"
import { redactSensitiveReportText } from "./report-redaction"

export function getFinalSummaryMarkdown(agentAnalysis?: string) {
  if (!agentAnalysis) return ""

  const legacyFinalOutputMatch = agentAnalysis.match(/## Final Output\s+([\s\S]*)$/)
  if (legacyFinalOutputMatch?.[1]?.trim()) {
    return legacyFinalOutputMatch[1].trim()
  }

  const transcriptFinalSummaryMatch = agentAnalysis.match(
    /### Final summary\s+\*\*User:\*\*[\s\S]*?\*\*Claude:\*\*\n([\s\S]*?)\n\*\*Result JSON:\*\*/i
  )

  return transcriptFinalSummaryMatch?.[1]?.trim() || ""
}

export function extractEveFinalMessage(agentAnalysis?: string): string {
  if (!agentAnalysis) return ""

  const markerIndex = agentAnalysis.indexOf("**Stream Events:**")
  if (markerIndex === -1) return ""

  const fenceIndex = agentAnalysis.indexOf("```ndjson", markerIndex)
  if (fenceIndex === -1) return ""

  const ndjsonStart = agentAnalysis.indexOf("\n", fenceIndex)
  if (ndjsonStart === -1) return ""

  let finalMessage = ""
  for (const line of agentAnalysis.slice(ndjsonStart + 1).split("\n")) {
    const trimmed = line.trim()
    if (trimmed === "```") break
    if (!trimmed) continue

    try {
      const event = JSON.parse(trimmed) as {
        type?: string
        data?: {
          finishReason?: string
          message?: string
        }
      }
      if (
        event.type === "message.completed" &&
        event.data?.finishReason === "stop" &&
        typeof event.data.message === "string"
      ) {
        finalMessage = event.data.message.trim()
      }
    } catch {
      // Ignore non-JSON transcript lines.
    }
  }

  return finalMessage
}

export function getGeneratedReportMarkdown(report: WorkflowReport): string {
  const storedReport = report.generatedReportMarkdown?.trim()
  if (storedReport) return redactSensitiveReportText(storedReport)

  if (report.workflowType === "deepsec-security-scan") {
    return redactSensitiveReportText(
      extractEveFinalMessage(report.agentAnalysis) || getFinalSummaryMarkdown(report.agentAnalysis)
    )
  }

  return ""
}

export function isSuccessfulDeepSecGeneratedReportMarkdown(markdown: string | undefined): boolean {
  const content = markdown?.trim()
  if (!content) return false

  const normalized = content.toLowerCase()
  return ![
    "claude code native binary not found",
    "no actual vulnerability analysis occurred",
    "processing failure",
    "processing pass failed",
    "ai investigation degraded",
    "manual fallback report",
    "static review could not be completed",
    "other-review-blocked",
    "bwrap: no permissions to create a new namespace",
    "no security conclusion can be drawn"
  ].some((failureSignal) => normalized.includes(failureSignal))
}

export function getGeneratedReportCostUsd(markdown: string): number | null {
  const contentWithoutCode = markdown.replace(/```[\s\S]*?```/g, "")

  for (const rawLine of contentWithoutCode.split("\n")) {
    const line = rawLine
      .replace(/^[-*]\s+/, "")
      .replace(/\*\*/g, "")
      .trim()
    const match = line.match(/^Cost:\s*(.+)$/i)
    if (!match) continue

    const costMatch = match[1].match(/~?\$([\d,]+(?:\.\d+)?)/)
    if (!costMatch) return null

    const amount = Number(costMatch[1].replace(/,/g, ""))
    return Number.isFinite(amount) ? amount : null
  }

  return null
}

function stripAnsi(value: string): string {
  let output = ""
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) === 27 && value[index + 1] === "[") {
      let end = index + 2
      while (end < value.length && /[0-9;]/.test(value[end])) {
        end += 1
      }
      if (value[end] === "m") {
        index = end
        continue
      }
    }
    output += value[index]
  }
  return output
}

function parseTokenCount(rawValue: string, suffix?: string): number | null {
  const value = Number(rawValue.replace(/,/g, ""))
  if (!Number.isFinite(value)) return null
  return suffix?.toLowerCase() === "k" ? Math.round(value * 1000) : Math.round(value)
}

export function getGeneratedReportTotalTokens(markdown: string): number | null {
  const contentWithoutCode = markdown.replace(/```[\s\S]*?```/g, "")

  for (const rawLine of contentWithoutCode.split("\n")) {
    const line = rawLine
      .replace(/^[-*]\s+/, "")
      .replace(/\*\*/g, "")
      .trim()
    const match = line.match(/^Cost:\s*.+?~?([\d,]+(?:\.\d+)?)(k)?\s+tokens\b/i)
    if (!match) continue

    return parseTokenCount(match[1], match[2])
  }

  return null
}

export function getDeepSecTranscriptUsage(agentAnalysis?: string): { costUsd?: number; totalTokens?: number } {
  if (!agentAnalysis) return {}

  const text = stripAnsi(agentAnalysis)
  let costUsd = 0
  let totalTokens = 0
  let matches = 0
  const investigationCompletePattern =
    /Investigation complete\s*\([^)]*?\$([\d,]+(?:\.\d+)?)\s+([\d,]+(?:\.\d+)?)(k)?\s+tokens\b/gi

  for (const match of text.matchAll(investigationCompletePattern)) {
    const cost = Number(match[1].replace(/,/g, ""))
    const tokens = parseTokenCount(match[2], match[3])
    if (Number.isFinite(cost) && cost > 0) {
      costUsd += cost
    }
    if (typeof tokens === "number" && tokens > 0) {
      totalTokens += tokens
    }
    matches += 1
  }

  return {
    costUsd: matches > 0 && costUsd > 0 ? costUsd : undefined,
    totalTokens: matches > 0 && totalTokens > 0 ? totalTokens : undefined
  }
}

export function getWorkflowReportCostUsd(report: WorkflowReport): number | undefined {
  if (typeof report.costUsd === "number" && Number.isFinite(report.costUsd) && report.costUsd > 0) {
    return report.costUsd
  }

  const generatedCost = getGeneratedReportCostUsd(getGeneratedReportMarkdown(report))
  if (typeof generatedCost === "number" && Number.isFinite(generatedCost) && generatedCost > 0) {
    return generatedCost
  }

  const transcriptCost = getDeepSecTranscriptUsage(report.agentAnalysis).costUsd
  if (typeof transcriptCost === "number" && Number.isFinite(transcriptCost) && transcriptCost > 0) {
    return transcriptCost
  }

  return undefined
}
