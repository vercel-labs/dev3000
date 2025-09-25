#!/usr/bin/env tsx
import { execSync } from "child_process"
import * as fs from "fs"
import * as path from "path"

function restoreCatalogVersions() {
  console.log("🔄 Restoring catalog: versions from pnpm-workspace.yaml...")

  // Find all package.json files that were modified
  const packageJsonFiles = [
    path.join(process.cwd(), "package.json"),
    path.join(process.cwd(), "mcp-server/package.json"),
    path.join(process.cwd(), "www/package.json")
  ]

  for (const file of packageJsonFiles) {
    if (fs.existsSync(file)) {
      try {
        // Reset the file to match git HEAD
        execSync(`git checkout HEAD -- "${file}"`, { stdio: "ignore" })
        console.log(`✅ Restored ${path.relative(process.cwd(), file)}`)
      } catch (_error) {
        console.log(`⚠️ Could not restore ${path.relative(process.cwd(), file)}`)
      }
    }
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  restoreCatalogVersions()
}
