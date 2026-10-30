import type { Readable, Writable } from "node:stream"
import { setTimeout as delay } from "node:timers/promises"
import type { Sandbox } from "@vercel/sandbox"
import { WebSocket } from "ws"
import { terminalRestorer } from "./terminal.js"

interface TerminalInput extends Readable {
  isTTY?: boolean
  isRaw?: boolean
  setRawMode?: (raw: boolean) => unknown
  unref?: () => unknown
}
interface TerminalOutput extends Writable {
  columns?: number
  rows?: number
}

export class SandboxShellDisconnected extends Error {}

/** Use the Sandbox PTY protocol directly so a dropped socket is never a shell exit. */
export async function runSandboxShell(options: {
  sandbox: Pick<Sandbox, "openInteractive">
  cwd: string
  execution: [string, ...string[]]
  env: Record<string, string>
  signal: AbortSignal
  input?: TerminalInput
  output?: TerminalOutput
  heartbeatMs?: number
}): Promise<number | undefined> {
  options.signal.throwIfAborted()
  const { url, token } = await options.sandbox.openInteractive({ signal: options.signal })
  options.signal.throwIfAborted()
  const endpoint = new URL(url)
  // Tokens go only to the TLS endpoint supplied by the SDK. Loopback HTTP is
  // useful for protocol fixtures and never exposes credentials off-machine.
  if (endpoint.protocol !== "wss:" && !(endpoint.protocol === "ws:" && endpoint.hostname === "127.0.0.1"))
    throw new Error("Sandbox returned an insecure terminal endpoint")
  const health = new URL("/health", endpoint)
  health.protocol = endpoint.protocol === "wss:" ? "https:" : "http:"
  let healthy = false
  for (let attempt = 0; attempt < 6; attempt++) {
    options.signal.throwIfAborted()
    healthy = await fetch(health, {
      signal: AbortSignal.any([options.signal, AbortSignal.timeout(3000)])
    })
      .then(async (response) => {
        await response.body?.cancel()
        return response.ok
      })
      .catch(() => false)
    if (healthy) break
    await delay(250 * (attempt + 1), undefined, { signal: options.signal })
  }
  if (!healthy) throw new SandboxShellDisconnected("Remote terminal endpoint did not become ready")
  endpoint.searchParams.set("token", token)
  const input = options.input ?? process.stdin
  const output = options.output ?? process.stdout
  const restoreTerminal = terminalRestorer(input, output)
  const wasFlowing = input.readableFlowing === true
  const socket = new WebSocket(endpoint, { handshakeTimeout: 10000, maxPayload: 1024 * 1024 })
  return new Promise((resolve, reject) => {
    let finished = false
    let missedPongs = 0
    let heartbeat: ReturnType<typeof setInterval> | undefined
    let backpressure = false
    const cleanup = () => {
      clearInterval(heartbeat)
      options.signal.removeEventListener("abort", abort)
      input.off("data", onInput)
      input.off("end", onInputEnd)
      output.off("drain", onDrain)
      process.off("SIGWINCH", resize)
      restoreTerminal()
      if (!wasFlowing) {
        input.pause()
        input.unref?.()
      }
      socket.terminate()
    }
    const settle = (error?: Error, code?: number) => {
      if (finished) return
      finished = true
      cleanup()
      if (error) reject(error)
      else resolve(code)
    }
    const abort = () => settle()
    const onInput = (chunk: Buffer) => {
      if (socket.readyState !== WebSocket.OPEN) return
      if (socket.bufferedAmount > 1024 * 1024) {
        settle(new SandboxShellDisconnected("Terminal input connection is stalled"))
        return
      }
      socket.send(chunk, { binary: true }, (error) => {
        if (error) settle(new SandboxShellDisconnected("Terminal input connection failed"))
      })
    }
    const onInputEnd = () => settle(new SandboxShellDisconnected("Local terminal input closed"))
    const resize = () => {
      if (socket.readyState === WebSocket.OPEN)
        socket.send(JSON.stringify({ type: "resize", cols: output.columns ?? 80, rows: output.rows ?? 24 }))
    }
    const onDrain = () => {
      if (backpressure) socket.resume()
      backpressure = false
    }
    options.signal.addEventListener("abort", abort, { once: true })
    socket.on("error", () => settle(new SandboxShellDisconnected("Terminal WebSocket connection failed")))
    socket.on("close", (code) => {
      settle(
        new SandboxShellDisconnected(`Terminal connection closed without a remote exit message (WebSocket ${code})`)
      )
    })
    socket.on("pong", () => {
      missedPongs = 0
    })
    socket.on("open", () => {
      if (finished) return
      socket.send(
        JSON.stringify({
          type: "start",
          command: options.execution[0],
          args: options.execution.slice(1),
          env: Object.entries({ TERM: process.env.TERM || "xterm-256color", ...options.env }).map(
            ([key, value]) => `${key}=${value}`
          ),
          cwd: options.cwd,
          cols: output.columns ?? 80,
          rows: output.rows ?? 24
        })
      )
      try {
        if (input.isTTY) input.setRawMode?.(true)
      } catch {
        settle(new SandboxShellDisconnected("Local terminal is unavailable"))
        return
      }
      input.on("data", onInput)
      input.once("end", onInputEnd)
      input.resume()
      output.on("drain", onDrain)
      process.on("SIGWINCH", resize)
      heartbeat = setInterval(() => {
        if (missedPongs >= 2) {
          settle(new SandboxShellDisconnected("Terminal connection stopped responding to keepalives"))
          return
        }
        missedPongs++
        socket.ping()
      }, options.heartbeatMs ?? 30000)
      heartbeat.unref()
    })
    socket.on("message", (data, binary) => {
      if (finished) return
      if (binary) {
        const chunk = Array.isArray(data) ? Buffer.concat(data) : Buffer.isBuffer(data) ? data : Buffer.from(data)
        if (!output.write(chunk)) {
          backpressure = true
          socket.pause()
        }
        return
      }
      let message: { type?: string; code?: number }
      try {
        message = JSON.parse(data.toString())
      } catch {
        output.write(data.toString())
        return
      }
      if (message.type === "exit") {
        // The controller omits a zero-valued code. An explicit exit frame is
        // still required; a WebSocket close alone never means success.
        const code = message.code ?? 0
        if (!Number.isInteger(code))
          settle(new SandboxShellDisconnected("Remote exit message contained an invalid code"))
        else settle(undefined, code)
      }
    })
    if (options.signal.aborted) abort()
  })
}
