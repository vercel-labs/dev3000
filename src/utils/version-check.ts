import { execSync, spawnSync } from "child_process"
import { existsSync, readFileSync, writeFileSync } from "fs"
import { homedir } from "os"
import { dirname, join } from "path"
import { fileURLToPath } from "url"

// Declare the compile-time injected version (set by bun build --define)
declare const __D3K_VERSION__: string | undefined

interface VersionInfo {
  currentVersion: string
  latestVersion: string | null
  updateAvailable: boolean
  packageManager: "npm" | "pnpm" | "yarn" | null
}

interface CachedVersionInfo {
  latestVersion: string
  timestamp: number
}

const CACHE_TTL_MS = 1000 * 60 * 60 // 1 hour cache

/**
 * Get the cache file path for version info
 */
function getCacheFilePath(): string {
  return join(homedir(), ".d3k", "version-cache.json")
}

/**
 * Read cached version info if it exists and is still valid
 */
function readCachedVersion(): string | null {
  try {
    const cachePath = getCacheFilePath()
    if (!existsSync(cachePath)) {
      return null
    }
    const cached: CachedVersionInfo = JSON.parse(readFileSync(cachePath, "utf8"))
    if (Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return cached.latestVersion
    }
  } catch {
    // Cache read failed, ignore
  }
  return null
}

/**
 * Write version info to cache
 */
function writeCachedVersion(version: string): void {
  try {
    const cachePath = getCacheFilePath()
    const cacheDir = dirname(cachePath)
    if (!existsSync(cacheDir)) {
      execSync(`mkdir -p "${cacheDir}"`, { stdio: "ignore" })
    }
    const cached: CachedVersionInfo = {
      latestVersion: version,
      timestamp: Date.now()
    }
    writeFileSync(cachePath, JSON.stringify(cached))
  } catch {
    // Cache write failed, ignore
  }
}

/**
 * Get the current installed version of dev3000
 */
export function getCurrentVersion(): string {
  // Check for compile-time injected version first (for standalone binaries)
  if (typeof __D3K_VERSION__ !== "undefined") {
    return __D3K_VERSION__
  }

  try {
    const currentFile = fileURLToPath(import.meta.url)
    const packageRoot = dirname(dirname(dirname(currentFile))) // Go up from dist/utils to package root
    const packageJsonPath = join(packageRoot, "package.json")
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"))
    return packageJson.version
  } catch {
    return "0.0.0"
  }
}

/**
 * Fetch the latest version from npm registry (non-blocking)
 */
export async function fetchLatestVersion(): Promise<string | null> {
  // Check cache first
  const cached = readCachedVersion()
  if (cached) {
    return cached
  }

  try {
    // Use npm view with a short timeout
    const result = execSync("npm view dev3000 version 2>/dev/null", {
      encoding: "utf8",
      timeout: 5000
    }).trim()

    if (result) {
      writeCachedVersion(result)
      return result
    }
  } catch {
    // npm view failed, try fetch as fallback
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 3000)

      const response = await fetch("https://registry.npmjs.org/dev3000/latest", {
        signal: controller.signal
      })
      clearTimeout(timeout)

      if (response.ok) {
        const data = await response.json()
        if (data.version) {
          writeCachedVersion(data.version)
          return data.version
        }
      }
    } catch {
      // Fetch also failed, return null
    }
  }

  return null
}

/**
 * Detect how dev3000 was installed globally
 */
export function detectPackageManager(): "npm" | "pnpm" | "yarn" | null {
  const currentFile = fileURLToPath(import.meta.url)
  const packageRoot = dirname(dirname(dirname(currentFile)))

  // Check path patterns for different package managers
  if (packageRoot.includes(".pnpm") || packageRoot.includes("pnpm")) {
    return "pnpm"
  }

  if (packageRoot.includes(".yarn") || packageRoot.includes("yarn")) {
    return "yarn"
  }

  // Check if npm global
  if (packageRoot.includes("npm") || packageRoot.includes("/lib/node_modules/") || packageRoot.includes("npm-global")) {
    return "npm"
  }

  // Try to detect by checking which package manager has dev3000 globally installed
  try {
    const pnpmResult = spawnSync("pnpm", ["list", "-g", "--depth=0", "dev3000"], {
      encoding: "utf8",
      timeout: 3000
    })
    if (pnpmResult.status === 0 && pnpmResult.stdout.includes("dev3000")) {
      return "pnpm"
    }
  } catch {
    // pnpm not available or failed
  }

  try {
    const npmResult = spawnSync("npm", ["list", "-g", "--depth=0", "dev3000"], {
      encoding: "utf8",
      timeout: 3000
    })
    if (npmResult.status === 0 && npmResult.stdout.includes("dev3000")) {
      return "npm"
    }
  } catch {
    // npm failed
  }

  try {
    const yarnResult = spawnSync("yarn", ["global", "list", "--depth=0"], {
      encoding: "utf8",
      timeout: 3000
    })
    if (yarnResult.status === 0 && yarnResult.stdout.includes("dev3000")) {
      return "yarn"
    }
  } catch {
    // yarn not available or failed
  }

  // Default to npm if we can't detect
  return "npm"
}

