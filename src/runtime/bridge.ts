import { randomUUID, timingSafeEqual } from "node:crypto"
import { createServer, type Server, type ServerResponse } from "node:http"
import { WebSocket, WebSocketServer } from "ws"

const MAX_BYTES = 16 * 1024 * 1024
const MAX_CHANNELS = 32
const TIMEOUT = 15000
type Frame = { id: string; type: string; path?: string; method?: string; body?: string; status?: number }
const MAX_GITHUB_BYTES = 1024 * 1024
const GITHUB_TIMEOUT = 65000
const UNCERTAIN_GITHUB =
  "GitHub connection lost or timed out. No request was replayed; inspect the remote branch/PR before retrying."

function send(socket: WebSocket | undefined, frame: Frame): boolean {
  if (!socket || socket.readyState !== WebSocket.OPEN) return false
  if (socket.bufferedAmount > MAX_BYTES) {
    socket.terminate()
    return false
  }
  socket.send(JSON.stringify(frame))
  return true
}

export function isDiscoveryPath(path: string, method: string): boolean {
  return method === "GET" && ["/json", "/json/list", "/json/version"].includes(path)
}

export function isDevtoolsPath(path: string): boolean {
  return /^\/devtools\/(page|browser)\/[a-zA-Z0-9-]+$/.test(path)
}

export function rewriteDiscovery(body: string, base: string): string {
  return JSON.stringify(JSON.parse(body), (key, value) => {
    if (key !== "webSocketDebuggerUrl" || typeof value !== "string") return value
    const path = new URL(value).pathname
    if (!isDevtoolsPath(path)) throw new Error("Invalid Chrome debugger path")
    return `${base.replace(/^http/, "ws")}${path}`
  })
}

async function listen(server: Server, host: string, port: number): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(port, host, resolve)
  })
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Bridge did not bind a TCP port")
  return address.port
}

