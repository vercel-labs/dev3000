#!/usr/bin/env bun
import { spawn, spawnSync } from "node:child_process"
import { homedir } from "node:os"
import { join } from "node:path"

for (const [entry, args] of [
  ["d3k", ["--version"]],
  ["dev3000", ["--version"]],
  ["d3k-runtime", ["--help"]],
  ["d3k", ["start", "--help"]],
  ["dev3000", ["sandbox", "--help"]],
  ["d3k", ["mcp", "--help"]]
] as const) {
  const result = spawnSync(join(homedir(), ".bun", "bin", entry), args, { encoding: "utf8" })
  if (result.status !== 0 || !result.stdout.trim()) throw new Error(`${entry} smoke test failed: ${result.stderr}`)
  console.log(`${entry}: ${result.stdout.split("\n")[0]}`)
}

const mcp = spawnSync(join(homedir(), ".bun", "bin", "d3k"), ["mcp"], {
  encoding: "utf8",
  input: `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } })}\n${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" })}\n`,
  timeout: 10000
})
if (mcp.status !== 0) throw new Error(`MCP smoke test failed: ${mcp.stderr}`)
const responses = mcp.stdout
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line))
if (
  !responses
    .find((response) => response.id === 2)
    ?.result.tools.some((tool: { name: string }) => tool.name === "sandbox_start")
)
  throw new Error("Installed MCP server did not expose sandbox lifecycle tools")
console.log("d3k: MCP initialize and tools/list passed")

await new Promise<void>((resolve, reject) => {
  const server = spawn(join(homedir(), ".bun", "bin", "d3k"), ["mcp"], { stdio: ["pipe", "pipe", "pipe"] })
  const timeout = setTimeout(() => {
    server.kill("SIGKILL")
    reject(new Error("MCP signal shutdown timed out"))
  }, 10000)
  server.on("error", reject)
  server.stdout.once("data", () => server.kill("SIGTERM"))
  server.on("close", (code) => {
    clearTimeout(timeout)
    if (code === 0) resolve()
    else reject(new Error(`MCP signal shutdown exited ${code}`))
  })
  server.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" })}\n`)
})
console.log("d3k: MCP SIGTERM shutdown passed")
