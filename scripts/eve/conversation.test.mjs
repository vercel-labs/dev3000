import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, expect, it, vi } from "vitest"
import { openEveConversation, prepareEveWorkspaceScript, saveEveConversationScript } from "./conversation.mjs"

const roots = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
const owner = "saved-sandbox"
const workdir = "/vercel/project"
const id = "wrun_01M6QHTXRYRKNVQKPGTG3FHC6E"
const state = { version: 1, owner, workdir, conversationId: id }

it("persists a new conversation identity before returning it to the UI", async () => {
  const session = { id }
  const client = { sessions: { create: vi.fn(async () => ({ session })) } }
  let persisted
  const returned = await openEveConversation({
    client,
    owner,
    workdir,
    save: async (value) => {
      persisted = value
    }
  })
  expect(returned).toBe(session)
  expect(persisted).toEqual(state)
})

it("attaches the saved conversation and verifies history without creating or resending a prompt", async () => {
  const session = { id, snapshot: vi.fn(async () => ({ events: [] })) }
  const client = { sessions: { attach: vi.fn(() => session), create: vi.fn() } }
  expect(await openEveConversation({ client, state, owner, workdir })).toBe(session)
  expect(client.sessions.attach).toHaveBeenCalledWith(id)
  expect(session.snapshot).toHaveBeenCalledOnce()
  expect(client.sessions.create).not.toHaveBeenCalled()
})

it("does not fall back to a new conversation when saved history is unavailable", async () => {
  const client = {
    sessions: {
      attach: () => ({
        snapshot: async () => {
          throw new Error("history missing")
        }
      }),
      create: vi.fn()
    }
  }
  await expect(openEveConversation({ client, state, owner, workdir })).rejects.toThrow(
    "No new conversation was created"
  )
  expect(client.sessions.create).not.toHaveBeenCalled()
})

it.each([{ owner: "another-sandbox" }, { workdir: "/vercel/other" }, { conversationId: "invalid" }])(
  "rejects mismatched or corrupt discovery state %j",
  async (changed) => {
    const client = { sessions: { attach: vi.fn(), create: vi.fn() } }
    await expect(openEveConversation({ client, state: { ...state, ...changed }, owner, workdir })).rejects.toThrow(
      "does not match"
    )
    expect(client.sessions.attach).not.toHaveBeenCalled()
    expect(client.sessions.create).not.toHaveBeenCalled()
  }
)

it("adopts legacy history into a stable session path and retains it across builds and subsequent resumes", () => {
  const root = mkdtempSync(join(tmpdir(), "d3k-conversation-"))
  roots.push(root)
  const legacy = join(root, "d3k-eve-0123456789ab")
  mkdirSync(join(legacy, "agent"), { recursive: true })
  writeFileSync(join(legacy, "agent/instructions.md"), `${workdir} https://project.d3k.localhost`)
  const runs = join(legacy, ".eve/.workflow-data/runs")
  mkdirSync(runs, { recursive: true })
  writeFileSync(
    join(runs, `${id}.json`),
    JSON.stringify({ runId: id, workflowName: "workflow//eve//workflowEntry", createdAt: "2026-11-05T00:00:00Z" })
  )
  // Timeout workflows must never be mistaken for conversations.
  writeFileSync(
    join(runs, "timeout.json"),
    JSON.stringify({
      runId: "timeout",
      workflowName: "workflow//eve//sessionTimeoutWorkflow",
      createdAt: "2026-11-06T00:00:00Z"
    })
  )
  const directory = join(root, "sessions", owner)
  const prepare = () => {
    const result = spawnSync(
      process.execPath,
      ["-e", prepareEveWorkspaceScript, directory, owner, workdir, "https://project.d3k.localhost", root],
      { encoding: "utf8" }
    )
    expect(result.status, result.stderr).toBe(0)
    return JSON.parse(result.stdout)
  }
  expect(prepare()).toEqual({ state, migrated: true })
  expect(realpathSync(directory)).toBe(realpathSync(legacy))
  writeFileSync(join(directory, "agent/agent.ts"), "updated service source")
  expect(prepare()).toEqual({ state, migrated: false })
  // A lost pointer is recovered from history instead of starting over.
  rmSync(join(directory, ".d3k-conversation.json"))
  expect(prepare()).toEqual({ state, migrated: true })
  const updated = { ...state, model: "selected-model" }
  const saved = spawnSync(process.execPath, ["-e", saveEveConversationScript, directory, JSON.stringify(updated)])
  expect(saved.status).toBe(0)
  expect(JSON.parse(readFileSync(join(directory, ".d3k-conversation.json"), "utf8"))).toEqual(updated)
})
