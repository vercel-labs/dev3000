import { describe, expect, it } from "vitest"
import { formatMcpConfigTargets, MCP_CONFIG_TARGETS, parseDisabledMcpConfigs } from "./mcp-configs.js"

describe("parseDisabledMcpConfigs", () => {
  it("returns an empty array when input is undefined", () => {
    expect(parseDisabledMcpConfigs()).toEqual([])
  })

  it("supports the 'all' keyword", () => {
    expect(parseDisabledMcpConfigs("all")).toEqual([...MCP_CONFIG_TARGETS])
  })

  it("ignores the 'none' keyword", () => {
    expect(parseDisabledMcpConfigs("none")).toEqual([])
  })

  it("parses comma or space separated lists", () => {
    expect(parseDisabledMcpConfigs("claude cursor,opencode")).toEqual(["claude", "cursor", "opencode"])
  })

  it("supports aliases for each config target", () => {
    expect(parseDisabledMcpConfigs(".mcp.json cursor/mcp opencode.json")).toEqual(["claude", "cursor", "opencode"])
  })
})

describe("formatMcpConfigTargets", () => {
  it("formats targets using friendly file names", () => {
    expect(formatMcpConfigTargets(["claude", "cursor"])).toBe(".mcp.json, .cursor/mcp.json")
  })

  it("returns an empty string when no targets are provided", () => {
    expect(formatMcpConfigTargets([])).toBe("")
  })
})
