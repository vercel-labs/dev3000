export function isValidRepoArg(repoArg: string): boolean {
  const normalized = repoArg.trim()
  if (!normalized) return false

  // Allow owner/name or GitHub URL
  const repoPattern = /^([^/\s]+)\/([^/\s]+)(?:\.git)?$/
  const urlPattern = /^https?:\/\/github\.com\/([^/\s]+)\/([^/\s]+)(?:\.git)?\/?$/
  return repoPattern.test(normalized) || urlPattern.test(normalized)
}
