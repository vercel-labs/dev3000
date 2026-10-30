import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ verify: vi.fn(), owner: vi.fn(), call: vi.fn(), start: vi.fn() }))
vi.mock("./auth", () => ({
  hostedAuth: () => ({
    config: {
      origin: "https://d3k.example",
      issuer: "https://d3k.example/api/mcp-auth",
      resource: "https://d3k.example/mcp",
      projects: [{ slug: "test/app" }]
    }
  }),
  requireOwner: mocks.owner
}))
vi.mock("./token", () => ({ verifyHostedToken: mocks.verify }))
vi.mock("./sandbox", () => ({ callCloudSession: mocks.call, startCloudSession: mocks.start }))

import { hostedMcp } from "./mcp"

function request(method: string, params = {}, headers: Record<string, string> = {}) {
  return new Request("https://d3k.example/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: "Bearer test-token",
      ...headers
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.verify.mockResolvedValue("owner")
  mocks.owner.mockResolvedValue(undefined)
  mocks.call.mockResolvedValue({ phase: "ready" })
})

describe("hosted MCP HTTP transport", () => {
  it("keeps the complete initialization response readable after closing the stateless server", async () => {
    const response = await hostedMcp(
      request("initialize", {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "test", version: "1" }
      })
    )
    expect(response.status).toBe(200)
    expect((await response.json()).result.serverInfo.name).toBe("d3k-hosted")
    expect(response.headers.get("cache-control")).toBe("no-store")
  })
  it("routes an explicit session ID to the authenticated owner on an independent request", async () => {
    const session = "8dd3b281-fc90-4612-a902-35e9b14f3dd6"
    const response = await hostedMcp(request("tools/call", { name: "sandbox_status", arguments: { session } }))
    expect(response.status).toBe(200)
    expect((await response.json()).result.content[0].text).toContain("ready")
    expect(mocks.call).toHaveBeenCalledWith("owner", "sandbox_status", { session })
  })
  it("rejects requests with no resource token and advertises OAuth discovery", async () => {
    const response = await hostedMcp(request("tools/list", {}, { Authorization: "" }))
    expect(response.status).toBe(401)
    expect(response.headers.get("www-authenticate")).toContain("/.well-known/oauth-protected-resource/mcp")
    expect(mocks.call).not.toHaveBeenCalled()
  })
  it("rejects unrelated browser origins before checking credentials", async () => {
    const response = await hostedMcp(request("tools/list", {}, { Origin: "https://unrelated.example" }))
    expect(response.status).toBe(403)
    expect(mocks.verify).not.toHaveBeenCalled()
  })
  it("rechecks owner admission after token verification", async () => {
    mocks.owner.mockRejectedValueOnce(new Error("Not admitted"))
    const response = await hostedMcp(request("tools/list"))
    expect(response.status).toBe(401)
    expect(mocks.call).not.toHaveBeenCalled()
  })
})
