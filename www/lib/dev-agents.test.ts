import { beforeEach, describe, expect, it, vi } from "vitest"
import { GET, PUT } from "@/app/api/dev-agents/[id]/route"
import { GET as getCatalog } from "@/app/api/dev-agents/route"
import { createDevAgentEveArtifactDescriptor, createDevAgentEveSource } from "@/lib/dev-agent-eve-spec"
import {
  canEditDevAgent,
  createCustomDevAgent,
  type DevAgent,
  type DevAgentAuthor,
  getDevAgent,
  listCustomDevAgents,
  updateCustomDevAgent
} from "@/lib/dev-agents"

const state = vi.hoisted(() => ({
  blobs: new Map<string, string>(),
  user: null as DevAgentAuthor | null,
  put: vi.fn(),
  publish: vi.fn()
}))

vi.mock("@vercel/blob", () => ({
  list: async ({ prefix }: { prefix: string }) => ({
    blobs: [...state.blobs.keys()].filter((pathname) => pathname.startsWith(prefix)).map((pathname) => ({ pathname }))
  })
}))
vi.mock("@/lib/auth", () => ({ getCurrentUser: async () => state.user }))
vi.mock("@/lib/blob-store", () => ({
  readBlobJson: async (pathname: string) => JSON.parse(state.blobs.get(pathname) || "null"),
  putBlobAndBuildUrl: async (pathname: string, body: string) => {
    state.put(pathname, body)
    state.blobs.set(pathname, body)
    return { appUrl: `https://example.invalid/${pathname}` }
  }
}))
vi.mock("@/lib/dev-agent-eve", () => ({
  publishDevAgentEveArtifact: async (
    input: Parameters<typeof createDevAgentEveArtifactDescriptor>[0],
    revision: number
  ) => {
    state.publish(input, revision)
    return createDevAgentEveArtifactDescriptor(input, revision)
  }
}))

const alice = { id: "alice", email: "alice@example.invalid", name: "Alice", username: "alice" }
const bob = { id: "bob", email: "bob@example.invalid", name: "Bob", username: "bob" }
const team = { id: "team-alice", slug: "alice", name: "Alice", isPersonal: true }
const ids = ["deepsec", "dev-agent-deepsec-security-scan", "devAgent-deepsec-security-scan"]
const marker = "UNTRUSTED_OVERRIDE_MARKER"
const params = (id: string) => ({ params: Promise.resolve({ id }) })
const request = (id: string, body: unknown) =>
  new Request(`https://example.invalid/api/dev-agents/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  })

async function builtin(): Promise<DevAgent> {
  const agent = await getDevAgent("deepsec")
  if (!agent) throw new Error("Missing builtin fixture")
  return agent
}

beforeEach(() => {
  state.blobs.clear()
  state.user = alice
  state.put.mockClear()
  state.publish.mockClear()
})

describe("shared dev agent integrity", () => {
  it.each(ids)("rejects builtin PUTs and direct writes for %s", async (id) => {
    const original = await builtin()
    const payload = { ...original, instructions: marker }
    const response = await PUT(request(id, payload), params(id))
    expect(response.status).toBe(403)
    expect(await updateCustomDevAgent(id, { ...payload, author: alice })).toBeNull()
    expect(state.put).not.toHaveBeenCalled()
    expect(state.publish).not.toHaveBeenCalled()
    expect((await getDevAgent(id))?.instructions).toBe(original.instructions)
  })

  it("still requires authentication", async () => {
    state.user = null
    expect((await PUT(request("deepsec", await builtin()), params("deepsec"))).status).toBe(401)
    expect(state.put).not.toHaveBeenCalled()
  })

  it.each(ids)(
    "ignores previously persisted overrides for %s in reads, catalogs and compiled instructions",
    async (id) => {
      const original = await builtin()
      const poisoned = {
        ...original,
        id,
        instructions: marker,
        actionSteps: [{ kind: "send-prompt", config: { prompt: marker } }],
        updatedAt: "2099-01-01T00:00:00.000Z"
      }
      state.blobs.set(`dev-agents/custom/${id}.json`, JSON.stringify(poisoned))
      state.user = bob
      for (const readId of ids) {
        const response = await GET(new Request(`https://example.invalid/api/dev-agents/${readId}`), params(readId))
        const { devAgent } = (await response.json()) as { devAgent: DevAgent }
        expect(devAgent).toEqual(original)
        const source = await createDevAgentEveSource(devAgent, 1)
        expect(source.files.find((file) => file.path === "agent/instructions.md")?.content).not.toContain(marker)
        expect(devAgent.eveArtifact?.compiledSpec?.instructions).toBe(original.eveArtifact?.compiledSpec?.instructions)
      }
      const response = await getCatalog(new Request("https://example.invalid/api/dev-agents?teamId=team-bob"))
      const { devAgents } = (await response.json()) as { devAgents: DevAgent[] }
      expect(devAgents.find((agent) => agent.id === original.id)).toEqual(original)
      expect(await listCustomDevAgents()).toEqual([])
    }
  )

  it("does not authorize shared IDs even when their author is replaced", async () => {
    const original = await builtin()
    for (const id of ids) {
      expect(canEditDevAgent({ ...original, id, author: alice }, alice)).toBe(false)
    }
  })

  it.each([
    { ...alice, id: "system" },
    { ...alice, username: "dev3000" },
    { ...alice, email: "system@dev3000.ai" }
  ])("never treats a reserved author identity as caller privilege: %j", async (author) => {
    const agent = { ...(await builtin()), id: "custom-reserved-author", author }
    expect(canEditDevAgent(agent, alice)).toBe(false)
    expect(canEditDevAgent(agent, bob)).toBe(false)
  })

  it("preserves custom-agent creation and owner edits while rejecting other users", async () => {
    const original = await builtin()
    const custom = await createCustomDevAgent({ ...original, author: alice, team })
    expect(custom.id).not.toBe(original.id)
    const payload = { ...custom, instructions: "Owner's updated instructions" }
    const response = await PUT(request(custom.id, payload), params(custom.id))
    expect(response.status).toBe(200)
    expect((await getDevAgent(custom.id))?.instructions).toBe(payload.instructions)
    expect((await getDevAgent(custom.id))?.author).toEqual(alice)
    state.put.mockClear()
    state.publish.mockClear()
    state.user = bob
    expect((await PUT(request(custom.id, { ...payload, author: bob }), params(custom.id))).status).toBe(403)
    expect(await updateCustomDevAgent(custom.id, { ...payload, author: bob })).toBeNull()
    expect(state.put).not.toHaveBeenCalled()
    expect(state.publish).not.toHaveBeenCalled()
    expect((await getDevAgent("deepsec"))?.instructions).toBe(original.instructions)
  })
})
