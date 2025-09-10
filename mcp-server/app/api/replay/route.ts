import { existsSync, readFileSync } from "fs"
import { type NextRequest, NextResponse } from "next/server"

interface InteractionEvent {
  timestamp: string
  type: "CLICK" | "TAP" | "SCROLL" | "KEY"
  x?: number
  y?: number
  target?: string
  direction?: string
  distance?: number
  key?: string
  url?: string
}

interface NavigationEvent {
  timestamp: string
  url: string
}

interface ScreenshotEvent {
  timestamp: string
  url: string
  event: string
}

interface ReplayData {
  interactions: InteractionEvent[]
  navigations: NavigationEvent[]
  screenshots: ScreenshotEvent[]
  startTime: string
  endTime: string
  duration: number
}

function parseLogFile(logContent: string, startTime?: string, endTime?: string): ReplayData {
  const lines = logContent.split("\n")
  const interactions: InteractionEvent[] = []
  const navigations: NavigationEvent[] = []
  const screenshots: ScreenshotEvent[] = []

  let actualStartTime = ""
  let actualEndTime = ""

  for (const line of lines) {
    if (!line.trim()) continue

    const timestampMatch = line.match(/^\[([^\]]+)\]/)
    if (!timestampMatch) continue

    const timestamp = timestampMatch[1]
    const logTime = new Date(timestamp)

    // Filter by time range if specified
    if (startTime && logTime < new Date(startTime)) continue
    if (endTime && logTime > new Date(endTime)) continue

    if (!actualStartTime) actualStartTime = timestamp
    actualEndTime = timestamp

    // Parse interaction events (both old and new formats)
    const interactionMatch = line.match(/\[INTERACTION\] (.+)/)
    if (interactionMatch) {
      const data = interactionMatch[1]

      try {
        // Try parsing as JSON (new format)
        const interactionData = JSON.parse(data)

        if (interactionData.type === "CLICK" || interactionData.type === "TAP") {
          interactions.push({
            timestamp,
            type: interactionData.type as "CLICK" | "TAP",
            x: interactionData.coordinates?.x || 0,
            y: interactionData.coordinates?.y || 0,
            target: interactionData.target || "unknown"
          })
        } else if (interactionData.type === "SCROLL") {
          interactions.push({
            timestamp,
            type: "SCROLL",
            direction: interactionData.direction || "DOWN",
            distance: interactionData.distance || 0,
            x: interactionData.to?.x || 0,
            y: interactionData.to?.y || 0
          })
        } else if (interactionData.type === "KEY") {
          interactions.push({
            timestamp,
            type: "KEY",
            key: interactionData.key || "unknown",
            target: interactionData.target || "unknown"
          })
        }
      } catch (_jsonError) {
        // Fallback to old format parsing
        const oldFormatMatch = data.match(/(CLICK|TAP|SCROLL|KEY) (.+)/)
        if (oldFormatMatch) {
          const [, type, details] = oldFormatMatch

          if (type === "CLICK" || type === "TAP") {
            // Match both old and new CLICK formats:
            // Old: "at (286, 303) on target"
            // New: "at 286,303 on {"selector":"...","tag":"..."}"
            const coordMatch = details.match(/at (?:\((\d+),\s*(\d+)\)|(\d+),(\d+)) on (.+)/)
            if (coordMatch) {
              const x = parseInt(coordMatch[1] || coordMatch[3], 10)
              const y = parseInt(coordMatch[2] || coordMatch[4], 10)
              const targetData = coordMatch[5]

              // Try to parse target as JSON, fallback to string
              let target = targetData
              try {
                const parsedTarget = JSON.parse(targetData)
                target = parsedTarget.selector || parsedTarget.tag || targetData
              } catch {
                // Use as string if not JSON
              }

              interactions.push({
                timestamp,
                type: type as "CLICK" | "TAP",
                x,
                y,
                target
              })
            }
          } else if (type === "SCROLL") {
            // Match new SCROLL format: "from 0,599.5 to 0,0 in document"
            const scrollMatch = details.match(/from ([\d.]+),([\d.]+) to ([\d.]+),([\d.]+) in (.+)/)
            if (scrollMatch) {
              const _fromX = parseFloat(scrollMatch[1])
              const fromY = parseFloat(scrollMatch[2])
              const toX = parseFloat(scrollMatch[3])
              const toY = parseFloat(scrollMatch[4])
              const target = scrollMatch[5]

              interactions.push({
                timestamp,
                type: "SCROLL",
                x: toX,
                y: toY,
                direction: toY > fromY ? "DOWN" : "UP",
                distance: Math.abs(toY - fromY),
                target
              })
            }
          } else if (type === "KEY") {
            const keyMatch = details.match(/(.+) in (.+)/)
            if (keyMatch) {
              interactions.push({
                timestamp,
                type: "KEY",
                key: keyMatch[1],
                target: keyMatch[2]
              })
            }
          }
        }
      }
    }

    // Parse navigation events
    const navigationMatch = line.match(/\[NAVIGATION\] (.+)/)
    if (navigationMatch) {
      navigations.push({
        timestamp,
        url: navigationMatch[1]
      })
    }

    // Parse screenshot events
    const screenshotMatch = line.match(/\[SCREENSHOT\] (.+)/)
    if (screenshotMatch) {
      const urlParts = screenshotMatch[1].split("/")
      const filename = urlParts[urlParts.length - 1]
      const eventType = filename.split("-").slice(3).join("-").replace(".png", "")

      screenshots.push({
        timestamp,
        url: screenshotMatch[1],
        event: eventType
      })
    }
  }

  const startTimeMs = new Date(actualStartTime).getTime()
  const endTimeMs = new Date(actualEndTime).getTime()
  const duration = endTimeMs - startTimeMs

  return {
    interactions,
    navigations,
    screenshots,
    startTime: actualStartTime,
    endTime: actualEndTime,
    duration
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const action = searchParams.get("action")
    const startTime = searchParams.get("startTime")
    const endTime = searchParams.get("endTime")

    // Get log file path from environment
    const logFilePath = process.env.LOG_FILE_PATH || "/tmp/dev3000.log"

    if (!existsSync(logFilePath)) {
      return NextResponse.json({ error: "Log file not found" }, { status: 404 })
    }

    const logContent = readFileSync(logFilePath, "utf8")

    if (action === "parse") {
      // Parse the log file and return replay data
      const replayData = parseLogFile(logContent, startTime || undefined, endTime || undefined)
      return NextResponse.json(replayData)
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 })
  } catch (error) {
    console.error("Replay API error:", error)
    return NextResponse.json({ error: "Failed to process replay request" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { action, replayData, speed = 1 } = body

    if (action === "execute") {
      // Execute replay via MCP server's execute_browser_action tool
      try {
        const result = await executeBrowserActions(replayData, speed)
        return NextResponse.json({
          success: true,
          message: "Replay executed successfully via MCP server",
          result: result,
          totalEvents: result.totalEvents,
          executedEvents: result.executed
        })
      } catch (error) {
        return NextResponse.json({
          success: false,
          message: "MCP server execution failed",
          error: error instanceof Error ? error.message : "Unknown error"
        })
      }
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 })
  } catch (error) {
    console.error("Replay execution error:", error)
    return NextResponse.json({ error: "Failed to execute replay" }, { status: 500 })
  }
}

