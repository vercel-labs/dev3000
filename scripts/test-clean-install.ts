#!/usr/bin/env tsx
/**
 * Test dev3000 in a clean environment similar to what real users experience
 * This script creates isolated environments to test global installations
 */

import { execSync, spawn } from "child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"

const GREEN = "\x1b[32m"
const RED = "\x1b[31m"
const YELLOW = "\x1b[33m"
const BLUE = "\x1b[36m"
const RESET = "\x1b[0m"

function log(message: string, color = RESET) {
  console.log(`${color}${message}${RESET}`)
}

interface TestResult {
  name: string
  passed: boolean
  error?: string
  duration: number
}

class CleanEnvironmentTester {
  private results: TestResult[] = []

  /**
   * Create a minimal PATH that simulates a fresh system
   */
  private getCleanPath(): string {
    // Only include system essentials, no dev tools
    const essentialPaths = ["/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"]
    return essentialPaths.join(":")
  }

  /**
   * Create a clean environment with minimal variables
   */
  private getCleanEnv(): NodeJS.ProcessEnv {
    return {
      PATH: this.getCleanPath(),
      HOME: process.env.HOME || "",
      USER: process.env.USER || "",
      LANG: "en_US.UTF-8",
      // Explicitly unset common dev environment variables
      NODE_ENV: undefined,
      npm_config_prefix: undefined,
      NVM_DIR: undefined,
      PNPM_HOME: undefined
    }
  }

  /**
   * Test installation using Docker (most isolated)
   */
  async testDockerInstall(tarballPath: string): Promise<TestResult> {
    const startTime = Date.now()
    const testName = "Docker Clean Install"

    try {
      log(`\n🐳 Testing ${testName}...`, BLUE)

      // Check if Docker is available
      try {
        execSync("docker --version", { stdio: "ignore" })
      } catch {
        log("Docker not available, skipping Docker test", YELLOW)
        return {
          name: testName,
          passed: true,
          error: "Docker not available",
          duration: 0
        }
      }

      // Create a Dockerfile for testing
      const tempDir = mkdtempSync(join(tmpdir(), "d3k-docker-test-"))
      const dockerfilePath = join(tempDir, "Dockerfile")

      writeFileSync(
        dockerfilePath,
        `
FROM node:20-slim
RUN apt-get update && apt-get install -y curl
RUN npm install -g pnpm
WORKDIR /test
COPY *.tgz ./
RUN pnpm install -g ./$(ls *.tgz)
# Test that d3k command exists
RUN which d3k
# Test running with --version
RUN d3k --version
`
      )

      // Copy tarball to temp directory
      execSync(`cp ${tarballPath} ${tempDir}/`)

      // Build Docker image
      log("Building Docker image...", YELLOW)
      execSync(`docker build -t d3k-test-clean ${tempDir}`, { stdio: "inherit" })

      // Run tests in container
      log("Running d3k in Docker container...", YELLOW)
      const output = execSync(`docker run --rm d3k-test-clean sh -c "d3k --version && echo 'SUCCESS'"`, {
        encoding: "utf-8"
      })

      const passed = output.includes("SUCCESS")

      // Cleanup
      execSync("docker rmi d3k-test-clean", { stdio: "ignore" })
      rmSync(tempDir, { recursive: true })

      return {
        name: testName,
        passed,
        duration: Date.now() - startTime
      }
    } catch (error) {
      return {
        name: testName,
        passed: false,
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime
      }
    }
  }

  /**
   * Test installation in isolated directory with clean environment
   */
  async testCleanEnvInstall(tarballPath: string): Promise<TestResult> {
    const startTime = Date.now()
    const testName = "Clean Environment Install"

    try {
      log(`\n🧪 Testing ${testName}...`, BLUE)

      // Create isolated temp directory
      const testDir = mkdtempSync(join(tmpdir(), "d3k-clean-test-"))
      const pnpmHome = join(testDir, "pnpm")
      const nodeModules = join(testDir, "node_modules")

      mkdirSync(pnpmHome, { recursive: true })
      mkdirSync(nodeModules, { recursive: true })

      // Set up clean environment
      const cleanEnv = {
        ...this.getCleanEnv(),
        PNPM_HOME: pnpmHome,
        npm_config_prefix: testDir,
        PATH: `${pnpmHome}:${nodeModules}/.bin:${this.getCleanPath()}`
      }

      // Install pnpm in isolated location
      log("Installing pnpm in isolated environment...", YELLOW)
      // Use SHELL=/bin/sh to prevent modification of user's shell config
      execSync("curl -fsSL https://get.pnpm.io/install.sh | SHELL=/bin/sh sh -", {
        env: {
          ...cleanEnv,
          SHELL: "/bin/sh",
          PNPM_HOME: pnpmHome
        },
        cwd: testDir,
        stdio: "inherit"
      })

      // Install dev3000 globally
      log("Installing dev3000 globally...", YELLOW)
      execSync(`${pnpmHome}/pnpm install -g ${tarballPath}`, {
        env: cleanEnv,
        cwd: testDir,
        stdio: "inherit"
      })

      // Test that it runs
      log("Testing d3k command...", YELLOW)

      // First check if d3k was installed
      try {
        const whichOutput = execSync(`${pnpmHome}/pnpm exec which d3k`, {
          env: cleanEnv,
          cwd: testDir,
          encoding: "utf-8"
        })
        log(`d3k installed at: ${whichOutput.trim()}`, YELLOW)
      } catch (e) {
        log("Failed to find d3k executable", RED)
        throw e
      }

      const output = execSync(`${pnpmHome}/pnpm exec d3k --version`, {
        env: cleanEnv,
        cwd: testDir,
        encoding: "utf-8"
      })

      const passed = output.includes("dev3000")

      // Cleanup
      rmSync(testDir, { recursive: true })

      return {
        name: testName,
        passed,
        duration: Date.now() - startTime
      }
    } catch (error) {
      return {
        name: testName,
        passed: false,
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime
      }
    }
  }

