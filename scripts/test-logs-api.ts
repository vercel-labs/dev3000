#!/usr/bin/env tsx
import { spawn } from "child_process"
import { join } from "path"

console.log("🧪 Testing d3k with logs API...")

// Kill any existing d3k processes first
console.log("🔄 Killing any existing d3k processes...")
const killProcess = spawn("sh", ["-c", "lsof -ti:3000 -ti:3684 | xargs kill -9"], { stdio: "ignore" })
await new Promise((resolve) => setTimeout(resolve, 2000)) // Wait for processes to die

// Start d3k in the www directory
console.log("🚀 Starting d3k in www directory...")
const d3kProcess = spawn("d3k", ["--no-tui", "--debug"], {
  cwd: join(process.cwd(), "www"),
  env: {
    ...process.env,
    PATH: process.env.PATH + ":" + join(process.cwd(), "node_modules/.bin")
  }
})

let mcpReady = false

// Wait for d3k to be ready
d3kProcess.stdout?.on("data", (data) => {
  const output = data.toString()
  console.log("[d3k]", output.trim())
  // Look for signs that both servers are ready
  if (
    output.includes("Development environment ready") ||
    output.includes("MCP Server:") ||
    output.includes("Your App:")
  ) {
    if (!mcpReady) {
      mcpReady = true
      // Give it a bit more time to fully initialize
      setTimeout(() => runTests(), 3000)
    }
  }
})

d3kProcess.stderr?.on("data", (data) => {
  const output = data.toString()
  console.error("[d3k error]", output.trim())
})

async function runTests() {
  const mcpUrl = "http://localhost:3684"
  let allTestsPassed = true

  try {
    // Test 1: List logs endpoint
    console.log("\n📋 Testing /api/logs/list...")
    const listResponse = await fetch(`${mcpUrl}/api/logs/list`)
    if (!listResponse.ok) {
      throw new Error(`List endpoint failed: ${listResponse.status} ${listResponse.statusText}`)
    }
    const logsData = await listResponse.json()
    if (!logsData.files || !Array.isArray(logsData.files)) {
      throw new Error("List endpoint didn't return expected format")
    }
    console.log(`✅ List endpoint working - found ${logsData.files.length} log files`)

    // Get current log file from the list
    const currentLogFile = logsData.currentFile || logsData.files[0]?.path

    if (currentLogFile) {
      // Test 2: Tail logs endpoint
      console.log("\n📋 Testing /api/logs/tail...")
      const tailResponse = await fetch(`${mcpUrl}/api/logs/tail?file=${encodeURIComponent(currentLogFile)}&lines=10`)
      if (!tailResponse.ok) {
        throw new Error(`Tail endpoint failed: ${tailResponse.status} ${tailResponse.statusText}`)
      }
      const tailData = await tailResponse.text()
      if (tailData.length === 0) {
        throw new Error("Tail endpoint returned empty content")
      }
      console.log("✅ Tail endpoint working")
    } else {
      console.log("⚠️ No log files found, skipping tail test")
    }

    // Test 3: Screenshots endpoint - verify it works (404 for non-existent is fine)
    console.log("\n📸 Testing screenshots endpoint...")
    const screenshotResponse = await fetch(`${mcpUrl}/api/screenshots/test-screenshot.png`)
    // 404 is expected for non-existent screenshots, anything else is an error
    if (screenshotResponse.status !== 404 && screenshotResponse.status !== 200) {
      throw new Error(`Screenshot endpoint returned unexpected status: ${screenshotResponse.status}`)
    }
    console.log("✅ Screenshot endpoint working")

    // Test 4: Logs page
    console.log("\n📄 Testing /logs page...")
    const logsPageResponse = await fetch(`${mcpUrl}/logs`)
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
    // Kill d3k process
    console.log("\n🧹 Cleaning up...")
    d3kProcess.kill()

    // Give it time to shut down
    await new Promise((resolve) => setTimeout(resolve, 1000))

    // Force kill any remaining processes
    const cleanupProcess = spawn("sh", ["-c", "lsof -ti:3000 -ti:3684 | xargs kill -9"], { stdio: "ignore" })
    await new Promise((resolve) => setTimeout(resolve, 1000))

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
