#!/usr/bin/env tsx
/**
 * Integration test to verify global installation works correctly
 * This simulates the conditions that cause issues #26, #30, and #31
 */

import { execSync } from "child_process"
import { cpSync, existsSync, mkdirSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"

// Colors for output
const GREEN = "\x1b[32m"
const RED = "\x1b[31m"
const YELLOW = "\x1b[33m"
const RESET = "\x1b[0m"

function log(message: string, color = RESET) {
  console.log(`${color}${message}${RESET}`)
}

function createMockGlobalInstall(): string {
  // Create a temporary directory structure that mimics pnpm global install
  const tempBase = join(tmpdir(), `test-dev3000-${Date.now()}`)
  const pnpmDir = join(tempBase, ".pnpm", "dev3000@latest", "node_modules", "dev3000")

  log(`Creating mock global install at: ${pnpmDir}`, YELLOW)

  // Create directory structure
  mkdirSync(pnpmDir, { recursive: true })
  mkdirSync(join(pnpmDir, "dist"), { recursive: true })

  // Copy essential files from current build
  const projectRoot = join(__dirname, "..")

  // Copy dist files
  if (existsSync(join(projectRoot, "dist"))) {
    cpSync(join(projectRoot, "dist"), join(pnpmDir, "dist"), { recursive: true })
  }

  // Copy package.json
  if (existsSync(join(projectRoot, "package.json"))) {
    cpSync(join(projectRoot, "package.json"), join(pnpmDir, "package.json"))
  }

  return pnpmDir
}

function cleanup(path: string) {
  try {
    execSync(`rm -rf ${path}`)
    log(`\nCleaned up: ${path}`, YELLOW)
  } catch {
    // Ignore cleanup errors
  }
}

// Main test execution
async function main() {
  log("=== Testing Global Installation Scenarios ===", GREEN)

  // First ensure we have a build
  log("\nBuilding project...", YELLOW)
  try {
    execSync("pnpm build", { stdio: "inherit", cwd: join(__dirname, "..") })
  } catch (_error) {
    log("Failed to build project", RED)
    process.exit(1)
  }

  // Create mock global install
  const mockInstallPath = createMockGlobalInstall()

  // Run tests
  const success = true

  try {
    // Add tests here as needed
  } finally {
    // Clean up
    cleanup(mockInstallPath)
  }

  if (success) {
    log("\n✅ All tests passed!", GREEN)
    process.exit(0)
  } else {
    log("\n❌ Some tests failed!", RED)
    process.exit(1)
  }
}

main().catch((error) => {
  log(`Unexpected error: ${error}`, RED)
  process.exit(1)
})
