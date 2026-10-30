import { once } from "node:events"
import { createServer } from "node:http"
import { PassThrough } from "node:stream"
import { describe, expect, it } from "vitest"
import { WebSocketServer } from "ws"
import { runSandboxShell, SandboxShellDisconnected } from "./sandbox-shell.js"

describe("sandbox terminal transport", () => {
  async function fixture(autoPong = true, initiallyPaused = true) {
    const http = createServer((_request, response) => response.end("ok"))
    const server = new WebSocketServer({ server: http, autoPong })
    http.listen(0, "127.0.0.1")
    await once(http, "listening")
    const address = http.address()
    if (!address || typeof address === "string") throw new Error("No test listener")
    const input = new PassThrough()
    const output = new PassThrough()
    if (initiallyPaused) input.pause()
    const controller = new AbortController()
    const sandbox = {
      openInteractive: async () => ({ url: `ws://127.0.0.1:${address.port}/pty`, token: "test-token" })
    }
    const connection = once(server, "connection")
    const run = runSandboxShell({
      sandbox,
      execution: ["fx", "--add-dir", "/tmp/context with spaces"],
      cwd: "/vercel/app with spaces",
      env: { PATH: "/tmp/d3k-tools/bin:/usr/bin" },
      signal: controller.signal,
      input,
      output,
      heartbeatMs: 100
    })
    // Register rejection handling immediately, including during fixture setup.
    void run.catch(() => {})
    const [peer] = await connection
    const start = JSON.parse((await once(peer, "message"))[0].toString())
    return {
      input,
      output,
      peer,
      run,
      start,
      controller,
      cleanup: async () => {
        controller.abort()
        for (const socket of server.clients) socket.terminate()
        await new Promise<void>((resolve) => server.close(() => resolve()))
        await new Promise<void>((resolve) => http.close(() => resolve()))
      }
    }
  }

  it("keeps an idle terminal alive with pings and waits for a confirmed process exit", async () => {
    const test = await fixture()
    try {
      expect(test.start).toMatchObject({
        type: "start",
        command: "fx",
        args: ["--add-dir", "/tmp/context with spaces"],
        cwd: "/vercel/app with spaces",
        env: expect.arrayContaining(["PATH=/tmp/d3k-tools/bin:/usr/bin"])
      })
      await once(test.peer, "ping")
      await once(test.peer, "ping")
      test.peer.send(Buffer.from("agent output"), { binary: true })
      test.peer.send(JSON.stringify({ type: "exit", code: 7 }))
      expect(await test.run).toBe(7)
      expect(test.output.read().toString()).toBe("agent output")
      expect(test.input.listenerCount("data")).toBe(0)
      expect(test.input.isPaused()).toBe(true)
    } finally {
      await test.cleanup()
    }
  })

  it("treats even a clean WebSocket close as a disconnect without a remote exit frame", async () => {
    const test = await fixture()
    try {
      test.peer.close(1000)
      await expect(test.run).rejects.toThrow("without a remote exit message (WebSocket 1000)")
    } finally {
      await test.cleanup()
    }
  })

  it("accepts the real controller's zero-exit frame with its omitted code", async () => {
    const test = await fixture()
    try {
      test.peer.send(JSON.stringify({ type: "exit" }))
      expect(await test.run).toBe(0)
    } finally {
      await test.cleanup()
    }
  })

  it("detects a stalled terminal rather than silently waiting forever", async () => {
    const test = await fixture(false)
    try {
      await expect(test.run).rejects.toThrow("stopped responding to keepalives")
    } finally {
      await test.cleanup()
    }
  })

  it("distinguishes local cancellation from a transport failure and restores terminal input", async () => {
    const test = await fixture()
    try {
      test.controller.abort()
      expect(await test.run).toBeUndefined()
      expect(test.input.listenerCount("data")).toBe(0)
      expect(test.input.isPaused()).toBe(true)
    } finally {
      await test.cleanup()
    }
  })

  it("passes Ctrl-C bytes to the remote PTY instead of treating them as a local connection failure", async () => {
    const test = await fixture()
    try {
      const received = once(test.peer, "message")
      test.input.write(Buffer.from([3, 3]))
      const [bytes, binary] = await received
      expect(binary).toBe(true)
      expect(Buffer.from(bytes)).toEqual(Buffer.from([3, 3]))
      test.peer.send(JSON.stringify({ type: "exit", code: 0 }))
      expect(await test.run).toBe(0)
    } finally {
      await test.cleanup()
    }
  })

  it("stops reading a previously unused stdin after exit so the launcher can finish", async () => {
    const test = await fixture(true, false)
    try {
      test.peer.send(JSON.stringify({ type: "exit", code: 0 }))
      expect(await test.run).toBe(0)
      expect(test.input.isPaused()).toBe(true)
      expect(test.input.listenerCount("data")).toBe(0)
    } finally {
      await test.cleanup()
    }
  })

  it("does not expose endpoint credentials in connection errors", async () => {
    await expect(
      runSandboxShell({
        sandbox: { openInteractive: async () => ({ url: "http://example.com", token: "secret" }) },
        execution: ["fx"],
        cwd: "/vercel/app",
        env: {},
        signal: new AbortController().signal
      })
    ).rejects.toThrow("insecure terminal endpoint")
    expect(new SandboxShellDisconnected("Disconnected")).toBeInstanceOf(Error)
  })
})
