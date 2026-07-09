import { describe, expect, it } from "vitest"
import { buildPortlessServerCommand, type PortlessRuntime, parsePortlessUrl } from "./portless"

const runtime: PortlessRuntime = {
  name: "example-app",
  url: "http://example-app.localhost:1355",
  command: "/usr/local/bin/portless"
}

describe("Portless integration", () => {
  it("extracts the canonical URL from Portless output", () => {
    expect(parsePortlessUrl("service URL: https://example.localhost\n")).toBe("https://example.localhost")
    expect(parsePortlessUrl("no URL here")).toBeNull()
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
