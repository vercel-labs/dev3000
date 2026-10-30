import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ query: vi.fn(), transaction: vi.fn(), release: vi.fn(), get: vi.fn() }))
vi.mock("./auth", () => ({
  hostedAuth: () => ({
    database: {
      query: mocks.query,
      connect: async () => ({ query: mocks.transaction, release: mocks.release })
    },
    config: { projects: [{ slug: "test/app", teamId: "team_test", projectId: "prj_test" }] }
  })
}))
vi.mock("@vercel/sandbox", () => ({ Sandbox: { get: mocks.get } }))

import { callCloudSession, startCloudSession } from "./sandbox"

beforeEach(() => {
  vi.clearAllMocks()
  mocks.query.mockResolvedValue({ rows: [] })
  mocks.transaction.mockResolvedValue({ rows: [] })
})

describe("hosted session ownership", () => {
  it("does not access a sandbox when another user guesses its session ID", async () => {
    await expect(
      callCloudSession("other-user", "sandbox_exec", {
        session: "8dd3b281-fc90-4612-a902-35e9b14f3dd6",
        command: "pwd"
      })
    ).rejects.toThrow("not found")
    expect(mocks.query.mock.calls[0][1]).toEqual(["8dd3b281-fc90-4612-a902-35e9b14f3dd6", "other-user"])
    expect(mocks.get).not.toHaveBeenCalled()
  })
  it("filters session discovery to the authenticated user", async () => {
    expect(await callCloudSession("owner", "sandbox_sessions", {})).toEqual([])
    expect(mocks.query.mock.calls[0][1]).toEqual(["owner"])
  })
  it("rejects non-allowlisted projects before using any infrastructure credentials", async () => {
    await expect(startCloudSession("owner", { project: "other/app" })).rejects.toThrow("not enabled")
    expect(mocks.query).not.toHaveBeenCalled()
    expect(mocks.get).not.toHaveBeenCalled()
  })
  it("enforces the active workspace cap on resume before accessing compute", async () => {
    const saved = {
      id: "8dd3b281-fc90-4612-a902-35e9b14f3dd6",
      owner: "owner",
      project: "test/app",
      phase: "stopped",
      expiresAt: 0,
      sandbox: "saved-vm"
    }
    mocks.query.mockResolvedValue({ rows: [saved] })
    mocks.transaction.mockImplementation(async (sql: string) => ({
      rows: sql.startsWith("SELECT *") ? [saved] : sql.startsWith("SELECT count") ? [{ count: "2" }] : []
    }))
    await expect(startCloudSession("owner", { resume: saved.id })).rejects.toThrow("two active")
    expect(mocks.transaction.mock.calls.some(([sql]) => sql.includes("pg_advisory_xact_lock"))).toBe(true)
    expect(mocks.transaction.mock.calls.at(-1)?.[0]).toBe("ROLLBACK")
    expect(mocks.release).toHaveBeenCalled()
    expect(mocks.get).not.toHaveBeenCalled()
  })
  it("does not restart a session already claimed by a concurrent resume", async () => {
    const saved = {
      id: "8dd3b281-fc90-4612-a902-35e9b14f3dd6",
      owner: "owner",
      project: "test/app",
      phase: "stopped",
      expiresAt: 0,
      sandbox: "saved-vm"
    }
    mocks.query.mockResolvedValue({ rows: [saved] })
    mocks.transaction.mockImplementation(async (sql: string) => ({
      rows: sql.startsWith("SELECT *") ? [{ ...saved, phase: "starting", expiresAt: Date.now() + 60000 }] : []
    }))
    expect(await startCloudSession("owner", { resume: saved.id })).toMatchObject({ phase: "starting" })
    expect(mocks.transaction.mock.calls.at(-1)?.[0]).toBe("COMMIT")
    expect(mocks.get).not.toHaveBeenCalled()
  })
})
