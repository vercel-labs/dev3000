import chalk from "chalk"
import { createReadStream, unwatchFile, watchFile } from "fs"
import { Box, render, Text, useApp, useInput, useStdout } from "ink"
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
}

interface LogEntry {
  id: number
  content: string
}

const TUIApp = ({
  appPort,
  mcpPort,
  logFile,
  commandName,
  serversOnly,
  version,
  onShutdown,
  onStatusUpdate
}: TUIOptions & { onShutdown: () => void; onStatusUpdate: (fn: (status: string | null) => void) => void }) => {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [scrollOffset, setScrollOffset] = useState(0)
  const [initStatus, setInitStatus] = useState<string | null>("Initializing...")
  const logIdCounter = useRef(0)
  const { exit } = useApp()
  const { stdout } = useStdout()

  // Provide status update function to parent
  useEffect(() => {
    onStatusUpdate(setInitStatus)
  }, [onStatusUpdate])

  // Calculate available lines for logs dynamically based on terminal height
  // Header box content: 4 (logo height) + 1 (margin) + 1 (controls) = 6 lines
  // Plus: 2 (top/bottom borders) + 2 (padding) + 1 (margin bottom) = 5 lines
  // Total header: 11 lines
  // Log box header: 1 (border) + 1 (title) + 1 (empty) = 3 lines
  // Log box footer: 1 (border) + 2 (scroll indicator if present) = 1-3 lines
  const headerLines = 12
  const logBoxHeaderLines = 3
  const logBoxFooterLines = scrollOffset > 0 ? 3 : 1
  const safetyBuffer = 1 // Extra line to ensure we don't overflow
  const totalReservedLines = headerLines + logBoxHeaderLines + logBoxFooterLines + safetyBuffer
  const maxVisibleLogs = Math.max(3, (stdout?.rows || 24) - totalReservedLines)

  useEffect(() => {
    let logStream: Readable | undefined
    let buffer = ""

    const appendLog = (line: string) => {
      const newLog: LogEntry = {
        id: logIdCounter.current++,
        content: line
      }

      setLogs((prevLogs) => {
        const updated = [...prevLogs, newLog]
        // Keep only last 1000 logs to prevent memory issues
        if (updated.length > 1000) {
          return updated.slice(-1000)
        }
        return updated
      })

      // Auto-scroll to bottom
      setScrollOffset(0)
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
    if (input === "q" || (key.ctrl && input === "c")) {
      onShutdown()
      exit()
    } else if (key.upArrow) {
      setScrollOffset((prev) => Math.min(prev + 1, Math.max(0, logs.length - maxVisibleLogs)))
    } else if (key.downArrow) {
      setScrollOffset((prev) => Math.max(0, prev - 1))
    } else if (key.pageUp) {
      setScrollOffset((prev) => Math.min(prev + maxVisibleLogs, Math.max(0, logs.length - maxVisibleLogs)))
    } else if (key.pageDown) {
      setScrollOffset((prev) => Math.max(0, prev - maxVisibleLogs))
    } else if (input === "g" && key.shift) {
      // Shift+G to go to end
      setScrollOffset(0)
    } else if (input === "g" && !key.shift) {
      // g to go to beginning
      setScrollOffset(Math.max(0, logs.length - maxVisibleLogs))
    }
  })

  // Calculate visible logs
  const visibleLogs = logs.slice(Math.max(0, logs.length - maxVisibleLogs - scrollOffset), logs.length - scrollOffset)

  return (
    <Box flexDirection="column" height="100%">
      {/* Header Box */}
      <Box borderStyle="round" borderColor="#A18CE5" paddingX={2} paddingY={1} marginBottom={1} flexDirection="column">
        <Box flexDirection="row" gap={3}>
          {/* ASCII Logo on the left */}
          {/* biome-ignore format: preserve ASCII art alignment */}
          <Box flexDirection="column" alignItems="flex-start">
            <Text color="#A18CE5" bold>   ▐▌▄▄▄▄ █  ▄ </Text>
            <Text color="#A18CE5" bold>   ▐▌   █ █▄▀  </Text>
            <Text color="#A18CE5" bold>▗▞▀▜▌▀▀▀█ █ ▀▄ </Text>
            <Text color="#A18CE5" bold>▝▚▄▟▌▄▄▄█ █  █ </Text>
          </Box>

          {/* Info on the right */}
          <Box flexDirection="column" flexGrow={1}>
            <Text color="#A18CE5" bold>
              {commandName} v{version} {initStatus ? `- ${initStatus}` : "is running!"}
            </Text>
            <Text> </Text>
            <Text color="cyan">🌐 Your App: http://localhost:{appPort}</Text>
            <Text color="cyan">🤖 MCP Server: http://localhost:{mcpPort}/mcp</Text>
            <Text color="cyan">📸 Visual Timeline: http://localhost:{mcpPort}/logs</Text>
            {serversOnly && <Text color="cyan">🖥️ Servers-only mode - use Chrome extension for browser monitoring</Text>}
          </Box>
        </Box>

        {/* Controls at the bottom of header box */}
        <Box marginTop={1}>
          <Text dimColor>💡 Controls: ↑/↓ scroll | PgUp/PgDn page | g/G start/end | Ctrl-C quit</Text>
        </Box>
      </Box>

      {/* Logs Box - flexGrow makes it expand to fill available height */}
      <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1} flexGrow={1} minHeight={0}>
        <Text color="gray" dimColor>
          Logs ({logs.length} total{scrollOffset > 0 && `, scrolled up ${scrollOffset} lines`})
        </Text>
        <Text> </Text>

        {/* Logs content area - also uses flexGrow to expand */}
        <Box flexDirection="column" flexGrow={1}>
          {visibleLogs.length === 0 ? (
            <Text dimColor>Waiting for logs...</Text>
          ) : (
            visibleLogs.map((log) => {
              // Parse log line to colorize different parts
              const parts = log.content.match(/^\[(.*?)\] \[(.*?)\] (?:\[(.*?)\] )?(.*)$/)

              if (parts) {
                const [, timestamp, source, type, message] = parts

                // Use shared color constants
                const sourceColor = source === "BROWSER" ? LOG_COLORS.BROWSER : LOG_COLORS.SERVER
                const typeColors: Record<string, string> = {
                  "NETWORK RESPONSE": LOG_COLORS.NETWORK,
                  "CONSOLE ERROR": LOG_COLORS.CONSOLE_ERROR,
                  "CONSOLE WARN": LOG_COLORS.CONSOLE_WARN,
                  "CONSOLE INFO": LOG_COLORS.CONSOLE_INFO,
                  "CONSOLE LOG": LOG_COLORS.CONSOLE_LOG,
                  "CONSOLE DEBUG": LOG_COLORS.CONSOLE_DEBUG,
                  SCREENSHOT: LOG_COLORS.SCREENSHOT,
                  PAGE: LOG_COLORS.PAGE,
                  DOM: LOG_COLORS.DOM,
                  CDP: LOG_COLORS.CDP,
                  ERROR: LOG_COLORS.ERROR,
                  "CRITICAL ERROR": LOG_COLORS.CRITICAL_ERROR
                }

                return (
                  <Text key={log.id} wrap="truncate-end">
                    <Text dimColor>[{timestamp}]</Text>
                    <Text> </Text>
                    <Text color={sourceColor} bold>
                      [{source}]
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

              // Fallback for unparsed lines
              return (
                <Text key={log.id} wrap="truncate-end">
                  {log.content}
                </Text>
              )
            })
          )}
        </Box>

        {/* Scroll indicator - only show when scrolled up */}
        {logs.length > maxVisibleLogs && scrollOffset > 0 && (
          <>
            <Text> </Text>
            <Text dimColor>({scrollOffset} lines below)</Text>
          </>
        )}
      </Box>
    </Box>
  )
}

export async function runTUI(
  options: TUIOptions
): Promise<{ app: { unmount: () => void }; updateStatus: (status: string | null) => void }> {
  return new Promise((resolve) => {
    let statusUpdater: ((status: string | null) => void) | null = null

    const app = render(
      <TUIApp
        {...options}
        onShutdown={() => {
          // Don't resolve here, just trigger shutdown
        }}
        onStatusUpdate={(fn) => {
          statusUpdater = fn
        }}
      />
    )

    // Give React time to set up the status updater
    setTimeout(() => {
      resolve({
        app,
        updateStatus: (status: string | null) => {
          if (statusUpdater) {
            statusUpdater(status)
          }
        }
      })
    }, 100)
  })
}
