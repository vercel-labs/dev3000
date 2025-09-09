import { existsSync, readFileSync } from "fs"
import type { NextRequest } from "next/server"
import type { LogsApiError, LogsApiResponse } from "@/types"

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const { searchParams } = new URL(request.url)
    const lines = parseInt(searchParams.get("lines") || "50", 10)
    const logPath = searchParams.get("logPath") || process.env.LOG_FILE_PATH || "./ai-dev-tools/consolidated.log"

    if (!existsSync(logPath)) {
      const errorResponse: LogsApiError = { error: "Log file not found" }
      return Response.json(errorResponse, { status: 404 })
    }

    const logContent = readFileSync(logPath, "utf-8")
    const allLines = logContent.split("\n").filter((line) => line.trim())
    const tailLines = allLines.slice(-lines)

    const response: LogsApiResponse = {
      logs: tailLines.join("\n"),
      total: allLines.length
    }

    return Response.json(response)
  } catch (error) {
    const errorResponse: LogsApiError = {
      error: error instanceof Error ? error.message : "Unknown error"
    }
    return Response.json(errorResponse, { status: 500 })
  }
}
