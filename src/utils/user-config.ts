import { existsSync, readFileSync } from "fs"
import { homedir } from "os"
import { join } from "path"

export interface UserConfig {
  disableMcpConfigs?: string
}

export function getUserConfigPath(): string {
  const configHome = process.env.XDG_CONFIG_HOME || join(homedir(), ".config")
  return join(configHome, "dev3000", "config.json")
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

    return disableList ? { disableMcpConfigs: disableList } : {}
  } catch {
    return {}
  }
}
