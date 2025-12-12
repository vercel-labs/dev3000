import { readdirSync, unlinkSync } from "fs"
import { NextResponse } from "next/server"
import { tmpdir } from "os"
import { join } from "path"

/**
 * DELETE /api/screenshots/clear
 * Clears all screenshots from the screenshot directory.
 * Used by the verification step to ensure fresh screenshots are captured after fix.
 */
export async function DELETE() {
  try {
    const screenshotDir = process.env.SCREENSHOT_DIR || join(tmpdir(), "dev3000-mcp-deps", "public", "screenshots")

    const files = readdirSync(screenshotDir).filter((f) => f.endsWith(".png") || f.endsWith("-metadata.json"))

    let deletedCount = 0
    for (const file of files) {
      try {
        unlinkSync(join(screenshotDir, file))
        deletedCount++
      } catch (err) {
        console.error(`Failed to delete ${file}:`, err)
      }
    }

    console.log(`[Screenshots] Cleared ${deletedCount} screenshots from ${screenshotDir}`)

    return NextResponse.json({
      success: true,
      deletedCount,
      directory: screenshotDir
    })
  } catch (error) {
    console.error("Error clearing screenshots:", error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    )
  }
}
