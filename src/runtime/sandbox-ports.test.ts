import { spawn } from "node:child_process"
import { once } from "node:events"
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { SANDBOX_APP_PORT, SANDBOX_BRIDGE_PORT, SANDBOX_PROXY_PORT, sandboxExposedPorts } from "./sandbox-ports.js"

async function freePort() {
  const server = createServer()
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const port = (server.address() as { port: number }).port
  await new Promise<void>((resolve) => server.close(() => resolve()))
  return port
}

describe("sandbox app and infrastructure ports", () => {
  it("keeps 3000 for the app and migrates legacy exposed routes without publishing the raw app", () => {
    expect(SANDBOX_APP_PORT).toBe(3000)
    expect(SANDBOX_PROXY_PORT).not.toBe(SANDBOX_APP_PORT)
    expect(sandboxExposedPorts()).toEqual([SANDBOX_PROXY_PORT, SANDBOX_BRIDGE_PORT])
    expect(sandboxExposedPorts([3000, 9223, 8080])).toEqual([9223, 8080, SANDBOX_PROXY_PORT])
    expect(sandboxExposedPorts(sandboxExposedPorts())).toEqual(sandboxExposedPorts())
  })

  it("starts an app with a Songbook-style port reuse check behind the authenticated proxy", async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "d3k-port-reuse-")))
    const appPort = await freePort()
    const proxyPort = await freePort()
    const bridgePort = await freePort()
    // The project checks a conventional fixed port before starting its server,
    // independently of PORT. Infrastructure must not make that check succeed.
    writeFileSync(
      join(root, "app.cjs"),
      `
const socket = require('node:net').connect(${appPort}, '127.0.0.1');
socket.on('connect', () => { console.log('App already running; reusing it'); socket.destroy(); });
socket.on('error', () => require('node:http').createServer((q,s) => s.end('app:'+process.env.PORT)).listen(process.env.PORT,'127.0.0.1'));
`
    )
    const child = spawn(
      "bun",
      [
        "-e",
        `
import {startRuntime} from ${JSON.stringify(fileURLToPath(new URL("./runtime.ts", import.meta.url)))};
await startRuntime(${JSON.stringify({
          cwd: root,
          serversOnly: true,
          startupTimeout: 5000,
          command: "bun app.cjs",
          sandbox: {
            appUrl: "https://ports.d3k.localhost",
            serverPort: proxyPort,
            appPort,
            bridgePort,
            token: "a".repeat(64),
            proxyToken: "companion"
          }
        })});`
      ],
      { cwd: root, env: { ...process.env, D3K_DATA_DIR: join(root, "discovery") }, stdio: ["ignore", "pipe", "pipe"] }
    )
    const exited = once(child, "exit")
    let output = ""
    child.stdout.on("data", (chunk) => {
      output += chunk
    })
    child.stderr.on("data", (chunk) => {
      output += chunk
    })
    try {
      const deadline = Date.now() + 8000
      while (!output.includes('"ready":true')) {
        if (child.exitCode !== null || Date.now() > deadline)
          throw new Error(`Port regression fixture failed: ${output}`)
        await new Promise((resolve) => setTimeout(resolve, 25))
      }
      expect(output).not.toContain("App already running")
      expect(await (await fetch(`http://127.0.0.1:${appPort}`)).text()).toBe(`app:${appPort}`)
      expect((await fetch(`http://127.0.0.1:${proxyPort}`)).status).toBe(403)
      const response = await fetch(`http://127.0.0.1:${proxyPort}`, { headers: { "x-d3k-proxy-token": "companion" } })
      expect(await response.text()).toBe(`app:${appPort}`)
    } finally {
      child.kill("SIGTERM")
      await exited
      rmSync(root, { recursive: true, force: true })
    }
  }, 15000)
})
