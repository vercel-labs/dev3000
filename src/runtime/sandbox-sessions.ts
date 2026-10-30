import { randomUUID } from "node:crypto"
import { mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { isAbsolute, join } from "node:path"
import { HARNESS_LOCATIONS, HARNESS_NAMES, type Harness, type HarnessLocation } from "./harness.js"

export interface SandboxSession {
  version: 1
  id: string
  project: string
  projectName: string
  team: string
  scope?: string
  sandbox: string
  hostname: string
  appUrl: string
  workdir: string
  branch?: string
  command?: string
  installCommand?: string
  timeout: string
  harness?: Harness
  harnessLocation?: HarnessLocation
  fxWorkspace?: string
  fx: boolean
  gateway?: boolean
  gatewayBudget?: string
  ownsSandbox: boolean
  createdAt: string
  lastUsedAt: string
  closedAt?: string
  launcherPid?: number
}

export const sandboxSessionsDirectory = () => join(homedir(), ".d3k", "sandbox-sessions")
const isId = (id: string) => /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id)

function validSession(value: unknown): value is SandboxSession {
  if (!value || typeof value !== "object") return false
  const record = value as SandboxSession
  return (
    record.version === 1 &&
    (record.harness === undefined || HARNESS_NAMES.includes(record.harness)) &&
    (record.harnessLocation === undefined || HARNESS_LOCATIONS.includes(record.harnessLocation)) &&
    typeof record.id === "string" &&
    isId(record.id) &&
    [
      record.project,
      record.projectName,
      record.team,
      record.sandbox,
      record.hostname,
      record.appUrl,
      record.workdir,
      record.timeout,
      record.createdAt,
      record.lastUsedAt
    ].every((value) => typeof value === "string" && !!value) &&
    typeof record.fx === "boolean" &&
    (record.fxWorkspace === undefined ||
      (typeof record.fxWorkspace === "string" &&
        isAbsolute(record.fxWorkspace) &&
        !record.fxWorkspace.includes("\0"))) &&
    (record.gateway === undefined || typeof record.gateway === "boolean") &&
    (record.gatewayBudget === undefined ||
      (typeof record.gatewayBudget === "string" &&
        Number.isFinite(Number(record.gatewayBudget)) &&
        Number(record.gatewayBudget) >= 1)) &&
    typeof record.ownsSandbox === "boolean" &&
    [record.scope, record.branch, record.command, record.installCommand, record.closedAt].every(
      (value) => value === undefined || typeof value === "string"
    ) &&
    (record.launcherPid === undefined || (Number.isSafeInteger(record.launcherPid) && record.launcherPid > 0))
  )
}

/** Keep fx's workspace identity stable; its own profile owns conversation history. */
export function sandboxFxWorkspace(record: SandboxSession, directory = sandboxSessionsDirectory()): string {
  if (!isId(record.id)) throw new Error("Invalid sandbox session ID")
  return record.fxWorkspace || join(directory, "workspaces", record.id)
}

export function readSandboxSession(id: string, directory = sandboxSessionsDirectory()): SandboxSession {
  if (!isId(id)) throw new Error("Invalid resume ID. Run d3k --resume to list saved sandbox sessions.")
  let record: unknown
  try {
    record = JSON.parse(readFileSync(join(directory, `${id}.json`), "utf8"))
  } catch {
    throw new Error(`No saved sandbox session ${id}. Run d3k --resume to list sessions.`)
  }
  if (!validSession(record) || record.id !== id) throw new Error(`Invalid saved sandbox session ${id}`)
  return record
}

export function listSandboxSessions(directory = sandboxSessionsDirectory()): SandboxSession[] {
  let files: string[]
  try {
    files = readdirSync(directory)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return []
    throw error
  }
  return files
    .flatMap((file) => {
      if (!file.endsWith(".json") || !isId(file.slice(0, -5))) return []
      try {
        return [readSandboxSession(file.slice(0, -5), directory)]
      } catch {
        return []
      }
    })
    .sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt))
}

export function saveSandboxSession(record: SandboxSession, directory = sandboxSessionsDirectory()): void {
  if (!validSession(record)) throw new Error("Invalid sandbox session metadata")
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const temporary = join(directory, `${record.id}.${randomUUID()}.tmp`)
  writeFileSync(temporary, JSON.stringify(record), { mode: 0o600 })
  renameSync(temporary, join(directory, `${record.id}.json`))
}

export function sandboxLauncherAlive(record: SandboxSession): boolean {
  if (!record.launcherPid) return false
  try {
    process.kill(record.launcherPid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM"
  }
}

export function formatSandboxSessions(records: SandboxSession[]): string {
  if (!records.length) return "No saved sandbox sessions. Start one with d3k --project <team/project>."
  const clean = (text: string) =>
    Array.from(text, (character) => {
      const code = character.codePointAt(0) || 0
      return code < 32 || (code >= 127 && code <= 159) ? " " : character
    }).join("")
  return [
    "Saved sandbox sessions (remote availability is checked when resuming):",
    ...records.map(
      (record) =>
        `${record.id}  ${clean(record.scope || record.team)}/${clean(record.projectName)}  ${clean(record.sandbox)}${record.branch ? `  branch: ${clean(record.branch)}` : ""}\n  ${clean(record.appUrl)}  last used: ${clean(record.lastUsedAt)}${sandboxLauncherAlive(record) ? "  companion running" : ""}`
    ),
    "Resume with: d3k --resume <id>"
  ].join("\n")
}
