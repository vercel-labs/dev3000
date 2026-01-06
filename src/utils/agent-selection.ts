import { execSync } from "child_process"

export interface AgentSubOption {
  label: string
  command: string
}

export interface AgentOption {
  name: string
  binary: string
  displayName: string
  available: boolean
  command?: string // Custom command to run (defaults to binary if not specified)
  subOptions?: AgentSubOption[]
}

export interface KnownAgent {
  name: string
  binary: string
  displayName: string
  command?: string // Custom command to run (defaults to binary if not specified)
  subOptions?: AgentSubOption[]
}

export const KNOWN_AGENTS: KnownAgent[] = [
  { name: "claude", binary: "claude", displayName: "claude" },
  {
    name: "claude-yolo",
    binary: "claude",
    displayName: "claude (let it rip)",
    command: "claude --dangerously-skip-permissions"
  },
  { name: "codex", binary: "codex", displayName: "codex" },
  { name: "opencode", binary: "opencode", displayName: "opencode" },
  { name: "gemini", binary: "gemini", displayName: "gemini" },
  { name: "cline", binary: "cline", displayName: "cline" },
  { name: "cursor-agent", binary: "cursor-agent", displayName: "cursor-agent" }
]

export function checkBinaryExists(binary: string): boolean {
  try {
    execSync(`which ${binary}`, { stdio: "ignore" })
    return true
  } catch {
    return false
  }
}

export function getAvailableAgents(): AgentOption[] {
  return KNOWN_AGENTS.map((agent) => ({
    ...agent,
    available: checkBinaryExists(agent.binary)
  }))
}

export function getAgentByName(name: string): KnownAgent | undefined {
  return KNOWN_AGENTS.find((agent) => agent.name === name)
}
