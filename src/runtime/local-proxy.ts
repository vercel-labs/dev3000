import { createServer, type IncomingHttpHeaders } from "node:http"
import { Agent, request as httpsRequest } from "node:https"
import type { Socket } from "node:net"
import type { ConnectionOptions } from "node:tls"

/** The browser keeps a stable local origin; only the transport host changes for Vercel routing. */
export async function startLocalProxy(options: {
  appUrl: string
  upstreamUrl: string
  token: string
  ca?: ConnectionOptions["ca"]
}) {
  const origin = new URL(options.appUrl)
  const target = new URL(options.upstreamUrl)
  if (origin.protocol !== "https:" || target.protocol !== "https:") throw new Error("Proxy origins must use HTTPS")
  const sockets = new Set<Socket>()
  const agent = new Agent({ keepAlive: true, ca: options.ca })
  const validPath = (path: string | undefined) => !!path?.startsWith("/") && !path.startsWith("//")
  const headers = (input: IncomingHttpHeaders): IncomingHttpHeaders => ({
    ...input,
    host: target.host,
    "x-forwarded-host": origin.host,
    "x-forwarded-proto": "https",
    "x-d3k-proxy-token": options.token
  })
  const server = createServer((incoming, response) => {
    if (incoming.headers.host !== origin.host) {
      response.writeHead(421).end()
      return
    }
    if (!validPath(incoming.url)) {
      response.writeHead(400).end()
      return
    }
    const upstream = httpsRequest(
      target,
      { method: incoming.method, path: incoming.url, headers: headers(incoming.headers), agent },
      (result) => {
        const output = { ...result.headers }
        if (output.location) {
          try {
            const location = new URL(output.location, target)
            if (location.origin === target.origin)
              output.location = `${origin.origin}${location.pathname}${location.search}${location.hash}`
          } catch {
            // Invalid application redirects must not crash the companion.
          }
        }
        if (output["set-cookie"])
          output["set-cookie"] = output["set-cookie"].map((cookie) =>
            cookie.replace(/;\s*Domain=([^;]+)/gi, (field, domain: string) =>
              domain.replace(/^\./, "").toLowerCase() === target.hostname ? "" : field
            )
          )
        response.writeHead(result.statusCode || 502, output)
        result.pipe(response)
        result.on("error", () => response.destroy())
      }
    )
    upstream.on("error", () =>
      response.headersSent ? response.destroy() : response.writeHead(502).end("Sandbox unavailable")
    )
    incoming.on("aborted", () => upstream.destroy())
    response.on("close", () => upstream.destroy())
    incoming.pipe(upstream)
  })
  server.on("connection", (socket) => {
    sockets.add(socket)
    socket.on("close", () => sockets.delete(socket))
  })
  server.on("upgrade", (incoming, client, head) => {
    if (
      incoming.headers.host !== origin.host ||
      !validPath(incoming.url) ||
      (incoming.headers.origin && incoming.headers.origin !== origin.origin)
    ) {
      client.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n")
      return
    }
    const upstream = httpsRequest(target, {
      method: incoming.method,
      path: incoming.url,
      headers: headers(incoming.headers),
      agent
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
      const lines = response.rawHeaders.reduce<string[]>((output, field, index, raw) => {
        if (!(index % 2)) output.push(`${field}: ${raw[index + 1]}`)
        return output
      }, [])
      client.write(`HTTP/1.1 ${response.statusCode} ${response.statusMessage}\r\n${lines.join("\r\n")}\r\n\r\n`)
      if (remoteHead.length) client.write(remoteHead)
      if (head.length) remote.write(head)
      client.pipe(remote).pipe(client)
    })
    upstream.on("response", (response) => {
      response.resume()
      client.end(`HTTP/1.1 ${response.statusCode || 502} Upstream response\r\nConnection: close\r\n\r\n`)
    })
    upstream.on("error", () => client.destroy())
    client.on("close", () => upstream.destroy())
    upstream.end()
  })
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Local proxy did not bind")
  return {
    port: address.port,
    close: async () => {
      agent.destroy()
      for (const socket of sockets) socket.destroy()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }
}
