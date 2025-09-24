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
  mkdirSync(join(pnpmDir, "mcp-server"), { recursive: true })

  // Copy essential files from current build
  const projectRoot = join(__dirname, "..")

  // Copy dist files
  if (existsSync(join(projectRoot, "dist"))) {
    cpSync(join(projectRoot, "dist"), join(pnpmDir, "dist"), { recursive: true })
  }

  // Copy mcp-server with .next build
  if (existsSync(join(projectRoot, "mcp-server"))) {
    cpSync(join(projectRoot, "mcp-server"), join(pnpmDir, "mcp-server"), { recursive: true })
  }

  // Copy package.json
  if (existsSync(join(projectRoot, "package.json"))) {
    cpSync(join(projectRoot, "package.json"), join(pnpmDir, "package.json"))
  }

  return pnpmDir
}

function testMcpServerStartup(installPath: string): boolean {
  log("\nTesting MCP server startup...", YELLOW)

  try {
    // Set up environment to run from mock global install
    const env = {
      ...process.env,
      NODE_PATH: installPath,
      DEBUG: "true"
    }

    // Try to start the CLI with --kill-mcp first to clean up
    try {
      execSync(`node ${join(installPath, "dist", "cli.js")} --kill-mcp`, {
        env,
        stdio: "pipe"
      })
    } catch {
      // Ignore errors from kill command
    }

    // Now try to start with debug mode to see what happens
    const output = execSync(`timeout 5s node ${join(installPath, "dist", "cli.js")} --debug --servers-only || true`, {
      env,
      stdio: "pipe",
      encoding: "utf8"
    })

    // Check for common error patterns
    if (output.includes("Cannot find module")) {
      log("❌ Module not found error detected", RED)
      log(output, RED)
      return false
    }

    if (output.includes("package.json not found")) {
      log("❌ package.json not found error detected", RED)
      log(output, RED)
      return false
    }

    if (output.includes("MCP server is pre-built") && output.includes("will run from original location")) {
      log("✅ Correctly detected pre-built server and running from original location", GREEN)
      return true
    }

    if (output.includes("Starting MCP server") || output.includes("MCP server ready")) {
      log("✅ MCP server started successfully", GREEN)
      return true
    }

    log("⚠️ Unexpected output:", YELLOW)
    log(output)
    return false
  } catch (error) {
    log("❌ Failed to start MCP server", RED)
    log(error instanceof Error ? error.message : String(error), RED)
    if (error && typeof error === "object" && "stdout" in error && error.stdout) {
      log("stdout:", YELLOW)
      log(String(error.stdout))
    }
    if (error && typeof error === "object" && "stderr" in error && error.stderr) {
      log("stderr:", YELLOW)
      log(String(error.stderr))
    }
    return false
  }
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
  let success = true

  try {
    // Test 1: MCP server startup
    if (!testMcpServerStartup(mockInstallPath)) {
      success = false
    }

    // Add more tests here as needed
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
