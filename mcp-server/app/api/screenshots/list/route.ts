import { readdirSync } from "fs"
import { type NextRequest, NextResponse } from "next/server"
import { tmpdir } from "os"
import { join } from "path"

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const pattern = searchParams.get("pattern") || ""

    const screenshotDir = process.env.SCREENSHOT_DIR || join(tmpdir(), "dev3000-mcp-deps", "public", "screenshots")

    const files = readdirSync(screenshotDir)
      .filter((f) => f.endsWith(".png"))
      .filter((f) => (pattern ? f.includes(pattern) : true))

    return NextResponse.json({ files })
  } catch (error) {
    console.error("Error listing screenshots:", error)
    return NextResponse.json({ files: [] }, { status: 500 })
  }
}
