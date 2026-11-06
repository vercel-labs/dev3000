import { join } from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ installed: new Set<string>(), home: "/Users/d3k-test" }))
vi.mock("node:os", async (original) => ({ ...(await original<typeof import("node:os")>()), homedir: () => mocks.home }))
vi.mock("node:fs", async (original) => ({
  ...(await original<typeof import("node:fs")>()),
  existsSync: (path: string) => mocks.installed.has(path)
}))

import { sandboxChromePath } from "./chrome-isolation.js"

const systemChrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
const userChrome = join(mocks.home, "Applications", "Google Chrome.app", "Contents", "MacOS", "Google Chrome")

describe.skipIf(process.platform !== "darwin")("sandbox Chrome selection", () => {
  beforeEach(() => mocks.installed.clear())

  it("prefers the system Chrome installation when user Chrome is also installed", () => {
    mocks.installed.add(systemChrome).add(userChrome)
    const log = vi.fn()
    expect(sandboxChromePath(log)).toBe(systemChrome)
    expect(log).toHaveBeenCalledWith(`Using installed Google Chrome: ${systemChrome}`)
  })

  it("supports Chrome installed in the user's Applications directory", () => {
    mocks.installed.add(userChrome)
    expect(sandboxChromePath(vi.fn())).toBe(userChrome)
  })

  it("reports how to install Chrome when no standard installation is available", () => {
    expect(() => sandboxChromePath(vi.fn())).toThrow(/Google Chrome is required/)
  })
})
