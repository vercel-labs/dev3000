#!/usr/bin/env node
import { spawn } from "child_process"
import { existsSync, readdirSync } from "fs"
import path from "path"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Set up the environment
process.env.NODE_ENV = "production"
process.env.PORT = process.env.PORT || "3684"

// Change to the MCP server directory
process.chdir(__dirname)

// Check if we're in a global install by looking for Next.js in parent directories
// Note: We use next/dist/bin/next directly instead of .bin/next because the .bin
// symlinks break when dereferenced during the build process (the relative imports
// in the .bin/next script point to wrong locations)
const findNext = () => {
  let currentDir = __dirname
  const maxLevels = 5 // Prevent infinite loop
  let levels = 0

  while (levels < maxLevels) {
    // Use the actual next package binary, not the .bin symlink
    const nextBin = path.join(currentDir, "node_modules", "next", "dist", "bin", "next")
    if (existsSync(nextBin)) {
      return nextBin
    }

    const parentDir = path.dirname(currentDir)
    if (parentDir === currentDir) break // Reached root
    currentDir = parentDir
    levels++
  }

  return null
}

// pnpm stores packages in .pnpm/package@version/node_modules/package
// Search for Next.js in pnpm's flat store structure
const findNextInPnpm = () => {
  let currentDir = __dirname
  const maxLevels = 10

  for (let i = 0; i < maxLevels; i++) {
    const pnpmDir = path.join(currentDir, ".pnpm")
    if (existsSync(pnpmDir)) {
      try {
        // Look for next@* directories in .pnpm
        const entries = readdirSync(pnpmDir)
        for (const entry of entries) {
          if (entry.startsWith("next@")) {
            const nextBin = path.join(pnpmDir, entry, "node_modules", "next", "dist", "bin", "next")
            if (existsSync(nextBin)) {
              return nextBin
            }
          }
        }
      } catch {
        // Ignore read errors
      }
    }

    const parentDir = path.dirname(currentDir)
    if (parentDir === currentDir) break
    currentDir = parentDir
  }

  return null
}

// Try standard node_modules first, then fall back to pnpm structure
const nextBin = findNext() || findNextInPnpm()

if (nextBin) {
  // Use the bundled Next.js
  console.log(`Starting MCP server using Next.js at: ${nextBin}`)
  const child = spawn(nextBin, ["start"], {
    stdio: "inherit",
    cwd: __dirname,
    env: {
      ...process.env,
      NODE_ENV: "production"
    }
  })

  child.on("error", (err) => {
    console.error("Failed to start server:", err)
    process.exit(1)
  })

  child.on("exit", (code) => {
    process.exit(code || 0)
  })
} else {
  console.error("Error: Next.js binary not found. The package may not have been built correctly.")
  console.error("Please reinstall dev3000 or report this issue.")
  process.exit(1)
}
