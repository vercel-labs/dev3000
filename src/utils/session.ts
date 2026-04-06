/**
 * Shared session discovery for d3k CLI commands.
 *
 * Finds active d3k sessions by scanning ~/.d3k/{project}/session.json,
 * preferring the session that matches the current working directory.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { getProjectName } from "./project-name.js"

export interface Session {
  projectName: string
  startTime: string
  logFilePath: string
  sessionFile: string
  pid: number
  lastModified: Date
  appPort?: string
  publicUrl?: string | null
  cdpUrl?: string | null
}

/**
 * Find all active d3k sessions, sorted by startTime (most recent first).
 */
export function findActiveSessions(): Session[] {
  const sessionDir = join(homedir(), ".d3k")
  if (!existsSync(sessionDir)) {
    return []
  }

  try {
    const entries = readdirSync(sessionDir, { withFileTypes: true })
    const sessionFiles: string[] = []

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const sessionFile = join(sessionDir, entry.name, "session.json")
        if (existsSync(sessionFile)) {
          sessionFiles.push(sessionFile)
        }
      }
    }

    return sessionFiles
      .map((filePath) => {
        try {
          const content = JSON.parse(readFileSync(filePath, "utf-8"))
          const stat = statSync(filePath)
          return {
            ...content,
            sessionFile: filePath,
            lastModified: stat.mtime
          }
        } catch {
          return null
        }
      })
      .filter((session): session is Session => {
        if (!session || !session.pid) return false
        try {
          process.kill(session.pid, 0)
          return true
        } catch {
          return false
        }
      })
      .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime())
  } catch {
    return []
  }
}

/**
 * Find the active session for the current working directory.
 * Falls back to the most recent session if no exact match is found.
 */
export function findCurrentSession(): Session | null {
  const sessions = findActiveSessions()
  if (sessions.length === 0) return null

  const currentProject = getProjectName()
  return sessions.find((s) => s.projectName === currentProject) || sessions[0]
}
