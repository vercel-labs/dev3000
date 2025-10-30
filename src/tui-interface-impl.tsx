import chalk from "chalk"
import { createReadStream, unwatchFile, watchFile } from "fs"
import { Box, render, Text, useInput, useStdout } from "ink"
import Spinner from "ink-spinner"
import { useEffect, useRef, useState } from "react"
import type { Readable } from "stream"
import { LOG_COLORS } from "./constants/log-colors.js"

export interface TUIOptions {
  appPort: string
  mcpPort: string
  logFile: string
  commandName: string
  serversOnly?: boolean
  version: string
  projectName?: string
}

interface LogEntry {
  id: number
  content: string
}

const NEXTJS_MCP_404_REGEX = /(?:\[POST\]|POST)\s+\/_next\/mcp\b[^\n]*\b404\b/i

// Compact ASCII logo for very small terminals
const COMPACT_LOGO = "d3k"

// Full ASCII logo lines as array for easier rendering
const FULL_LOGO = ["   ▐▌▄▄▄▄ █  ▄ ", "   ▐▌   █ █▄▀  ", "▗▞▀▜▌▀▀▀█ █ ▀▄ ", "▝▚▄▟▌▄▄▄█ █  █ "]

const TUIApp = ({
  appPort: initialAppPort,
  mcpPort,
  logFile,
  commandName,
  serversOnly,
  version,
  projectName,
  onStatusUpdate,
  onAppPortUpdate
}: TUIOptions & {
  onStatusUpdate: (fn: (status: string | null) => void) => void
  onAppPortUpdate: (fn: (port: string) => void) => void
}) => {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [scrollOffset, setScrollOffset] = useState(0)
  const [initStatus, setInitStatus] = useState<string | null>("Initializing...")
  const [appPort, setAppPort] = useState<string>(initialAppPort)
  const [portConfirmed, setPortConfirmed] = useState<boolean>(false)
  const logIdCounter = useRef(0)
  const [clearFromLogId, setClearFromLogId] = useState<number>(0) // Track log ID to clear from
  const { stdout } = useStdout()
  const ctrlCMessageDefault = "^L clear ^C quit"
  const [ctrlCMessage, setCtrlCMessage] = useState(ctrlCMessageDefault)
  const maxScrollOffsetRef = useRef(0)

  const [terminalSize, setTerminalSize] = useState(() => ({
    width: stdout?.columns || 80,
    height: stdout?.rows || 24
  }))

  useEffect(() => {
    if (!stdout) {
      return
    }

    const handleResize = () => {
      setTerminalSize({
        width: stdout.columns || 80,
        height: stdout.rows || 24
      })
    }

    stdout.on("resize", handleResize)

    return () => {
      if (typeof stdout.off === "function") {
        stdout.off("resize", handleResize)
      } else {
        stdout.removeListener("resize", handleResize)
      }
    }
  }, [stdout])

  // Get terminal dimensions with fallbacks
  const termWidth = terminalSize.width
  const termHeight = terminalSize.height

  // Determine if we should use compact mode
  const isCompact = termWidth < 80 || termHeight < 20
  const isVeryCompact = termWidth < 60 || termHeight < 15

  // Provide status update function to parent
  useEffect(() => {
    onStatusUpdate((status: string | null) => {
      // Check if this is the "Press Ctrl+C again" warning
      if (status?.includes("Press Ctrl+C again")) {
        // Update the bottom Ctrl+C message with warning emoji
        setCtrlCMessage("⚠️ ^C again to quit")
        // Clear the init status since we don't want it in the header anymore
        setInitStatus(null)
        // Reset after 3 seconds
        setTimeout(() => {
          setCtrlCMessage(ctrlCMessageDefault)
        }, 3000)
      } else {
        setInitStatus(status)
      }
    })
  }, [onStatusUpdate])

  // Provide app port update function to parent
  useEffect(() => {
    onAppPortUpdate((port: string) => {
      setAppPort(port)
      setPortConfirmed(true)
    })
  }, [onAppPortUpdate])

  // Calculate available lines for logs dynamically based on terminal height and mode
  const calculateMaxVisibleLogs = () => {
    if (isVeryCompact) {
      // In very compact mode, use most of the screen for logs, account for bottom status line
      return Math.max(3, termHeight - 8)
    } else if (isCompact) {
      // In compact mode, reduce header size, account for bottom status line
      return Math.max(3, termHeight - 10)
    } else {
      // Normal mode calculation - account for all UI elements
      const headerBorderLines = 2 // Top border (with title) + bottom border
      const headerContentLines = 5 // Logo is 4 lines tall, +1 for padding
      const logBoxBorderLines = 2 // Top and bottom border of log box
      const logBoxHeaderLines = 2 // "Logs (X total)" text (no blank line after)
      const logBoxFooterLines = scrollOffset > 0 ? 2 : 0 // "(X lines below)" when scrolled
      const bottomStatusLine = 1 // Log path and quit message
      const safetyBuffer = 1 // Small buffer to prevent header from being pushed up
      const totalReservedLines =
        headerBorderLines +
        headerContentLines +
        logBoxBorderLines +
        logBoxHeaderLines +
        logBoxFooterLines +
        bottomStatusLine +
        safetyBuffer
      return Math.max(3, termHeight - totalReservedLines)
    }
  }

  const maxLogs = 1000
  const maxVisibleLogs = calculateMaxVisibleLogs()
  const maxScrollOffset = Math.max(0, maxLogs - maxVisibleLogs)
  maxScrollOffsetRef.current = maxScrollOffset

  useEffect(() => {
    let logStream: Readable | undefined
    let buffer = ""

    const appendLog = (line: string) => {
      if (NEXTJS_MCP_404_REGEX.test(line)) {
        return
      }

      const newLog: LogEntry = {
        id: logIdCounter.current++,
        content: line
      }

      setLogs((prevLogs) => {
        const updated = [...prevLogs, newLog]
        // Keep only last N logs to prevent memory issues
        if (updated.length > maxLogs) {
          return updated.slice(-maxLogs)
        }
        return updated
      })

      // Auto-scroll to bottom only if user is already at the bottom
      // Otherwise, increment scroll offset by 1, accounting for the appended log and max scroll offset
      setScrollOffset((currentOffset) => {
        return currentOffset === 0 ? 0 : Math.min(maxScrollOffsetRef.current, currentOffset + 1)
      })
    }

    // Create a read stream for the log file
    logStream = createReadStream(logFile, {
      encoding: "utf8",
      start: 0
    })

    logStream.on("data", (chunk) => {
      buffer += chunk.toString()
      const lines = buffer.split("\n")

      // Keep the last incomplete line in buffer
      buffer = lines.pop() || ""

      // Add complete lines to logs
      for (const line of lines) {
        if (line.trim()) {
          appendLog(line)
        }
      }
    })

    logStream.on("error", (error) => {
      appendLog(chalk.red(`Error reading log file: ${error.message}`))
    })

    // Watch for new content
    watchFile(logFile, { interval: 100 }, (curr, prev) => {
      if (curr.size > prev.size) {
        // File has grown, read new content
        const stream = createReadStream(logFile, {
          encoding: "utf8",
          start: prev.size
        })

        let watchBuffer = ""
        stream.on("data", (chunk) => {
          watchBuffer += chunk.toString()
          const lines = watchBuffer.split("\n")
          watchBuffer = lines.pop() || ""

          for (const line of lines) {
            if (line.trim()) {
              appendLog(line)
            }
          }
        })
      }
    })

    // Cleanup
    return () => {
      if (logStream) {
        logStream.destroy()
      }
      unwatchFile(logFile)
    }
  }, [logFile])

  // Handle keyboard input
  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      // Send SIGINT to trigger main process shutdown handler
      process.kill(process.pid, "SIGINT")
    } else if (key.ctrl && input === "l") {
      // Ctrl-L: Clear logs box - set clear point to last log ID
      const lastLogId = logs.length > 0 ? logs[logs.length - 1].id : logIdCounter.current
      setClearFromLogId(lastLogId)
      setScrollOffset(0) // Reset scroll to bottom
    } else if (key.upArrow) {
      const filteredCount = logs.filter((log) => log.id > clearFromLogId).length
      setScrollOffset((prev) => Math.min(prev + 1, Math.max(0, filteredCount - maxVisibleLogs)))
    } else if (key.downArrow) {
      setScrollOffset((prev) => Math.max(0, prev - 1))
    } else if (key.pageUp) {
      const filteredCount = logs.filter((log) => log.id > clearFromLogId).length
      setScrollOffset((prev) => Math.min(prev + maxVisibleLogs, Math.max(0, filteredCount - maxVisibleLogs)))
    } else if (key.pageDown) {
      setScrollOffset((prev) => Math.max(0, prev - maxVisibleLogs))
    } else if (input === "G") {
      // Shift+G to go to end
      setScrollOffset(0)
    } else if (input === "g") {
      // g to go to beginning
      const filteredCount = logs.filter((log) => log.id > clearFromLogId).length
      setScrollOffset(Math.max(0, filteredCount - maxVisibleLogs))
    }
  })

  // Calculate visible logs - filter to only show logs after the clear point
  const filteredLogs = logs.filter((log) => log.id > clearFromLogId)
  const visibleLogs = filteredLogs.slice(
    Math.max(0, filteredLogs.length - maxVisibleLogs - scrollOffset),
    filteredLogs.length - scrollOffset
  )

  // Render compact header for small terminals
  const renderCompactHeader = () => (
    <Box borderStyle="single" borderColor="#A18CE5" paddingX={1} marginBottom={1}>
      <Box flexDirection="column" width="100%">
        <Box>
          <Text color="#A18CE5" bold>
            {COMPACT_LOGO}
          </Text>
          <Text> v{version} </Text>
          {initStatus && <Text dimColor>- {initStatus}</Text>}
        </Box>
        {!isVeryCompact && (
          <Box flexDirection="column">
            <Text dimColor>
              App: localhost:{appPort} | MCP: localhost:{mcpPort}
            </Text>
            <Text dimColor>
              📸 http://localhost:{mcpPort}/logs
              {projectName ? `?project=${encodeURIComponent(projectName)}` : ""}
            </Text>
          </Box>
        )}
      </Box>
    </Box>
  )

  // Render normal header
  const renderNormalHeader = () => {
    // Create custom top border with title embedded (like Claude Code)
    const title = ` ${commandName} v${version} ${initStatus ? `- ${initStatus} ` : ""}`
    const borderChar = "─"
    const leftPadding = 2
    // Account for border characters and padding
    const availableWidth = termWidth - 2 // -2 for corner characters
    const titleLength = title.length
    const rightBorderLength = Math.max(0, availableWidth - titleLength - leftPadding)
    const topBorderLine = `╭${borderChar.repeat(leftPadding)}${title}${borderChar.repeat(rightBorderLength)}╮`

    return (
      <Box flexDirection="column">
        {/* Custom top border with embedded title */}
        <Text color="#A18CE5">{topBorderLine}</Text>

        {/* Content with side borders only */}
        <Box borderStyle="round" borderColor="#A18CE5" borderTop={false} paddingX={1} paddingY={1}>
          <Box flexDirection="row" gap={1}>
            {/* ASCII Logo on the left */}
            {/* biome-ignore format: preserve ASCII art alignment */}
            <Box flexDirection="column" alignItems="flex-start">
              {FULL_LOGO.map((line) => (
                <Text key={line} color="#A18CE5" bold>
                  {line}
                </Text>
              ))}
            </Box>

            {/* Info on the right */}
            <Box flexDirection="column" flexGrow={1}>
              <Box>
                <Text color="cyan">🌐 App: http://localhost:{appPort} </Text>
                {!portConfirmed && <Spinner type="dots" />}
              </Box>
              <Text color="cyan">🤖 MCP: http://localhost:{mcpPort}</Text>
              <Text color="cyan">
                📸 Logs: http://localhost:{mcpPort}/logs
                {projectName ? `?project=${encodeURIComponent(projectName)}` : ""}
              </Text>
              {serversOnly && (
                <Text color="cyan">🖥️ Servers-only mode - use Chrome extension for browser monitoring</Text>
              )}
            </Box>
          </Box>
        </Box>
      </Box>
    )
  }

  return (
    <Box flexDirection="column" height="100%">
      {/* Header Box - responsive to terminal size */}
      {isCompact ? renderCompactHeader() : renderNormalHeader()}

      {/* Logs Box - flexGrow makes it expand to fill available height */}
      <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1} flexGrow={1} minHeight={0}>
        {!isVeryCompact && (
          <Text color="gray" dimColor>
            Logs ({filteredLogs.length} total{scrollOffset > 0 && `, scrolled up ${scrollOffset} lines`})
          </Text>
        )}

        {/* Logs content area - also uses flexGrow to expand */}
        <Box flexDirection="column" flexGrow={1}>
          {visibleLogs.length === 0 ? (
            <Text dimColor>Waiting for logs...</Text>
          ) : (
            visibleLogs.map((log) => {
              // Parse log line to colorize different parts
              const parts = log.content.match(/^\[(.*?)\] \[(.*?)\] (?:\[(.*?)\] )?(.*)$/)

              if (parts) {
                let [, timestamp, source, type, message] = parts

                // Extract HTTP method from SERVER logs as a secondary tag
                if (source === "SERVER" && !type && message) {
                  const methodMatch = message.match(/^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s/)
                  if (methodMatch) {
                    type = methodMatch[1]
                    message = message.slice(type.length + 1) // Remove method from message
                  }
                }

                // Replace warning emoji in ERROR/WARNING messages for consistent terminal rendering
                if (message && (type === "ERROR" || type === "WARNING")) {
                  message = message.replace(/⚠/g, "[!]")
                }

                // In very compact mode, simplify the output
                if (isVeryCompact) {
                  const shortSource = source === "BROWSER" ? "B" : "S"
                  const shortType = type ? type.split(".")[0].charAt(0) : ""
                  return (
                    <Text key={log.id} wrap="truncate-end">
                      <Text dimColor>[{shortSource}]</Text>
                      {shortType && <Text dimColor>[{shortType}]</Text>}
                      <Text> {message}</Text>
                    </Text>
                  )
                }

                // Use shared color constants
                const sourceColor = source === "BROWSER" ? LOG_COLORS.BROWSER : LOG_COLORS.SERVER
                const typeColors: Record<string, string> = {
                  NETWORK: LOG_COLORS.NETWORK,
                  ERROR: LOG_COLORS.ERROR,
                  WARNING: LOG_COLORS.WARNING,
                  INFO: LOG_COLORS.INFO,
                  LOG: LOG_COLORS.LOG,
                  DEBUG: LOG_COLORS.DEBUG,
                  SCREENSHOT: LOG_COLORS.SCREENSHOT,
                  DOM: LOG_COLORS.DOM,
                  CDP: LOG_COLORS.CDP,
                  CHROME: LOG_COLORS.CHROME,
                  CRASH: LOG_COLORS.CRASH,
                  REPLAY: LOG_COLORS.REPLAY,
                  NAVIGATION: LOG_COLORS.NAVIGATION,
                  INTERACTION: LOG_COLORS.INTERACTION,
                  GET: LOG_COLORS.SERVER,
                  POST: LOG_COLORS.SERVER,
                  PUT: LOG_COLORS.SERVER,
                  DELETE: LOG_COLORS.SERVER,
                  PATCH: LOG_COLORS.SERVER,
                  HEAD: LOG_COLORS.SERVER,
                  OPTIONS: LOG_COLORS.SERVER
                }

                // In compact mode, skip padding
                if (isCompact) {
                  return (
                    <Text key={log.id} wrap="truncate-end">
                      <Text dimColor>[{timestamp}]</Text>
                      <Text> </Text>
                      <Text color={sourceColor} bold>
                        [{source.charAt(0)}]
                      </Text>
                      {type && (
                        <>
                          <Text> </Text>
                          <Text color={typeColors[type] || "#A0A0A0"}>[{type}]</Text>
                        </>
                      )}
                      <Text> {message}</Text>
                    </Text>
                  )
                }

                // Normal mode with minimal padding
                // Single space after source
                const sourceSpacing = ""

                // Single space after type
                const typeSpacing = ""

                return (
                  <Text key={log.id} wrap="truncate-end">
                    <Text dimColor>[{timestamp}]</Text>
                    <Text> </Text>
                    <Text color={sourceColor} bold>
                      [{source}]
                    </Text>
                    {type ? (
                      <>
                        <Text>{sourceSpacing} </Text>
                        <Text color={typeColors[type] || "#A0A0A0"}>[{type}]</Text>
                        <Text>{typeSpacing} </Text>
                      </>
                    ) : (
                      <Text> </Text>
                    )}
                    <Text>{message}</Text>
                  </Text>
                )
              }

              // Fallback for unparsed lines
              return (
                <Text key={log.id} wrap="truncate-end">
                  {log.content}
                </Text>
              )
            })
          )}
        </Box>

        {/* Scroll indicator - only show when scrolled up and not in very compact mode */}
        {!isVeryCompact && logs.length > maxVisibleLogs && scrollOffset > 0 && (
          <Text dimColor>({scrollOffset} lines below)</Text>
        )}
      </Box>

      {/* Bottom status line - no border, just text */}
      <Box paddingX={1} justifyContent="space-between">
        <Text color="#A18CE5">
          ⏵⏵{" "}
          {isVeryCompact
            ? logFile.split("/").slice(-2, -1)[0] || "logs" // Just show directory name
            : logFile.replace(process.env.HOME || "", "~")}
        </Text>
        <Text color="#A18CE5">{ctrlCMessage}</Text>
      </Box>
    </Box>
  )
}

export async function runTUI(options: TUIOptions): Promise<{
  app: { unmount: () => void }
  updateStatus: (status: string | null) => void
  updateAppPort: (port: string) => void
}> {
  return new Promise((resolve, reject) => {
    try {
      let statusUpdater: ((status: string | null) => void) | null = null
      let appPortUpdater: ((port: string) => void) | null = null

      const app = render(
        <TUIApp
          {...options}
          onStatusUpdate={(fn) => {
            statusUpdater = fn
          }}
          onAppPortUpdate={(fn) => {
            appPortUpdater = fn
          }}
        />,
        { exitOnCtrlC: false }
      )

      // Give React time to set up the updaters
      setTimeout(() => {
        resolve({
          app,
          updateStatus: (status: string | null) => {
            if (statusUpdater) {
              statusUpdater(status)
            }
          },
          updateAppPort: (port: string) => {
            if (appPortUpdater) {
              appPortUpdater(port)
            }
          }
        })
      }, 100)
    } catch (error) {
      console.error("Error in runTUI render:", error)
      reject(error)
    }
  })
}
