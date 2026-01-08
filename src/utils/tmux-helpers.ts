/**
 * Helper functions for tmux split-screen mode with --with-agent flag.
 * Extracted for testability.
 */

export interface TmuxSessionConfig {
  sessionName: string
  d3kCommand: string
  agentCommand: string
  agentDelay: number // seconds to wait before starting agent
  paneWidthPercent: number // percentage for agent pane (left side)
}

/**
 * Wrap a command to show error and wait for user input on failure.
 * This prevents the pane from immediately closing on crash, letting users see the error.
 */
function wrapCommandWithErrorHandling(cmd: string, name: string): string {
  // Use bash -c to run the command and capture its exit code
  // If it fails, show the error and wait for Enter before exiting
  // Note: Use escaped quotes for the inner strings since this gets embedded in tmux commands
  return `bash -c '${cmd}; EXIT_CODE=\\$?; if [ \\$EXIT_CODE -ne 0 ]; then echo; echo ❌ ${name} exited with code \\$EXIT_CODE; echo Press Enter to close...; read; fi; exit \\$EXIT_CODE'`
}

/**
 * Generate tmux commands for setting up split-screen mode.
 */
export function generateTmuxCommands(config: TmuxSessionConfig): string[] {
  const { sessionName, d3kCommand, agentCommand, agentDelay, paneWidthPercent } = config

  // Wrap commands with error handling so users can see crash output
  const d3kWithErrorHandling = wrapCommandWithErrorHandling(d3kCommand, "d3k")
  // Wait for MCP server to start before launching agent
  // Using simple sleep since quote escaping in nested bash -c is fragile
  const agentWithDelay = agentDelay > 0 ? `sleep ${agentDelay} && ${agentCommand}` : agentCommand
  const agentWithErrorHandling = wrapCommandWithErrorHandling(agentWithDelay, "agent")

  return [
    // Create new session with d3k in the first pane (will be right side)
    `tmux new-session -d -s "${sessionName}" "${d3kWithErrorHandling}"`,

    // Increase scrollback buffer for more history
    `tmux set-option -t "${sessionName}" history-limit 10000`,

    // Hide the tmux status bar for a cleaner look
    `tmux set-option -t "${sessionName}" status off`,

    // Enable mouse support for scrolling, clicking to switch panes, and resizing
    `tmux set-option -t "${sessionName}" mouse on`,

    // Enable focus events (required for pane-focus-in hook to work)
    `tmux set-option -g focus-events on`,

    // When any pane exits, kill the entire session (so Ctrl-C in either pane exits both)
    `tmux set-hook -t "${sessionName}" pane-exited "kill-session -t ${sessionName}"`,

    // When terminal is resized, maintain the pane width ratio
    `tmux set-hook -t "${sessionName}" client-resized "resize-pane -t :.0 -x ${paneWidthPercent}%"`,

    // Make inactive pane borders subtle gray, active pane border purple to show focus
    `tmux set-option -t "${sessionName}" pane-border-style "fg=#333333"`,
    `tmux set-option -t "${sessionName}" pane-active-border-style "fg=#A18CE5"`,

    // Split horizontally and run agent in the new pane (left side)
    // -b puts the new pane before (left of) the current one
    // -l sets the size of the NEW pane (agent)
    `tmux split-window -h -b -l ${paneWidthPercent}% -t "${sessionName}" "${agentWithErrorHandling}"`,

    // When focus changes (via mouse click or keyboard), resize focused pane to 75%
    // Note: pane-focus-in is a window-level hook, requires -w flag
    `tmux set-hook -w -t "${sessionName}" pane-focus-in 'resize-pane -x ${paneWidthPercent}%'`,

    // Bind Ctrl+B Left to focus agent pane (left/pane 0) AND resize it
    // Use single quotes to prevent shell from interpreting the semicolon
    `tmux bind-key -T prefix Left 'select-pane -t :.0 ; resize-pane -t :.0 -x ${paneWidthPercent}%'`,

    // Bind Ctrl+B Right to focus d3k pane (right/pane 1) AND resize it
    `tmux bind-key -T prefix Right 'select-pane -t :.1 ; resize-pane -t :.1 -x ${paneWidthPercent}%'`,

    // Focus on the agent pane (left side, pane 0 after split with -b)
    `tmux select-pane -t "${sessionName}:0.0"`
  ]
}

/**
 * Generate a unique session name for tmux.
 */
export function generateSessionName(): string {
  return `d3k-${Date.now()}`
}

/**
 * Check if tmux is installed by looking for the binary.
 */
export async function isTmuxInstalled(): Promise<boolean> {
  const { execSync } = await import("child_process")
  try {
    execSync("which tmux", { stdio: "ignore" })
    return true
  } catch {
    return false
  }
}

/**
 * Get installation instructions for tmux based on platform.
 */
export function getTmuxInstallInstructions(): string[] {
  return ["macOS:  brew install tmux", "Ubuntu: sudo apt install tmux", "Fedora: sudo dnf install tmux"]
}

/**
 * Default configuration for tmux split-screen.
 */
export const DEFAULT_TMUX_CONFIG = {
  agentDelay: 2, // seconds to wait for MCP to start
  paneWidthPercent: 75 // Agent gets 75% of width
}
