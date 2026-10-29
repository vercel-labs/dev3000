import { createServer, request } from "node:http"
import type { Socket } from "node:net"

/** Stream app traffic inside the VM. Validate the public origin before normalizing Next's HMR upgrade. */
export async function startSandboxProxy(options: { port: number; targetPort: number; appUrl: string; token?: string }) {
  const origin = new URL(options.appUrl).origin
  const sockets = new Set<Socket>()
  const server = createServer((incoming, response) => {
    if (options.token && incoming.headers["x-d3k-proxy-token"] !== options.token) {
      response.writeHead(403).end("Forbidden")
      return
    }
    const headers = { ...incoming.headers }
    delete headers["x-d3k-proxy-token"]
    if (options.token) {
      headers.host = new URL(origin).host
      headers["x-forwarded-host"] = headers.host
      headers["x-forwarded-proto"] = "https"
    }
    const upstream = request(
      {
        host: "127.0.0.1",
        port: options.targetPort,
        method: incoming.method,
        path: incoming.url,
        headers
      },
      (result) => {
        response.writeHead(result.statusCode || 502, result.headers)
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
    socket.on("close", () => sockets.delete(socket))
  })
  server.on("upgrade", (incoming, client, head) => {
    if (options.token && incoming.headers["x-d3k-proxy-token"] !== options.token) {
      client.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n")
      return
    }
    const headers = { ...incoming.headers }
    delete headers["x-d3k-proxy-token"]
    if (options.token) {
      headers.host = new URL(origin).host
      headers["x-forwarded-host"] = headers.host
      headers["x-forwarded-proto"] = "https"
    }
    let path: string
    try {
      path = new URL(incoming.url || "/", origin).pathname
    } catch {
      client.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n")
      return
    }
    if (path.endsWith("/_next/hmr") || path.endsWith("/_next/webpack-hmr")) {
      if (headers.origin !== origin) {
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
  return {
    port: address.port,
    close: async () => {
      for (const socket of sockets) socket.destroy()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }
}
