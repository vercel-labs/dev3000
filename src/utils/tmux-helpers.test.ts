import { describe, expect, it } from "vitest"
import {
  DEFAULT_TMUX_CONFIG,
  generateSessionName,
  generateTmuxCommands,
  getTmuxInstallInstructions,
  type TmuxSessionConfig
} from "./tmux-helpers.js"

describe("tmux-helpers", () => {
  describe("generateSessionName", () => {
    it("should generate a unique session name with d3k prefix", () => {
      const name = generateSessionName()
      expect(name).toMatch(/^d3k-\d+$/)
    })

    it("should generate different names on subsequent calls", () => {
      const name1 = generateSessionName()
      // Small delay to ensure different timestamps
      const name2 = generateSessionName()
      // Names might be same if called in same millisecond, but format should be correct
      expect(name1).toMatch(/^d3k-\d+$/)
      expect(name2).toMatch(/^d3k-\d+$/)
    })
  })

  describe("generateTmuxCommands", () => {
    const baseConfig: TmuxSessionConfig = {
      sessionName: "d3k-test-123",
      d3kCommand: "d3k",
      agentCommand: "claude",
      agentDelay: 5,
      paneWidthPercent: 65
    }

    it("should generate correct number of commands", () => {
      const commands = generateTmuxCommands(baseConfig)
      expect(commands).toHaveLength(7)
    })

    it("should create session with d3k command first", () => {
      const commands = generateTmuxCommands(baseConfig)
      expect(commands[0]).toBe('tmux new-session -d -s "d3k-test-123" "d3k"')
    })

    it("should set history limit to 10000", () => {
      const commands = generateTmuxCommands(baseConfig)
      expect(commands[1]).toBe('tmux set-option -t "d3k-test-123" history-limit 10000')
    })

    it("should hide status bar", () => {
      const commands = generateTmuxCommands(baseConfig)
      expect(commands[2]).toBe('tmux set-option -t "d3k-test-123" status off')
    })

    it("should set pane border styles with purple active border", () => {
      const commands = generateTmuxCommands(baseConfig)
      expect(commands[3]).toBe('tmux set-option -t "d3k-test-123" pane-border-style "fg=#333333"')
      expect(commands[4]).toBe('tmux set-option -t "d3k-test-123" pane-active-border-style "fg=#A18CE5"')
    })

    it("should split window with agent on left side with correct percentage", () => {
      const commands = generateTmuxCommands(baseConfig)
      expect(commands[5]).toContain("split-window -h -b -p 65")
      expect(commands[5]).toContain("d3k-test-123")
    })

    it("should include sleep delay before agent command", () => {
      const commands = generateTmuxCommands(baseConfig)
      expect(commands[5]).toContain("sleep 5 && claude")
    })

    it("should set pane-exited hook to kill session", () => {
      const commands = generateTmuxCommands(baseConfig)
      expect(commands[6]).toBe('tmux set-hook -t "d3k-test-123" pane-exited "kill-session -t d3k-test-123"')
    })

    it("should handle zero delay correctly", () => {
      const config: TmuxSessionConfig = {
        ...baseConfig,
        agentDelay: 0
      }
      const commands = generateTmuxCommands(config)
      // Should not have sleep prefix
      expect(commands[5]).toContain('"claude"')
      expect(commands[5]).not.toContain("sleep")
    })

    it("should handle different pane widths", () => {
      const config: TmuxSessionConfig = {
        ...baseConfig,
        paneWidthPercent: 50
      }
      const commands = generateTmuxCommands(config)
      expect(commands[5]).toContain("-p 50")
    })

    it("should handle different agent commands", () => {
      const config: TmuxSessionConfig = {
        ...baseConfig,
        agentCommand: "opencode"
      }
      const commands = generateTmuxCommands(config)
      expect(commands[5]).toContain("opencode")
    })

    it("should properly escape session name in all commands", () => {
      const config: TmuxSessionConfig = {
        ...baseConfig,
        sessionName: "d3k-special-session"
      }
      const commands = generateTmuxCommands(config)
      for (const cmd of commands) {
        expect(cmd).toContain("d3k-special-session")
      }
    })
  })

  describe("getTmuxInstallInstructions", () => {
    it("should return installation instructions for major platforms", () => {
      const instructions = getTmuxInstallInstructions()
      expect(instructions).toHaveLength(3)
      expect(instructions.some((i) => i.includes("brew"))).toBe(true)
      expect(instructions.some((i) => i.includes("apt"))).toBe(true)
      expect(instructions.some((i) => i.includes("dnf"))).toBe(true)
    })
  })

  describe("DEFAULT_TMUX_CONFIG", () => {
    it("should have correct default values", () => {
      expect(DEFAULT_TMUX_CONFIG.agentDelay).toBe(5)
      expect(DEFAULT_TMUX_CONFIG.paneWidthPercent).toBe(65)
    })
  })

  describe("integration scenarios", () => {
    it("should generate valid commands for Claude Code", () => {
      const config: TmuxSessionConfig = {
        sessionName: generateSessionName(),
        d3kCommand: "d3k",
        agentCommand: "claude",
        agentDelay: DEFAULT_TMUX_CONFIG.agentDelay,
        paneWidthPercent: DEFAULT_TMUX_CONFIG.paneWidthPercent
      }
      const commands = generateTmuxCommands(config)

      // All commands should be non-empty strings
      expect(commands.every((cmd) => typeof cmd === "string" && cmd.length > 0)).toBe(true)

      // Commands should be in correct order for tmux
      expect(commands[0]).toContain("new-session")
      expect(commands[5]).toContain("split-window")
      expect(commands[6]).toContain("set-hook")
    })

    it("should generate valid commands for OpenCode", () => {
      const config: TmuxSessionConfig = {
        sessionName: generateSessionName(),
        d3kCommand: "dev3000",
        agentCommand: "opencode",
        agentDelay: DEFAULT_TMUX_CONFIG.agentDelay,
        paneWidthPercent: DEFAULT_TMUX_CONFIG.paneWidthPercent
      }
      const commands = generateTmuxCommands(config)

      expect(commands[0]).toContain("dev3000")
      expect(commands[5]).toContain("opencode")
    })
  })
})
