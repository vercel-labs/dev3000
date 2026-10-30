import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  formatSandboxSessions,
  listSandboxSessions,
  readSandboxSession,
  type SandboxSession,
  sandboxFxWorkspace,
  saveSandboxSession
} from "./sandbox-sessions.js"

const directories: string[] = []
const fixture = () => {
  const directory = mkdtempSync(join(tmpdir(), "d3k-resume-test-"))
  directories.push(directory)
  return directory
}
const record: SandboxSession = {
  version: 1,
  id: "04b39196-d4e2-4f3b-8ffc-7d3fdb067f6a",
  project: "prj_test",
  projectName: "songbook-studio",
  team: "team_test",
  scope: "elsigh-pro",
  sandbox: "my-sandbox",
  hostname: "songbook",
  appUrl: "https://songbook.d3k.localhost",
  workdir: "/vercel/songbook.studio",
  branch: "main",
  command: "bun run dev:next",
  timeout: "30",
  fx: false,
  ownsSandbox: false,
  createdAt: "2026-10-28T00:00:00.000Z",
  lastUsedAt: "2026-10-28T00:00:00.000Z"
}
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})
describe("sandbox resume discovery", () => {
  it("persists private metadata and updates the same ID without duplicate history", () => {
    const directory = fixture()
    saveSandboxSession(record, directory)
    expect(readSandboxSession(record.id, directory)).toEqual(record)
    expect(statSync(join(directory, `${record.id}.json`)).mode & 0o777).toBe(0o600)
    const updated = { ...record, lastUsedAt: "2026-10-28T01:00:00.000Z", closedAt: "2026-10-28T02:00:00.000Z" }
    saveSandboxSession(updated, directory)
    expect(listSandboxSessions(directory)).toEqual([updated])
    expect(readFileSync(join(directory, `${record.id}.json`), "utf8")).not.toContain("token")
  })
  it("keeps fx's workspace stable and restores an older recorded workspace", () => {
    const directory = fixture()
    const workspace = sandboxFxWorkspace(record, directory)
    expect(workspace).toBe(join(directory, "workspaces", record.id))
    const saved = { ...record, harness: "fx" as const, harnessLocation: "local" as const, fxWorkspace: workspace }
    saveSandboxSession(saved, directory)
    expect(sandboxFxWorkspace(readSandboxSession(record.id, directory), "/different/temp")).toBe(workspace)
    const legacy = { ...saved, fxWorkspace: "/private/tmp/d3k-sandbox-old/control" }
    saveSandboxSession(legacy, directory)
    expect(sandboxFxWorkspace(readSandboxSession(record.id, directory))).toBe(legacy.fxWorkspace)
    expect(() => saveSandboxSession({ ...saved, fxWorkspace: "../escape" }, directory)).toThrow("Invalid")
  })

  it("sorts sessions by recent use and skips malformed discovery records", () => {
    const directory = fixture()
    saveSandboxSession(record, directory)
    const newer = {
      ...record,
      id: "e7a5e9ef-a7db-4edb-9347-a95543767436",
      sandbox: "another",
      lastUsedAt: "2026-10-28T03:00:00.000Z"
    }
    saveSandboxSession(newer, directory)
    writeFileSync(join(directory, "69d07a2b-5a2e-4467-83cd-a50b3bba1c2b.json"), "{}")
    expect(listSandboxSessions(directory)).toEqual([newer, record])
    const text = formatSandboxSessions(listSandboxSessions(directory))
    expect(text).toContain(record.id)
    expect(text).toContain("elsigh-pro/songbook-studio")
    expect(text).toContain("branch: main")
    expect(text).toContain("d3k --resume <id>")
  })
  it("rejects path traversal and missing sessions with actionable errors", () => {
    const directory = fixture()
    expect(() => readSandboxSession("../../credentials", directory)).toThrow("Invalid resume ID")
    expect(() => readSandboxSession(record.id, directory)).toThrow("No saved sandbox session")
    expect(formatSandboxSessions([])).toContain("No saved sandbox sessions")
  })
})
