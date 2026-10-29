import { mkdtempSync, rmSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { RouteStore } from "portless"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  buildPortlessServerCommand,
  isCanonicalPortlessUrl,
  isPortlessHostnameHeld,
  type PortlessRuntime,
  parsePortlessProxyStatus,
  parsePortlessUrl,
  registerPortlessAlias,
  removePortlessAlias
} from "./portless"

const runtime: PortlessRuntime = {
  name: "example-app",
  url: "https://example-app.localhost",
  command: "/usr/local/bin/portless"
}

describe("Portless integration", () => {
  it("extracts the canonical URL from Portless output", () => {
    expect(parsePortlessUrl("service URL: https://example.localhost\n")).toBe("https://example.localhost")
    expect(parsePortlessUrl("no URL here")).toBeNull()
  })

  it("only accepts genuinely port-free URLs as canonical", () => {
    expect(isCanonicalPortlessUrl("https://example.localhost")).toBe(true)
    expect(isCanonicalPortlessUrl("http://example.localhost")).toBe(true)
    expect(isCanonicalPortlessUrl("https://example.localhost:443")).toBe(false)
    expect(isCanonicalPortlessUrl("http://example.localhost:1355")).toBe(false)
    expect(isCanonicalPortlessUrl("not a URL")).toBe(false)
  })

  it("recognizes a persistent canonical HTTPS proxy", () => {
    const status = parsePortlessProxyStatus(
      "Proxy target: https://127.0.0.1\nok    Proxy is running on port 443.",
      "Installed: yes\nProxy on 443: responding"
    )

    expect(status).toMatchObject({
      serviceInstalled: true,
      proxyRunning: true,
      canonical: true,
      setupRequired: false
    })
  })

  it("requires setup for a high-port proxy", () => {
    const status = parsePortlessProxyStatus(
      "Proxy target: https://127.0.0.1:1355\nok    Proxy is responding on port 1355.",
      "Installed: no\nProxy on 443: not responding"
    )

    expect(status).toMatchObject({
      serviceInstalled: false,
      proxyRunning: true,
      canonical: false,
      setupRequired: true
    })
  })

  it("requires setup when the canonical proxy is not persistent", () => {
    const status = parsePortlessProxyStatus(
      "Proxy target: https://127.0.0.1\nok    Proxy is running on port 443.",
      "Installed: no\nProxy on 443: responding"
    )

    expect(status).toMatchObject({
      serviceInstalled: false,
      canonical: true,
      setupRequired: true
    })
  })

  it("wraps detected server commands with Portless", () => {
    const command = buildPortlessServerCommand(runtime, "bun run dev")

    expect(command).toContain("run --name 'example-app'")
    expect(command).toContain("-- bun run dev")
    expect(command).not.toContain("--app-port")
  })

  it("forwards explicit app ports", () => {
    const command = buildPortlessServerCommand(runtime, "bun run dev", { appPort: "4321" })

    expect(command).toContain("--app-port '4321'")
  })

  it("preserves custom shell commands as one child command", () => {
    const command = buildPortlessServerCommand(runtime, "API_MODE=local bun run dev", { customCommand: true })

    expect(command).toContain("-- sh -c 'API_MODE=local bun run dev'")
  })
})

describe("isPortlessHostnameHeld", () => {
  const dirs: string[] = []
  const stateDirWith = (routes: unknown) => {
    const dir = mkdtempSync(join(tmpdir(), "portless-state-"))
    dirs.push(dir)
    writeFileSync(join(dir, "routes.json"), JSON.stringify(routes))
    return dir
  }

  afterEach(() => {
    vi.unstubAllEnvs()
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  it("owns sandbox aliases by process and cannot remove another owner's route", () => {
    const dir = stateDirWith([])
    vi.stubEnv("PORTLESS_STATE_DIR", dir)
    const route = { ...runtime, name: "songbook.d3k", url: "https://songbook.d3k.localhost" }
    registerPortlessAlias(route, 4321)
    const store = new RouteStore(dir)
    expect(store.loadRoutes()).toMatchObject([{ hostname: "songbook.d3k.localhost", port: 4321, pid: process.pid }])
    removePortlessAlias(route)
    expect(store.loadRoutes()).toEqual([])
    store.addRoute("songbook.d3k.localhost", 4322, 0)
    expect(() => registerPortlessAlias(route, 4321)).toThrow()
    removePortlessAlias(route)
    expect(store.loadRoutes()[0].port).toBe(4322)
  })

  it("treats a route owned by a live process as held", () => {
    const dir = stateDirWith([{ hostname: "my-app.localhost", port: 4000, pid: process.pid }])
    expect(isPortlessHostnameHeld("my-app", dir)).toBe(true)
  })

  it("treats a static alias (pid 0) as held, since Portless refuses to replace it", () => {
    const dir = stateDirWith([{ hostname: "my-app.localhost", port: 3000, pid: 0 }])
    expect(isPortlessHostnameHeld("my-app", dir)).toBe(true)
  })

  it("ignores stale routes from exited processes and other hostnames", () => {
    const dir = stateDirWith([
      { hostname: "my-app.localhost", port: 4000, pid: 2 ** 30 },
      { hostname: "other-app.localhost", port: 4001, pid: process.pid }
    ])
    expect(isPortlessHostnameHeld("my-app", dir)).toBe(false)
  })

  it("treats a missing or malformed route table as free", () => {
    expect(isPortlessHostnameHeld("my-app", join(tmpdir(), "portless-state-does-not-exist"))).toBe(false)
    expect(isPortlessHostnameHeld("my-app", stateDirWith({ not: "an array" }))).toBe(false)
  })
})
