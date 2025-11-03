/**
 * Detects if the current process is being invoked by an AI agent/assistant
 *
 * AI agents typically cannot interact with TUI (Terminal User Interface) properly,
 * so we auto-disable TUI when an agent is detected.
 */

export interface AgentDetectionResult {
  isAgent: boolean
  agentName?: string
  reason?: string
}

/**
 * Check if the process is being run by an AI agent
 */
export function detectAIAgent(): AgentDetectionResult {
  // Check for Claude Code (Anthropic's CLI agent)
  if (process.env.CLAUDECODE === "1" || process.env.CLAUDE_CODE_ENTRYPOINT) {
    return {
      isAgent: true,
      agentName: "Claude Code",
      reason: "CLAUDECODE environment variable detected"
    }
  }

  // Check for Cline (VSCode extension)
  if (process.env.CLINE === "1" || process.env.CLINE_MODE) {
    return {
      isAgent: true,
      agentName: "Cline",
      reason: "CLINE environment variable detected"
    }
  }

  // Check for GitHub Copilot CLI
  if (process.env.GITHUB_COPILOT === "1" || process.env.COPILOT_MODE) {
    return {
      isAgent: true,
      agentName: "GitHub Copilot",
      reason: "COPILOT environment variable detected"
    }
  }

  // Check for Cursor AI
  if (process.env.CURSOR_AI === "1" || process.env.CURSOR_MODE) {
    return {
      isAgent: true,
      agentName: "Cursor AI",
      reason: "CURSOR environment variable detected"
    }
  }

  // Check for Windsurf (Codeium's IDE)
  if (process.env.WINDSURF === "1" || process.env.WINDSURF_MODE) {
    return {
      isAgent: true,
      agentName: "Windsurf",
      reason: "WINDSURF environment variable detected"
    }
  }

  // Check for Aider
  if (process.env.AIDER === "1" || process.env.AIDER_MODE) {
    return {
      isAgent: true,
      agentName: "Aider",
      reason: "AIDER environment variable detected"
    }
  }

  // Check if running in a non-interactive shell (common for agents)
  // But only if stdin is not a TTY (to avoid false positives)
  if (!process.stdin.isTTY && process.env.TERM === "dumb") {
    return {
      isAgent: true,
      agentName: "Unknown AI Agent",
      reason: "Non-interactive terminal detected (TERM=dumb, no TTY)"
    }
  }

  return { isAgent: false }
}
