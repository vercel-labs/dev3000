import { execFileSync } from "node:child_process"
import { once } from "node:events"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { createServer as httpServer, request } from "node:http"
import { createServer } from "node:https"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import { WebSocket, WebSocketServer } from "ws"
import { startLocalProxy } from "./local-proxy.js"
import { startSandboxProxy } from "./sandbox-proxy.js"

const origin = "https://songbook.d3k.localhost"
const token = "test-session-token"
const cleanup: (() => void | Promise<void>)[] = []
let directory: string
let key: Buffer
let cert: Buffer
beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), "d3k-proxy-test-"))
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-days",
      "1",
      "-subj",
      "/CN=127.0.0.1",
      "-addext",
      "subjectAltName=IP:127.0.0.1",
      "-keyout",
      join(directory, "key.pem"),
      "-out",
      join(directory, "cert.pem")
    ],
    { stdio: "ignore" }
  )
  key = readFileSync(join(directory, "key.pem"))
  cert = readFileSync(join(directory, "cert.pem"))
})
afterAll(() => rmSync(directory, { recursive: true, force: true }))
afterEach(async () => {
  for (const close of cleanup.reverse()) await close()
  cleanup.length = 0
})

async function fixture() {
  const app = httpServer((incoming, response) => {
    if (incoming.url === "/account/logout") {
      response.writeHead(302, { location: "login?q=1" }).end()
      return
    }
    if (incoming.url === "/redirect") {
      response
        .writeHead(302, {
          location: `${upstreamUrl}/destination?q=1`,
          "set-cookie": "session=proof; Domain=127.0.0.1; Secure; HttpOnly; SameSite=Lax"
        })
        .end()
      return
    }
    if (incoming.url === "/oauth") {
      response.writeHead(302, { location: "https://accounts.example/login" }).end()
      return
    }
    if (incoming.url === "/bad-redirect") {
      response.writeHead(302, { location: "http://[" }).end()
      return
    }
    let body = ""
    incoming.on("data", (chunk) => {
      body += chunk
    })
    incoming.on("end", () =>
      response
        .writeHead(201, { "content-type": "application/json" })
        .end(JSON.stringify({ path: incoming.url, body, headers: incoming.headers }))
    )
  })
  const ws = new WebSocketServer({ server: app })
  ws.on("connection", (socket, incoming) => {
    socket.send(JSON.stringify(incoming.headers))
    socket.on("message", (data) => socket.send(data))
  })
  await new Promise<void>((resolve) => app.listen(0, "127.0.0.1", resolve))
  const appPort = (app.address() as { port: number }).port
  cleanup.push(async () => {
    for (const socket of ws.clients) socket.terminate()
    ws.close()
    app.closeAllConnections()
    await new Promise<void>((resolve) => app.close(() => resolve()))
  })
  const remote = await startSandboxProxy({ port: 0, targetPort: appPort, appUrl: origin, token })
  cleanup.push(remote.close)
  // TLS terminates at Vercel's edge. Model that hop without disabling TLS verification.
  const edge = createServer({ key, cert }, (incoming, response) => {
    const upstream = request(
      { host: "127.0.0.1", port: remote.port, path: incoming.url, method: incoming.method, headers: incoming.headers },
      (result) => {
        response.writeHead(result.statusCode || 502, result.headers)
        result.pipe(response)
      }
    )
    incoming.pipe(upstream)
  })
  edge.on("upgrade", (incoming, client, head) => {
    const upstream = request({ host: "127.0.0.1", port: remote.port, path: incoming.url, headers: incoming.headers })
    upstream.on("upgrade", (response, socket, remoteHead) => {
      client.write(
        `HTTP/1.1 101 Switching Protocols\r\n${response.rawHeaders
          .reduce<string[]>((lines, value, index, raw) => {
            if (index % 2 === 0) lines.push(`${value}: ${raw[index + 1]}`)
            return lines
          }, [])
          .join("\r\n")}\r\n\r\n`
      )
      if (head.length) socket.write(head)
      if (remoteHead.length) client.write(remoteHead)
      client.pipe(socket).pipe(client)
      client.on("close", () => socket.destroy())
      socket.on("close", () => client.destroy())
    })
    upstream.on("error", () => client.destroy())
    upstream.end()
  })
  await new Promise<void>((resolve) => edge.listen(0, "127.0.0.1", resolve))
  const upstreamUrl = `https://127.0.0.1:${(edge.address() as { port: number }).port}`
  cleanup.push(async () => {
    edge.closeAllConnections()
    await new Promise<void>((resolve) => edge.close(() => resolve()))
  })
  const local = await startLocalProxy({ appUrl: origin, upstreamUrl, token, ca: cert })
  cleanup.push(local.close)
  return { local, remote, appPort }
}

