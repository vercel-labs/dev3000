export type McpConfigTarget = "claude" | "cursor" | "opencode"

const DEV3000_MCP_SERVER_NAME = "dev3000"

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function getConfigKey(target: McpConfigTarget): "mcp" | "mcpServers" {
  return target === "opencode" ? "mcp" : "mcpServers"
}

function isManagedDev3000Server(value: Record<string, unknown>): boolean {
  return typeof value.url === "string" && /^http:\/\/localhost:\d+\/mcp$/.test(value.url)
}

function getServerConfig(target: McpConfigTarget, mcpPort: string, existing?: Record<string, unknown>) {
  const url = `http://localhost:${mcpPort}/mcp`
  const current = existing ?? {}

  if (target === "opencode") {
    return {
      ...current,
      type: "remote",
      url,
      enabled: typeof existing?.enabled === "boolean" ? existing.enabled : true
    }
  }

  return {
    ...current,
    type: "http",
    url
  }
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

export function upsertMcpServerConfig(
  config: Record<string, unknown>,
  target: McpConfigTarget,
  mcpPort: string
): { config: Record<string, unknown>; changed: boolean } {
  const configKey = getConfigKey(target)
  const existingServers = config[configKey]

  if (existingServers !== undefined && !isRecord(existingServers)) {
    return { config, changed: false }
  }

  const servers: Record<string, unknown> = existingServers ? { ...existingServers } : {}
  const existingServer = servers[DEV3000_MCP_SERVER_NAME]
  const existingServerRecord = isRecord(existingServer) ? existingServer : undefined

  if (existingServer !== undefined && !existingServerRecord) {
    return { config, changed: false }
  }

  if (existingServerRecord && !isManagedDev3000Server(existingServerRecord)) {
    return { config, changed: false }
  }

  const nextServer = getServerConfig(target, mcpPort, existingServerRecord)

  if (existingServerRecord && JSON.stringify(existingServerRecord) === JSON.stringify(nextServer)) {
    return { config, changed: false }
  }

  servers[DEV3000_MCP_SERVER_NAME] = nextServer

  return {
    config: {
      ...config,
      [configKey]: servers
    },
    changed: true
  }
}
