import { once } from "node:events"
import { createServer } from "node:http"
import { afterEach, describe, expect, it } from "vitest"
import { WebSocket, WebSocketServer } from "ws"
import { startSandboxProxy } from "./sandbox-proxy.js"

const cleanup: (() => void | Promise<void>)[] = []
afterEach(async () => {
  for (const close of cleanup.reverse()) await close()
  cleanup.length = 0
})

async function fixture() {
  const upstream = createServer((request, response) => {
    let body = ""
    request.on("data", (chunk) => {
      body += chunk.toString()
    })
    request.on("end", () => {
      response.writeHead(201, { "content-type": "application/json" })
      response.end(JSON.stringify({ path: request.url, method: request.method, origin: request.headers.origin, body }))
    })
  })
  const wsServer = new WebSocketServer({ server: upstream })
  wsServer.on("connection", (socket, request) => {
    socket.send(JSON.stringify({ origin: request.headers.origin, path: request.url }))
    socket.on("message", (data) => socket.send(data))
  })
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve))
  const address = upstream.address()
  if (!address || typeof address === "string") throw new Error("No upstream port")
  cleanup.push(async () => {
    for (const socket of wsServer.clients) socket.terminate()
    wsServer.close()
    await new Promise<void>((resolve) => upstream.close(() => resolve()))
  })
  const proxy = await startSandboxProxy({ port: 0, targetPort: address.port, appUrl: "https://proof.vercel.run" })
  cleanup.push(proxy.close)
  return { proxy, targetPort: address.port }
}

describe("sandbox app proxy", () => {
  it("preserves HTTP paths, bodies, statuses and application origins", async () => {
    const { proxy } = await fixture()
    const response = await fetch(`http://127.0.0.1:${proxy.port}/api/test?q=1`, {
      method: "POST",
      headers: { origin: "https://proof.vercel.run" },
      body: "payload"
    })
    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({
      path: "/api/test?q=1",
      method: "POST",
      origin: "https://proof.vercel.run",
      body: "payload"
    })
  })

  it.each(["/_next/hmr?id=1", "/base/_next/webpack-hmr"])(
    "allows only the exact sandbox origin for %s",
    async (path) => {
      const { proxy, targetPort } = await fixture()
      for (const origin of [undefined, "https://attacker.example", "https://proof.vercel.run.attacker.example"]) {
        const client = new WebSocket(`ws://127.0.0.1:${proxy.port}${path}`, { origin })
        const [error] = await once(client, "error")
        expect(error.message).toContain("403")
      }
      const client = new WebSocket(`ws://127.0.0.1:${proxy.port}${path}`, { origin: "https://proof.vercel.run" })
      cleanup.push(() => client.terminate())
      const initial = once(client, "message")
      await once(client, "open")
      expect(JSON.parse((await initial)[0].toString())).toEqual({ origin: `http://localhost:${targetPort}`, path })
      const echo = once(client, "message")
      client.send("HMR update")
      expect((await echo)[0].toString()).toBe("HMR update")
    }
  )

  it("preserves origins for ordinary application WebSockets", async () => {
    const { proxy } = await fixture()
    const client = new WebSocket(`ws://127.0.0.1:${proxy.port}/chat`, { origin: "https://proof.vercel.run" })
    cleanup.push(() => client.terminate())
    const initial = once(client, "message")
    await once(client, "open")
    expect(JSON.parse((await initial)[0].toString()).origin).toBe("https://proof.vercel.run")
  })
})
