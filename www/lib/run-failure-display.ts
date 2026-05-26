function stripAnsi(value: string): string {
  let result = ""

  for (let index = 0; index < value.length; index++) {
    const charCode = value.charCodeAt(index)
    if (charCode === 27 && value[index + 1] === "[") {
      while (index < value.length && value[index] !== "m") {
        index++
      }
      continue
    }
    result += value[index]
  }

  return result
}

export function sanitizeRunFailureText(value: string): string {
  const stripped = stripAnsi(value)
  let printable = ""

  for (let index = 0; index < stripped.length; index++) {
    const charCode = stripped.charCodeAt(index)
    const isDisallowedControl =
      (charCode >= 0 && charCode <= 8) || (charCode >= 11 && charCode <= 31) || (charCode >= 127 && charCode <= 159)
    if (!isDisallowedControl) {
      printable += stripped[index]
    }
  }

  return printable.replace(/\s+/g, " ").trim()
}

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return count === 1 ? singular : plural
}

export interface RunFailureDisplay {
  summary: string
  details: string
  workflowStep?: string
  retryCount?: string
  stats: string[]
}

export function formatRunFailure(value?: string | null): RunFailureDisplay {
  const details = sanitizeRunFailureText(value || "The workflow ended in a failure state.")
  const fallbackSummary = details.length > 260 ? `${details.slice(0, 257).trim()}...` : details
  const fatalMatch = details.match(/^FatalError:\s*Step\s+"([^"]+)"\s+failed after\s+(\d+)\s+retries:\s*(.*)$/i)
  const workflowStep = fatalMatch?.[1]
  const retryCount = fatalMatch?.[2]
  const cause = fatalMatch?.[3]?.trim() || details

  if (/AI Gateway authentication failed|Authentication failed|AI Gateway[^\n]*401|401 Unauthorized/i.test(cause)) {
    return {
      summary: "The runner could not authenticate to AI Gateway, so no analysis report was generated.",
      details,
      workflowStep,
      retryCount,
      stats: ["Root cause: AI Gateway 401 Unauthorized"]
    }
  }

  const deepSecStats = cause.match(
    /Processing complete\.\s*Run:\s*([^\s]+)\s*Analyses:\s*(\d+)\s*Findings:\s*(\d+)\s*Errored batches:\s*(\d+)/i
  )
  if (/DeepSec process failed:/i.test(cause) && deepSecStats) {
    const analyses = Number(deepSecStats[2])
    const findings = Number(deepSecStats[3])
    const erroredBatches = Number(deepSecStats[4])
    return {
      summary: `DeepSec processed ${analyses} ${pluralize(analyses, "analysis", "analyses")} and found ${findings} ${pluralize(findings, "finding")}, but ${erroredBatches} ${pluralize(erroredBatches, "batch", "batches")} errored, so no clean report was generated.`,
      details,
      workflowStep,
      retryCount,
      stats: [
        `Analyses: ${analyses}`,
        `Findings: ${findings}`,
        `Errored ${pluralize(erroredBatches, "batch", "batches")}: ${erroredBatches}`
      ]
    }
  }

  if (/DeepSec completed but did not generate a markdown report/i.test(cause)) {
    return {
      summary: "DeepSec completed, but no markdown report was generated.",
      details,
      workflowStep,
      retryCount,
      stats: []
    }
  }

  if (/Unexpected end of JSON input/i.test(cause)) {
    return {
      summary: "The analysis runner returned an incomplete JSON response.",
      details,
      workflowStep,
      retryCount,
      stats: []
    }
  }

  return {
    summary: fallbackSummary || "The workflow ended in a failure state.",
    details,
    workflowStep,
    retryCount,
    stats: []
  }
}
