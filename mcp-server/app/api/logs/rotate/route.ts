import { existsSync, renameSync, symlinkSync, unlinkSync, writeFileSync } from "fs"
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

    // Extract project name from current log path if it follows dev3000 pattern
    const currentFileName = currentLogPath.split("/").pop() || ""
    const projectMatch = currentFileName.match(/^dev3000-([^-]+)-/)
    const projectName = projectMatch ? projectMatch[1] : "unknown"

    // Create new timestamped filename matching dev3000 pattern
    const archivedLogPath = join(logDir, `dev3000-${projectName}-${timestamp}.log`)

    // Rename current log to archived name
    renameSync(currentLogPath, archivedLogPath)

    // Create new empty log file
    writeFileSync(currentLogPath, "")

    // Update symlink to point to new log file
    const symlinkPath = "/tmp/dev3000.log"
    if (existsSync(symlinkPath)) {
      unlinkSync(symlinkPath)
    }
    symlinkSync(currentLogPath, symlinkPath)

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
