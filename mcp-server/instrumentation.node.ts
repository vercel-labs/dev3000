/**
 * Node.js-specific global error handlers for the MCP server
 * This file should only be imported in Node.js runtime
 */

// Suppress common network errors that are expected
const IGNORED_ERROR_CODES = new Set([
  "ECONNRESET", // Client disconnected
  "EPIPE", // Broken pipe
  "ECANCELED" // Request canceled
])

export function registerNodeErrorHandlers() {
  // Set process title for easier identification in process lists
  process.title = "d3k-mcp"

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
