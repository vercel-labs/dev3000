import { describe, expect, it } from "vitest"
import {
  formatMcpConfigTargets,
  MCP_CONFIG_TARGETS,
  parseDisabledMcpConfigs,
  upsertMcpServerConfig
} from "./mcp-configs.js"

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

describe("upsertMcpServerConfig", () => {
  it("updates stale dev3000 URLs while preserving existing config", () => {
    const result = upsertMcpServerConfig(
      {
        mcpServers: {
          existing: { type: "stdio", command: "existing-tool" },
          dev3000: { type: "http", url: "http://localhost:3684/mcp" }
        },
        note: "keep me"
      },
      "claude",
      "3999"
    )

    expect(result.changed).toBe(true)
    expect(result.config).toEqual({
      mcpServers: {
        existing: { type: "stdio", command: "existing-tool" },
        dev3000: { type: "http", url: "http://localhost:3999/mcp" }
      },
      note: "keep me"
    })
  })

  it("reports unchanged when the dev3000 URL already matches", () => {
    const existingConfig = {
      mcpServers: {
        dev3000: { type: "http", url: "http://localhost:3684/mcp" }
      }
    }

    const result = upsertMcpServerConfig(existingConfig, "claude", "3684")

    expect(result.changed).toBe(false)
    expect(result.config).toEqual(existingConfig)
  })

  it("updates OpenCode URLs without re-enabling a disabled entry", () => {
    const result = upsertMcpServerConfig(
      {
        mcp: {
          dev3000: { type: "remote", url: "http://localhost:3684/mcp", enabled: false }
        }
      },
      "opencode",
      "3999"
    )

    expect(result.changed).toBe(true)
    expect(result.config).toEqual({
      mcp: {
        dev3000: { type: "remote", url: "http://localhost:3999/mcp", enabled: false }
      }
    })
  })

  it("does not overwrite a custom dev3000 server entry", () => {
    const existingConfig = {
      mcpServers: {
        dev3000: { type: "stdio", command: "custom-dev3000" }
      }
    }

    const result = upsertMcpServerConfig(existingConfig, "claude", "3999")

    expect(result.changed).toBe(false)
    expect(result.config).toEqual(existingConfig)
  })
})
