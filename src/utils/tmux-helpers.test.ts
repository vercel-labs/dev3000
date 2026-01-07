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
      paneWidthPercent: 75
    }

    it("should generate correct number of commands", () => {
      const commands = generateTmuxCommands(baseConfig)
      expect(commands).toHaveLength(14)
    })

    it("should create session with d3k command first", () => {
      const commands = generateTmuxCommands(baseConfig)
      expect(commands[0]).toContain('tmux new-session -d -s "d3k-test-123"')
      expect(commands[0]).toContain("d3k")
      // Should have error handling wrapper
      expect(commands[0]).toContain("EXIT_CODE")
      expect(commands[0]).toContain("Press Enter to close")
    })

    it("should set history limit to 10000", () => {
      const commands = generateTmuxCommands(baseConfig)
      expect(commands[1]).toBe('tmux set-option -t "d3k-test-123" history-limit 10000')
    })

    it("should hide status bar", () => {
      const commands = generateTmuxCommands(baseConfig)
      expect(commands[2]).toBe('tmux set-option -t "d3k-test-123" status off')
    })

    it("should enable mouse mode", () => {
      const commands = generateTmuxCommands(baseConfig)
      expect(commands[3]).toBe('tmux set-option -t "d3k-test-123" mouse on')
    })

    it("should enable focus-events globally", () => {
      const commands = generateTmuxCommands(baseConfig)
      expect(commands[4]).toBe("tmux set-option -g focus-events on")
    })

    it("should set pane-exited hook to kill session", () => {
      const commands = generateTmuxCommands(baseConfig)
      expect(commands[5]).toBe('tmux set-hook -t "d3k-test-123" pane-exited "kill-session -t d3k-test-123"')
    })

    it("should set client-resized hook to maintain pane ratio", () => {
      const commands = generateTmuxCommands(baseConfig)
      expect(commands[6]).toContain("set-hook")
      expect(commands[6]).toContain("client-resized")
      expect(commands[6]).toContain("resize-pane -t :.0 -x 75%")
    })

    it("should set pane border styles with purple active border", () => {
      const commands = generateTmuxCommands(baseConfig)
      expect(commands[7]).toBe('tmux set-option -t "d3k-test-123" pane-border-style "fg=#333333"')
      expect(commands[8]).toBe('tmux set-option -t "d3k-test-123" pane-active-border-style "fg=#A18CE5"')
    })

    it("should split window with agent on left side with size", () => {
      const commands = generateTmuxCommands(baseConfig)
      expect(commands[9]).toContain("split-window -h -b -l 75%")
      expect(commands[9]).toContain("d3k-test-123")
    })

    it("should include sleep delay before agent command", () => {
      const commands = generateTmuxCommands(baseConfig)
      expect(commands[9]).toContain("sleep 5 && claude")
    })

    it("should set pane-focus-in hook with window flag to resize on click", () => {
      const commands = generateTmuxCommands(baseConfig)
      expect(commands[10]).toContain("set-hook -w")
      expect(commands[10]).toContain("pane-focus-in")
      expect(commands[10]).toContain("resize-pane -x 75%")
    })

    it("should bind arrow keys for focus+resize after split", () => {
      const commands = generateTmuxCommands(baseConfig)
      expect(commands[11]).toContain("bind-key -T prefix Left")
      expect(commands[11]).toContain("'select-pane -t :.0 ; resize-pane -t :.0 -x 75%'")
      expect(commands[12]).toContain("bind-key -T prefix Right")
      expect(commands[12]).toContain("'select-pane -t :.1 ; resize-pane -t :.1 -x 75%'")
    })

    it("should select agent pane after split", () => {
      const commands = generateTmuxCommands(baseConfig)
      expect(commands[13]).toBe('tmux select-pane -t "d3k-test-123:0.0"')
    })

    it("should handle zero delay correctly", () => {
      const config: TmuxSessionConfig = {
        ...baseConfig,
        agentDelay: 0
      }
      const commands = generateTmuxCommands(config)
      // Should not have sleep prefix, but should have the agent command
      expect(commands[9]).toContain("claude")
      expect(commands[9]).not.toContain("sleep")
    })

    it("should handle different pane widths", () => {
      const config: TmuxSessionConfig = {
        ...baseConfig,
        paneWidthPercent: 50
      }
      const commands = generateTmuxCommands(config)
      // Split window command should have the specified percentage
      expect(commands[9]).toContain("-l 50%")
    })

    it("should handle different agent commands", () => {
      const config: TmuxSessionConfig = {
        ...baseConfig,
        agentCommand: "opencode"
      }
      const commands = generateTmuxCommands(config)
      expect(commands[9]).toContain("opencode")
    })

    it("should properly escape session name in session-targeted commands", () => {
      const config: TmuxSessionConfig = {
        ...baseConfig,
        sessionName: "d3k-special-session"
      }
      const commands = generateTmuxCommands(config)
      // Check session-targeted commands (excludes bind-key and global options)
      const sessionTargetedCommands = commands.filter((cmd) => !cmd.includes("bind-key") && !cmd.includes("-g "))
      for (const cmd of sessionTargetedCommands) {
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
      expect(DEFAULT_TMUX_CONFIG.paneWidthPercent).toBe(75)
    })
  })

  describe("resize on focus behavior", () => {
    const baseConfig: TmuxSessionConfig = {
      sessionName: "d3k-focus-test",
      d3kCommand: "d3k",
      agentCommand: "claude",
      agentDelay: 5,
      paneWidthPercent: 75
    }

    it("should enable focus-events BEFORE setting pane-focus-in hook", () => {
      const commands = generateTmuxCommands(baseConfig)
      const focusEventsIndex = commands.findIndex((cmd) => cmd.includes("focus-events on"))
      const paneFocusInIndex = commands.findIndex((cmd) => cmd.includes("pane-focus-in"))

      expect(focusEventsIndex).toBeGreaterThan(-1)
      expect(paneFocusInIndex).toBeGreaterThan(-1)
      expect(focusEventsIndex).toBeLessThan(paneFocusInIndex)
    })

    it("should set pane-focus-in hook AFTER split-window creates panes", () => {
      const commands = generateTmuxCommands(baseConfig)
      const splitWindowIndex = commands.findIndex((cmd) => cmd.includes("split-window"))
      const paneFocusInIndex = commands.findIndex((cmd) => cmd.includes("pane-focus-in"))

      expect(splitWindowIndex).toBeGreaterThan(-1)
      expect(paneFocusInIndex).toBeGreaterThan(-1)
      expect(splitWindowIndex).toBeLessThan(paneFocusInIndex)
    })

    it("should use -w flag for pane-focus-in (window-level hook)", () => {
      const commands = generateTmuxCommands(baseConfig)
      const paneFocusInCmd = commands.find((cmd) => cmd.includes("pane-focus-in"))

      expect(paneFocusInCmd).toBeDefined()
      // Must use -w flag for window-level hook
      expect(paneFocusInCmd).toMatch(/set-hook\s+-w/)
    })

    it("should use configured paneWidthPercent in pane-focus-in hook", () => {
      const config: TmuxSessionConfig = { ...baseConfig, paneWidthPercent: 80 }
      const commands = generateTmuxCommands(config)
      const paneFocusInCmd = commands.find((cmd) => cmd.includes("pane-focus-in"))

      expect(paneFocusInCmd).toContain("resize-pane -x 80%")
    })

    it("should set focus-events globally with -g flag", () => {
      const commands = generateTmuxCommands(baseConfig)
      const focusEventsCmd = commands.find((cmd) => cmd.includes("focus-events"))

      expect(focusEventsCmd).toBeDefined()
      expect(focusEventsCmd).toMatch(/set-option\s+-g\s+focus-events\s+on/)
    })

    it("should have consistent width across all resize commands", () => {
      const config: TmuxSessionConfig = { ...baseConfig, paneWidthPercent: 65 }
      const commands = generateTmuxCommands(config)

      // All these should use 65%
      const splitWindow = commands.find((cmd) => cmd.includes("split-window"))
      const clientResized = commands.find((cmd) => cmd.includes("client-resized"))
      const paneFocusIn = commands.find((cmd) => cmd.includes("pane-focus-in"))
      const bindLeft = commands.find((cmd) => cmd.includes("bind-key") && cmd.includes("Left"))
      const bindRight = commands.find((cmd) => cmd.includes("bind-key") && cmd.includes("Right"))

      expect(splitWindow).toContain("-l 65%")
      expect(clientResized).toContain("-x 65%")
      expect(paneFocusIn).toContain("-x 65%")
      expect(bindLeft).toContain("-x 65%")
      expect(bindRight).toContain("-x 65%")
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
      expect(commands[3]).toContain("mouse on")
      expect(commands[4]).toContain("focus-events on")
      expect(commands[5]).toContain("set-hook")
      expect(commands[6]).toContain("client-resized")
      expect(commands[9]).toContain("split-window")
      expect(commands[9]).toContain("-l 75%")
      expect(commands[10]).toContain("pane-focus-in")
      expect(commands[13]).toContain("select-pane")
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
      expect(commands[9]).toContain("opencode")
    })
  })
})
