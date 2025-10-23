/**
 * Shared color constants for log entries
 * Used by both TUI and web logs viewer to ensure consistency
 */

export const LOG_COLORS = {
  // Source colors
  BROWSER: "#00CED1", // Cyan
  SERVER: "#32CD32", // Lime green

  // Log type colors
  NETWORK: "#4A7C7E", // Soft teal
  ERROR: "#FF6B6B", // Red
  WARNING: "#FFA500", // Orange
  INFO: "#87CEEB", // Sky blue
  LOG: "#B0B0B0", // Gray
  DEBUG: "#9370DB", // Purple
  SCREENSHOT: "#FF69B4", // Hot pink
  DOM: "#DDA0DD", // Plum
  CDP: "#F0E68C", // Khaki
  CHROME: "#F0E68C", // Khaki (same as CDP)
  CRASH: "#DC143C", // Crimson
  REPLAY: "#9370DB", // Purple
  NAVIGATION: "#DDA0DD", // Plum (same as DOM)
  INTERACTION: "#DDA0DD", // Plum (same as DOM)
  DEFAULT: "#A0A0A0" // Dark gray
} as const

// Helper to determine text color based on background
export function getTextColor(bgColor: string): string {
  // Light backgrounds need dark text
  const lightColors: string[] = [
    LOG_COLORS.INFO,
    LOG_COLORS.SCREENSHOT,
    LOG_COLORS.DOM,
    LOG_COLORS.CDP,
    LOG_COLORS.CHROME,
    LOG_COLORS.NAVIGATION,
    LOG_COLORS.INTERACTION
  ]
  return lightColors.includes(bgColor) ? "#000" : "#FFF"
}

// Map log type names to color keys
export const TYPE_COLOR_MAP = {
  NETWORK: "NETWORK",
  ERROR: "ERROR",
  WARNING: "WARNING",
  INFO: "INFO",
  LOG: "LOG",
  DEBUG: "DEBUG",
  SCREENSHOT: "SCREENSHOT",
  DOM: "DOM",
  CDP: "CDP",
  CHROME: "CHROME",
  CRASH: "CRASH",
  REPLAY: "REPLAY",
  NAVIGATION: "NAVIGATION",
  INTERACTION: "INTERACTION"
} as const
