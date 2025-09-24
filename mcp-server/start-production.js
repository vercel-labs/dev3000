#!/usr/bin/env node
const { spawn } = require("child_process")
const path = require("path")
const fs = require("fs")

// Function to start the server using Next.js runtime
function startWithNextRuntime() {
  // Set up the environment
  process.env.NODE_ENV = "production"

  // Change working directory to the MCP server directory
  process.chdir(__dirname)

  // Import and start the Next.js server directly
  try {
    // First set up require paths to find Next.js modules
    const Module = require("module")
    const originalResolveFilename = Module._resolveFilename

    Module._resolveFilename = function (request, parent, isMain) {
      // For Next.js internal modules, try multiple locations
      if (request.startsWith("next/") || request === "next") {
        const attempts = [
          // Try in the main dev3000 package's node_modules
          path.join(__dirname, "..", "..", "node_modules", request),
          // Try in parent directory's node_modules
          path.join(__dirname, "..", "node_modules", request),
          // Try in current directory's node_modules
          path.join(__dirname, "node_modules", request),
          // Try in parent's parent (for pnpm structure)
          path.join(__dirname, "..", "..", "..", "node_modules", request),
          // Try in parent's parent's parent
          path.join(__dirname, "..", "..", "..", "..", "node_modules", request)
        ]

        for (const attempt of attempts) {
          try {
            return originalResolveFilename.call(this, attempt, parent, isMain)
          } catch (_e) {
            // Continue to next attempt
          }
        }
      }

      // Fallback to original resolution
      return originalResolveFilename.call(this, request, parent, isMain)
    }

    // Now require Next.js and start the server
    const { startServer } = require("next/dist/server/lib/start-server")

    startServer({
      dir: __dirname,
      hostname: "0.0.0.0",
      port: parseInt(process.env.PORT || "3684", 10),
      isDev: false
    })
      .then(() => {
        console.log(`> Ready on http://localhost:${process.env.PORT || "3684"}`)
      })
      .catch((err) => {
        console.error("Error starting server:", err)
        process.exit(1)
      })
  } catch (err) {
    console.error("Failed to start with Next.js runtime:", err)
    // Fallback to spawning next binary
    startWithNextBinary()
  }
}

// Fallback function to use next binary
function startWithNextBinary() {
  // Try to find the next binary
  const possiblePaths = [
    path.join(__dirname, "..", "..", "node_modules", ".bin", "next"),
    path.join(__dirname, "..", "node_modules", ".bin", "next"),
    path.join(__dirname, "node_modules", ".bin", "next"),
    path.join(__dirname, "..", "..", "..", "node_modules", ".bin", "next"),
    path.join(__dirname, "..", "..", "..", "..", "node_modules", ".bin", "next")
  ]

  let nextBin = null
  for (const binPath of possiblePaths) {
    if (fs.existsSync(binPath)) {
      nextBin = binPath
      break
    }
  }

  if (!nextBin) {
    console.error("Could not find Next.js binary")
    process.exit(1)
  }

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
}

// Start the server
startWithNextRuntime()
