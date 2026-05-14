export function redactSensitiveReportText(value: string): string {
  return value
    .replace(/https?:\/\/x-access-token:[^@\s)]+@github\.com\//gi, "https://github.com/")
    .replace(/https?:\/\/[^:\s/@)]+:[^@\s)]+@github\.com\//gi, "https://github.com/")
    .replace(/\bgithub_pat_[A-Za-z0-9_]+/g, "github_pat_[redacted]")
}