/** Public ingress accepts only the paired companion. CDP discovery/control is loopback-only. */
export async function startBridge(options: {
  token: string
  port: number
  host?: string
  onState?: (connected: boolean) => void
}) {
  if (!/^[a-f0-9]{64}$/.test(options.token)) throw new Error("Bridge token must be 32 random bytes in hex")
  let companion: WebSocket | undefined
  const channels = new Map<string, WebSocket>()
  const pending = new Map<string, { response: ServerResponse; timer: NodeJS.Timeout }>()
  const github = new Map<
    string,
    { resolve: (body: string) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }
  >()
  const ingress = createServer((_request, response) => {
    response.writeHead(404).end()
  })
  const upgrades = new WebSocketServer({ noServer: true, maxPayload: MAX_BYTES, perMessageDeflate: false })
  const cdpUpgrades = new WebSocketServer({ noServer: true, maxPayload: MAX_BYTES, perMessageDeflate: false })
  let base = ""
  const reset = () => {
    companion = undefined
    for (const socket of channels.values()) socket.terminate()
    channels.clear()
    for (const { response, timer } of pending.values()) {
      clearTimeout(timer)
      response.writeHead(503).end("Browser disconnected")
    }
    pending.clear()
    for (const { reject, timer } of github.values()) {
      clearTimeout(timer)
      reject(new Error(UNCERTAIN_GITHUB))
    }
    github.clear()
    options.onState?.(false)
  }
  ingress.on("upgrade", (request, socket, head) => {
    const supplied = Buffer.from(request.headers.authorization || "")
    const expected = Buffer.from(`Bearer ${options.token}`)
    if (
      request.url !== "/bridge" ||
      request.headers.origin ||
      supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected) ||
      companion
    ) {
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n")
      return
    }
    upgrades.handleUpgrade(request, socket, head, (ws) => {
      companion = ws
      let alive = true
      const heartbeat = setInterval(() => {
        if (!alive) {
          ws.terminate()
          return
        }
        alive = false
        send(ws, { id: "heartbeat", type: "heartbeat" })
        ws.ping()
      }, 20000)
      ws.on("error", () => ws.terminate())
      ws.on("close", () => {
        clearInterval(heartbeat)
        reset()
      })
      ws.on("message", (data) => {
        try {
          const frame = JSON.parse(data.toString()) as Frame
          if (typeof frame.id !== "string") throw new Error("Invalid bridge frame")
          if (frame.type === "heartbeat-ack") {
            alive = true
          } else if (frame.type === "github-response") {
            const item = github.get(frame.id)
            if (!item) return
            clearTimeout(item.timer)
            github.delete(frame.id)
            if (typeof frame.body !== "string" || Buffer.byteLength(frame.body) > MAX_BYTES / 2)
              item.reject(new Error("Invalid GitHub response"))
            else if (frame.status !== 200) item.reject(new Error(frame.body))
            else item.resolve(frame.body)
          } else if (frame.type === "response") {
            const item = pending.get(frame.id)
            if (!item) return
            let body = frame.body || ""
            if (frame.status === 200) body = rewriteDiscovery(body, base)
            clearTimeout(item.timer)
            pending.delete(frame.id)
            item.response
              .writeHead(frame.status === 200 ? 200 : 502, {
                "content-type": "application/json",
                "cache-control": "no-store"
              })
              .end(body)
          } else {
            const channel = channels.get(frame.id)
            if (frame.type === "data" && typeof frame.body === "string" && channel?.readyState === WebSocket.OPEN) {
              if (channel.bufferedAmount > MAX_BYTES) {
                channel.terminate()
                return
              }
              channel.send(frame.body)
            } else if (frame.type === "close") channel?.terminate()
          }
        } catch {
          ws.terminate()
        }
      })
      options.onState?.(true)
    })
  })
  const cdp = createServer((request, response) => {
    if (
      request.headers.origin ||
      !isDiscoveryPath(request.url || "", request.method || "") ||
      !companion ||
      pending.size >= MAX_CHANNELS
    ) {
      response.writeHead(503).end("Browser unavailable or unsupported CDP request")
      return
    }
    const id = randomUUID()
    const timer = setTimeout(() => {
      pending.delete(id)
      response.writeHead(504).end()
    }, TIMEOUT)
    pending.set(id, { response, timer })
    response.on("close", () => {
      clearTimeout(timer)
      pending.delete(id)
    })
    send(companion, { id, type: "request", path: request.url, method: request.method })
  })
  cdp.on("upgrade", (request, socket, head) => {
    if (request.headers.origin || !isDevtoolsPath(request.url || "") || !companion || channels.size >= MAX_CHANNELS) {
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n")
      return
    }
    cdpUpgrades.handleUpgrade(request, socket, head, (ws) => {
      const id = randomUUID()
      channels.set(id, ws)
      send(companion, { id, type: "open", path: request.url })
      // Hold commands until the companion's Chrome WebSocket has opened.
      ws.on("message", (data) => send(companion, { id, type: "data", body: data.toString() }))
      ws.on("error", () => ws.terminate())
      ws.on("close", () => {
        channels.delete(id)
        send(companion, { id, type: "close" })
      })
    })
  })
  try {
    const cdpPort = await listen(cdp, "127.0.0.1", 0)
    base = `http://127.0.0.1:${cdpPort}`
    const port = await listen(ingress, options.host || "0.0.0.0", options.port)
    return {
      cdpBase: base,
      port,
      connected: () => companion?.readyState === WebSocket.OPEN,
      github: (args: Record<string, unknown>): Promise<string> => {
        if (companion?.readyState !== WebSocket.OPEN)
          return Promise.reject(
            new Error(
              "GitHub publishing needs the laptop companion connected. Credentials stay on the laptop; do not log in inside the sandbox."
            )
          )
        const body = JSON.stringify(args)
        if (Buffer.byteLength(body) > MAX_GITHUB_BYTES) return Promise.reject(new Error("GitHub request exceeds 1 MiB"))
        if (github.size >= MAX_CHANNELS) return Promise.reject(new Error("Too many GitHub requests"))
        return new Promise((resolve, reject) => {
          const id = randomUUID()
          const timer = setTimeout(() => {
            github.delete(id)
            reject(new Error(UNCERTAIN_GITHUB))
          }, GITHUB_TIMEOUT)
          github.set(id, { resolve, reject, timer })
          if (!send(companion, { id, type: "github-request", body })) {
            clearTimeout(timer)
            github.delete(id)
            reject(new Error(UNCERTAIN_GITHUB))
          }
        })
      },
      close: async () => {
        companion?.terminate()
        reset()
        upgrades.close()
        cdpUpgrades.close()
        await Promise.all([ingress, cdp].map((server) => new Promise<void>((resolve) => server.close(() => resolve()))))
      }
    }
  } catch (error) {
    ingress.close()
    cdp.close()
    throw error
  }
}

