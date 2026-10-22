import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { request } from "node:http"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { getProjectDir } from "../utils/project-name.js"

export interface RuntimeSession {
  sessionId: string
  pid: number
  cwd: string
  socketPath: string
  token: string
  appUrl: string
  ready: boolean
  cdpUrl: string | null
}

export function runtimePaths(cwd = process.cwd()) {
  const directory = getProjectDir(cwd)
  const key = createHash("sha256").update(resolve(directory)).digest("hex").slice(0, 20)
  return {
    directory,
    sessionFile: join(directory, "runtime.json"),
    // Short paths avoid macOS's 104-byte Unix socket limit.
    socketPath:
      process.platform === "win32"
        ? `\\\\.\\pipe\\d3k-${key}`
        : join(tmpdir(), `d3k-${process.getuid?.() ?? "user"}-${key}.sock`)
  }
}

export function readRuntimeSession(cwd = process.cwd()): RuntimeSession | null {
  try {
    const session = JSON.parse(readFileSync(runtimePaths(cwd).sessionFile, "utf8")) as RuntimeSession
    if (session.cwd !== resolve(cwd) || !Number.isSafeInteger(session.pid) || session.pid <= 0) return null
    process.kill(session.pid, 0)
    return session
  } catch {
    return null
  }
}

export async function queryRuntime(path: string, cwd = process.cwd(), method = "GET"): Promise<unknown> {
  const session = readRuntimeSession(cwd)
  if (!session) throw new Error("No active skill runtime for this project")
  return new Promise((resolveResult, reject) => {
    const req = request(
      { socketPath: session.socketPath, path, method, headers: { authorization: `Bearer ${session.token}` } },
      (res) => {
        let body = ""
        res.setEncoding("utf8")
        res.on("data", (chunk) => {
          body += chunk
        })
        res.on("error", reject)
        res.on("end", () => {
          try {
            const result = JSON.parse(body)
            if (res.statusCode !== 200) reject(new Error(result.error || `Runtime returned ${res.statusCode}`))
            else resolveResult(result)
          } catch (error) {
            reject(error)
          }
        })
      }
    )
    req.setTimeout(5000, () => req.destroy(new Error("Runtime request timed out")))
    req.on("error", reject)
    req.end()
  })
}
