import { createServer, request } from "node:http"
import type { Socket } from "node:net"
import type { Duplex } from "node:stream"
import { type SandboxPreview, sandboxPreview } from "./sandbox-preview.js"

/** Stream app traffic inside the VM. Validate the public origin before normalizing Next's HMR upgrade. */
export async function startSandboxProxy(options: {
  port: number
  targetPort: number
  appUrl: string
  token?: string
  preview?: SandboxPreview
}) {
  const origin = new URL(options.appUrl).origin
  const preview = options.preview ? sandboxPreview(options.preview) : undefined
  const authorizedOrigin = (incoming: import("node:http").IncomingMessage) => {
    if (options.token && incoming.headers["x-d3k-proxy-token"] === options.token) return origin
    if (preview?.authorized(incoming)) return options.preview?.origin
    return options.token || preview ? undefined : origin
  }
  const usesPreview = (incoming: import("node:http").IncomingMessage) =>
    !!preview && !(options.token && incoming.headers["x-d3k-proxy-token"] === options.token)
  const forwardHeaders = (incoming: import("node:http").IncomingMessage, requestOrigin: string) => {
    const headers = { ...incoming.headers }
    delete headers["x-d3k-proxy-token"]
    // The app must never see or log the preview access credential.
    if (preview) {
      const cookie = preview.stripCookie(headers.cookie)
      if (cookie) headers.cookie = cookie
      else delete headers.cookie
    }
    if (options.token || preview) {
      headers.host = new URL(requestOrigin).host
      headers["x-forwarded-host"] = headers.host
      headers["x-forwarded-proto"] = "https"
    }
    return headers
  }
  const sockets = new Set<Socket>()
  const previewSockets = new Set<Duplex>()
  const server = createServer((incoming, response) => {
    if (preview) response.setHeader("cache-control", "no-store")
    if (preview?.handle(incoming, response)) return
    const requestOrigin = authorizedOrigin(incoming)
    if (!requestOrigin) {
      response.writeHead(403).end("Forbidden")
      return
    }
    if (usesPreview(incoming)) previewSockets.add(incoming.socket)
    const headers = forwardHeaders(incoming, requestOrigin)
    const upstream = request(
      {
        host: "127.0.0.1",
        port: options.targetPort,
        method: incoming.method,
        path: incoming.url,
        headers
      },
      (result) => {
        const output = { ...result.headers }
        if (usesPreview(incoming)) {
          output["cache-control"] = "private, no-store"
          output["referrer-policy"] = "no-referrer"
          if (output.location) {
            try {
              const redirect = new URL(output.location, requestOrigin)
              if (redirect.origin === origin)
                output.location = `${requestOrigin}${redirect.pathname}${redirect.search}${redirect.hash}`
            } catch {
              // Preserve malformed app redirects without crashing the proxy.
            }
          }
          if (output["set-cookie"])
            output["set-cookie"] = output["set-cookie"].map((cookie) =>
              cookie.replace(/;\s*Domain=([^;]+)/gi, (field, domain: string) =>
                domain.replace(/^\./, "").toLowerCase() === new URL(origin).hostname ? "" : field
              )
            )
        }
        response.writeHead(result.statusCode || 502, output)
        result.pipe(response)
        result.on("error", () => response.destroy())
      }
    )
    upstream.on("error", () => {
      if (response.headersSent) response.destroy()
      else response.writeHead(502).end("Dev server unavailable")
    })
    incoming.on("aborted", () => upstream.destroy())
    response.on("close", () => upstream.destroy())
    incoming.pipe(upstream)
  })
  server.on("connection", (socket) => {
    sockets.add(socket)
    socket.on("close", () => {
      sockets.delete(socket)
      previewSockets.delete(socket)
    })
  })
  server.on("upgrade", (incoming, client, head) => {
    const requestOrigin = authorizedOrigin(incoming)
    if (!requestOrigin) {
      client.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n")
      return
    }
    if (usesPreview(incoming)) previewSockets.add(client)
    const headers = forwardHeaders(incoming, requestOrigin)
    let path: string
    try {
      path = new URL(incoming.url || "/", requestOrigin).pathname
    } catch {
      client.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n")
      return
    }
    if (path.endsWith("/_next/hmr") || path.endsWith("/_next/webpack-hmr")) {
      if (headers.origin !== requestOrigin) {
        client.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n")
        return
      }
      // Next allows localhost by default. This applies only after the exact public-origin check above.
      headers.origin = `http://localhost:${options.targetPort}`
    }
    const upstream = request({
      host: "127.0.0.1",
      port: options.targetPort,
      method: incoming.method,
      path: incoming.url,
      headers
    })
    upstream.on("upgrade", (response, remote, remoteHead) => {
      sockets.add(remote)
      remote.on("close", () => {
        sockets.delete(remote)
        client.destroy()
      })
      remote.on("error", () => client.destroy())
      client.on("error", () => remote.destroy())
      client.on("close", () => remote.destroy())
      const fields = response.rawHeaders.reduce<string[]>((lines, value, index, raw) => {
        if (index % 2 === 0) lines.push(`${value}: ${raw[index + 1]}`)
        return lines
      }, [])
      client.write(`HTTP/1.1 ${response.statusCode} ${response.statusMessage}\r\n${fields.join("\r\n")}\r\n\r\n`)
      if (remoteHead.length) client.write(remoteHead)
      if (head.length) remote.write(head)
      client.pipe(remote).pipe(client)
    })
    upstream.on("response", (response) => {
      response.resume()
      client.end("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n")
    })
    upstream.on("error", () => client.destroy())
    client.on("close", () => upstream.destroy())
    upstream.end()
  })
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(options.port, "0.0.0.0", resolve)
  })
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Sandbox proxy did not bind a port")
  const expiryTimer = options.preview
    ? setTimeout(
        () => {
          for (const socket of previewSockets) socket.destroy()
        },
        Math.max(0, Math.min(2147483647, options.preview.expiresAt - Date.now()))
      )
    : undefined
  expiryTimer?.unref()
  return {
    port: address.port,
    close: async () => {
      clearTimeout(expiryTimer)
      for (const socket of sockets) socket.destroy()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }
}
