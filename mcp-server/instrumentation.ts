/**
 * Global error handlers for the MCP server
 * Suppresses common network errors that are expected during normal operation
 */

// Suppress common network errors that are expected
const IGNORED_ERROR_CODES = new Set([
  "ECONNRESET", // Client disconnected
  "EPIPE", // Broken pipe
  "ECANCELED" // Request canceled
])

// Setup global error handlers
export function register() {
  // Only register handlers in Node.js runtime (not Edge Runtime)
  if (typeof process === "undefined" || !process.on) {
    return
  }

  // Suppress unhandled rejections for network errors
  process.on("unhandledRejection", (reason: unknown) => {
    // Ignore network-related errors
    if (reason && typeof reason === "object" && "code" in reason && IGNORED_ERROR_CODES.has(String(reason.code))) {
      return
    }

    // Log other unhandled rejections
    console.error("[MCP Server] Unhandled rejection:", reason)
  })

  // Suppress uncaught exceptions for network errors
  process.on("uncaughtException", (error: unknown) => {
    // Ignore network-related errors
    if (error && typeof error === "object" && "code" in error && IGNORED_ERROR_CODES.has(String(error.code))) {
      return
    }

    // Log other uncaught exceptions
    console.error("[MCP Server] Uncaught exception:", error)
  })
}
