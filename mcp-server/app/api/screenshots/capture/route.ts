import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs"
import { NextResponse } from "next/server"
import { tmpdir } from "os"
import { join } from "path"
import WebSocket from "ws"

/**
 * POST /api/screenshots/capture
 * Captures a screenshot of the current browser page via CDP.
 * Used by the verification step to capture "after-fix" screenshots.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { label?: string }
    const label = body.label || "page-loaded"

    // Find active d3k session to get CDP URL
    const sessionsDir = join(tmpdir(), "dev3000-sessions")
    if (!existsSync(sessionsDir)) {
      return NextResponse.json({ success: false, error: "No d3k sessions directory found" }, { status: 404 })
    }

    // Read session files to find CDP URL
    const fs = await import("fs")
    const sessionFiles = fs.readdirSync(sessionsDir).filter((f: string) => f.endsWith(".json"))

    let cdpUrl: string | null = null
    for (const file of sessionFiles) {
      try {
        const sessionData = JSON.parse(readFileSync(join(sessionsDir, file), "utf-8"))
        if (sessionData.cdpUrl) {
          cdpUrl = sessionData.cdpUrl
          break
        }
      } catch {
        // Skip invalid session files
      }
    }

    // Fallback: try localhost:9222
    if (!cdpUrl) {
      try {
        const response = await fetch("http://localhost:9222/json")
        const pages = (await response.json()) as Array<{ type: string; url: string; webSocketDebuggerUrl: string }>
        const activePage = pages.find((page) => page.type === "page" && !page.url.startsWith("chrome://"))
        if (activePage) {
          cdpUrl = activePage.webSocketDebuggerUrl
        }
      } catch {
        // Ignore fallback errors
      }
    }

    if (!cdpUrl) {
      return NextResponse.json(
        { success: false, error: "No CDP connection available. Make sure d3k is running with browser monitoring." },
        { status: 404 }
      )
    }

    // Connect to CDP and capture screenshot
    const screenshot = await new Promise<{ filename: string; path: string }>((resolve, reject) => {
      const ws = new WebSocket(cdpUrl)
      const timeout = setTimeout(() => {
        ws.close()
        reject(new Error("CDP connection timeout"))
      }, 30000)

      ws.on("error", (err) => {
        clearTimeout(timeout)
        reject(err)
      })

      ws.on("open", () => {
        // Capture screenshot
        ws.send(
          JSON.stringify({
            id: 1,
            method: "Page.captureScreenshot",
            params: { format: "png", quality: 80 }
          })
        )
      })

      ws.on("message", (data) => {
        try {
          const message = JSON.parse(data.toString())
          if (message.id === 1) {
            clearTimeout(timeout)
            ws.close()

            if (message.error) {
              reject(new Error(message.error.message || "Screenshot failed"))
              return
            }

            // Save screenshot
            const screenshotDir =
              process.env.SCREENSHOT_DIR || join(tmpdir(), "dev3000-mcp-deps", "public", "screenshots")
            if (!existsSync(screenshotDir)) {
              mkdirSync(screenshotDir, { recursive: true })
            }

            const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
            const filename = `${timestamp}-${label}.png`
            const screenshotPath = join(screenshotDir, filename)

            const buffer = Buffer.from(message.result.data, "base64")
            writeFileSync(screenshotPath, buffer)

            console.log(`[Screenshots] Captured ${filename}`)
            resolve({ filename, path: screenshotPath })
          }
        } catch (err) {
          clearTimeout(timeout)
          ws.close()
          reject(err)
        }
      })
    })

    return NextResponse.json({
      success: true,
      filename: screenshot.filename,
      path: screenshot.path
    })
  } catch (error) {
    console.error("Error capturing screenshot:", error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    )
  }
}
