/**
 * Smoke tests for CLI
 * Minimal tests to ensure the CLI binary works correctly
 */

import { execSync } from "child_process"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { afterAll, beforeAll, describe, expect, test } from "vitest"

describe("CLI Smoke Tests", () => {
  const cliPath = join(process.cwd(), "dist", "cli.js")
  const testDir = join(tmpdir(), "dev3000-smoke-test")

  beforeAll(() => {
    // Ensure CLI is built
    if (!existsSync(cliPath)) {
      throw new Error(`CLI not built. Run 'pnpm build' first. Looking for: ${cliPath}`)
    }
    // Create test directory
    mkdirSync(testDir, { recursive: true })
  })

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  test("CLI displays help", () => {
    const output = execSync(`node ${cliPath} --help`, { encoding: "utf8" })

    expect(output).toContain("AI-powered development tools")
    expect(output).toContain("--port")
    expect(output).toContain("--script")
    expect(output).toContain("--debug")
    expect(output).toContain("--servers-only")
  })

  test("CLI displays version", () => {
    const output = execSync(`node ${cliPath} --version`, { encoding: "utf8" })

    expect(output).toMatch(/\d+\.\d+\.\d+/)
  })

  test("CLI detects Python project with debug output", () => {
    const pythonDir = join(testDir, "python-test")
    mkdirSync(pythonDir)
    writeFileSync(join(pythonDir, "requirements.txt"), "flask")

    let output = ""
    try {
      // Use --servers-only to avoid actually starting servers
      output = execSync(`node ${cliPath} --debug --servers-only`, {
        cwd: pythonDir,
        encoding: "utf8",
        timeout: 2000,
        stdio: "pipe" // Capture both stdout and stderr
      })
    } catch (e) {
      // Command might fail (no actual server), but we still get debug output
      const error = e as { stdout?: string; stderr?: string; output?: Buffer[] }
      output = error.stdout || error.stderr || error.output?.join("") || ""
    }

    expect(output).toContain("[PROJECT DEBUG] Python project detected")
    expect(output).toContain("[CLI DEBUG] Project type: python")
  })

  test("CLI detects Rails project with debug output", () => {
    const railsDir = join(testDir, "rails-test")
    mkdirSync(railsDir)
    mkdirSync(join(railsDir, "config"))
    writeFileSync(join(railsDir, "Gemfile"), 'gem "rails"')
    writeFileSync(join(railsDir, "config", "application.rb"), "# Rails app")

    let output = ""
    try {
      output = execSync(`node ${cliPath} --debug --servers-only`, {
        cwd: railsDir,
        encoding: "utf8",
        timeout: 2000,
        stdio: "pipe"
      })
    } catch (e) {
      const error = e as { stdout?: string; stderr?: string; output?: Buffer[] }
      output = error.stdout || error.stderr || error.output?.join("") || ""
    }

    expect(output).toContain("[PROJECT DEBUG] Rails project detected")
    expect(output).toContain("[CLI DEBUG] Project type: rails")
  })

  test("CLI detects Node.js project with debug output", () => {
    const nodeDir = join(testDir, "node-test")
    mkdirSync(nodeDir)
    writeFileSync(join(nodeDir, "package.json"), '{"name": "test-app", "scripts": {"dev": "node app.js"}}')

    let output = ""
    try {
      output = execSync(`node ${cliPath} --debug --servers-only`, {
        cwd: nodeDir,
        encoding: "utf8",
        timeout: 2000,
        stdio: "pipe"
      })
    } catch (e) {
      const error = e as { stdout?: string; stderr?: string; output?: Buffer[] }
      output = error.stdout || error.stderr || error.output?.join("") || ""
    }

    expect(output).toContain("[CLI DEBUG] Project type: node")
  })

  test("CLI respects custom port and script flags", () => {
    const customDir = join(testDir, "custom-test")
    mkdirSync(customDir)
    writeFileSync(join(customDir, "requirements.txt"), "django")

    let output = ""
    try {
      output = execSync(`node ${cliPath} --debug --port 8080 --script app.py --servers-only`, {
        cwd: customDir,
        encoding: "utf8",
        timeout: 2000,
        stdio: "pipe"
      })
    } catch (e) {
      const error = e as { stdout?: string; stderr?: string; output?: Buffer[] }
      output = error.stdout || error.stderr || error.output?.join("") || ""
    }

    expect(output).toContain("[CLI DEBUG] Port: 8080 (explicit)")
    expect(output).toContain("[CLI DEBUG] Script: app.py (explicit)")
  })

  test("Rails with Procfile.dev uses bin/dev with custom scripts", () => {
    const railsDir = join(testDir, "rails-procfile-test")
    mkdirSync(railsDir)
    mkdirSync(join(railsDir, "config"))
    writeFileSync(join(railsDir, "Gemfile"), 'gem "rails"')
    writeFileSync(join(railsDir, "config", "application.rb"), "# Rails app")
    writeFileSync(join(railsDir, "Procfile.dev"), "web: rails server\nworker: sidekiq")

    let output = ""
    try {
      output = execSync(`node ${cliPath} --debug --script server --servers-only`, {
        cwd: railsDir,
        encoding: "utf8",
        timeout: 2000,
        stdio: "pipe"
      })
    } catch (e) {
      const error = e as { stdout?: string; stderr?: string; output?: Buffer[] }
      output = error.stdout || error.stderr || error.output?.join("") || ""
    }

    expect(output).toContain("[CLI DEBUG] Server command: bin/dev server")
  })
})
