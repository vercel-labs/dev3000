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
  CONSOLE_ERROR: "#FF6B6B", // Red
  CONSOLE_WARN: "#FFA500", // Orange
  CONSOLE_INFO: "#87CEEB", // Sky blue
  CONSOLE_LOG: "#B0B0B0", // Gray
  CONSOLE_DEBUG: "#9370DB", // Purple
  SCREENSHOT: "#FF69B4", // Hot pink
  DOM: "#DDA0DD", // Plum
  CDP: "#F0E68C", // Khaki
  ERROR: "#FF6B6B", // Red
  CRITICAL_ERROR: "#DC143C", // Crimson
  DEFAULT: "#A0A0A0" // Dark gray
} as const

// Helper to determine text color based on background
export function getTextColor(bgColor: string): string {
  // Light backgrounds need dark text
  const lightColors: string[] = [LOG_COLORS.CONSOLE_INFO, LOG_COLORS.SCREENSHOT, LOG_COLORS.DOM, LOG_COLORS.CDP]
  return lightColors.includes(bgColor) ? "#000" : "#FFF"
}

// Map log type names to color keys
export const TYPE_COLOR_MAP = {
  NETWORK: "NETWORK",
  "NETWORK.REQUEST": "NETWORK",
  "CONSOLE.ERROR": "CONSOLE_ERROR",
  "CONSOLE.WARN": "CONSOLE_WARN",
  "CONSOLE.INFO": "CONSOLE_INFO",
  "CONSOLE.LOG": "CONSOLE_LOG",
  "CONSOLE.DEBUG": "CONSOLE_DEBUG",
  "RUNTIME.ERROR": "ERROR",
  "CDP.ERROR": "CDP",
  "CHROME.ERROR": "ERROR",
  "CHROME.CRASH": "CRITICAL_ERROR",
  NAVIGATION: "DOM",
  INTERACTION: "DOM",
  SCREENSHOT: "SCREENSHOT",
  DOM: "DOM",
  CDP: "CDP",
  ERROR: "ERROR",
  "CRITICAL ERROR": "CRITICAL_ERROR"
} as const
