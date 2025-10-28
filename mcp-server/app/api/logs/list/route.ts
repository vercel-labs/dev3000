import { existsSync, readdirSync, statSync } from "fs"
import type { NextRequest } from "next/server"
import { basename, dirname, join } from "path"
import type { LogFile, LogListError, LogListResponse } from "@/types"
import { extractProjectNameFromLogFilename, logFilenameMatchesProject } from "../../../../src/utils/log-filename"

export async function GET(_request: NextRequest): Promise<Response> {
  try {
    const currentLogPath = process.env.LOG_FILE_PATH || "/var/log/dev3000/dev3000.log"

    if (!existsSync(currentLogPath)) {
      const errorResponse: LogListError = { error: "Current log file not found" }
      return Response.json(errorResponse, { status: 404 })
    }

    // Get the directory containing the current log
    const logDir = dirname(currentLogPath)
    const currentLogName = basename(currentLogPath)

    // Extract project name from current log filename using shared utility
    const projectName = extractProjectNameFromLogFilename(currentLogName) || "unknown"

    // Find all log files for this project
    const files: LogFile[] = []

    try {
      const dirContents = readdirSync(logDir)
      const logFiles = dirContents
        .filter((file) => logFilenameMatchesProject(file, projectName))
        .map((file) => {
          const filePath = join(logDir, file)
          const stats = statSync(filePath)

          // Extract timestamp from filename
          const timestampMatch = file.match(/(\d{4}-\d{2}-\d{2}T[\d-]+Z)/)
          const timestamp = timestampMatch ? timestampMatch[1].replace(/-/g, ":") : ""

          return {
            name: file,
            path: filePath,
            timestamp,
            size: stats.size,
            mtime: stats.mtime,
            isCurrent: file === currentLogName
          }
        })
        .sort((a, b) => b.mtime.getTime() - a.mtime.getTime()) // Most recent first
        .map((file) => ({
          ...file,
          mtime: file.mtime.toISOString() // Convert to string after sorting
        }))

      files.push(...logFiles)
    } catch (error) {
      console.warn("Could not read log directory:", error)
    }

    const response: LogListResponse = {
      files,
      currentFile: currentLogPath,
      projectName
    }

    return Response.json(response)
  } catch (error) {
    const errorResponse: LogListError = {
      error: error instanceof Error ? error.message : "Unknown error"
    }
    return Response.json(errorResponse, { status: 500 })
  }
}
