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
