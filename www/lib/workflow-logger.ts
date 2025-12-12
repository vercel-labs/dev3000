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
 * Workflow logger that writes ONLY to /tmp file (saves memory/tokens)
 * Read logs with: cat /tmp/d3k-workflow-test-log
 */
export function workflowLog(message: string): void {
  writeToLogFile("INFO", message)
}

/**
 * Workflow error logger that writes ONLY to /tmp file
 */
export function workflowError(message: string, error?: unknown): void {
  if (error) {
    writeToLogFile("ERROR", `${message} ${error instanceof Error ? error.message : String(error)}`)
  } else {
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
