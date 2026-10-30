import { spawn } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { startWorkspaceBroker } from "./sandbox-workspace.js"

describe("workspace stdio transport", () => {
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