function http(port: number, path: string, host = "songbook.d3k.localhost", body?: string) {
  return new Promise<{ status: number; headers: import("node:http").IncomingHttpHeaders; body: string }>(
    (resolve, reject) => {
      const outgoing = request(
        { host: "127.0.0.1", port, path, method: body ? "POST" : "GET", headers: { host } },
        (response) => {
          let output = ""
          response.on("data", (chunk) => {
            output += chunk
          })
          response.on("end", () =>
            resolve({ status: response.statusCode || 0, headers: response.headers, body: output })
          )
        }
      )
      outgoing.on("error", reject)
      outgoing.end(body)
    }
  )
}

describe("stable local sandbox proxy", () => {
  it("streams bodies and preserves the local app origin while stripping its token", async () => {
    const { local } = await fixture()
    const response = await http(local.port, "/api/test?q=1", undefined, "payload")
    expect(response.status).toBe(201)
    const result = JSON.parse(response.body)
    expect(result.path).toBe("/api/test?q=1")
    expect(result.body).toBe("payload")
    expect(result.headers.host).toBe("songbook.d3k.localhost")
    expect(result.headers["x-forwarded-host"]).toBe("songbook.d3k.localhost")
    expect(result.headers["x-forwarded-proto"]).toBe("https")
    expect(result.headers["x-d3k-proxy-token"]).toBeUndefined()
  })

  it("rewrites upstream redirects and cookie domains, preserving external and malformed redirects", async () => {
    const { local } = await fixture()
    const response = await http(local.port, "/redirect")
    expect(response.headers.location).toBe(`${origin}/destination?q=1`)
    expect(response.headers["set-cookie"]).toEqual(["session=proof; Secure; HttpOnly; SameSite=Lax"])
    expect((await http(local.port, "/oauth")).headers.location).toBe("https://accounts.example/login")
    expect((await http(local.port, "/bad-redirect")).headers.location).toBe("http://[")
    expect((await http(local.port, "/account/logout")).headers.location).toBe(`${origin}/account/login?q=1`)
  })

  it("rejects foreign hosts, absolute request targets and unpaired public requests", async () => {
    const { local, remote } = await fixture()
    expect((await http(local.port, "/", "attacker.example")).status).toBe(421)
    expect((await http(local.port, "https://attacker.example/")).status).toBe(400)
    expect((await http(remote.port, "/")).status).toBe(403)
  })

  it("streams HMR WebSockets in both directions and rejects foreign origins", async () => {
    const { local, appPort } = await fixture()
    const rejected = new WebSocket(`ws://127.0.0.1:${local.port}/_next/hmr`, {
      headers: { host: "songbook.d3k.localhost" },
      origin: "https://attacker.example"
    })
    expect((await once(rejected, "error"))[0].message).toContain("403")
    const client = new WebSocket(`ws://127.0.0.1:${local.port}/_next/hmr`, {
      headers: { host: "songbook.d3k.localhost" },
      origin
    })
    cleanup.push(() => client.terminate())
    const initial = once(client, "message")
    await once(client, "open")
    const headers = JSON.parse((await initial)[0].toString())
    expect(headers.origin).toBe(`http://localhost:${appPort}`)
    expect(headers.host).toBe("songbook.d3k.localhost")
    expect(headers["x-d3k-proxy-token"]).toBeUndefined()
    const echo = once(client, "message")
    client.send("update")
    expect((await echo)[0].toString()).toBe("update")
    const closed = once(client, "close")
    await local.close()
    cleanup.splice(cleanup.indexOf(local.close), 1)
    await closed
  })
})
