export type SupportedPackageManager = "bun" | "pnpm" | "npm" | "yarn"
export const NO_DEV_SERVER_COMMAND = "none"

interface PackageJsonShape {
  packageManager?: string
  scripts?: Record<string, string>
}

export function normalizePackageManagerName(rawValue?: string | null): SupportedPackageManager {
  const normalized = rawValue?.trim().toLowerCase() ?? ""
  if (normalized.startsWith("bun")) return "bun"
  if (normalized.startsWith("pnpm")) return "pnpm"
  if (normalized.startsWith("yarn")) return "yarn"
  return "npm"
}

export function getPackageManagerScriptCommand(packageManager: SupportedPackageManager, scriptName: string): string {
  if (packageManager === "pnpm" || packageManager === "yarn") {
    return `${packageManager} ${scriptName}`
  }
  return `${packageManager} run ${scriptName}`
}

export function inferDevServerCommandFromPackageJson(
  packageJson: PackageJsonShape | null | undefined,
  fallbackPackageManager: SupportedPackageManager = "npm"
): string {
  const packageManager = normalizePackageManagerName(packageJson?.packageManager) || fallbackPackageManager
  const scripts = packageJson?.scripts ?? {}

  if (typeof scripts.dev === "string" && scripts.dev.trim().length > 0) {
    return getPackageManagerScriptCommand(packageManager, "dev")
  }

  if (typeof scripts.start === "string" && scripts.start.trim().length > 0) {
    return getPackageManagerScriptCommand(packageManager, "start")
  }

  return getPackageManagerScriptCommand(packageManager, "dev")
}
