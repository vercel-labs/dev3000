import { describe, expect, it, vi } from "vitest"

vi.mock("os", () => ({
  homedir: () => "/tmp/home"
}))

const mkdirSync = vi.fn()

vi.mock("fs", () => ({
  mkdirSync
}))

describe("d3k-dir", () => {
  it("should build the d3k home dir path", async () => {
    const { getD3kHomeDir } = await import("./d3k-dir")
    expect(getD3kHomeDir()).toBe("/tmp/home/.d3k")
  })

  it("should create the d3k home dir", async () => {
    const { ensureD3kHomeDir } = await import("./d3k-dir")
    const dir = ensureD3kHomeDir()
    expect(dir).toBe("/tmp/home/.d3k")
    expect(mkdirSync).toHaveBeenCalledWith("/tmp/home/.d3k", { recursive: true })
  })
})
