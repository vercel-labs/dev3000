import { existsSync, readFileSync, statSync, watch } from "fs"
import type { NextRequest } from "next/server"

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const logPath = searchParams.get("logPath") || process.env.LOG_FILE_PATH || "./ai-dev-tools/consolidated.log"

  if (!existsSync(logPath)) {
    return new Response("Log file not found", { status: 404 })
  }

  const encoder = new TextEncoder()
  let lastSize = 0
  let lastInode = 0

  const stream = new ReadableStream({
    start(controller) {
      // Send initial content
      try {
        const content = readFileSync(logPath, "utf-8")
        const stats = statSync(logPath)
        lastSize = content.length
        lastInode = stats.ino

        // Send initial content as string (parseLogEntries expects string, not array)
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ lines: content })}\n\n`))
      } catch (error) {
        console.error("Failed to read initial log:", error)
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: "Failed to read log" })}\n\n`))
      }

      // Watch for file changes using fs.watch (more efficient than watchFile)
      let watcher: ReturnType<typeof watch> | null = null

      try {
        watcher = watch(logPath, (eventType) => {
          // Handle both 'change' and 'rename' (rotation/truncation)
          try {
            const stats = statSync(logPath)
            const rotatedOrRecreated = stats.ino !== lastInode || eventType === "rename"
            if (rotatedOrRecreated) {
              // Log rotation detected - send full content of new file
              console.log("Log rotation detected, reloading full file")
              const content = readFileSync(logPath, "utf-8")
              lastSize = content.length
              lastInode = stats.ino

              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ rotated: true, lines: content })}\n\n`))
              return
            }

            // Normal file update - send only new content
            const content = readFileSync(logPath, "utf-8")
            if (content.length > lastSize) {
              const newContent = content.slice(lastSize)
              if (newContent.length > 0) {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ newLines: newContent })}\n\n`))
              }
              lastSize = content.length
            } else if (content.length < lastSize) {
              // File was truncated - reload full content
              console.log("Log file truncated, reloading")
              lastSize = content.length
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ truncated: true, lines: content })}\n\n`))
            }
          } catch (error) {
            console.error("Error reading log updates:", error)
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: "Failed to read log updates" })}\n\n`))
          }
        })

        // Send periodic heartbeat to keep connection alive
        const heartbeatInterval = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(": heartbeat\n\n"))
          } catch (_error) {
            // Connection closed, cleanup
            clearInterval(heartbeatInterval)
          }
        }, 30000) // Every 30 seconds

        // Cleanup on close
        request.signal.addEventListener("abort", () => {
          clearInterval(heartbeatInterval)
          if (watcher) {
            watcher.close()
            watcher = null
          }
          controller.close()
        })
      } catch (error) {
        console.error("Failed to setup file watcher:", error)
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: "Failed to setup file watcher" })}\n\n`))
        controller.close()
      }
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
