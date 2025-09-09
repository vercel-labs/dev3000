import { existsSync, readFileSync, watchFile } from "fs"
import type { NextRequest } from "next/server"

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const logPath = searchParams.get("logPath") || process.env.LOG_FILE_PATH || "./ai-dev-tools/consolidated.log"

  if (!existsSync(logPath)) {
    return new Response("Log file not found", { status: 404 })
  }

  const encoder = new TextEncoder()
  let lastSize = 0

  const stream = new ReadableStream({
    start(controller) {
      // Send initial content
      try {
        const content = readFileSync(logPath, "utf-8")
        const lines = content.split("\n").filter((line) => line.trim())
        lastSize = content.length

        // Send initial lines
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ lines })}\n\n`))
      } catch (_error) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: "Failed to read log" })}\n\n`))
      }

      // Watch for file changes
      const watcher = watchFile(logPath, { interval: 1000 }, () => {
        try {
          const content = readFileSync(logPath, "utf-8")
          if (content.length > lastSize) {
            const newContent = content.slice(lastSize)
            const newLines = newContent.split("\n").filter((line) => line.trim())
            if (newLines.length > 0) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ newLines })}\n\n`))
            }
            lastSize = content.length
          }
        } catch (_error) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: "Failed to read log updates" })}\n\n`))
        }
      })

      // Cleanup on close
      request.signal.addEventListener("abort", () => {
        watcher.unref()
        controller.close()
      })
    }
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive"
    }
  })
}
