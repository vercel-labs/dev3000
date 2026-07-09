import { findCurrentSession, type Session } from "../utils/session.js"

export interface D3kStatus {
  running: boolean
  ready: boolean
  projectName?: string
  pid?: number
  appUrl?: string | null
  appPort?: string
  browserConnected?: boolean
  cdpUrl?: string | null
  logFilePath?: string
  serverCommand?: string | null
  serverPid?: number | null
  startedAt?: string
  routing?: "portless" | "direct"
}

export function getD3kStatus(session: Session | null = findCurrentSession()): D3kStatus {
  if (!session) {
    return { running: false, ready: false }
  }

  return {
    running: true,
    ready: session.ready === true,
    projectName: session.projectName,
    pid: session.pid,
    appUrl: session.publicUrl || (session.appPort ? `http://localhost:${session.appPort}` : null),
    appPort: session.appPort,
    browserConnected: Boolean(session.cdpUrl),
    cdpUrl: session.cdpUrl || null,
    logFilePath: session.logFilePath,
    serverCommand: session.serverCommand || null,
    serverPid: session.serverPid || null,
    startedAt: session.startTime,
    routing: session.portless ? "portless" : "direct"
  }
}

export function printD3kStatus(options: { json?: boolean } = {}): number {
  const status = getD3kStatus()

  if (options.json) {
    console.log(JSON.stringify(status, null, 2))
    // "not running" is expected control flow for agents deciding whether to
    // start d3k, so machine-readable status should not surface as a tool error.
    return 0
  }

  if (!status.running) {
    console.log("d3k is not running for this project.")
    return 1
  }

  console.log(`d3k is running for ${status.projectName} (PID ${status.pid})`)
  if (status.appUrl) console.log(`App: ${status.appUrl}`)
  console.log(`Browser: ${status.browserConnected ? "connected" : "not connected"}`)
  if (status.logFilePath) console.log(`Logs: ${status.logFilePath}`)
  if (status.serverCommand) console.log(`Command: ${status.serverCommand}`)
  return 0
}
