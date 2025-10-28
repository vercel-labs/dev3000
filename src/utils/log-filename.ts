/**
 * Utilities for working with dev3000 log filenames
 *
 * Log files follow the pattern: <project-name>-<timestamp>.log
 * where timestamp is ISO 8601 with special chars replaced by hyphens
 * Example: tailwindui-studio-2025-10-27T17-57-15-014Z.log
 */

/**
 * Extract the project name from a log filename
 *
 * @param filename - The log filename (e.g., "tailwindui-studio-2025-10-27T17-57-15-014Z.log")
 * @returns The project name (e.g., "tailwindui-studio") or null if invalid format
 */
export function extractProjectNameFromLogFilename(filename: string): string | null {
  // Pattern matches: <project-name>-YYYY-MM-DDTHH-MM-SS-SSSZ.log
  // The timestamp always starts with YYYY-MM-DD which is a reliable anchor
  const match = filename.match(/^(.+?)-(\d{4}-\d{2}-\d{2}T[\d-]+Z)\.log$/)
  if (match) {
    return match[1]
  }
  return null
}

/**
 * Check if a log filename matches a given project name
 *
 * @param filename - The log filename to check
 * @param projectName - The project name to match (supports partial matching)
 * @returns true if the filename belongs to this project
 */
export function logFilenameMatchesProject(filename: string, projectName: string): boolean {
  const extractedName = extractProjectNameFromLogFilename(filename)
  if (!extractedName) {
    return false
  }

  // Support partial matching (e.g., "studio" matches "tailwindui-studio")
  return extractedName.includes(projectName)
}

/**
 * Extract the timestamp from a log filename
 *
 * @param filename - The log filename
 * @returns ISO 8601 timestamp string or null if invalid format
 */
export function extractTimestampFromLogFilename(filename: string): string | null {
  const match = filename.match(/^.+?-(\d{4}-\d{2}-\d{2}T[\d-]+Z)\.log$/)
  if (match) {
    // Convert back to proper ISO format (replace hyphens with colons and dots)
    const timestamp = match[1]
    // Format: 2025-10-27T17-57-15-014Z -> 2025-10-27T17:57:15.014Z
    const isoTimestamp = timestamp.replace(/T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/, "T$1:$2:$3.$4Z")
    return isoTimestamp
  }
  return null
}
