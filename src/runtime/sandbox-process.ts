import { spawn } from "node:child_process"

/** No shell interpolation. Bounded captured output also keeps credential-bearing CLI output out of logs. */
export async function runSandboxCli(
  binary: string,
  args: string[],
  options: {
    cwd?: string
    inherit?: boolean
    env?: NodeJS.ProcessEnv
    input?: string
    signal?: AbortSignal
    isolated?: boolean
    timeoutMs?: number
  } = {}
): Promise<string> {
  return new Promise((resolveRun, reject) => {
    if (options.signal?.aborted) {
      reject(new Error("Session ended"))
      return
    }
    const child = spawn(binary, args, {
      cwd: options.cwd,
      env: options.env,
      detached: options.isolated,
      stdio: options.inherit ? "inherit" : [options.input === undefined ? "ignore" : "pipe", "pipe", "pipe"]
    })
    let killTimer: ReturnType<typeof setTimeout> | undefined
    let timedOut = false
    const kill = (signal: NodeJS.Signals) => {
      try {
        if (options.isolated && process.platform !== "win32" && child.pid) process.kill(-child.pid, signal)
        else child.kill(signal)
      } catch {
        /* The process may already have exited. */
      }
    }
    const abort = () => {
      kill("SIGTERM")
      killTimer = setTimeout(() => kill("SIGKILL"), 1000)
      killTimer.unref()
    }
    options.signal?.addEventListener("abort", abort, { once: true })
    const timeout = options.timeoutMs
      ? setTimeout(() => {
          timedOut = true
          abort()
        }, options.timeoutMs)
      : undefined
    const cleanup = () => {
      options.signal?.removeEventListener("abort", abort)
      if (killTimer) clearTimeout(killTimer)
      if (timeout) clearTimeout(timeout)
    }
    let stdout = ""
    let stderr = ""
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString()
      if (stdout.length > 4 * 1024 * 1024) child.kill()
    })
    child.stderr?.on("data", (chunk) => {
      stderr = (stderr + chunk.toString()).slice(-8192)
    })
    child.on("error", (error) => {
      cleanup()
      reject(error)
    })
    child.stdin?.on("error", () => {}) // Early CLI exits still report their bounded stderr below.
    if (options.input !== undefined) child.stdin?.end(options.input)
    child.on("close", (code) => {
      cleanup()
      if (timedOut) reject(new Error(`${binary} ${args[0]} timed out`))
      else if (options.signal?.aborted) resolveRun(stdout)
      else if (code === 0) resolveRun(stdout)
      else reject(new Error(`${binary} ${args[0]} failed: ${stderr || `exit ${code}`}`))
    })
  })
}
