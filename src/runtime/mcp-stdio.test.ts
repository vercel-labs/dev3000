import { PassThrough } from "node:stream"
import { describe, expect, it, vi } from "vitest"
import { serveMcp } from "./mcp-stdio.js"

describe("MCP stdio", () => {
  it("negotiates protocols, stays responsive during tool calls, and returns tool errors without corrupting stdout", async () => {
    const input = new PassThrough()
    const output = new PassThrough()
    let text = ""
    output.on("data", (chunk) => {
      text += chunk.toString()
    })
    let finish: () => void = () => {}
    const pending = new Promise<void>((resolve) => {
      finish = resolve
    })
    const server = serveMcp({
      name: "test",
      instructions: "remote workspace",
      input,
      output,
      tools: [{ name: "slow", description: "Wait", inputSchema: { type: "object" } }],
      call: async (_name, args) => {
        if (args.fail) throw new Error("session ended")
        await pending
        return { content: [] }
      }
    })
    const send = (id: number, method: string, params?: object) =>
      input.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`)
    send(1, "initialize", { protocolVersion: "2025-06-18" })
    send(2, "tools/call", { name: "slow", arguments: {} })
    send(3, "ping")
    send(4, "tools/call", { name: "slow", arguments: { fail: true } })
    send(5, "tools/call", { name: "missing" })
    input.write("{broken}\n")
    const responses = () =>
      text
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line))
    try {
      await vi.waitFor(() => expect(responses().find((value) => value.id === 3)?.result).toEqual({}))
      expect(responses().some((value) => value.id === 2)).toBe(false)
      finish()
      input.end()
      await server
      expect(responses().find((value) => value.id === 1).result).toMatchObject({
        protocolVersion: "2025-06-18",
        instructions: "remote workspace"
      })
      expect(responses().find((value) => value.id === 4).result).toMatchObject({ isError: true })
      expect(responses().find((value) => value.id === 5).error.code).toBe(-32602)
      expect(responses().find((value) => value.id === null).error.code).toBe(-32700)
    } finally {
      finish()
      input.end()
      await server
    }
  })

  it("bounds unterminated input", async () => {
    const input = new PassThrough()
    const server = serveMcp({
      name: "test",
      instructions: "",
      tools: [],
      call: async () => ({ content: [] }),
      input,
      output: new PassThrough()
    })
    const assertion = expect(server).rejects.toThrow("exceeds 1 MiB")
    input.end("x".repeat(1024 * 1024 + 1))
    await assertion
  })
})