  /**
   * Test with minimal PATH
   */
  async testMinimalPath(tarballPath: string): Promise<TestResult> {
    const startTime = Date.now()
    const testName = "Minimal PATH Test"

    try {
      log(`\n🛤️ Testing ${testName}...`, BLUE)

      // Create a test script that runs with minimal PATH
      const testScript = `
        set -e
        export PATH="/usr/local/bin:/usr/bin:/bin"
        export PNPM_HOME="$HOME/.local/share/pnpm"
        
        # Install pnpm if not available
        if ! command -v pnpm &> /dev/null; then
          echo "Installing pnpm..."
          curl -fsSL https://get.pnpm.io/install.sh | SHELL=/bin/sh sh -
        fi
        
        # Add pnpm to PATH after installation
        export PATH="$PNPM_HOME:$PATH"
        
        # Verify pnpm is available
        which pnpm || (echo "pnpm not found in PATH" && exit 1)
        
        # Install and test dev3000
        pnpm install -g ${tarballPath}
        pnpm exec d3k --version
      `

      const output = execSync(testScript, {
        shell: "/bin/bash",
        encoding: "utf-8"
      })

      const passed = output.includes("dev3000")

      return {
        name: testName,
        passed,
        duration: Date.now() - startTime
      }
    } catch (error) {
      return {
        name: testName,
        passed: false,
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime
      }
    }
  }

  /**
   * Test server startup in clean environment
   */
  async testServerStartup(_tarballPath: string): Promise<TestResult> {
    const startTime = Date.now()
    const testName = "MCP Server Startup Test"

    try {
      log(`\n🚀 Testing ${testName}...`, BLUE)

      // Create test directory with minimal app
      const testDir = mkdtempSync(join(tmpdir(), "d3k-startup-test-"))
      const packageJson = {
        name: "test-app",
        scripts: {
          dev: "echo 'Test server running on port 3000'"
        }
      }
      writeFileSync(join(testDir, "package.json"), JSON.stringify(packageJson, null, 2))

      // Run d3k with clean environment
      const d3kProcess = spawn("d3k", ["--debug", "--servers-only"], {
        cwd: testDir,
        env: {
          ...this.getCleanEnv(),
          PATH: process.env.PATH // Need current PATH to find d3k
        }
      })

      let output = ""
      let _errorOutput = ""

      d3kProcess.stdout.on("data", (data) => {
        output += data.toString()
      })

      d3kProcess.stderr.on("data", (data) => {
        _errorOutput += data.toString()
      })

      // Wait for startup or timeout
      const timeoutPromise = new Promise((resolve) => setTimeout(resolve, 30000))
      const startupPromise = new Promise((resolve) => {
        const checkInterval = setInterval(() => {
          if (output.includes("MCP Server:") || output.includes("MCP server ready")) {
            clearInterval(checkInterval)
            resolve(true)
          }
        }, 1000)
      })

      const result = await Promise.race([startupPromise, timeoutPromise])

      // Kill the process
      d3kProcess.kill()

      // Cleanup
      rmSync(testDir, { recursive: true })

      return {
        name: testName,
        passed: result === true,
        error: result !== true ? "MCP server failed to start" : undefined,
        duration: Date.now() - startTime
      }
    } catch (error) {
      return {
        name: testName,
        passed: false,
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime
      }
    }
  }

  async runAllTests(tarballPath: string) {
    log("🧹 Starting Clean Environment Tests", GREEN)
    log(`📦 Testing with: ${tarballPath}`, YELLOW)

    // Run tests
    this.results.push(await this.testDockerInstall(tarballPath))
    this.results.push(await this.testCleanEnvInstall(tarballPath))
    this.results.push(await this.testMinimalPath(tarballPath))
    this.results.push(await this.testServerStartup(tarballPath))

    // Summary
    log("\n📊 Test Results Summary", GREEN)
    log("=".repeat(50))

    let allPassed = true
    for (const result of this.results) {
      const status = result.passed ? `✅ PASSED` : `❌ FAILED`
      const duration = `(${(result.duration / 1000).toFixed(2)}s)`
      log(`${status} ${result.name} ${duration}`, result.passed ? GREEN : RED)
      if (result.error) {
        log(`   Error: ${result.error}`, YELLOW)
      }
      if (!result.passed) allPassed = false
    }

    log("=".repeat(50))

    if (allPassed) {
      log("\n✨ All tests passed! Safe to publish.", GREEN)
      return 0
    } else {
      log("\n⚠️  Some tests failed. Review before publishing.", RED)
      return 1
    }
  }
}

// Main execution
async function main() {
  // Clean up any old tarballs first
  try {
    execSync("rm -f dev3000-*.tgz", { stdio: "ignore" })
  } catch {
    // Ignore errors
  }

  // Create fresh tarball
  log("Creating fresh tarball...", YELLOW)
  execSync("pnpm pack", { stdio: "inherit" })

  // Get the newly created tarball
  const tarballPath = execSync("ls -1t dev3000-*.tgz | head -1", { encoding: "utf-8" }).trim()
  const fullPath = join(process.cwd(), tarballPath)

  log(`Using tarball: ${tarballPath}`, YELLOW)

  const tester = new CleanEnvironmentTester()
  const exitCode = await tester.runAllTests(fullPath)

  process.exit(exitCode)
}

main().catch((error) => {
  log(`Fatal error: ${error}`, RED)
  process.exit(1)
})
