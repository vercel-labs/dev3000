import { createHash } from "crypto"
import { existsSync, readFileSync } from "fs"
import { homedir } from "os"
import { basename, dirname, join } from "path"

/**
 * Generate a unique project name based on various sources
 * Priority order:
 * 1. package.json name (Node.js)
 * 2. pyproject.toml name (Python)
 * 3. Rails app name from config/application.rb
 * 4. Directory name + partial path hash for uniqueness
 *
 * @param cwd Current working directory
 * @returns Sanitized unique project name
 */
export function getProjectName(cwd: string = process.cwd()): string {
  let projectName: string | null = null

  // Try Node.js package.json
  const packageJsonPath = join(cwd, "package.json")
  if (existsSync(packageJsonPath)) {
    try {
      const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"))
      if (packageJson.name) {
        projectName = packageJson.name
      }
    } catch {
      // Ignore parse errors
    }
  }

  // Try Python pyproject.toml
  if (!projectName) {
    const pyprojectPath = join(cwd, "pyproject.toml")
    if (existsSync(pyprojectPath)) {
      try {
        const content = readFileSync(pyprojectPath, "utf8")
        // Simple regex to extract project name from pyproject.toml
        const match = content.match(/^\s*name\s*=\s*["']([^"']+)["']/m)
        if (match?.[1]) {
          projectName = match[1]
        }
      } catch {
        // Ignore read errors
      }
    }
  }

  // Try Python setup.py
  if (!projectName) {
    const setupPyPath = join(cwd, "setup.py")
    if (existsSync(setupPyPath)) {
      try {
        const content = readFileSync(setupPyPath, "utf8")
        // Look for name= in setup() call
        const match = content.match(/name\s*=\s*["']([^"']+)["']/m)
        if (match?.[1]) {
          projectName = match[1]
        }
      } catch {
        // Ignore read errors
      }
    }
  }

  // Try Rails application name
  if (!projectName) {
    const railsAppPath = join(cwd, "config", "application.rb")
    if (existsSync(railsAppPath)) {
      try {
        const content = readFileSync(railsAppPath, "utf8")
        // Look for module declaration
        const match = content.match(/^\s*module\s+(\w+)/m)
        if (match?.[1]) {
          projectName = match[1]
        }
      } catch {
        // Ignore read errors
      }
    }
  }

  // Fallback: use directory name with uniqueness suffix
  if (!projectName) {
    const dirName = basename(cwd)

    // If the directory name is too generic, add parent directory
    const genericNames = ["www", "app", "src", "frontend", "backend", "client", "server", "web"]
    if (genericNames.includes(dirName.toLowerCase())) {
      const parentDir = basename(dirname(cwd))
      projectName = `${parentDir}-${dirName}`
    } else {
      projectName = dirName
    }
  }

  // Always add a path hash to ensure uniqueness across different directories
  // that might have the same package.json name or directory name
  const pathHash = createHash("sha256").update(cwd).digest("hex").substring(0, 6)

  // Sanitize the project name (replace special chars, limit length)
  // Truncate before appending the hash so long names keep their path hash
  const baseName = projectName
    .toLowerCase()
    .replace(/[^a-zA-Z0-9-_]/g, "-") // Replace special chars with hyphens
    .replace(/-+/g, "-") // Collapse multiple hyphens
    .replace(/^-|-$/g, "") // Remove leading/trailing hyphens
    .substring(0, 50 - pathHash.length - 1) // Limit length
    .replace(/-$/, "") // Remove trailing hyphen left by truncation

  return baseName ? `${baseName}-${pathHash}` : pathHash
}

/**
 * Get a display-friendly version of the project name
 * (without hash suffixes for better readability)
 */
export function getProjectDisplayName(cwd: string = process.cwd()): string {
  const fullName = getProjectName(cwd)
  // Remove hash suffix if present
  return fullName.replace(/-[a-f0-9]{6}$/, "")
}

/**
 * Name to register with Portless, i.e. the app's https://<name>.localhost host.
 *
 * Prefers the readable name (`my-app` -> https://my-app.localhost). The
 * path-hashed name is only used when that hostname is already held by another
 * project, so two checkouts with the same name can still run side by side.
 * The data directory (Chrome profile, session discovery) stays keyed by the hashed name
 * either way, so switching hostnames never shares or loses a profile.
 */
export function getPortlessName(
  cwd: string = process.cwd(),
  isHostnameHeld: (name: string) => boolean = () => false
): string {
  const displayName = getProjectDisplayName(cwd)
  return displayName && !isHostnameHeld(displayName) ? displayName : getProjectName(cwd)
}

/**
 * Get the d3k data directory for a project
 * Project browser profiles and session discovery are stored here
 * Structure: ~/.d3k/{projectName}/
 *
 * Honors D3K_DATA_DIR as a full override of the computed project directory.
 */
export function getProjectDir(cwd: string = process.cwd()): string {
  const override = process.env.D3K_DATA_DIR
  if (override && override.length > 0) {
    return override
  }

  const projectName = getProjectName(cwd)
  return join(homedir(), ".d3k", projectName)
}
