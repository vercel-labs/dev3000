#!/usr/bin/env tsx
import { spawn } from "child_process"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"

// Create test log file
const testDir = join(tmpdir(), `test-logs-${Date.now()}`)
mkdirSync(testDir, { recursive: true })

const testLogFile = join(testDir, "test.log")
const testLogContent = `[2025-09-25T01:00:00.000Z] [SERVER] Starting server...
[2025-09-25T01:00:01.000Z] [SERVER] Server started successfully
[2025-09-25T01:00:02.000Z] [BROWSER] Browser connected
[2025-09-25T01:00:03.000Z] [SERVER] Request received: GET /
[2025-09-25T01:00:04.000Z] [SERVER] Response sent: 200 OK`

writeFileSync(testLogFile, testLogContent)

console.log("🧪 Testing MCP Server Logs API...")

// Start the MCP server in test mode (use start for production build)
const mcpProcess = spawn("pnpm", ["run", "start"], {
  cwd: join(process.cwd(), "mcp-server"),
  env: {
    ...process.env,
    PORT: "3685", // Use different port for testing
    NODE_ENV: "production"
  }
})

let mcpReady = false

// Wait for server to be ready
mcpProcess.stdout?.on("data", (data) => {
  const output = data.toString()
  console.log("MCP stdout:", output.trim())
  if ((output.includes("Ready") || output.includes("started on") || output.includes("Listening")) && !mcpReady) {
    mcpReady = true
    // Give it a bit more time to fully initialize
    setTimeout(() => runTests(), 2000)
  }
})

mcpProcess.stderr?.on("data", (data) => {
  const output = data.toString()
  console.error("MCP stderr:", output.trim())
  // Next.js outputs to stderr sometimes
  if ((output.includes("Ready") || output.includes("started on") || output.includes("Listening")) && !mcpReady) {
    mcpReady = true
    // Give it a bit more time to fully initialize
    setTimeout(() => runTests(), 2000)
  }
})

async function runTests() {
  const baseUrl = "http://localhost:3685"
  let allTestsPassed = true

  try {
    // Test 1: List logs endpoint
    console.log("\n📋 Testing /api/logs/list...")
    const listResponse = await fetch(`${baseUrl}/api/logs/list`)
    if (!listResponse.ok) {
      throw new Error(`List endpoint failed: ${listResponse.status} ${listResponse.statusText}`)
    }
    await listResponse.json()
    console.log("✅ List endpoint working")

    // Test 2: Tail logs endpoint
    console.log("\n📋 Testing /api/logs/tail...")
    const tailResponse = await fetch(`${baseUrl}/api/logs/tail?file=${encodeURIComponent(testLogFile)}&lines=5`)
    if (!tailResponse.ok) {
      throw new Error(`Tail endpoint failed: ${tailResponse.status} ${tailResponse.statusText}`)
    }
    const tailData = await tailResponse.text()
    if (!tailData.includes("Response sent: 200 OK")) {
      throw new Error("Tail endpoint didn't return expected content")
    }
    console.log("✅ Tail endpoint working")

    // Test 3: Head logs endpoint
    console.log("\n📋 Testing /api/logs/head...")
    const headResponse = await fetch(`${baseUrl}/api/logs/head?file=${encodeURIComponent(testLogFile)}&lines=2`)
    if (!headResponse.ok) {
      throw new Error(`Head endpoint failed: ${headResponse.status} ${headResponse.statusText}`)
    }
    const headData = await headResponse.text()
    if (!headData.includes("Starting server...")) {
      throw new Error("Head endpoint didn't return expected content")
    }
    console.log("✅ Head endpoint working")

    // Test 4: Screenshots endpoint (404 expected)
    console.log("\n📋 Testing /api/screenshots/[filename]...")
    const screenshotResponse = await fetch(`${baseUrl}/api/screenshots/test.png`)
    if (screenshotResponse.status !== 404) {
      throw new Error(`Screenshot endpoint returned unexpected status: ${screenshotResponse.status}`)
    }
    console.log("✅ Screenshot endpoint working")

    // Test 5: Logs page
    console.log("\n📋 Testing /logs page...")
    const logsPageResponse = await fetch(`${baseUrl}/logs?file=${encodeURIComponent(testLogFile)}&mode=tail`)
    if (!logsPageResponse.ok) {
      throw new Error(`Logs page failed: ${logsPageResponse.status} ${logsPageResponse.statusText}`)
    }
    const pageContent = await logsPageResponse.text()
    if (!pageContent.includes("<!DOCTYPE html>")) {
      throw new Error("Logs page didn't return HTML")
    }
    console.log("✅ Logs page working")

    console.log("\n🎉 All tests passed!")
  } catch (error) {
    console.error("\n❌ Test failed:", error)
    allTestsPassed = false
  } finally {
    // Cleanup
    mcpProcess.kill()
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true })
    }
    process.exit(allTestsPassed ? 0 : 1)
  }
}

// Try to connect after 5 seconds if we haven't seen a ready message
setTimeout(() => {
  if (!mcpReady) {
    console.log("No ready message detected, attempting to connect anyway...")
    mcpReady = true
    runTests()
  }
}, 5000)

// Timeout after 30 seconds
setTimeout(() => {
  console.error("\n❌ Test timeout - MCP server didn't start")
  mcpProcess.kill()
  process.exit(1)
}, 30000)
