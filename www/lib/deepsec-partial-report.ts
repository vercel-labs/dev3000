export interface DeepSecPersistedFindingSummary {
  confidence?: string
  description?: string
  filePath: string
  lineNumbers?: number[]
  recommendation?: string
  revalidationVerdict?: string
  severity?: string
  title?: string
  triagePriority?: string
  vulnSlug?: string
}

export interface DeepSecPersistedFindingsSnapshot {
  fileCount: number
  findingCount: number
  findings: DeepSecPersistedFindingSummary[]
  projectIds: string[]
  statusCounts: Record<string, number>
  truncated?: boolean
}

const SEVERITY_ORDER = new Map([
  ["CRITICAL", 0],
  ["HIGH", 1],
  ["HIGH_BUG", 2],
  ["MEDIUM", 3],
  ["BUG", 4],
  ["LOW", 5]
])

function normalizeText(value: string | undefined, maxLength = 2400): string {
  return (value || "")
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, maxLength)
}

function formatStatusCounts(statusCounts: Record<string, number>): string {
  const entries = Object.entries(statusCounts).filter(([, count]) => count > 0)
  if (entries.length === 0) return "No file status data was available."
  return entries
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([status, count]) => `- ${status}: ${count}`)
    .join("\n")
}

function sortFindings(findings: DeepSecPersistedFindingSummary[]): DeepSecPersistedFindingSummary[] {
  return [...findings].sort((left, right) => {
    const leftRank = SEVERITY_ORDER.get((left.severity || "").toUpperCase()) ?? 99
    const rightRank = SEVERITY_ORDER.get((right.severity || "").toUpperCase()) ?? 99
    if (leftRank !== rightRank) return leftRank - rightRank
    return left.filePath.localeCompare(right.filePath) || (left.title || "").localeCompare(right.title || "")
  })
}

export function buildPersistedDeepSecFindingsMarkdown(snapshot: DeepSecPersistedFindingsSnapshot): string {
  const findings = sortFindings(snapshot.findings)
  const lines = [
    "# Persisted DeepSec Findings",
    "",
    `Projects: ${snapshot.projectIds.length ? snapshot.projectIds.join(", ") : "unknown"}`,
    `File records read: ${snapshot.fileCount}`,
    `Persisted findings: ${snapshot.findingCount}`,
    snapshot.truncated
      ? `Displayed findings: ${findings.length} (truncated)`
      : `Displayed findings: ${findings.length}`,
    "",
    "## Coverage Snapshot",
    "",
    formatStatusCounts(snapshot.statusCounts),
    ""
  ]

  if (findings.length === 0) {
    lines.push(
      "## Persisted Finding Details",
      "",
      "No persisted finding details were available. The status snapshot above is still from DeepSec's on-disk state."
    )
    return lines.join("\n")
  }

  lines.push("## Persisted Finding Details", "")

  findings.forEach((finding, index) => {
    const severity = (finding.severity || "UNKNOWN").toUpperCase()
    const title = normalizeText(finding.title, 240) || "Untitled finding"
    const lineSuffix = finding.lineNumbers?.length ? `:${finding.lineNumbers.join(",")}` : ""
    lines.push(`### ${index + 1}. ${severity}: ${title}`, "", `File: ${finding.filePath}${lineSuffix}`)

    if (finding.vulnSlug) lines.push(`Matcher: ${finding.vulnSlug}`)
    if (finding.confidence) lines.push(`Confidence: ${finding.confidence}`)
    if (finding.triagePriority) lines.push(`Triage: ${finding.triagePriority}`)
    if (finding.revalidationVerdict) lines.push(`Revalidation: ${finding.revalidationVerdict}`)

    const description = normalizeText(finding.description)
    if (description) lines.push("", "Description:", "", description)

    const recommendation = normalizeText(finding.recommendation)
    if (recommendation) lines.push("", "Recommendation:", "", recommendation)

    lines.push("")
  })

  return lines.join("\n").trim()
}
