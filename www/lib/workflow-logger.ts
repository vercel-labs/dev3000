import { appendFileSync, writeFileSync } from "fs"

const LOG_FILE = "/tmp/d3k-workflow-test-log"

/**
 * Write a message to the workflow log file (with timestamp)
 */
function writeToLogFile(level: string, message: string): void {
  try {
    const timestamp = new Date().toISOString()
    const logLine = `[${timestamp}] [${level}] ${message}\n`
    appendFileSync(LOG_FILE, logLine)
  } catch {
    // Silently ignore file write errors (e.g., in Vercel serverless)
  }
}

/**
 * Workflow logger that writes to both console and /tmp file
 * Useful for debugging workflow execution locally
 */
export function workflowLog(message: string): void {
  console.log(message)
  writeToLogFile("INFO", message)
}

/**
 * Workflow error logger that writes to both console.error and /tmp file
 */
export function workflowError(message: string, error?: unknown): void {
  if (error) {
    console.error(message, error)
    writeToLogFile("ERROR", `${message} ${error instanceof Error ? error.message : String(error)}`)
  } else {
    console.error(message)
    writeToLogFile("ERROR", message)
  }
}

/**
 * Clear the workflow log file (useful at start of new workflow run)
 */
export function clearWorkflowLog(): void {
  try {
    writeFileSync(LOG_FILE, "")
  } catch {
    // Silently ignore
  }
}

/**
 * Get the path to the workflow log file
 */
export function getWorkflowLogPath(): string {
  return LOG_FILE
}
