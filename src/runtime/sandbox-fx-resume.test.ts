import { realpathSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it, vi } from "vitest"
import { discoverLegacyFxWorkspace, legacyFxWorkspace } from "./sandbox-fx-resume.js"
import type { SandboxSession } from "./sandbox-sessions.js"

const record: SandboxSession = {
  version: 1,
  id: "04b39196-d4e2-4f3b-8ffc-7d3fdb067f6a",
  project: "test",
  projectName: "test",
  team: "test",
  sandbox: "test",
  hostname: "test",
  appUrl: "https://test.localhost",
  workdir: "/vercel/app",
  timeout: "60",
  fx: true,
  harness: "fx",
  harnessLocation: "local",
  ownsSandbox: true,
  createdAt: "2026-10-30T00:00:00Z",
  lastUsedAt: "2026-10-30T00:00:00Z",
  closedAt: "2026-10-30T01:00:00Z"
}
const root = join(realpathSync(tmpdir()), "d3k-sandbox-legacy", "control")
const session = {
  workspace_root: root,
  created_at_ms: Date.parse("2026-10-30T00:01:00Z"),
  updated_at_ms: Date.parse("2026-10-30T00:59:00Z")
}

describe("legacy fx workspace recovery", () => {
  it("finds a unique old workspace using metadata without needing its deleted directory or transcript", () => {
    expect(legacyFxWorkspace(record, [record], [session])).toBe(root)
    expect(
      legacyFxWorkspace(record, [record], [session, { ...session, created_at_ms: session.created_at_ms + 1000 }])
    ).toBe(root)
  })
  it("does not guess across overlapping launchers, multiple workspaces, unrelated paths or incomplete lifetimes", () => {
    const overlap = { ...record, id: "e7a5e9ef-a7db-4edb-9347-a95543767436" }
    expect(legacyFxWorkspace(record, [record, overlap], [session])).toBeUndefined()
    expect(
      legacyFxWorkspace(
        record,
        [record],
        [session, { ...session, workspace_root: join(realpathSync(tmpdir()), "d3k-sandbox-other", "control") }]
      )
    ).toBeUndefined()
    expect(legacyFxWorkspace(record, [record], [{ ...session, workspace_root: "/some/project" }])).toBeUndefined()
    expect(legacyFxWorkspace({ ...record, closedAt: undefined }, [record], [session])).toBeUndefined()
    expect(
      legacyFxWorkspace(record, [record], [{ ...session, created_at_ms: Date.parse("2026-10-29T00:00:00Z") }])
    ).toBeUndefined()
  })
  it("paginates fx's supported session listing before deciding a match is unique", async () => {
    const invoke = vi
      .fn()
      .mockResolvedValueOnce(JSON.stringify({ sessions: [], has_more: true, next_cursor: "next" }))
      .mockResolvedValueOnce(JSON.stringify({ sessions: [session], has_more: false }))
    expect(await discoverLegacyFxWorkspace(record, [record], invoke)).toBe(root)
    expect(invoke.mock.calls[1][0]).toContain("next")
  })
})
