import { spawn } from "node:child_process"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { dirname, isAbsolute } from "node:path"
import { Readable, Writable } from "node:stream"

/** The host must already be an isolated VM. This adapter adds no isolation. */
export function connect(workspaceRoot) {
  if (!isAbsolute(workspaceRoot)) throw new Error("Eve requires an absolute existing checkout")
  return {
    workspaceRoot,
    async spawn({ signal, stdin, command, env, workingDirectory }) {
      signal?.throwIfAborted()
      const commandEnv = { ...process.env, ...env }
      for (const key of [
        "D3K_EVE_TOKEN",
        "AI_GATEWAY_API_KEY",
        "VERCEL_TOKEN",
        "VERCEL_AUTH_TOKEN",
        "VERCEL_OIDC_TOKEN"
      ])
        delete commandEnv[key]
      const child = spawn("bash", ["-lc", command], {
        cwd: workingDirectory,
        env: commandEnv,
        detached: true,
        stdio: ["pipe", "pipe", "pipe"]
      })
      const killGroup = (signalName) => {
        if (!child.pid) return
        try {
          process.kill(-child.pid, signalName)
        } catch (error) {
          if (error.code !== "ESRCH") throw error
        }
      }
      let timer
      const kill = async () => {
        killGroup("SIGTERM")
        timer ??= setTimeout(() => killGroup("SIGKILL"), 1000)
        timer.unref()
      }
      const abort = () => void kill()
      const result = new Promise((resolve, reject) => {
        child.once("error", reject)
        child.once("close", (code, termination) => {
          clearTimeout(timer)
          signal?.removeEventListener("abort", abort)
          if (termination) reject(new Error(`Command terminated: ${termination}`))
          else resolve({ exitCode: code ?? 1 })
        })
      })
      // A process may fail before Eve starts waiting for it.
      void result.catch(() => {})
      signal?.addEventListener("abort", abort, { once: true })
      if (signal?.aborted) abort()
      if (!stdin) child.stdin.end()
      return {
        pid: child.pid,
        stdin: stdin ? Writable.toWeb(child.stdin) : undefined,
        stdout: Readable.toWeb(child.stdout),
        stderr: Readable.toWeb(child.stderr),
        wait: () => result,
        kill
      }
    },
    async readFile({ path, signal }) {
      try {
        return await readFile(path, { signal })
      } catch (error) {
        if (error.code === "ENOENT") return null
        throw error
      }
    },
    async writeFiles({ files, signal }) {
      for (const { path, content } of files) {
        signal?.throwIfAborted()
        await mkdir(dirname(path), { recursive: true })
        await writeFile(path, content, { signal })
      }
    },
    async removePath({ path, force, recursive, signal }) {
      signal?.throwIfAborted()
      await rm(path, { force, recursive })
    },
    // d3k owns the shared VM; ending an Eve session must not stop its dev server.
    async stop() {},
    async close() {}
  }
}
