import { extractProjectNameFromLogFilename } from "@dev3000/src/utils/log-filename"
import { existsSync, renameSync, writeFileSync } from "fs"
import { type NextRequest, NextResponse } from "next/server"
import { dirname, join } from "path"

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { currentLogPath } = body

    if (!currentLogPath) {
      return NextResponse.json({ error: "currentLogPath is required" }, { status: 400 })
    }

    // Check if the current log file exists
    if (!existsSync(currentLogPath)) {
      return NextResponse.json({ error: "Current log file not found" }, { status: 404 })
    }

    const logDir = dirname(currentLogPath)
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-")

    // Extract project name from current log filename using shared utility
    const currentFileName = currentLogPath.split("/").pop() || ""
    const projectName = extractProjectNameFromLogFilename(currentFileName) || "unknown"

    // Create new timestamped filename
    const archivedLogPath = join(logDir, `${projectName}-${timestamp}.log`)

    // Rename current log to archived name
    renameSync(currentLogPath, archivedLogPath)

    // Create new empty log file
    writeFileSync(currentLogPath, "")

    // No symlink update needed - each instance uses its own log file

    return NextResponse.json({
      success: true,
      archivedLogPath,
      currentLogPath,
      timestamp
    })
  } catch (error) {
    console.error("Log rotation error:", error)
    return NextResponse.json({ error: "Failed to rotate log file" }, { status: 500 })
  }
}
