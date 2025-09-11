import { existsSync } from "fs"
import { NextResponse } from "next/server"

export async function GET() {
  const logFilePath = process.env.LOG_FILE_PATH || "./ai-dev-tools/consolidated.log"

  const health = {
    status: "healthy",
    timestamp: new Date().toISOString(),
    mcpEndpoint: "/api/mcp/mcp",
    logFile: {
      path: logFilePath,
      exists: existsSync(logFilePath)
    },
    version: process.env.DEV3000_VERSION || "unknown"
  }

  return NextResponse.json(health)
}
