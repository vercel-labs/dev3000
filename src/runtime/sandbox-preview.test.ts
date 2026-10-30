import { createServer, type IncomingHttpHeaders, request } from "node:http"
import { afterEach, describe, expect, it } from "vitest"
import { WebSocket, WebSocketServer } from "ws"
import { sandboxPreviewLink } from "./sandbox-preview.js"
import { startSandboxProxy } from "./sandbox-proxy.js"

const origin = "https://preview.example.test"
const token = "a".repeat(64)
const cookie = `__Host-d3k-preview=${token}`
const cleanup: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const close of cleanup.reverse()) await close()
  cleanup.length = 0
})

async function fixture(expiresAt = Date.now() + 60000, appUrl = "https://test.d3k.localhost") {
  const app = createServer((incoming, response) => {
    if (incoming.url === "/redirect") {
      response
        .writeHead(302, {
          location: "https://test.d3k.localhost/account?q=1#done",
          "set-cookie": "app=ok; Domain=test.d3k.localhost; Secure"
        })
        .end()
      return
    }
    response.setHeader("cache-control", "public, max-age=3600")
    response.end(JSON.stringify({ path: incoming.url, headers: incoming.headers }))
  })
  const sockets = new WebSocketServer({ server: app })
  sockets.on("connection", (socket, incoming) => socket.send(JSON.stringify(incoming.headers)))
  await new Promise<void>((resolve) => app.listen(0, "127.0.0.1", resolve))
  cleanup.push(async () => {
    for (const socket of sockets.clients) socket.terminate()
    sockets.close()
    app.closeAllConnections()
    await new Promise<void>((resolve) => app.close(() => resolve()))
  })
  const proxy = await startSandboxProxy({
    port: 0,
    targetPort: (app.address() as { port: number }).port,
    appUrl,
    token: "companion-secret",
    preview: { origin, token, expiresAt }
  })
  cleanup.push(proxy.close)
  const http = (path: string, headers: IncomingHttpHeaders = {}, method = "GET", body?: string) =>
    new Promise<{ status: number; headers: IncomingHttpHeaders; body: string }>((resolve, reject) => {
      const outgoing = request(
        {
          host: "127.0.0.1",
          port: proxy.port,
          path,
          method,
          headers: { host: "preview.example.test", ...headers }
        },
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
    })
  return { http, port: proxy.port }
}

describe("phone sandbox previews", () => {
  it("keeps link credentials in a fragment and exchanges them for a secure cookie", async () => {
    const { http } = await fixture()
    const link = new URL(sandboxPreviewLink({ origin, token, expiresAt: Date.now() + 60000 }))
    expect(link.hash).toBe(`#${token}`)
    expect(link.search).toBe("")
    const bootstrap = await http(link.pathname)
    expect(bootstrap.status).toBe(200)
    expect(bootstrap.body).not.toContain(token)
    expect(bootstrap.body.indexOf("history.replaceState")).toBeLessThan(bootstrap.body.indexOf("fetch("))
    expect(bootstrap.headers["cache-control"]).toBe("no-store")
    expect(bootstrap.headers["referrer-policy"]).toBe("no-referrer")
    const auth = await http(`${link.pathname}/authorize`, { origin }, "POST", token)
    expect(auth.status).toBe(204)
    expect(auth.headers["set-cookie"]?.[0]).toMatch(/Path=\/; Secure; HttpOnly; SameSite=Lax; Max-Age=\d+/)
    const response = await http("/api/check?q=1", { cookie: `${cookie}; app=ok` })
    expect(response.status).toBe(200)
    expect(response.headers["cache-control"]).toBe("private, no-store")
    expect(JSON.parse(response.body)).toMatchObject({
      path: "/api/check?q=1",
      headers: {
        host: "preview.example.test",
        "x-forwarded-host": "preview.example.test",
        "x-forwarded-proto": "https",
        cookie: "app=ok"
      }
    })
    expect(response.body).not.toContain(token)
  })

  it("rejects unauthenticated requests, forged hosts/origins and malformed credentials", async () => {
    const { http } = await fixture()
    for (const headers of [
      {},
      { cookie: "__Host-d3k-preview=bad" },
      { cookie, host: "attacker.test" },
      { cookie, origin: "https://attacker.test" },
      { cookie: `${cookie}; ${cookie}` }
    ])
      expect((await http("/", headers)).status).toBe(403)
    for (const [headers, body] of [
      [{}, token],
      [{ origin: "https://attacker.test" }, token],
      [{ origin }, "b".repeat(64)],
      [{ origin }, "💥".repeat(32)]
    ] as const)
      expect([403, 413]).toContain((await http("/.d3k/preview/authorize", headers, "POST", body)).status)
    expect((await http("/.d3k/preview/authorize", { origin }, "POST", "a".repeat(65))).status).toBe(413)
    expect((await http("/mutate", { cookie }, "POST", "change")).status).toBe(403)
    expect((await http("/mutate", { cookie, origin }, "POST", "change")).status).toBe(200)
  })

  it("expires phone access independently of companion access", async () => {
    const { http } = await fixture(Date.now() - 1)
    expect((await http("/", { cookie })).status).toBe(403)
    expect((await http("/.d3k/preview")).status).toBe(403)
    expect((await http("/.d3k/preview/authorize", { origin }, "POST", token)).status).toBe(403)
    const local = await http("/", { "x-d3k-proxy-token": "companion-secret" })
    expect(local.status).toBe(200)
    expect(JSON.parse(local.body).headers.host).toBe("test.d3k.localhost")
  })

  it("adapts local-origin redirects and cookies for the phone origin", async () => {
    const { http } = await fixture()
    const response = await http("/redirect", { cookie })
    expect(response.headers.location).toBe(`${origin}/account?q=1#done`)
    expect(response.headers["set-cookie"]).toEqual(["app=ok; Secure"])
  })

  it("supports authenticated HMR while rejecting foreign WebSocket origins", async () => {
    const { port } = await fixture()
    const socket = new WebSocket(`ws://127.0.0.1:${port}/_next/webpack-hmr`, {
      headers: { host: "preview.example.test", cookie, origin }
    })
    try {
      const headers = await new Promise<Record<string, string>>((resolve, reject) => {
        socket.on("message", (value) => resolve(JSON.parse(value.toString())))
        socket.on("error", reject)
      })
      expect(headers.host).toBe("preview.example.test")
      expect(headers.origin).toMatch(/^http:\/\/localhost:\d+$/)
      expect(headers.cookie).toBeUndefined()
      const foreign = new WebSocket(`ws://127.0.0.1:${port}/socket`, {
        headers: { host: "preview.example.test", cookie, origin: "https://attacker.test" }
      })
      await new Promise<void>((resolve, reject) => {
        foreign.on("open", () => {
          foreign.terminate()
          reject(new Error("Foreign origin was allowed"))
        })
        foreign.on("error", () => resolve())
      })
    } finally {
      socket.terminate()
    }
  })

  it("closes an already-connected preview WebSocket when access expires", async () => {
    const { port } = await fixture(Date.now() + 300)
    const socket = new WebSocket(`ws://127.0.0.1:${port}/socket`, {
      headers: { host: "preview.example.test", cookie, origin }
    })
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Preview connection outlived its access deadline")), 1500)
        socket.on("close", () => {
          clearTimeout(timer)
          resolve()
        })
        socket.on("error", (error) => {
          clearTimeout(timer)
          reject(error)
        })
      })
    } finally {
      socket.terminate()
    }
  })
  it("also expires cloud browser sockets when app and preview share their origin", async () => {
    const { port, http } = await fixture(Date.now() + 400, origin)
    const page = await http("/", { cookie })
    expect(page.headers["cache-control"]).toBe("private, no-store")
    const socket = new WebSocket(`ws://127.0.0.1:${port}/socket`, {
      headers: { host: "preview.example.test", cookie, origin }
    })
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Cloud socket outlived preview")), 1500)
        socket.on("close", () => {
          clearTimeout(timer)
          resolve()
        })
        socket.on("error", reject)
      })
    } finally {
      socket.terminate()
    }
  })
})
