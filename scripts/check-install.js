#!/usr/bin/env node
import { existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { pathToFileURL } from "node:url"

function isGlobalInstall() {
  const packageRoot = dirname(__dirname)

  // Check common global install paths
  const globalPaths = [
    "/usr/local/lib/node_modules",
    "/usr/lib/node_modules",
    process.env.NPM_CONFIG_PREFIX && join(process.env.NPM_CONFIG_PREFIX, "lib/node_modules"),
    process.env.PNPM_HOME,
    process.platform === "win32" && process.env.APPDATA && join(process.env.APPDATA, "npm/node_modules"),
    process.env.HOME && join(process.env.HOME, ".npm-global/lib/node_modules"),
    process.env.HOME && join(process.env.HOME, ".pnpm"),
    process.env.HOME && join(process.env.HOME, ".yarn/global/node_modules")
  ].filter(Boolean)

  // Check if our package path contains any of these global paths
  for (const globalPath of globalPaths) {
    if (packageRoot.includes(globalPath)) {
      return true
    }
  }

  // Additional check: if we're in node_modules but not in a project's node_modules
  if (packageRoot.includes("node_modules") && !existsSync(join(packageRoot, "..", "..", "..", "package.json"))) {
    return true
  }

  // If running in npm lifecycle, check npm_config_global
  if (process.env.npm_config_global === "true") {
    return true
  }

  return false
}

function checkInstallation() {
  const isGlobal = isGlobalInstall()

  if (!isGlobal) {
    console.log("\n⚠️  Warning: dev3000 appears to be installed locally.\n")
    console.log("This package is designed to be installed globally and won't work correctly as a local dependency.\n")
    console.log("To install globally, use one of these commands:")
    console.log("  pnpm install -g dev3000")
    console.log("  npm install -g dev3000")
    console.log("  yarn global add dev3000\n")
    console.log("Then run 'd3k' or 'dev3000' from any project directory.\n")
  }
}

// Only run if executed directly (not imported)
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  checkInstallation()
}