/** Only talks to our dedicated loopback Chrome. Never accepts a remote hostname or arbitrary HTTP path. */
export function connectCompanion(options: {
  url: string
  token: string
  chromePort: number
  onState?: (connected: boolean) => void
  allowLoopback?: boolean
  github?: (args: Record<string, unknown>, signal: AbortSignal) => Promise<string>
}) {
  const url = new URL(options.url)
  if (url.protocol !== "wss:" && !(options.allowLoopback && url.protocol === "ws:" && url.hostname === "127.0.0.1")) {
    throw new Error("Companion requires a secure WebSocket URL")
  }
  if (
    !/^[a-f0-9]{64}$/.test(options.token) ||
    !Number.isInteger(options.chromePort) ||
    options.chromePort < 1 ||
    options.chromePort > 65535
  )
    throw new Error("Invalid companion configuration")
  let stopped = false
  let socket: WebSocket | undefined
  let retry: NodeJS.Timeout | undefined
  let attempt = 0
  const connect = () => {
    if (stopped) return
    const channels = new Map<string, { ws: WebSocket; queued: string[]; bytes: number }>()
    const requests = new Set<AbortController>()
    const ws = new WebSocket(url, {
      headers: { authorization: `Bearer ${options.token}` },
      maxPayload: MAX_BYTES,
      perMessageDeflate: false,
      handshakeTimeout: TIMEOUT
    })
    socket = ws
    let lastActivity = Date.now()
    let lastTick = Date.now()
    const heartbeat = setInterval(() => {
      const now = Date.now()
      // After laptop sleep, queued frames can look fresh while the edge tunnel is already stale.
      if (now - lastTick > 60000 || now - lastActivity > 60000) ws.terminate()
      lastTick = now
    }, 20000)
    ws.on("open", () => {
      attempt = 0
      options.onState?.(true)
    })
    ws.on("error", () => ws.terminate())
    ws.on("close", () => {
      clearInterval(heartbeat)
      for (const { ws: chrome } of channels.values()) chrome.terminate()
      for (const controller of requests) controller.abort()
      options.onState?.(false)
      if (!stopped) retry = setTimeout(connect, Math.min(10000, 500 * 2 ** attempt++))
    })
    ws.on("message", (data) => {
      lastActivity = Date.now()
      try {
        const frame = JSON.parse(data.toString()) as Frame
        if (typeof frame.id !== "string" || frame.id.length > 100) throw new Error("Invalid frame")
        if (frame.type === "heartbeat") {
          send(ws, { id: frame.id, type: "heartbeat-ack" })
        } else if (frame.type === "github-request") {
          if (
            typeof frame.body !== "string" ||
            Buffer.byteLength(frame.body) > MAX_GITHUB_BYTES ||
            requests.size >= MAX_CHANNELS
          )
            throw new Error("Invalid GitHub request")
          const args: unknown = JSON.parse(frame.body)
          if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("Invalid GitHub arguments")
          const controller = new AbortController()
          requests.add(controller)
          const timer = setTimeout(() => controller.abort(), GITHUB_TIMEOUT - 1000)
          void Promise.resolve()
            .then(() => {
              if (!options.github)
                throw new Error(
                  "This companion does not support GitHub publishing. Update d3k and reconnect; do not authenticate in the sandbox."
                )
              return options.github(args as Record<string, unknown>, controller.signal)
            })
            .then((body) => {
              if (controller.signal.aborted) throw new Error(UNCERTAIN_GITHUB)
              if (Buffer.byteLength(body) > MAX_BYTES / 2) throw new Error("GitHub response too large")
              send(ws, { id: frame.id, type: "github-response", status: 200, body })
            })
            .catch((error) =>
              send(ws, { id: frame.id, type: "github-response", status: 502, body: String(error.message).slice(-8192) })
            )
            .finally(() => {
              clearTimeout(timer)
              requests.delete(controller)
            })
        } else if (frame.type === "request") {
          if (!isDiscoveryPath(frame.path || "", frame.method || "") || requests.size >= MAX_CHANNELS)
            throw new Error("Invalid discovery request")
          const controller = new AbortController()
          requests.add(controller)
          const timeout = setTimeout(() => controller.abort(), TIMEOUT)
          void fetch(`http://127.0.0.1:${options.chromePort}${frame.path}`, {
            method: frame.method,
            signal: controller.signal,
            redirect: "error"
          })
            .then(async (response) => {
              const body = await response.text()
              if (Buffer.byteLength(body) > MAX_BYTES / 2) throw new Error("Discovery response too large")
              send(ws, { id: frame.id, type: "response", status: response.status, body })
            })
            .catch(() => send(ws, { id: frame.id, type: "response", status: 502 }))
            .finally(() => {
              clearTimeout(timeout)
              requests.delete(controller)
            })
        } else if (frame.type === "open") {
          if (!isDevtoolsPath(frame.path || "") || channels.has(frame.id) || channels.size >= MAX_CHANNELS)
            throw new Error("Invalid CDP channel")
          const chrome = new WebSocket(`ws://127.0.0.1:${options.chromePort}${frame.path}`, {
            maxPayload: MAX_BYTES,
            perMessageDeflate: false,
            handshakeTimeout: TIMEOUT
          })
          const channel = { ws: chrome, queued: [] as string[], bytes: 0 }
          channels.set(frame.id, channel)
          chrome.on("open", () => {
            for (const body of channel.queued) chrome.send(body)
            channel.queued = []
            channel.bytes = 0
          })
          chrome.on("message", (data) => send(ws, { id: frame.id, type: "data", body: data.toString() }))
          chrome.on("error", () => chrome.terminate())
          chrome.on("close", () => {
            channels.delete(frame.id)
            send(ws, { id: frame.id, type: "close" })
          })
        } else {
          const channel = channels.get(frame.id)
          if (frame.type === "close") channel?.ws.terminate()
          else if (frame.type === "data" && channel && typeof frame.body === "string") {
            if (channel.ws.readyState === WebSocket.OPEN) {
              if (channel.ws.bufferedAmount > MAX_BYTES) throw new Error("Slow Chrome consumer")
              channel.ws.send(frame.body)
            } else if (channel.ws.readyState === WebSocket.CONNECTING) {
              channel.bytes += Buffer.byteLength(frame.body)
              if (channel.bytes > MAX_BYTES) throw new Error("CDP startup queue full")
              channel.queued.push(frame.body)
            }
          }
        }
      } catch {
        ws.terminate()
      }
    })
  }
  connect()
  return {
    close: () => {
      stopped = true
      clearTimeout(retry)
      socket?.terminate()
    }
  }
}
