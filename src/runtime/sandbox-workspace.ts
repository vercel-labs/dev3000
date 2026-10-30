import { randomBytes, timingSafeEqual } from "node:crypto"
import { createServer } from "node:http"
import { Readable } from "node:stream"
import type { Sandbox } from "@vercel/sandbox"

export const workspaceTools = [
  {
    name: "sandbox_recover",
    description:
      "Recover a stopped or unhealthy dev runtime and browser bridge in the SAME sandbox, preserving files, the local browser, and the agent. No clone or dependency reinstall. Start returns immediately; poll with action status until recovered or failed, then reread sandbox_runtime status. A restarted runtime loses its old in-memory evidence. Does not replay agent commands, renew Gateway keys or extend compute lifetime.",
    inputSchema: {
      type: "object",
      properties: { action: { type: "string", enum: ["start", "status"] } },
      additionalProperties: false
    }
  },
  {
    name: "sandbox_exec",
    description:
      "Run a shell command in the REMOTE project. Use for search, tests, dependencies, Git branches and commits. Nothing executes on the laptop.",
    inputSchema: {
      type: "object",
      properties: { command: { type: "string" } },
      required: ["command"],
      additionalProperties: false
    }
  },
  {
    name: "sandbox_read_file",
    description: "Read a UTF-8 project file inside the sandbox. Paths are relative to the remote project root.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
      additionalProperties: false
    }
  },
  {
    name: "sandbox_write_file",
    description:
      "Write a UTF-8 project file inside the sandbox. Read existing files first. Nothing is saved to the laptop.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" }, content: { type: "string" } },
      required: ["path", "content"],
      additionalProperties: false
    }
  },
  {
    name: "sandbox_runtime",
    description:
      "Read d3k status or the shared browser/server events inside the running sandbox. Use events --after CURSOR for logs. Do not start or stop the runtime.",
    inputSchema: {
      type: "object",
      properties: { args: { type: "array", items: { type: "string" } } },
      required: ["args"],
      additionalProperties: false
    }
  },
  {
    name: "sandbox_browser",
    description:
      "Control the user's existing local Chrome through d3k. agent-browser arguments, e.g. [snapshot,-i], [fill,@e2,text], [click,@e3]. For loading metrics use [metrics,https://example.com/,--new-tab]: Web Vitals, navigation timing, long tasks and resource summaries as JSON. Omit URL to inspect current page without reload (CLS/long tasks unavailable). Prefer metrics over custom eval scripts. CDP is already connected.",
    inputSchema: {
      type: "object",
      properties: { args: { type: "array", items: { type: "string" } } },
      required: ["args"],
      additionalProperties: false
    }
  },
  {
    name: "sandbox_github",
    description:
      "Publish branches/PRs for this sandbox's linked GitHub repository using LOCAL GitHub CLI authentication. GitHub credentials never enter the sandbox. Use Git Data APIs (blobs, trees, commits, refs) to publish remote Git objects, then /pulls to create a PR. No force pushes. Paths are repo-relative, e.g. /git/ref/heads/main or /pulls.",
    inputSchema: {
      type: "object",
      properties: {
        method: { type: "string", enum: ["GET", "POST", "PATCH"] },
        path: { type: "string" },
        body: { type: "object" }
      },
      required: ["method", "path"],
      additionalProperties: false
    }
  }
] as const

export type WorkspaceResult = { content: { type: "text"; text: string }[]; isError?: boolean }
const result = (value: string): WorkspaceResult => ({ content: [{ type: "text", text: value }] })
const MAX_BYTES = 1024 * 1024

