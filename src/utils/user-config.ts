import { existsSync, readFileSync, writeFileSync } from "fs"
import { homedir } from "os"
import { join } from "path"

export interface AgentConfig {
  name: string
  command: string
}

export interface UserConfig {
  disableMcpConfigs?: string
  defaultAgent?: AgentConfig
  browser?: string
}

export function getUserConfigPath(): string {
  return join(homedir(), ".d3k.json")
}

function normalizeDisableList(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim().length > 0) {
    return value
  }

  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    return value.join(" ")
  }

  return undefined
}

export function loadUserConfig(): UserConfig {
  const configPath = getUserConfigPath()

  if (!existsSync(configPath)) {
    return {}
  }

  try {
    const content = readFileSync(configPath, "utf-8")
    const parsed = JSON.parse(content) as Record<string, unknown>
    const disableList = normalizeDisableList(parsed.disableMcpConfigs)

    const config: UserConfig = {}
    if (disableList) {
      config.disableMcpConfigs = disableList
    }
    if (parsed.defaultAgent && typeof parsed.defaultAgent === "object") {
      const agent = parsed.defaultAgent as Record<string, unknown>
      if (typeof agent.name === "string" && typeof agent.command === "string") {
        config.defaultAgent = { name: agent.name, command: agent.command }
      }
    }
    if (typeof parsed.browser === "string" && parsed.browser.trim().length > 0) {
      config.browser = parsed.browser.trim()
    }
    return config
  } catch {
    return {}
  }
}

export function saveUserConfig(updates: Partial<UserConfig>): void {
  const configPath = getUserConfigPath()

  // Load existing config and merge
  const existing = loadUserConfig()
  const merged = { ...existing, ...updates }

  // Remove defaultAgent if set to undefined (user chose "No agent")
  if (updates.defaultAgent === undefined && "defaultAgent" in updates) {
    delete merged.defaultAgent
  }

  // Remove browser if set to undefined
  if (updates.browser === undefined && "browser" in updates) {
    delete merged.browser
  }

  writeFileSync(configPath, JSON.stringify(merged, null, 2))
}
