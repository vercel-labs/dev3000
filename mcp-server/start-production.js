#!/usr/bin/env node
const { spawn } = require("child_process")

// Set up the environment
process.env.NODE_ENV = "production"
process.env.PORT = process.env.PORT || "3684"

// Change to the MCP server directory
process.chdir(__dirname)

// For turbopack builds, we need to use the exact Next.js version that built it
// Since turbopack runtime files are version-specific, we'll use npx to ensure compatibility
const child = spawn("npx", ["--yes", "next@15.5.1-canary.30", "start"], {
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
