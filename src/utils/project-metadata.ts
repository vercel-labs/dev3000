import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs"
import { join } from "path"
import { getProjectDir } from "./project-name.js"

interface ProjectSessionInfo {
  agentName?: string | null
}

interface ProjectMetadataFile {
  lastAgentName?: string | null
}

function normalizeAgentName(agentName: unknown): string | null {
  return typeof agentName === "string" && agentName.trim().length > 0 ? agentName.trim() : null
}

function readJsonFile<T>(filePath: string): T | null {
  if (!existsSync(filePath)) {
    return null
  }

  try {
    return JSON.parse(readFileSync(filePath, "utf-8")) as T
  } catch {
    return null
  }
}

export function getProjectMetadataPath(cwd: string = process.cwd()): string {
  return join(getProjectDir(cwd), "project.json")
}

export function readProjectAgentName(cwd: string = process.cwd()): string | null {
  const projectDir = getProjectDir(cwd)

  const sessionInfo = readJsonFile<ProjectSessionInfo>(join(projectDir, "session.json"))
  const sessionAgentName = normalizeAgentName(sessionInfo?.agentName)
  if (sessionAgentName) {
    return sessionAgentName
  }

  const projectMetadata = readJsonFile<ProjectMetadataFile>(getProjectMetadataPath(cwd))
  return normalizeAgentName(projectMetadata?.lastAgentName)
}

export function rememberProjectAgentName(agentName: string, cwd: string = process.cwd()): void {
  const normalizedAgentName = normalizeAgentName(agentName)
  if (!normalizedAgentName) {
    return
  }

  const projectDir = getProjectDir(cwd)
  if (!existsSync(projectDir)) {
    mkdirSync(projectDir, { recursive: true })
  }

  const metadataPath = getProjectMetadataPath(cwd)
  const existingMetadata = readJsonFile<Record<string, unknown>>(metadataPath) ?? {}
  const metadata: Record<string, unknown> = {
    ...existingMetadata,
    lastAgentName: normalizedAgentName
  }

  writeFileSync(metadataPath, JSON.stringify(metadata, null, 2))
}
