#!/usr/bin/env node

/**
 * MCP stdio bridge for dev3000
 *
 * This script bridges HTTP-based MCP server (http://localhost:3684/mcp)
 * to stdio for Claude Desktop integration.
 *
 * Usage:
 *   node scripts/mcp-stdio-bridge.js [--port 3684] [--host localhost]
 */

import http from "node:http"

// Parse command line arguments
const args = process.argv.slice(2)
let port = 3684
let host = "localhost"

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--port" && args[i + 1]) {
    port = parseInt(args[i + 1], 10)
    i++
  } else if (args[i] === "--host" && args[i + 1]) {
    host = args[i + 1]
    i++
  }
}

const MCP_URL = `http://${host}:${port}/mcp`

// Log to stderr so it doesn't interfere with stdio communication
function log(...args) {
  console.error("[dev3000-mcp-bridge]", ...args)
}

// Function to make HTTP request to MCP server
function makeRequest(method, body) {
  return new Promise((resolve, reject) => {
    const options = {
      method,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json"
      }
    }

    const req = http.request(MCP_URL, options, (res) => {
      let data = ""

      res.on("data", (chunk) => {
        data += chunk
      })

      res.on("end", () => {
        try {
          const response = JSON.parse(data)
          resolve(response)
        } catch (error) {
          reject(new Error(`Failed to parse response: ${error.message}`))
        }
      })
    })

    req.on("error", (error) => {
      reject(error)
    })

    req.write(JSON.stringify(body))
    req.end()
  })
}

// Handle stdin input
let inputBuffer = ""

process.stdin.setEncoding("utf8")
process.stdin.on("data", async (chunk) => {
  inputBuffer += chunk

  // Process complete lines
  const lines = inputBuffer.split("\n")
  inputBuffer = lines.pop() || "" // Keep incomplete line in buffer

  for (const line of lines) {
    if (!line.trim()) continue

    try {
      const request = JSON.parse(line)
      log("Received request:", request.method || request.jsonrpc)

      // Forward request to HTTP MCP server
      const response = await makeRequest("POST", request)

      // Send response back via stdout
      process.stdout.write(`${JSON.stringify(response)}\n`)
    } catch (error) {
      log("Error processing request:", error.message)

      // Send error response
      const errorResponse = {
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: error.message
        },
        id: null
      }
      process.stdout.write(`${JSON.stringify(errorResponse)}\n`)
    }
  }
})

process.stdin.on("end", () => {
  log("stdin closed, exiting")
  process.exit(0)
})

process.on("SIGINT", () => {
  log("Received SIGINT, exiting")
  process.exit(0)
})

process.on("SIGTERM", () => {
  log("Received SIGTERM, exiting")
  process.exit(0)
})

// Wait for HTTP server to be ready
async function waitForServer(maxRetries = 30, retryDelay = 1000) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      await new Promise((resolve, reject) => {
        const req = http.get(MCP_URL.replace("/mcp", "/"), (_res) => {
          resolve()
        })
        req.on("error", reject)
        req.setTimeout(1000, () => {
          req.destroy()
          reject(new Error("Timeout"))
        })
      })
      log(`Connected to MCP server at ${MCP_URL}`)
      return true
    } catch (_error) {
      if (i < maxRetries - 1) {
        log(`Waiting for MCP server at ${MCP_URL}... (attempt ${i + 1}/${maxRetries})`)
        await new Promise((resolve) => setTimeout(resolve, retryDelay))
      }
    }
  }
  throw new Error(`Could not connect to MCP server at ${MCP_URL} after ${maxRetries} attempts`)
}
// Start bridge
;(async () => {
  try {
    log("Starting dev3000 MCP stdio bridge")
    log(`Target: ${MCP_URL}`)

    await waitForServer()

    log("Bridge ready, listening for requests on stdin...")
  } catch (error) {
    log("Fatal error:", error.message)
    log("Make sure dev3000 is running with: dev3000 or d3k")
    process.exit(1)
  }
})()
