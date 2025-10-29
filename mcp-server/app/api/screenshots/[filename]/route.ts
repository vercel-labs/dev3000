import { existsSync } from "fs"
import { readFile } from "fs/promises"
import { type NextRequest, NextResponse } from "next/server"
import { tmpdir } from "os"
import { join } from "path"

export async function GET(_request: NextRequest, { params }: { params: Promise<{ filename: string }> }) {
  try {
    const { filename } = await params

    // Sanitize filename to prevent directory traversal
    if (!filename || filename.includes("..") || filename.includes("/")) {
      return new NextResponse("Invalid filename", { status: 400 })
    }

    // For global installs, screenshots are saved to temp directory
    // First check if SCREENSHOT_DIR is set (passed by dev3000 for global installs)
    let screenshotPath: string
    if (process.env.SCREENSHOT_DIR) {
      // Use the directory specified by dev3000
      screenshotPath = join(process.env.SCREENSHOT_DIR, filename)
    } else {
      // Fallback: Check if running from global install location
      const isGlobalInstall = __dirname.includes(".pnpm")

      if (isGlobalInstall) {
        // Global install - check temp directory
        const tmpDir = join(tmpdir(), "dev3000-mcp-deps", "public", "screenshots", filename)
        screenshotPath = tmpDir
      } else {
        // Local install - use current working directory
        screenshotPath = join(process.cwd(), "public", "screenshots", filename)
      }
    }

    // Check if file exists
    if (!existsSync(screenshotPath)) {
      return new NextResponse("Screenshot not found", { status: 404 })
    }

    // Read the file
    const imageBuffer = await readFile(screenshotPath)

    // Determine content type based on file extension
    const ext = filename.split(".").pop()?.toLowerCase()
    const contentType = ext === "png" ? "image/png" : "image/jpeg"

    // Convert Buffer to Uint8Array for NextResponse
    const imageData = new Uint8Array(imageBuffer)

    // Return the image with appropriate headers
    return new NextResponse(imageData, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=3600"
      }
    })
  } catch (error) {
    console.error("Error serving screenshot:", error)
    return new NextResponse("Internal server error", { status: 500 })
  }
}
