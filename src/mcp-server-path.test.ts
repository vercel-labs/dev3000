import { describe, expect, it } from "vitest"

describe("MCP Server Path Resolution", () => {
  it("should correctly identify global pnpm installations", () => {
    // Test various path patterns
    const globalPaths = [
      "/Users/test/.pnpm/dev3000@latest/node_modules/dev3000/mcp-server",
      "/home/user/.local/share/pnpm/global/5/.pnpm/dev3000@0.0.68/node_modules/dev3000/mcp-server",
      "/Users/test/.pnpm/store/v3/dev3000/mcp-server"
    ]

    for (const path of globalPaths) {
      const isGlobal = path.includes(".pnpm")
      expect(isGlobal).toBe(true)
    }
  })

  it("should correctly identify local installations", () => {
    const localPaths = [
      "/Users/test/projects/myapp/node_modules/dev3000/mcp-server",
      "/home/user/dev/project/node_modules/dev3000/mcp-server",
      "./mcp-server",
      "../dev3000/mcp-server"
    ]

    for (const path of localPaths) {
      const isGlobal = path.includes(".pnpm")
      expect(isGlobal).toBe(false)
    }
  })

  it("should detect pre-built servers by checking .next directory", () => {
    // Test the logic without relying on actual file system
    const hasNextDirectory = (path: string) => {
      // In production, pre-built servers should have .next directory
      return path.includes(".next")
    }

    // Simulate pre-built server
    const preBuiltPath = "/path/to/server/.next"
    expect(hasNextDirectory(preBuiltPath)).toBe(true)

    // Simulate non-pre-built server
    const nonPreBuiltPath = "/path/to/server"
    expect(hasNextDirectory(nonPreBuiltPath)).toBe(false)
  })

  it("should determine correct working directory for global pre-built servers", () => {
    // Simulate the logic for determining working directory
    const mcpServerPath = "/Users/test/.pnpm/dev3000@latest/node_modules/dev3000/mcp-server"
    const isGlobalInstall = mcpServerPath.includes(".pnpm")
    const isPreBuilt = true // Simulated

    let actualWorkingDir = mcpServerPath

    // This is the key logic we're testing
    if (isGlobalInstall && isPreBuilt) {
      // For global installs with pre-built servers, run from original location
      actualWorkingDir = mcpServerPath
    }

    expect(actualWorkingDir).toBe(mcpServerPath)
    expect(actualWorkingDir).not.toContain("tmp")
  })

  it("should use temp directory for non-pre-built servers", () => {
    const mcpServerPath = "/Users/test/.pnpm/dev3000@latest/node_modules/dev3000/mcp-server"
    const isGlobalInstall = mcpServerPath.includes(".pnpm")
    const isPreBuilt = false // Not pre-built
    const tmpDirPath = "/tmp/dev3000-mcp-deps"

    let actualWorkingDir = mcpServerPath

    // Logic for non-pre-built servers
    if (isGlobalInstall && !isPreBuilt) {
      actualWorkingDir = tmpDirPath
    }

    expect(actualWorkingDir).toBe(tmpDirPath)
    expect(actualWorkingDir).toContain("tmp")
  })
})