export function workspaceHandler(sandbox: Sandbox, workdir: string, gitIdentity?: Record<string, string>) {
  return async (name: string, args: Record<string, unknown>): Promise<WorkspaceResult> => {
    let cmd = "node"
    let argv: string[]
    let input: string | undefined
    const string = (key: string) => {
      const value = args[key]
      if (typeof value !== "string") throw new Error(`${key} must be a string`)
      return value
    }
    if (name === "sandbox_exec") {
      cmd = "sh"
      argv = ["-c", string("command")]
    } else if (name === "sandbox_read_file" || name === "sandbox_write_file") {
      const path = string("path")
      if (!path || path.startsWith("/") || path.split("/").includes(".."))
        throw new Error("Use a relative project path")
      // Resolve links remotely as well; file tools should not accidentally read/write
      // another workspace. Shell commands deliberately retain the sandbox's authority.
      const script = `const fs=require('node:fs'),p=require('node:path');
const root=fs.realpathSync('.'),file=p.resolve(process.argv[1]);
const target=fs.existsSync(file)?fs.realpathSync(file):p.join(fs.realpathSync(p.dirname(file)),p.basename(file));
if(!target.startsWith(root+p.sep))throw Error('Path escapes project root');
${name === "sandbox_read_file" ? `if(fs.statSync(target).size>${MAX_BYTES})throw Error('File exceeds 1 MiB; use shell for a focused read');process.stdout.write(fs.readFileSync(target,'utf8'));` : "fs.writeFileSync(target,fs.readFileSync(0));process.stdout.write('Written '+process.argv[1]);"}`
      argv = ["-e", script, "--", path]
      if (name === "sandbox_write_file") input = string("content")
    } else if (name === "sandbox_runtime" || name === "sandbox_browser") {
      if (!Array.isArray(args.args) || args.args.some((value) => typeof value !== "string"))
        throw new Error("args must be an array of strings")
      const values = args.args as string[]
      if (name === "sandbox_runtime" && !["status", "events", "logs", "errors"].includes(values[0]))
        throw new Error("Use status, events, logs or errors")
      argv = [
        "/tmp/d3k-tools/node_modules/dev3000/dist/runtime/cli.js",
        ...(name === "sandbox_browser" ? ["browser"] : []),
        ...values
      ]
    } else throw new Error("Unknown workspace tool")
    const execution = await sandbox.runCommand({
      cmd,
      args: argv,
      cwd: workdir,
      ...(gitIdentity ? { env: gitIdentity } : {}),
      ...(input !== undefined ? { stdin: Readable.from([input]) } : {}),
      timeoutMs: 60000,
      signal: AbortSignal.timeout(65000)
    })
    const [stdout, stderr] = await Promise.all([execution.stdout(), execution.stderr()])
    return {
      ...result(
        JSON.stringify({
          exitCode: execution.exitCode,
          stdout: stdout.slice(0, MAX_BYTES),
          stderr: stderr.slice(-16384),
          truncated: stdout.length > MAX_BYTES
        })
      ),
      ...(execution.exitCode !== 0 ? { isError: true } : {})
    }
  }
}

/** A per-session loopback broker holds the live SDK credentials in the launcher.
 * Harness configs contain only this ephemeral local connection capability. */
export async function startWorkspaceBroker(
  call: (name: string, args: Record<string, unknown>) => Promise<WorkspaceResult>
) {
  const token = randomBytes(32).toString("hex")
  const server = createServer(async (request, response) => {
    const supplied = Buffer.from(request.headers.authorization || "")
    const expected = Buffer.from(`Bearer ${token}`)
    if (request.headers.origin || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      response.writeHead(403).end()
      return
    }
    if (request.method !== "POST" || request.url !== "/call") {
      response.writeHead(404).end()
      return
    }
    try {
      let size = 0
      const chunks: Buffer[] = []
      for await (const chunk of request) {
        size += chunk.length
        if (size > MAX_BYTES) throw new Error("Workspace request exceeds 1 MiB")
        chunks.push(Buffer.from(chunk))
      }
      const body = JSON.parse(Buffer.concat(chunks).toString())
      if (
        typeof body.name !== "string" ||
        !body.arguments ||
        typeof body.arguments !== "object" ||
        Array.isArray(body.arguments)
      )
        throw new Error("Invalid workspace call")
      const output = await call(body.name, body.arguments)
      response
        .writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" })
        .end(JSON.stringify(output))
    } catch (error) {
      response
        .writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" })
        .end(
          JSON.stringify({ ...result(error instanceof Error ? error.message : "Workspace call failed"), isError: true })
        )
    }
  })
  server.requestTimeout = 70000
  server.headersTimeout = 5000
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Missing workspace listener")
  return {
    url: `http://127.0.0.1:${address.port}/call`,
    token,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      })
  }
}
