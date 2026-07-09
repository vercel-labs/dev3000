import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { join, resolve } from "node:path"
import { getProjectDir, getProjectName } from "./project-name.js"

export interface Session {
  projectName: string
  startTime?: string
  logFilePath?: string
  sessionFile: string
  pid: number
  lastModified: Date
  appPort?: string
  publicUrl?: string | null
  cdpUrl?: string | null
  cwd?: string
  serverCommand?: string | null
  serverPid?: number | null
  portless?: boolean
  ready?: boolean
}

function readActiveSession(sessionFile: string): Session | null {
  if (!existsSync(sessionFile)) {
    return null
  }

  try {
    const content = JSON.parse(readFileSync(sessionFile, "utf-8"))
    if (!content.pid) {
      return null
    }

    process.kill(content.pid, 0)
    const stat = statSync(sessionFile)
    return {
      ...content,
      sessionFile,
      lastModified: stat.mtime
    }
  } catch {
    return null
  }
}

function byNewestSession(a: Session, b: Session): number {
  const aTime = a.startTime ? new Date(a.startTime).getTime() : a.lastModified.getTime()
  const bTime = b.startTime ? new Date(b.startTime).getTime() : b.lastModified.getTime()
  return bTime - aTime
}

export function findActiveSessions(): Session[] {
  const sessionFiles = new Set<string>()

  sessionFiles.add(resolve(join(getProjectDir(), "session.json")))

  const defaultSessionDir = join(homedir(), ".d3k")
  if (existsSync(defaultSessionDir)) {
    try {
      for (const entry of readdirSync(defaultSessionDir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          sessionFiles.add(resolve(join(defaultSessionDir, entry.name, "session.json")))
        }
      }
    } catch {
      // Ignore unreadable session directories.
    }
  }

  return Array.from(sessionFiles)
    .map((sessionFile) => readActiveSession(sessionFile))
    .filter((session): session is Session => session !== null)
    .sort(byNewestSession)
}

export function findCurrentSession(): Session | null {
  const sessions = findActiveSessions()
  if (sessions.length === 0) {
    return null
  }

  const exactSessionFile = resolve(join(getProjectDir(), "session.json"))
  const exactSession = sessions.find((session) => resolve(session.sessionFile) === exactSessionFile)
  if (exactSession) {
    return exactSession
  }

  const currentProject = getProjectName()
  return sessions.find((session) => session.projectName === currentProject) || null
}
