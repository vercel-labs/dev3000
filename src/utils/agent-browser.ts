/** Resolve the installed agent-browser helper without launching a separate browser. */

import { createRequire } from "node:module"
import { accessSync, chmodSync, constants, existsSync } from "fs"
import { homedir } from "os"
import { dirname, join } from "path"
import { fileURLToPath } from "url"

function getRunnablePath(searchPath: string): string | null {
  if (!existsSync(searchPath)) {
    return null
  }
  if (process.platform === "win32") {
    return searchPath
  }
  try {
    accessSync(searchPath, constants.X_OK)
    return searchPath
  } catch {
    try {
      chmodSync(searchPath, 0o755)
      accessSync(searchPath, constants.X_OK)
      return searchPath
    } catch {
      return null
    }
  }
}

// Find the agent-browser binary in node_modules
function getAgentBrowserPath(): string {
  // 1. Check environment variable first
  if (process.env.AGENT_BROWSER_PATH) {
    const runnablePath = getRunnablePath(process.env.AGENT_BROWSER_PATH)
    if (runnablePath) {
      return runnablePath
    }
  }

  // Build search paths from multiple starting points
  const searchPaths: string[] = []

  // Package managers may hoist the dependency beside d3k (including sandbox installs).
  try {
    const dependency = createRequire(import.meta.url).resolve("agent-browser/package.json")
    searchPaths.push(join(dirname(dependency), "bin", "agent-browser.js"))
  } catch {
    // Bundled installations can fall back to the filesystem/global probes below.
  }

  // 2. Try import.meta.url-based paths (works in dev, may not work in Next.js bundle)
  try {
    const currentFile = fileURLToPath(import.meta.url)
    const currentDir = dirname(currentFile)

    // Only use these paths if currentDir looks like a real filesystem path
    // (Next.js/Turbopack rewrites import.meta.url to virtual paths like "src/utils/...")
    if (currentDir.startsWith("/") || currentDir.match(/^[A-Z]:\\/i)) {
      searchPaths.push(
        // Relative to src/utils/ or dist/utils/
        join(dirname(dirname(currentDir)), "node_modules", ".bin", "agent-browser"),
        join(currentDir, "..", "..", "node_modules", ".bin", "agent-browser")
      )
    }
  } catch {
    // import.meta.url not available or invalid, skip these paths
  }

  // 3. Bun global install (dev3000 dependency)
  searchPaths.push(
    join(homedir(), ".bun", "install", "global", "node_modules", "dev3000", "node_modules", ".bin", "agent-browser"),
    join(homedir(), ".bun", "install", "global", "node_modules", ".bin", "agent-browser"),
    join(homedir(), ".bun", "install", "global", "node_modules", "agent-browser", "bin", "agent-browser.js")
  )

  // 4. Use process.cwd() as fallback - essential for Next.js bundled code
  // When running in a bundled environment, cwd may vary, so include common local paths
  const cwd = process.cwd()
  searchPaths.push(
    // Direct node_modules
    join(cwd, "node_modules", ".bin", "agent-browser"),
    join(cwd, "node_modules", "agent-browser", "bin", "agent-browser.js"),
    // Parent node_modules (when cwd is nested)
    join(cwd, "..", "node_modules", ".bin", "agent-browser"),
    join(cwd, "..", "node_modules", "agent-browser", "bin", "agent-browser.js")
  )

  // 5. npm/pnpm/yarn global install locations (best-effort)
  const globalNodeModules = [
    join("/usr", "local", "lib", "node_modules"),
    join("/opt", "homebrew", "lib", "node_modules")
  ]
  for (const root of globalNodeModules) {
    searchPaths.push(join(root, "dev3000", "node_modules", ".bin", "agent-browser"))
    searchPaths.push(join(root, "agent-browser", "bin", "agent-browser.js"))
  }

  for (const searchPath of searchPaths) {
    const runnablePath = getRunnablePath(searchPath)
    if (runnablePath) {
      return runnablePath
    }
  }

  // Fallback to global command (may work if installed globally)
  return "agent-browser"
}

/** Resolve the installed browser helper for the runtime-owned CDP session. */
export function getAgentBrowserBinaryPath(): string {
  return getAgentBrowserPath()
}