async function executeBrowserActions(
  replayData: ReplayData,
  speed: number
): Promise<{
  executed: number
  results: Array<{ event?: any; result?: any; error?: string; description: string }>
  totalEvents: number
}> {
  try {
    // Get MCP server URL from environment (defaults to local MCP server)
    const mcpServerUrl = process.env.MCP_SERVER_URL || "http://localhost:3684"

    const events = [
      ...replayData.interactions.map((i) => ({ ...i, eventType: "interaction" })),
      ...replayData.navigations.map((n) => ({ ...n, eventType: "navigation" }))
    ].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())

    const results: Array<{ event?: any; result?: any; error?: string; description: string }> = []
    const startTime = new Date(replayData.startTime).getTime()

    // Execute events sequentially with proper timing
    for (let i = 0; i < events.length; i++) {
      const event = events[i]
      const eventTime = new Date(event.timestamp).getTime()
      const delay = Math.max(0, (eventTime - startTime) / speed)

      // Wait for the calculated delay
      if (delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay))
      }

      try {
        let response: Response | undefined

        if (event.eventType === "navigation") {
          // Navigate to URL
          response = await fetch(`${mcpServerUrl}/mcp`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              jsonrpc: "2.0",
              id: i + 1,
              method: "tools/call",
              params: {
                name: "execute_browser_action",
                arguments: {
                  action: "navigate",
                  url: event.url
                }
              }
            })
          })
        } else if (event.eventType === "interaction") {
          if ("type" in event && event.type === "CLICK" && event.x !== undefined && event.y !== undefined) {
            // Click action
            response = await fetch(`${mcpServerUrl}/mcp`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                jsonrpc: "2.0",
                id: i + 1,
                method: "tools/call",
                params: {
                  name: "execute_browser_action",
                  arguments: {
                    action: "click",
                    x: event.x,
                    y: event.y
                  }
                }
              })
            })
          } else if ("type" in event && event.type === "SCROLL" && event.x !== undefined && event.y !== undefined) {
            // Scroll action
            response = await fetch(`${mcpServerUrl}/mcp`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                jsonrpc: "2.0",
                id: i + 1,
                method: "tools/call",
                params: {
                  name: "execute_browser_action",
                  arguments: {
                    action: "scroll",
                    x: 0,
                    y: 0,
                    deltaX: event.x,
                    deltaY: event.y
                  }
                }
              })
            })
          } else if ("type" in event && event.type === "KEY" && event.key) {
            // Type action
            response = await fetch(`${mcpServerUrl}/mcp`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                jsonrpc: "2.0",
                id: i + 1,
                method: "tools/call",
                params: {
                  name: "execute_browser_action",
                  arguments: {
                    action: "type",
                    text: event.key
                  }
                }
              })
            })
          }
        }

        if (response) {
          const result = await response.json()
          results.push({
            event,
            result,
            description: `${event.eventType}: ${event.eventType === "navigation" ? event.url : "type" in event ? event.type : "unknown"}`
          })
        }
      } catch (error) {
        results.push({
          event,
          error: error instanceof Error ? error.message : "Unknown error",
          description: `Failed: ${event.eventType}`
        })
      }
    }

    return {
      executed: results.length,
      results,
      totalEvents: events.length
    }
  } catch (error) {
    throw new Error(`Failed to execute replay via MCP server: ${error}`)
  }
}
