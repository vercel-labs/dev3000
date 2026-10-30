import type { Readable, Writable } from "node:stream"
import type { WorkspaceResult } from "./sandbox-workspace.js"

export interface McpTool {
  name: string
  description: string
  inputSchema: object
}

/** Newline-delimited MCP stdio. Calls run concurrently so ping/status/stop remain usable. */
export async function serveMcp(options: {
  name: string
  instructions: string
  tools: readonly McpTool[]
  call: (name: string, args: Record<string, unknown>) => Promise<WorkspaceResult>
  input?: Readable
  output?: Writable
}) {
  const input = options.input || process.stdin
  const output = options.output || process.stdout
  const pending = new Set<Promise<void>>()
  const send = (message: object) => output.write(`${JSON.stringify(message)}\n`)
  const error = (id: unknown, code: number, message: string) => send({ jsonrpc: "2.0", id, error: { code, message } })
  const handle = async (line: string) => {
    let request: { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: Record<string, unknown> }
    try {
      request = JSON.parse(line)
    } catch {
      error(null, -32700, "Parse error")
      return
    }
    if (
      request?.jsonrpc !== "2.0" ||
      typeof request.method !== "string" ||
      (request.id !== undefined && typeof request.id !== "string" && typeof request.id !== "number")
    ) {
      error(null, -32600, "Invalid request")
      return
    }
    if (request.id === undefined) return
    const { id, method, params } = request
    try {
      let result: unknown
      if (method === "initialize") {
        const versions = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"]
        const requested = String(params?.protocolVersion || "2024-11-05")
        result = {
          protocolVersion: versions.includes(requested) ? requested : versions[0],
          capabilities: { tools: {} },
          serverInfo: { name: options.name, version: "1.0.0" },
          instructions: options.instructions
        }
      } else if (method === "ping") result = {}
      else if (method === "tools/list") result = { tools: options.tools }
      else if (method === "tools/call") {
        const args = params?.arguments ?? {}
        if (
          typeof params?.name !== "string" ||
          !options.tools.some((tool) => tool.name === params.name) ||
          !args ||
          typeof args !== "object" ||
          Array.isArray(args)
        ) {
          error(id, -32602, "Unknown tool or invalid arguments")
          return
        }
        try {
          result = await options.call(params.name, args as Record<string, unknown>)
        } catch (failure) {
          result = {
            content: [{ type: "text", text: failure instanceof Error ? failure.message : "Tool failed" }],
            isError: true
          }
        }
      } else {
        error(id, -32601, "Method not found")
        return
      }
      send({ jsonrpc: "2.0", id, result })
    } catch {
      error(id, -32603, "MCP request failed")
    }
  }
  let buffer = Buffer.alloc(0)
  try {
    for await (const chunk of input) {
      buffer = Buffer.concat([buffer, Buffer.from(chunk)])
      let newline = buffer.indexOf(10)
      while (newline !== -1) {
        if (newline > 1024 * 1024) throw new Error("MCP request exceeds 1 MiB")
        const line = buffer.subarray(0, newline).toString("utf8").trim()
        buffer = buffer.subarray(newline + 1)
        if (line) {
          if (pending.size >= 32) throw new Error("Too many concurrent MCP requests")
          const task = handle(line)
          pending.add(task)
          void task.finally(() => pending.delete(task))
        }
        newline = buffer.indexOf(10)
      }
      if (buffer.length > 1024 * 1024) throw new Error("MCP request exceeds 1 MiB")
    }
  } finally {
    await Promise.allSettled(pending)
  }
}
