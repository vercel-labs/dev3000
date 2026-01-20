/**
 * Format timestamp based on user preference
 * @param date Date object to format
 * @param format "local" for local time (default) or "utc" for ISO string
 * @returns Formatted timestamp string
 */
export function formatTimestamp(date: Date, format: "local" | "utc" = "local"): string {
  if (format === "utc") {
    return date.toISOString()
  }

  // Local format: HH:mm:ss.SSS
  const hours = date.getHours().toString().padStart(2, "0")
  const minutes = date.getMinutes().toString().padStart(2, "0")
  const seconds = date.getSeconds().toString().padStart(2, "0")
  const milliseconds = date.getMilliseconds().toString().padStart(3, "0")

  return `${hours}:${minutes}:${seconds}.${milliseconds}`
}

/**
 * Parse a timestamp string like "12:34:56.789" into milliseconds from midnight
 * @param timestamp Timestamp string in HH:mm:ss.SSS or HH:mm:ss format
 * @returns Milliseconds from midnight, or null if parsing fails
 */
export function parseTimestampToMs(timestamp: string): number | null {
  // Match formats like "12:34:56.789" or "12:34:56"
  const match = timestamp.match(/^(\d{1,2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?/)
  if (!match) return null

  const hours = parseInt(match[1], 10)
  const minutes = parseInt(match[2], 10)
  const seconds = parseInt(match[3], 10)
  const milliseconds = match[4] ? parseInt(match[4].padEnd(3, "0"), 10) : 0

  return hours * 3600000 + minutes * 60000 + seconds * 1000 + milliseconds
}

/**
 * Format a time delta in milliseconds to a human-readable string
 * @param deltaMs Delta in milliseconds (can be negative)
 * @returns Formatted string like "+0.011s", "-1.049s", "+5.2s", "+1m23.4s"
 */
export function formatTimeDelta(deltaMs: number): string {
  const sign = deltaMs >= 0 ? "+" : "-"
  const absMs = Math.abs(deltaMs)

  if (absMs < 10000) {
    // Under 10 seconds: show 3 decimal places (e.g., "+0.011s")
    return `${sign}${(absMs / 1000).toFixed(3)}s`
  } else if (absMs < 60000) {
    // Under 1 minute: show 1 decimal place (e.g., "+15.2s")
    return `${sign}${(absMs / 1000).toFixed(1)}s`
  } else {
    // 1 minute or more: show minutes and seconds (e.g., "+1m23.4s")
    const minutes = Math.floor(absMs / 60000)
    const seconds = (absMs % 60000) / 1000
    return `${sign}${minutes}m${seconds.toFixed(1)}s`
  }
}