/**
 * Get the upgrade command for the detected package manager
 */
export function getUpgradeCommand(packageManager: "npm" | "pnpm" | "yarn" | null): string {
  switch (packageManager) {
    case "pnpm":
      return "pnpm install -g dev3000@latest"
    case "yarn":
      return "yarn global add dev3000@latest"
    default:
      return "npm install -g dev3000@latest"
  }
}

/**
 * Compare two semver versions
 * Returns true if version2 is greater than version1
 *
 * Pre-release versions (e.g., 0.0.125-canary) are considered older than
 * their corresponding stable versions (e.g., 0.0.125).
 */
export function isNewerVersion(current: string, latest: string): boolean {
  // Extract pre-release tags
  const currentPrerelease = current.includes("-") ? current.split("-")[1] : null
  const latestPrerelease = latest.includes("-") ? latest.split("-")[1] : null

  // Strip any pre-release tags for base version comparison
  const cleanCurrent = current.replace(/-.*$/, "")
  const cleanLatest = latest.replace(/-.*$/, "")

  const v1Parts = cleanCurrent.split(".").map(Number)
  const v2Parts = cleanLatest.split(".").map(Number)

  for (let i = 0; i < Math.max(v1Parts.length, v2Parts.length); i++) {
    const v1 = v1Parts[i] || 0
    const v2 = v2Parts[i] || 0

    if (v2 > v1) return true
    if (v2 < v1) return false
  }

  // Base versions are equal - check pre-release status
  // A stable version (no prerelease) is newer than a prerelease version
  // e.g., 0.0.125 > 0.0.125-canary
  if (currentPrerelease && !latestPrerelease) {
    return true // latest is stable, current is prerelease -> update available
  }

  return false
}

/**
 * Check for updates (async, non-blocking)
 */
export async function checkForUpdates(): Promise<VersionInfo> {
  const currentVersion = getCurrentVersion()
  const latestVersion = await fetchLatestVersion()
  const packageManager = detectPackageManager()

  // Don't auto-update if on a canary/prerelease version
  // Canary users should upgrade manually
  const isCanary = currentVersion.includes("-")
  const updateAvailable = !isCanary && latestVersion !== null && isNewerVersion(currentVersion, latestVersion)

  return {
    currentVersion,
    latestVersion,
    updateAvailable,
    packageManager
  }
}

/**
 * Perform the upgrade (blocking, with stdio output)
 */
export function performUpgrade(): { success: boolean; error?: string } {
  const packageManager = detectPackageManager()
  const command = getUpgradeCommand(packageManager)

  try {
    console.log(`Upgrading dev3000 using ${packageManager || "npm"}...`)
    console.log(`Running: ${command}\n`)

    execSync(command, {
      stdio: "inherit",
      timeout: 120000 // 2 minute timeout
    })

    return { success: true }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error during upgrade"
    }
  }
}

/**
 * Perform the upgrade asynchronously (non-blocking, for background updates)
 * Returns the new version on success, or null on failure
 */
export async function performUpgradeAsync(): Promise<{ success: boolean; newVersion?: string; error?: string }> {
  const packageManager = detectPackageManager()
  const command = getUpgradeCommand(packageManager)

  return new Promise((resolve) => {
    try {
      // Run upgrade silently in background
      execSync(command, {
        stdio: "ignore",
        timeout: 120000 // 2 minute timeout
      })

      // After upgrade, fetch the new version by checking what's installed
      // Clear the module cache and re-read package.json isn't reliable after global install
      // Instead, use npm/pnpm to query the installed version
      try {
        const versionCommand =
          packageManager === "pnpm"
            ? "pnpm list -g dev3000 --json"
            : packageManager === "yarn"
              ? "yarn global list --json"
              : "npm list -g dev3000 --json"

        const result = execSync(versionCommand, { encoding: "utf8", timeout: 5000 })
        const parsed = JSON.parse(result)

        // Extract version based on package manager format
        let newVersion: string | undefined
        if (packageManager === "pnpm") {
          // pnpm format: array of packages
          newVersion = parsed?.[0]?.dependencies?.dev3000?.version
        } else if (packageManager === "npm") {
          // npm format: { dependencies: { dev3000: { version: "x.x.x" } } }
          newVersion = parsed?.dependencies?.dev3000?.version
        }

        resolve({ success: true, newVersion })
      } catch {
        // Couldn't get version, but upgrade succeeded
        resolve({ success: true })
      }
    } catch (error) {
      resolve({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error during upgrade"
      })
    }
  })
}
