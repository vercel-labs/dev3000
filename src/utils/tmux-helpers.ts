/**
 * Helper functions for tmux split-screen mode with --with-agent flag.
 * Extracted for testability.
 */

export interface TmuxSessionConfig {
  sessionName: string
  d3kCommand: string
  agentCommand: string
  paneWidthPercent: number // percentage for agent pane (left side)
  d3kLogPath?: string
  agentLogPath?: string
}

/**
 * Safely quote a value as a single shell argument using POSIX single-quote escaping.
 */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/**
 * Wrap a command to show error and wait for user input on failure.
 * This prevents the pane from immediately closing on crash, letting users see the error.
 */
function wrapCommandWithErrorHandling(cmd: string, name: string, pauseOnAnyExit = false): string {
  // Use bash -c to run the command and capture its exit code.
  // Quote the script safely so user commands with spaces/quotes don't break tmux startup.
  const shouldPauseCondition = pauseOnAnyExit ? "true" : "[ $EXIT_CODE -ne 0 ]"
  const script = `${cmd}; EXIT_CODE=$?; if ${shouldPauseCondition}; then echo; if [ $EXIT_CODE -ne 0 ]; then echo ❌ ${name} exited with code $EXIT_CODE; else echo ℹ️ ${name} exited with code $EXIT_CODE; fi; echo Press Enter to close...; read; fi; exit $EXIT_CODE`
  return `bash -c ${shellQuote(script)}`
}

/**
 * Generate tmux commands for setting up split-screen mode.
 */
export function generateTmuxCommands(config: TmuxSessionConfig): string[] {
  const { sessionName, d3kCommand, agentCommand, paneWidthPercent, d3kLogPath, agentLogPath } = config

  // Wrap commands with error handling so users can see crash output
  const d3kWithErrorHandling = wrapCommandWithErrorHandling(d3kCommand, "d3k", false)
  // Always pause when the agent pane exits so users can see why split-screen closed.
  // This catches both failures and fast-exit cases (e.g. missing auth/session).
  const agentWithErrorHandling = wrapCommandWithErrorHandling(agentCommand, "agent", true)

  const commands = [
    // Create new session with d3k in the first pane (will be right side)
    `tmux new-session -d -s "${sessionName}" ${shellQuote(d3kWithErrorHandling)}`,

    // Increase scrollback buffer for more history
    `tmux set-option -t "${sessionName}" history-limit 10000`,

    // Hide the tmux status bar for a cleaner look
    `tmux set-option -t "${sessionName}" status off`,

    // Enable mouse support for scrolling, clicking to switch panes, and resizing
    `tmux set-option -t "${sessionName}" mouse on`,

    // Enable focus events (required for pane-focus-in hook to work)
    `tmux set-option -g focus-events on`,

    // When terminal is resized, maintain the pane width ratio
    `tmux set-hook -t "${sessionName}" client-resized "resize-pane -t :.0 -x ${paneWidthPercent}%"`,

    // Make inactive pane borders subtle gray, active pane border purple to show focus
    `tmux set-option -t "${sessionName}" pane-border-style "fg=#333333"`,
    `tmux set-option -t "${sessionName}" pane-active-border-style "fg=#A18CE5"`,

    // Split horizontally and run agent in the new pane (left side)
    // -b puts the new pane before (left of) the current one
    // -l sets the size of the NEW pane (agent)
    `tmux split-window -h -b -l ${paneWidthPercent}% -t "${sessionName}" ${shellQuote(agentWithErrorHandling)}`,

    // Mirror pane output to log files without breaking TTY semantics for interactive CLIs.
    // Pane 0 is agent (left), pane 1 is d3k (right) after split-window -b.
    ...(agentLogPath ? [`tmux pipe-pane -o -t "${sessionName}:0.0" "cat >> ${shellQuote(agentLogPath)}"`] : []),
    ...(d3kLogPath ? [`tmux pipe-pane -o -t "${sessionName}:0.1" "cat >> ${shellQuote(d3kLogPath)}"`] : []),

    // When focus changes (via mouse click or keyboard), resize focused pane to 75%
    // Note: pane-focus-in is a window-level hook, requires -w flag
    `tmux set-hook -w -t "${sessionName}" pane-focus-in 'resize-pane -x ${paneWidthPercent}%'`,

    // Bind Ctrl+B Left to focus agent pane (left/pane 0) AND resize it
    // Use single quotes to prevent shell from interpreting the semicolon
    `tmux bind-key -T prefix Left 'select-pane -t :.0 ; resize-pane -t :.0 -x ${paneWidthPercent}%'`,

    // Bind Ctrl+B Right to focus d3k pane (right/pane 1) AND resize it
    `tmux bind-key -T prefix Right 'select-pane -t :.1 ; resize-pane -t :.1 -x ${paneWidthPercent}%'`,

    // When any pane exits, kill the entire session (so Ctrl-C in either pane exits both).
    // Important: install this after split/bind setup to avoid a race if the agent exits quickly.
    `tmux set-hook -t "${sessionName}" pane-exited "kill-session -t ${sessionName}"`,

    // Focus on the agent pane (left side, pane 0 after split with -b)
    `tmux select-pane -t "${sessionName}:0.0"`
  ]

  return commands
}

/**
 * Generate a unique session name for tmux.
 */
export function generateSessionName(): string {
  return `d3k-${Date.now()}`
}

/**
 * Check if tmux is installed by looking for the binary.
 * Uses file existence checks instead of execSync to avoid SIGINT interruption issues.
 */
export async function isTmuxInstalled(): Promise<boolean> {
  const { existsSync } = await import("fs")

  // Check common tmux binary paths (avoids execSync which can be interrupted by SIGINT)
  const commonPaths = [
    "/opt/homebrew/bin/tmux", // macOS Homebrew (Apple Silicon)
    "/usr/local/bin/tmux", // macOS Homebrew (Intel) or manual install
    "/usr/bin/tmux", // Linux (apt, dnf, etc.)
    "/bin/tmux" // Some Linux distros
  ]

  for (const path of commonPaths) {
    if (existsSync(path)) {
      return true
    }
  }

  // Fallback to which command if not found in common paths
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
  paneWidthPercent: 75 // Agent gets 75% of width
}
