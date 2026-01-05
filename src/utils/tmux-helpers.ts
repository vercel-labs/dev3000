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
 * Generate tmux commands for setting up split-screen mode.
 */
export function generateTmuxCommands(config: TmuxSessionConfig): string[] {
  const { sessionName, d3kCommand, agentCommand, agentDelay, paneWidthPercent } = config

  const agentWithDelay = agentDelay > 0 ? `sleep ${agentDelay} && ${agentCommand}` : agentCommand

  return [
    // Create new session with d3k in the first pane (will be right side)
    `tmux new-session -d -s "${sessionName}" "${d3kCommand}"`,

    // Increase scrollback buffer for more history
    `tmux set-option -t "${sessionName}" history-limit 10000`,

    // Hide the tmux status bar for a cleaner look
    `tmux set-option -t "${sessionName}" status off`,

    // Split horizontally and run agent in the new pane (left side)
    // -b puts the new pane before (left of) the current one
    `tmux split-window -h -b -p ${paneWidthPercent} -t "${sessionName}" "${agentWithDelay}"`,

    // Kill entire session when any pane exits (crash or normal exit)
    `tmux set-hook -t "${sessionName}" pane-exited "kill-session -t ${sessionName}"`
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
  agentDelay: 5, // 5 seconds for MCP to start
  paneWidthPercent: 65 // Agent gets 65% of width
}
