import { existsSync } from "fs"
import { readFile } from "fs/promises"
import { type NextRequest, NextResponse } from "next/server"
import { join } from "path"

export async function GET(_request: NextRequest, { params }: { params: Promise<{ filename: string }> }) {
  try {
    const { filename } = await params

    // Sanitize filename to prevent directory traversal
    if (!filename || filename.includes("..") || filename.includes("/")) {
      return new NextResponse("Invalid filename", { status: 400 })
    }

    // For global installs, screenshots are saved to temp directory
    // Check if running from global install location
    const isGlobalInstall = __dirname.includes(".pnpm")

    let screenshotPath: string
    if (isGlobalInstall) {
      // Global install - check temp directory
      const tmpDir = join(require("os").tmpdir(), "dev3000-mcp-deps", "public", "screenshots", filename)
      screenshotPath = tmpDir
    } else {
      // Local install - use current working directory
      screenshotPath = join(process.cwd(), "public", "screenshots", filename)
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
