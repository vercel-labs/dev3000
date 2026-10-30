import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { serveMcp } from "./mcp-stdio.js"
import { workspaceTools } from "./sandbox-workspace.js"

export async function runWorkspaceClient(configPath: string, args: string[]) {
  const config = JSON.parse(readFileSync(configPath, "utf8")) as { url: string; token: string }
  const url = new URL(config.url)
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.pathname !== "/call")
    throw new Error("Invalid local workspace broker")
  const call = async (name: string, parameters: Record<string, unknown>) => {
    const response = await fetch(url, {
      method: "POST",
      redirect: "error",
      headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name, arguments: parameters }),
      signal: AbortSignal.timeout(70000)
    })
    if (!response.ok) throw new Error("The d3k workspace connection ended; resume the session")
    return response.json()
  }
  if (args[0] !== "--stdio") {
    const output = await call(args[0], JSON.parse(args[1] === "-" ? readFileSync(0, "utf8") : args[1] || "{}"))
    process.stdout.write(`${JSON.stringify(output)}\n`)
    if (output.isError) process.exitCode = 1
    return
  }
  await serveMcp({
    name: "d3k-workspace",
    instructions:
      "The project is remote. Use sandbox_exec/read_file/write_file for code and sandbox_browser for the already connected local Chrome. Do not clone locally or discover a CDP port.",
    tools: workspaceTools,
    call
  })
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runWorkspaceClient(process.argv[2], process.argv.slice(3)).catch(() => {
    console.error("d3k workspace connection failed; check the companion and resume if needed")
    process.exitCode = 1
  })
}
