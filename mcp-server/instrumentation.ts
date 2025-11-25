/**
 * Global error handlers for the MCP server
 * Suppresses common network errors that are expected during normal operation
 */

// Setup global error handlers
export async function register() {
  // Only register handlers in Node.js runtime (not Edge Runtime)
  // Check for Node.js runtime using process.env.NEXT_RUNTIME
  const isNodeRuntime =
    typeof process !== "undefined" && (!process.env.NEXT_RUNTIME || process.env.NEXT_RUNTIME === "nodejs")

  if (!isNodeRuntime) {
    return
  }

  // Dynamically import Node.js-specific error handlers
  // This prevents Edge Runtime from seeing process.on during static analysis
  const { registerNodeErrorHandlers } = await import("./instrumentation.node")
  registerNodeErrorHandlers()
}
