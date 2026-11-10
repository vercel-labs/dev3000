import { spawn } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it, vi } from "vitest"
import { startWorkspaceBroker } from "./sandbox-workspace.js"
import { runWorkspaceClient } from "./workspace-client.js"

describe("workspace stdio transport", () => {
  it("returns a long capture result while keeping ordinary request deadlines bounded", async () => {
    const directory = mkdtempSync(join(tmpdir(), "d3k-workspace-capture-"))
    const config = join(directory, "connection.json")
    writeFileSync(config, JSON.stringify({ url: "http://127.0.0.1:1234/call", token: "test" }))
    vi.useFakeTimers()
    vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
      const controller = new AbortController()
      setTimeout(() => controller.abort(new Error("Request timed out")), ms)
      return controller.signal
    })
    let responseDelay = 75000
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url, options: RequestInit) =>
          new Promise<Response>((resolve, reject) => {
            const timer = setTimeout(
              () => resolve(Response.json({ content: [{ type: "text", text: "recorded" }] })),
              responseDelay
            )
            options.signal?.addEventListener("abort", () => {
              clearTimeout(timer)
              reject(options.signal?.reason)
            })
          })
      )
    )
    const output = vi.spyOn(process.stdout, "write").mockReturnValue(true)
    try {
      const capture = runWorkspaceClient(config, [
        "sandbox_browser",
        JSON.stringify({ args: ["capture", "https://example.com"] })
      ])
      await vi.advanceTimersByTimeAsync(75000)
      await capture
      expect(output).toHaveBeenCalledWith(`${JSON.stringify({ content: [{ type: "text", text: "recorded" }] })}\n`)
      const ordinary = expect(runWorkspaceClient(config, ["sandbox_exec", '{"command":"pwd"}'])).rejects.toThrow(
        "Request timed out"
      )
      await vi.advanceTimersByTimeAsync(70000)
      await ordinary
      responseDelay = 650000
      const overlong = expect(runWorkspaceClient(config, ["sandbox_browser", '{"args":["capture"]}'])).rejects.toThrow(
        "Request timed out"
      )
      await vi.advanceTimersByTimeAsync(600000)
      await overlong
    } finally {
      vi.clearAllTimers()
      vi.restoreAllMocks()
      vi.unstubAllGlobals()
      vi.useRealTimers()
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it("supports MCP discovery and large stdin JSON without shell argument transport", async () => {
    const directory = mkdtempSync(join(tmpdir(), "d3k-workspace-client-"))
    const broker = await startWorkspaceBroker(async (_name, args) => ({
      content: [{ type: "text", text: String(args.content).length.toString() }]
    }))
    const config = join(directory, "connection.json")
    writeFileSync(config, JSON.stringify(broker), { mode: 0o600 })
    const run = (args: string[], input: string) =>
      new Promise<{ code: number | null; output: string }>((resolve, reject) => {
        const child = spawn(
          "bun",
          [fileURLToPath(new URL("./workspace-client.ts", import.meta.url)), config, ...args],
          { stdio: ["pipe", "pipe", "pipe"] }
        )
        let output = ""
        child.stdout.on("data", (chunk) => {
          output += chunk.toString()
        })
        child.on("error", reject)
        child.on("close", (code) => resolve({ code, output }))
        child.stdin.end(input)
      })
    try {
      const large = await run(["sandbox_write_file", "-"], JSON.stringify({ content: "a".repeat(300000) }))
      expect(large.code).toBe(0)
      expect(JSON.parse(large.output).content[0].text).toBe("300000")
      const mcp = await run(
        ["--stdio"],
        `${[
          { id: 1, method: "initialize" },
          { method: "notifications/initialized" },
          { id: 2, method: "tools/list" },
          { id: 3, method: "tools/call", params: { name: "sandbox_write_file", arguments: { content: "hello" } } }
        ]
          .map((request) => JSON.stringify({ jsonrpc: "2.0", ...request }))
          .join("\n")}\n`
      )
      expect(mcp.code).toBe(0)
      const responses = mcp.output
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line))
      expect(responses).toHaveLength(3)
      expect(responses[0].result.protocolVersion).toBe("2024-11-05")
      expect(responses[1].result.tools.some((tool: { name: string }) => tool.name === "sandbox_github")).toBe(true)
      expect(responses[2].result.content[0].text).toBe("5")
    } finally {
      await broker.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
