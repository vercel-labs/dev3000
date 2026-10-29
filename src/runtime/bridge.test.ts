import { randomBytes } from "node:crypto"
import { once } from "node:events"
import { createServer } from "node:http"
import { afterEach, describe, expect, it, vi } from "vitest"
import { WebSocket, WebSocketServer } from "ws"
import { connectCompanion, isDevtoolsPath, isDiscoveryPath, rewriteDiscovery, startBridge } from "./bridge.js"
import { sandboxWorkdir } from "./sandbox.js"

const cleanup: (() => void | Promise<void>)[] = []
afterEach(async () => {
  vi.useRealTimers()
  for (const close of cleanup.reverse()) await close()
  cleanup.length = 0
})

async function until(predicate: () => boolean) {
  const deadline = Date.now() + 3000
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("Condition timed out")
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

async function fixture() {
  const chrome = createServer((request, response) => {
    response.setHeader("content-type", "application/json")
    response.end(
      JSON.stringify(
        request.url === "/json/version"
          ? {
              webSocketDebuggerUrl: "ws://localhost:9999/devtools/browser/browser-1"
            }
          : [
              {
                id: "page-1",
                type: "page",
                url: "about:blank",
                webSocketDebuggerUrl: "ws://localhost:9999/devtools/page/page-1"
              }
            ]
      )
    )
  })
  const sockets = new WebSocketServer({ server: chrome })
  sockets.on("connection", (socket) => socket.on("message", (data) => socket.send(data)))
  await new Promise<void>((resolve) => chrome.listen(0, "127.0.0.1", resolve))
  const address = chrome.address()
  if (!address || typeof address === "string") throw new Error("No fake Chrome port")
  cleanup.push(async () => {
    for (const socket of sockets.clients) socket.terminate()
    sockets.close()
    await new Promise<void>((resolve) => chrome.close(() => resolve()))
  })
  const token = randomBytes(32).toString("hex")
  const bridge = await startBridge({ token, port: 0, host: "127.0.0.1" })
  cleanup.push(bridge.close)
  const companion = connectCompanion({
    url: `ws://127.0.0.1:${bridge.port}/bridge`,
    token,
    chromePort: address.port,
    allowLoopback: true
  })
  cleanup.push(companion.close)
  await until(bridge.connected)
  return { bridge, companion, token }
}

describe("sandbox browser bridge", () => {
  it.each(["intermediary pings", "suspended client"])("detects a dead tunnel despite %s", async (condition) => {
    const edge = createServer()
    const sockets = new WebSocketServer({ server: edge })
    await new Promise<void>((resolve) => edge.listen(0, "127.0.0.1", resolve))
    const address = edge.address()
    if (!address || typeof address === "string") throw new Error("No edge port")
    cleanup.push(async () => {
      for (const socket of sockets.clients) socket.terminate()
      sockets.close()
      await new Promise<void>((resolve) => edge.close(() => resolve()))
    })
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] })
    const connected = once(sockets, "connection")
    const companion = connectCompanion({
      url: `ws://127.0.0.1:${address.port}/bridge`,
      token: "a".repeat(64),
      chromePort: 9222,
      allowLoopback: true
    })
    cleanup.push(companion.close)
    const [peer] = await connected
    const closed = once(peer, "close")
    if (condition === "suspended client") {
      vi.setSystemTime(Date.now() + 75000)
      peer.send(JSON.stringify({ id: "heartbeat", type: "heartbeat" }))
      await new Promise((resolve) => setTimeout(resolve, 5))
      vi.advanceTimersByTime(20000)
    } else {
      for (let i = 0; i < 4; i++) {
        peer.ping()
        await new Promise((resolve) => setTimeout(resolve, 5))
        vi.advanceTimersByTime(20000)
      }
    }
    await closed
    companion.close()
  })

  it("rewrites discovery for browser and page targets and multiplexes independent CDP clients", async () => {
    const { bridge } = await fixture()
    const targets = await fetch(`${bridge.cdpBase}/json`).then((r) => r.json())
    expect(targets[0].webSocketDebuggerUrl).toBe(`${bridge.cdpBase.replace("http:", "ws:")}/devtools/page/page-1`)
    const version = await fetch(`${bridge.cdpBase}/json/version`).then((r) => r.json())
    const clients = [new WebSocket(targets[0].webSocketDebuggerUrl), new WebSocket(version.webSocketDebuggerUrl)]
    cleanup.push(() => {
      for (const client of clients) client.terminate()
    })
    await Promise.all(clients.map((client) => once(client, "open")))
    const replies = clients.map((client) => once(client, "message"))
    // Send immediately after the remote socket opens, before local Chrome connects.
    clients[0].send('{"id":1,"method":"Page.enable"}')
    clients[1].send('{"id":1,"method":"Target.getTargets"}')
    expect((await replies[0])[0].toString()).toContain("Page.enable")
    expect((await replies[1])[0].toString()).toContain("Target.getTargets")
  })

  it("rejects unauthenticated pairing, browser origins, and public CDP discovery", async () => {
    const { bridge, token } = await fixture()
    expect((await fetch(`http://127.0.0.1:${bridge.port}/json`)).status).toBe(404)
    for (const headers of [{}, { authorization: `Bearer ${token}`, origin: "https://attacker.example" }]) {
      const socket = new WebSocket(`ws://127.0.0.1:${bridge.port}/bridge`, { headers })
      const [error] = await once(socket, "error")
      expect(error.message).toContain("403")
    }
    expect((await fetch(`${bridge.cdpBase}/json`, { headers: { origin: "https://attacker.example" } })).status).toBe(
      503
    )
    expect((await fetch(`${bridge.cdpBase}/json/new?https://attacker.example`, { method: "PUT" })).status).toBe(503)
  })

  it("closes CDP clients on disconnect and permits a new paired connection without replay", async () => {
    const { bridge, companion, token } = await fixture()
    const targets = await fetch(`${bridge.cdpBase}/json`).then((r) => r.json())
    const client = new WebSocket(targets[0].webSocketDebuggerUrl)
    await once(client, "open")
    const closed = once(client, "close")
    companion.close()
    await closed
    await until(() => !bridge.connected())
    expect((await fetch(`${bridge.cdpBase}/json`)).status).toBe(503)
    // A new companion may pair after the previous authenticated connection has gone.
    const replacement = new WebSocket(`ws://127.0.0.1:${bridge.port}/bridge`, {
      headers: { authorization: `Bearer ${token}` }
    })
    cleanup.push(() => replacement.terminate())
    await once(replacement, "open")
    await until(bridge.connected)
  })

  it("allows only fixed Chrome paths and keeps monorepo roots inside the checkout", () => {
    expect(isDiscoveryPath("http://elsewhere/json", "GET")).toBe(false)
    expect(isDiscoveryPath("/json/new?about:blank", "PUT")).toBe(false)
    expect(isDevtoolsPath("/devtools/page/../other")).toBe(false)
    expect(isDevtoolsPath("/devtools/page/id?url=http://elsewhere")).toBe(false)
    expect(() =>
      rewriteDiscovery('{"webSocketDebuggerUrl":"ws://localhost/arbitrary"}', "http://127.0.0.1:1")
    ).toThrow()
    expect(() =>
      connectCompanion({ url: "ws://example.com/bridge", token: "a".repeat(64), chromePort: 9222 })
    ).toThrow()
    expect(sandboxWorkdir("apps/web")).toBe("/vercel/sandbox/apps/web")
    expect(() => sandboxWorkdir("../../etc")).toThrow()
    expect(sandboxWorkdir("apps/web", "/vercel/repo")).toBe("/vercel/repo/apps/web")
  })

  it("automatically reconnects after the sandbox ingress restarts", async () => {
    const { bridge, token } = await fixture()
    await bridge.close()
    const replacement = await startBridge({ token, port: bridge.port, host: "127.0.0.1" })
    cleanup.push(replacement.close)
    await until(replacement.connected)
    const targets = await fetch(`${replacement.cdpBase}/json`).then((response) => response.json())
    const client = new WebSocket(targets[0].webSocketDebuggerUrl)
    cleanup.push(() => client.terminate())
    await once(client, "open")
    const reply = once(client, "message")
    client.send('{"id":2,"method":"Runtime.evaluate"}')
    expect((await reply)[0].toString()).toContain("Runtime.evaluate")
  })
})
