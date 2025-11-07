export type McpConfigTarget = "claude" | "cursor" | "opencode"

export const MCP_CONFIG_TARGETS: readonly McpConfigTarget[] = ["claude", "cursor", "opencode"] as const

export const MCP_CONFIG_DISPLAY_NAMES: Record<McpConfigTarget, string> = {
  claude: ".mcp.json",
  cursor: ".cursor/mcp.json",
  opencode: "opencode.json"
}

const MCP_CONFIG_ALIASES: Record<string, McpConfigTarget> = {
  claude: "claude",
  ".mcp": "claude",
  ".mcp.json": "claude",
  mcp: "claude",
  cursor: "cursor",
  ".cursor": "cursor",
  "cursor/mcp": "cursor",
  "cursor/mcp.json": "cursor",
  opencode: "opencode",
  "opencode.json": "opencode"
}

function normalizeToken(value: string): string {
  return value.trim().toLowerCase()
}

export function parseDisabledMcpConfigs(input?: string | null): McpConfigTarget[] {
  if (!input) {
    return []
  }

  const tokens = input
    .split(/[,\s]+/)
    .map(normalizeToken)
    .filter(Boolean)

  if (tokens.length === 0) {
    return []
  }

  if (tokens.includes("all")) {
    return [...MCP_CONFIG_TARGETS]
  }

  const disabled = new Set<McpConfigTarget>()
  for (const token of tokens) {
    if (token === "none") {
      continue
    }

    const target = MCP_CONFIG_ALIASES[token]
    if (target) {
      disabled.add(target)
    }
  }

  return Array.from(disabled)
}

export function formatMcpConfigTargets(targets: McpConfigTarget[]): string {
  if (targets.length === 0) {
    return ""
  }

  return targets.map((target) => MCP_CONFIG_DISPLAY_NAMES[target]).join(", ")
}
