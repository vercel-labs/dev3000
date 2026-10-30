import { realpathSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, dirname, resolve } from "node:path"
import type { SandboxSession } from "./sandbox-sessions.js"

interface FxSession {
  workspace_root: string
  created_at_ms: number
  updated_at_ms: number
}

/** Recover old temporary workspace identities from fx metadata, never conversation contents. */
export function legacyFxWorkspace(
  record: SandboxSession,
  records: SandboxSession[],
  sessions: FxSession[]
): string | undefined {
  const start = Date.parse(record.lastUsedAt)
  const end = Date.parse(record.closedAt || "")
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return undefined
  // Concurrent launchers make a time-based association ambiguous. Do not guess.
  if (
    records.some(
      (other) =>
        other.id !== record.id &&
        other.harness === "fx" &&
        other.harnessLocation !== "sandbox" &&
        Date.parse(other.lastUsedAt) <= end &&
        Date.parse(other.closedAt || "9999-01-01") >= start
    )
  )
    return undefined
  const roots = new Set(
    sessions
      .filter(
        (session) =>
          typeof session.workspace_root === "string" &&
          session.created_at_ms >= start &&
          session.updated_at_ms >= session.created_at_ms &&
          session.updated_at_ms <= end &&
          basename(session.workspace_root) === "control" &&
          basename(dirname(session.workspace_root)).startsWith("d3k-sandbox-") &&
          dirname(dirname(resolve(session.workspace_root))) === realpathSync(tmpdir())
      )
      .map((session) => session.workspace_root)
  )
  return roots.size === 1 ? [...roots][0] : undefined
}

export async function discoverLegacyFxWorkspace(
  record: SandboxSession,
  records: SandboxSession[],
  invoke: (args: string[]) => Promise<string>
): Promise<string | undefined> {
  const sessions: FxSession[] = []
  let cursor: string | undefined
  for (let page = 0; page < 10; page++) {
    const response = JSON.parse(
      await invoke(["sessions", "--all", "--json", "--limit", "100", ...(cursor ? ["--cursor", cursor] : [])])
    ) as {
      sessions: FxSession[]
      has_more?: boolean
      next_cursor?: string
    }
    if (!Array.isArray(response.sessions)) throw new Error("fx did not return saved-session metadata")
    sessions.push(...response.sessions)
    if (!response.has_more) return legacyFxWorkspace(record, records, sessions)
    if (!response.next_cursor || response.next_cursor === cursor) break
    cursor = response.next_cursor
  }
  // An incomplete listing cannot establish that the association is unique.
  return undefined
}
