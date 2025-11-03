import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { detectAIAgent } from "./agent-detection"

describe("detectAIAgent", () => {
  const originalEnv = process.env
  const originalStdin = process.stdin

  beforeEach(() => {
    // Reset environment before each test - create clean copy without AI agent vars
    const cleanEnv = { ...originalEnv }
    delete cleanEnv.CLAUDECODE
    delete cleanEnv.CLAUDE_CODE_ENTRYPOINT
    delete cleanEnv.CLINE
    delete cleanEnv.CLINE_MODE
    delete cleanEnv.GITHUB_COPILOT
    delete cleanEnv.COPILOT_MODE
    delete cleanEnv.CURSOR_AI
    delete cleanEnv.CURSOR_MODE
    delete cleanEnv.WINDSURF
    delete cleanEnv.WINDSURF_MODE
    delete cleanEnv.AIDER
    delete cleanEnv.AIDER_MODE
    process.env = cleanEnv
    vi.clearAllMocks()
  })

  afterEach(() => {
    process.env = originalEnv
    Object.defineProperty(process, "stdin", { value: originalStdin })
  })

  it("should detect Claude Code via CLAUDECODE env var", () => {
    process.env.CLAUDECODE = "1"
    const result = detectAIAgent()
    expect(result.isAgent).toBe(true)
    expect(result.agentName).toBe("Claude Code")
  })

  it("should detect Claude Code via CLAUDE_CODE_ENTRYPOINT", () => {
    process.env.CLAUDE_CODE_ENTRYPOINT = "cli"
    const result = detectAIAgent()
    expect(result.isAgent).toBe(true)
    expect(result.agentName).toBe("Claude Code")
  })

  it("should detect Cline", () => {
    process.env.CLINE = "1"
    const result = detectAIAgent()
    expect(result.isAgent).toBe(true)
    expect(result.agentName).toBe("Cline")
  })

  it("should detect GitHub Copilot", () => {
    process.env.GITHUB_COPILOT = "1"
    const result = detectAIAgent()
    expect(result.isAgent).toBe(true)
    expect(result.agentName).toBe("GitHub Copilot")
  })

  it("should detect Cursor AI", () => {
    process.env.CURSOR_AI = "1"
    const result = detectAIAgent()
    expect(result.isAgent).toBe(true)
    expect(result.agentName).toBe("Cursor AI")
  })

  it("should detect Windsurf", () => {
    process.env.WINDSURF = "1"
    const result = detectAIAgent()
    expect(result.isAgent).toBe(true)
    expect(result.agentName).toBe("Windsurf")
  })

  it("should detect Aider", () => {
    process.env.AIDER = "1"
    const result = detectAIAgent()
    expect(result.isAgent).toBe(true)
    expect(result.agentName).toBe("Aider")
  })

  it("should detect non-interactive terminal (TERM=dumb, no TTY)", () => {
    process.env.TERM = "dumb"
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true })

    const result = detectAIAgent()
    expect(result.isAgent).toBe(true)
    expect(result.agentName).toBe("Unknown AI Agent")
  })

  it("should NOT detect agent in normal terminal", () => {
    delete process.env.CLAUDECODE
    delete process.env.CLINE
    process.env.TERM = "xterm-256color"
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true })

    const result = detectAIAgent()
    expect(result.isAgent).toBe(false)
  })

  it("should NOT detect agent with TERM=dumb but TTY available", () => {
    process.env.TERM = "dumb"
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true })

    const result = detectAIAgent()
    expect(result.isAgent).toBe(false)
  })
})
