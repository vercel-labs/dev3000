#!/usr/bin/env tsx
import { spawn } from "child_process"
import { join } from "path"

console.log("🧪 Testing d3k with logs API...")

// Don't kill existing processes - let d3k handle port conflicts
console.log("🚀 Starting d3k test...")

// Start d3k in the www directory with a random high port to avoid conflicts
const TEST_PORT = "3210"
console.log(`🚀 Starting d3k in www directory on port ${TEST_PORT}...`)
const d3kProcess = spawn("d3k", ["--no-tui", "--debug", "--port", TEST_PORT], {
  cwd: join(process.cwd(), "www"),
  env: {
    ...process.env,
    PATH: `${process.env.PATH}:${join(process.cwd(), "node_modules/.bin")}`
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
  // Clear the timeouts since we're now running tests
  clearTimeout(connectTimeout)
  clearTimeout(testTimeout)
  const mcpUrl = "http://localhost:3684"
  let allTestsPassed = true
  let testError: Error | null = null

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

    // Test 5: Verify screenshot URLs in log data via API
    console.log("\n🖼️ Testing screenshot URLs in log entries...")
    // Fetch actual log content to check for screenshot entries
    if (currentLogFile) {
      const logContentResponse = await fetch(
        `${mcpUrl}/api/logs/tail?file=${encodeURIComponent(currentLogFile)}&lines=1000`
      )
      if (logContentResponse.ok) {
        const logContent = await logContentResponse.text()
        const screenshotLines = logContent.split("\n").filter((line) => line.includes("[SCREENSHOT]"))

        if (screenshotLines.length > 0) {
          console.log(`Found ${screenshotLines.length} screenshot entries in logs`)
          for (const line of screenshotLines.slice(0, 3)) {
            // Extract screenshot URL from log line (non-greedy match up to newline or end)
            const urlMatch = line.match(/\[SCREENSHOT\] (https?:\/\/[^\s\n]+)/)
            if (urlMatch) {
              const screenshotUrl = urlMatch[1].trim()
              console.log(`  Checking screenshot URL: ${screenshotUrl}`)

              // Check for doubled protocol or path issues
              if (screenshotUrl.includes("http://") && screenshotUrl.match(/http:\/\//g)?.length > 1) {
                throw new Error(`Screenshot URL has doubled protocol: ${screenshotUrl}`)
              }
              if (
                screenshotUrl.includes("/api/screenshots/") &&
                screenshotUrl.match(/\/api\/screenshots\//g)?.length > 1
              ) {
                throw new Error(`Screenshot URL has doubled path: ${screenshotUrl}`)
              }

              // Try to fetch the screenshot
              const screenshotCheck = await fetch(screenshotUrl)
              if (screenshotCheck.status !== 200 && screenshotCheck.status !== 404) {
                throw new Error(`Screenshot URL ${screenshotUrl} returned unexpected status: ${screenshotCheck.status}`)
              }
              console.log(`  ✓ Screenshot URL valid (${screenshotCheck.status})`)
            }
          }
          console.log("✅ Screenshot URLs are correctly formatted")
        } else {
          console.log("ℹ️ No screenshot entries found in current log file")
        }
      }
    }

    console.log("\n🎉 All tests passed!")
  } catch (error) {
    console.error("\n❌ Test failed:", error)
    allTestsPassed = false
    testError = error as Error
  } finally {
    // Kill the specific d3k process we started
    console.log("\n🧹 Cleaning up...")

    // Send two SIGINTs (like Ctrl+C twice) to d3k - this triggers its graceful cleanup
    console.log("Sending first SIGINT (Ctrl+C) to d3k...")
    d3kProcess.kill("SIGINT")
    // Wait a moment then send second SIGINT
    await new Promise((resolve) => setTimeout(resolve, 1000))
    console.log("Sending second SIGINT (Ctrl+C) to d3k...")
    d3kProcess.kill("SIGINT")

    console.log("⏳ Waiting for d3k to clean up...")

    // Wait for d3k to handle cleanup (it should kill Chrome and its servers)
    let waitTime = 0
    const maxWait = 5000 // 5 seconds max

    while (waitTime < maxWait) {
      try {
        // Check if process is still alive
        process.kill(d3kProcess.pid as number, 0)
        // If no error, process is still running
        await new Promise((resolve) => setTimeout(resolve, 500))
        waitTime += 500
      } catch (_e) {
        // Process is dead
        console.log("✅ d3k process terminated")
        break
      }
    }

    // If still running after timeout, force kill
    if (waitTime >= maxWait) {
      console.log("⚠️ d3k didn't terminate gracefully, force killing...")
      try {
        d3kProcess.kill("SIGKILL")
      } catch (_e) {
        // Already dead
      }
    }

    // IMPORTANT: Force kill any remaining processes on the test port
    // This prevents zombie Next.js worker processes (next-server) from lingering
    console.log(`🧹 Force cleaning up any remaining processes on port ${TEST_PORT}...`)
    try {
      const { execSync } = await import("child_process")
      execSync(`lsof -ti :${TEST_PORT} | xargs kill -9 2>/dev/null || true`, { stdio: "ignore" })
      console.log(`✅ Cleaned up any remaining processes on port ${TEST_PORT}`)
    } catch (_e) {
      // Port was already clean or lsof failed - not critical
    }

    // Also kill any orphaned next-server processes that might be consuming CPU
    try {
      const { execSync } = await import("child_process")
      // Only kill next-server processes that are using high CPU (likely orphaned)
      execSync('pkill -9 -f "next-server.*v15" 2>/dev/null || true', { stdio: "ignore" })
      console.log("✅ Cleaned up any orphaned next-server processes")
    } catch (_e) {
      // No orphaned processes - not critical
    }
  }

  // Handle result after cleanup
  if (!allTestsPassed) {
    console.log("\n❌ Test failed")
    throw testError || new Error("Tests failed")
  }

  console.log("\n✅ Test completed successfully")
}

// Store timeout IDs so we can cancel them
let connectTimeout: NodeJS.Timeout
let testTimeout: NodeJS.Timeout

// Try to connect after 5 seconds if we haven't seen a ready message
connectTimeout = setTimeout(() => {
  if (!mcpReady) {
    console.log("No ready message detected, attempting to connect anyway...")
    mcpReady = true
    runTests()
  }
}, 5000)

// Timeout after 30 seconds
testTimeout = setTimeout(() => {
  console.error("\n❌ Test timeout - MCP server didn't start")
  d3kProcess.kill()
  process.exit(1)
}, 30000)
