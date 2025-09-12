import { existsSync, readFileSync } from "fs"
import { createMcpHandler } from "mcp-handler"
import { WebSocket } from "ws"
import { z } from "zod"

const handler = createMcpHandler(
  (server) => {
    // Get current timestamp for workflow tracking
    server.tool(
      "get_current_timestamp",
      "Get the current timestamp in ISO format - use this to mark points in time before/after user testing. WORKFLOW: Always capture timestamp before asking user to test changes, then capture again after they return, then use get_logs_between_timestamps to analyze what happened during testing.",
      {},
      async () => {
        const timestamp = new Date().toISOString()
        return {
          content: [
            {
              type: "text",
              text: `Current timestamp: ${timestamp}`
            }
          ]
        }
      }
    )

    // Healthcheck tool
    server.tool(
      "healthcheck",
      "Internal healthcheck tool - rarely needed since MCP connection is already working if you can see this. Only use if explicitly asked to verify server health. Prefer read_consolidated_logs for debugging.",
      {
        message: z.string().optional().describe("Optional message to echo back")
      },
      async ({ message = "MCP server is healthy!" }) => {
        return {
          content: [
            {
              type: "text",
              text: `✅ ${message} - Timestamp: ${new Date().toISOString()}`
            }
          ]
        }
      }
    )

    // Tool to read consolidated logs
    server.tool(
      "read_consolidated_logs",
      "Read recent consolidated development logs containing server output, browser console logs, network requests, user interactions, and screenshots. INSIGHTS: Use this for general log overview, recent error checking, or when you need to understand current application state. Logs include [PLAYWRIGHT] or [CHROME_EXTENSION] tags to distinguish monitoring sources. Filter by keywords like 'ERROR', 'NETWORK', 'INTERACTION', or 'SCREENSHOT' for focused analysis. Combine with search_logs for pattern-based analysis.",
      {
        lines: z.number().optional().describe("Number of recent lines to read (default: 50)"),
        filter: z.string().optional().describe("Filter logs by text content"),
        logPath: z.string().optional().describe("Path to log file (default: ./ai-dev-tools/consolidated.log)")
      },
      async ({ lines = 50, filter, logPath = process.env.LOG_FILE_PATH || "./ai-dev-tools/consolidated.log" }) => {
        try {
          if (!existsSync(logPath)) {
            return {
              content: [
                {
                  type: "text",
                  text: `No log file found at ${logPath}. Make sure the dev environment is running.`
                }
              ]
            }
          }

          const logContent = readFileSync(logPath, "utf-8")
          let logLines = logContent.split("\n").filter((line) => line.trim())

          // Apply filter if provided
          if (filter) {
            logLines = logLines.filter((line) => line.toLowerCase().includes(filter.toLowerCase()))
          }

          // Get recent lines
          const recentLines = logLines.slice(-lines)

          return {
            content: [
              {
                type: "text",
                text: recentLines.length > 0 ? recentLines.join("\n") : "No matching log entries found."
              }
            ]
          }
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Error reading logs: ${error instanceof Error ? error.message : String(error)}`
              }
            ]
          }
        }
      }
    )

    // Tool to search logs
    server.tool(
      "search_logs",
      "Search through consolidated logs using regex patterns with context lines around matches. POWERFUL DEBUGGING: Essential for tracing error patterns, finding specific API calls, or tracking user interaction sequences. Use patterns like 'ERROR.*fetch', 'CLICK.*button', or 'NETWORK.*POST' to find relevant events. Context lines help understand what led to and followed each match. Great for correlating server errors with user actions.",
      {
        pattern: z.string().describe("Regex pattern to search for"),
        context: z.number().optional().describe("Number of lines of context around matches (default: 2)"),
        logPath: z.string().optional().describe("Path to log file (default: ./ai-dev-tools/consolidated.log)")
      },
      async ({ pattern, context = 2, logPath = process.env.LOG_FILE_PATH || "./ai-dev-tools/consolidated.log" }) => {
        try {
          if (!existsSync(logPath)) {
            return {
              content: [
                {
                  type: "text",
                  text: `No log file found at ${logPath}.`
                }
              ]
            }
          }

          const logContent = readFileSync(logPath, "utf-8")
          const logLines = logContent.split("\n")

          const regex = new RegExp(pattern, "gi")
          const matches: string[] = []

          logLines.forEach((line, index) => {
            if (regex.test(line)) {
              const start = Math.max(0, index - context)
              const end = Math.min(logLines.length, index + context + 1)
              const contextLines = logLines.slice(start, end)

              matches.push(`Match at line ${index + 1}:\n${contextLines.join("\n")}\n---`)
            }
          })

          return {
            content: [
              {
                type: "text",
                text: matches.length > 0 ? matches.join("\n\n") : "No matches found for the given pattern."
              }
            ]
          }
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Error searching logs: ${error instanceof Error ? error.message : String(error)}`
              }
            ]
          }
        }
      }
    )

    // Tool to get logs between timestamps
    server.tool(
      "get_logs_between_timestamps",
      "Get logs between two specific timestamps - CRITICAL for timestamp-based debugging workflow. WORKFLOW: (1) Use get_current_timestamp before user testing, (2) Ask user to reproduce issue/test changes, (3) Use get_current_timestamp after user returns, (4) Use this tool with both timestamps to see exactly what happened during testing. This eliminates noise and focuses analysis on the specific user session. Essential for correlating user actions with server/browser events.",
      {
        startTime: z.string().describe("Start timestamp (ISO 8601 format: 2024-01-01T12:00:00.000Z)"),
        endTime: z.string().describe("End timestamp (ISO 8601 format: 2024-01-01T12:30:00.000Z)"),
        filter: z.string().optional().describe("Filter logs by text content (case insensitive)"),
        logPath: z.string().optional().describe("Path to log file (default: ./ai-dev-tools/consolidated.log)")
      },
      async ({
        startTime,
        endTime,
        filter,
        logPath = process.env.LOG_FILE_PATH || "./ai-dev-tools/consolidated.log"
      }) => {
        try {
          if (!existsSync(logPath)) {
            return {
              content: [
                {
                  type: "text",
                  text: `No log file found at ${logPath}.`
                }
              ]
            }
          }

          const start = new Date(startTime)
          const end = new Date(endTime)

          if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
            return {
              content: [
                {
                  type: "text",
                  text: "Invalid timestamp format. Use ISO 8601 format: 2024-01-01T12:00:00.000Z"
                }
              ]
            }
          }

          if (start >= end) {
            return {
              content: [
                {
                  type: "text",
                  text: "Start time must be before end time."
                }
              ]
            }
          }

          const logContent = readFileSync(logPath, "utf-8")
          const logLines = logContent.split("\n").filter((line) => line.trim())

          // Filter by timestamp range
          const filteredLines = logLines.filter((line) => {
            const timestampMatch = line.match(/\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\]/)
            if (timestampMatch) {
              const logTime = new Date(timestampMatch[1])
              return logTime >= start && logTime <= end
            }
            return false // Exclude lines without parseable timestamps
          })

          // Apply text filter if provided
          let resultLines = filteredLines
          if (filter) {
            resultLines = filteredLines.filter((line) => line.toLowerCase().includes(filter.toLowerCase()))
          }

          const timeRange = `${start.toISOString()} to ${end.toISOString()}`
          const summary = `Found ${
            resultLines.length
          } logs between ${timeRange}${filter ? ` matching "${filter}"` : ""}`

          return {
            content: [
              {
                type: "text",
                text: resultLines.length > 0 ? `${summary}:\n\n${resultLines.join("\n")}` : `${summary}.`
              }
            ]
          }
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Error reading logs between timestamps: ${error instanceof Error ? error.message : String(error)}`
              }
            ]
          }
        }
      }
    )

    // Tool to get browser errors
    server.tool(
      "get_browser_errors",
      "Get recent browser errors including console errors, JavaScript exceptions, and page errors from both Playwright and Chrome extension monitoring. DEBUGGING FOCUS: Start here when user reports issues like 'page not working', broken functionality, or visual problems. Filters logs to show only ERROR, CONSOLE ERROR, and PAGE ERROR entries. Use this before search_logs to identify specific error patterns to investigate further. Time-based filtering helps focus on recent issues.",
      {
        hours: z.number().optional().describe("Hours to look back (default: 1)"),
        logPath: z.string().optional().describe("Path to log file (default: ./ai-dev-tools/consolidated.log)")
      },
      async ({ hours = 1, logPath = process.env.LOG_FILE_PATH || "./ai-dev-tools/consolidated.log" }) => {
        try {
          if (!existsSync(logPath)) {
            return {
              content: [
                {
                  type: "text",
                  text: `No log file found at ${logPath}.`
                }
              ]
            }
          }

          const logContent = readFileSync(logPath, "utf-8")
          const logLines = logContent.split("\n")

          const cutoffTime = new Date(Date.now() - hours * 60 * 60 * 1000)
          const errorLines = logLines.filter((line) => {
            if (!line.includes("[BROWSER]")) return false
            if (!(line.includes("ERROR") || line.includes("CONSOLE ERROR") || line.includes("PAGE ERROR"))) return false

            // Extract timestamp
            const timestampMatch = line.match(/\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\]/)
            if (timestampMatch) {
              const logTime = new Date(timestampMatch[1])
              return logTime > cutoffTime
            }
            return true // Include if we can't parse timestamp
          })

          return {
            content: [
              {
                type: "text",
                text:
                  errorLines.length > 0
                    ? errorLines.join("\n")
                    : "No browser errors found in the specified time period."
              }
            ]
          }
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Error getting browser errors: ${error instanceof Error ? error.message : String(error)}`
              }
            ]
          }
        }
      }
    )

    // Tool to execute browser actions via CDP
    server.tool(
      "execute_browser_action",
      "Execute safe browser actions via Chrome DevTools Protocol for testing and interaction automation. TESTING CAPABILITIES: Click elements, navigate pages, take screenshots, evaluate JavaScript expressions, scroll, and type text. SAFETY: Only whitelisted JavaScript expressions allowed, URLs restricted to http/https. Use for reproducing user interactions, testing fixes, or capturing current page state. Screenshots and actions are logged automatically for debugging context.",
      {
        action: z.enum(["click", "navigate", "screenshot", "evaluate", "scroll", "type"]).describe("Action to perform"),
        params: z
          .object({
            x: z.number().optional().describe("X coordinate for click/scroll"),
            y: z.number().optional().describe("Y coordinate for click/scroll"),
            url: z.string().optional().describe("URL for navigation"),
            selector: z.string().optional().describe("CSS selector for element targeting"),
            text: z.string().optional().describe("Text to type"),
            expression: z.string().optional().describe("JavaScript expression to evaluate (safe expressions only)"),
            deltaX: z.number().optional().describe("Horizontal scroll amount"),
            deltaY: z.number().optional().describe("Vertical scroll amount")
          })
          .describe("Parameters for the action")
      },
      async ({ action, params }) => {
        try {
          // Connect to CDP on port 9222
          const targetsResponse = await fetch("http://localhost:9222/json")
          const targets = await targetsResponse.json()

          const pageTarget = targets.find(
            (target: { type: string; webSocketDebuggerUrl: string }) => target.type === "page"
          )
          if (!pageTarget) {
            throw new Error("No browser tab found. Make sure dev3000 is running with CDP monitoring.")
          }

          const wsUrl = pageTarget.webSocketDebuggerUrl

          const result = await new Promise((resolve, reject) => {
            // WebSocket imported at top of file
            const ws = new WebSocket(wsUrl)
            let messageId = 1

            ws.on("open", async () => {
              try {
                let cdpResult: Record<string, unknown>

                switch (action) {
                  case "click":
                    if (!params.x || !params.y) {
                      throw new Error("Click action requires x and y coordinates")
                    }
                    // Send mouse down and up events
                    await sendCDPCommand(ws, messageId++, "Input.dispatchMouseEvent", {
                      type: "mousePressed",
                      x: params.x,
                      y: params.y,
                      button: "left",
                      clickCount: 1
                    })
                    await sendCDPCommand(ws, messageId++, "Input.dispatchMouseEvent", {
                      type: "mouseReleased",
                      x: params.x,
                      y: params.y,
                      button: "left",
                      clickCount: 1
                    })
                    cdpResult = {
                      action: "click",
                      coordinates: { x: params.x, y: params.y }
                    }
                    break

                  case "navigate":
                    if (!params.url) {
                      throw new Error("Navigate action requires url parameter")
                    }
                    // Basic URL validation
                    if (!params.url.startsWith("http://") && !params.url.startsWith("https://")) {
                      throw new Error("Only http:// and https:// URLs are allowed")
                    }
                    cdpResult = await sendCDPCommand(ws, messageId++, "Page.navigate", { url: params.url })
                    break

                  case "screenshot":
                    cdpResult = await sendCDPCommand(ws, messageId++, "Page.captureScreenshot", {
                      format: "png",
                      quality: 80
                    })
                    break

                  case "evaluate": {
                    if (!params.expression) {
                      throw new Error("Evaluate action requires expression parameter")
                    }
                    // Whitelist safe expressions only
                    const safeExpressions = [
                      /^document\.title$/,
                      /^window\.location\.href$/,
                      /^document\.querySelector\(['"][^'"]*['"]\)\.textContent$/,
                      /^document\.body\.scrollHeight$/,
                      /^window\.scrollY$/,
                      /^window\.scrollX$/
                    ]

                    if (!params.expression) {
                      throw new Error("Evaluate action requires expression parameter")
                    }

                    if (!safeExpressions.some((regex) => regex.test(params.expression as string))) {
                      throw new Error("Expression not in whitelist. Only safe read-only expressions allowed.")
                    }

                    cdpResult = await sendCDPCommand(ws, messageId++, "Runtime.evaluate", {
                      expression: params.expression,
                      returnByValue: true
                    })
                    break
                  }

                  case "scroll": {
                    const scrollX = params.deltaX || 0
                    const scrollY = params.deltaY || 0
                    cdpResult = await sendCDPCommand(ws, messageId++, "Input.dispatchMouseEvent", {
                      type: "mouseWheel",
                      x: params.x || 500,
                      y: params.y || 500,
                      deltaX: scrollX,
                      deltaY: scrollY
                    })
                    break
                  }

                  case "type":
                    if (!params.text) {
                      throw new Error("Type action requires text parameter")
                    }
                    // Type each character
                    for (const char of params.text) {
                      await sendCDPCommand(ws, messageId++, "Input.dispatchKeyEvent", {
                        type: "char",
                        text: char
                      })
                    }
                    cdpResult = { action: "type", text: params.text }
                    break

                  default:
                    throw new Error(`Unsupported action: ${action}`)
                }

                ws.close()
                resolve(cdpResult)
              } catch (error) {
                ws.close()
                reject(error)
              }
            })

            ws.on("error", reject)

            // Helper function to send CDP commands
            async function sendCDPCommand(
              ws: WebSocket,
              id: number,
              method: string,
              params: Record<string, unknown>
            ): Promise<Record<string, unknown>> {
              return new Promise((cmdResolve, cmdReject) => {
                const command = { id, method, params }

                const messageHandler = (data: Buffer) => {
                  const message = JSON.parse(data.toString())
                  if (message.id === id) {
                    ws.removeListener("message", messageHandler)
                    if (message.error) {
                      cmdReject(new Error(message.error.message))
                    } else {
                      cmdResolve(message.result)
                    }
                  }
                }

                ws.on("message", messageHandler)
                ws.send(JSON.stringify(command))

                // Command timeout
                setTimeout(() => {
                  ws.removeListener("message", messageHandler)
                  cmdReject(new Error(`CDP command timeout: ${method}`))
                }, 5000)
              })
            }
          })

          return {
            content: [
              {
                type: "text",
                text: `Browser action '${action}' executed successfully. Result: ${JSON.stringify(result, null, 2)}`
              }
            ]
          }
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Browser action failed: ${error instanceof Error ? error.message : String(error)}`
              }
            ]
          }
        }
      }
    )
  },
  {
    // dev3000 MCP Server - Advanced development debugging tools
    // Provides AI tools with comprehensive access to real-time development logs,
    // browser monitoring data, and timestamp-based debugging workflows
  },
  {
    basePath: "/api/mcp",
    maxDuration: 60,
    verboseLogs: true
  }
)

export { handler as GET, handler as POST }
