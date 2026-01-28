import chalk from "chalk"
import { createReadStream, unwatchFile, watchFile } from "fs"
import { Box, render, Text, useInput, useStdout } from "ink"
import Spinner from "ink-spinner"
import { memo, useEffect, useRef, useState } from "react"
import type { Readable } from "stream"
import { LOG_COLORS } from "./constants/log-colors.js"

export type UpdateInfo =
  | { type: "available"; latestVersion: string }
  | { type: "updated"; newVersion: string; autoHide?: boolean }
  | null

export interface TUIOptions {
  appPort: string
  mcpPort: string
  logFile: string
  commandName: string
  serversOnly?: boolean
  version: string
  projectName?: string
  updateInfo?: UpdateInfo
  useHttps?: boolean
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

// Type colors map - defined outside component to avoid recreation
const TYPE_COLORS: Record<string, string> = {
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
  EXIT: LOG_COLORS.EXIT,
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

// Memoized log line component to prevent re-parsing on every render
const LogLine = memo(
  ({ log, isCompact, isVeryCompact }: { log: LogEntry; isCompact: boolean; isVeryCompact: boolean }) => {
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
          <Text wrap="truncate-end">
            <Text dimColor>[{shortSource}]</Text>
            {shortType && <Text dimColor>[{shortType}]</Text>}
            <Text> {message}</Text>
          </Text>
        )
      }

      // Use shared color constants
      const sourceColor = source === "BROWSER" ? LOG_COLORS.BROWSER : LOG_COLORS.SERVER

      // In compact mode, skip padding
      if (isCompact) {
        return (
          <Text wrap="truncate-end">
            <Text dimColor>[{timestamp}]</Text>
            <Text> </Text>
            <Text color={sourceColor} bold>
              [{source.charAt(0)}]
            </Text>
            {type && (
              <>
                <Text> </Text>
                <Text color={TYPE_COLORS[type] || "#A0A0A0"}>[{type}]</Text>
              </>
            )}
            <Text> {message}</Text>
          </Text>
        )
      }

      // Normal mode with minimal padding
      return (
        <Text wrap="truncate-end">
          <Text dimColor>[{timestamp}]</Text>
          <Text> </Text>
          <Text color={sourceColor} bold>
            [{source}]
          </Text>
          {type ? (
            <>
              <Text> </Text>
              <Text color={TYPE_COLORS[type] || "#A0A0A0"}>[{type}]</Text>
              <Text> </Text>
            </>
          ) : (
            <Text> </Text>
          )}
          <Text>{message}</Text>
        </Text>
      )
    }

    // Fallback for unparsed lines
    return <Text wrap="truncate-end">{log.content}</Text>
  }
)

const TUIApp = ({
  appPort: initialAppPort,
  mcpPort: _mcpPort,
  logFile,
  commandName: _commandName,
  serversOnly,
  version,
  projectName,
  updateInfo: initialUpdateInfo,
  useHttps: initialUseHttps,
  onStatusUpdate,
  onAppPortUpdate,
  onUpdateInfoUpdate,
  onUseHttpsUpdate
}: TUIOptions & {
  onStatusUpdate: (fn: (status: string | null) => void) => void
  onAppPortUpdate: (fn: (port: string) => void) => void
  onUpdateInfoUpdate: (fn: (info: UpdateInfo) => void) => void
  onUseHttpsUpdate: (fn: (useHttps: boolean) => void) => void
}) => {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [scrollOffset, setScrollOffset] = useState(0)
  const [initStatus, setInitStatus] = useState<string | null>(null)
  const [appPort, setAppPort] = useState<string>(initialAppPort)
  const [useHttps, setUseHttps] = useState<boolean>(initialUseHttps || false)
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo>(initialUpdateInfo || null)
  const [portConfirmed, setPortConfirmed] = useState<boolean>(false)
  const logIdCounter = useRef(0)
  const [clearFromLogId, setClearFromLogId] = useState<number>(0) // Track log ID to clear from
  const { stdout } = useStdout()
  const ctrlCMessageDefault = "" // Removed - click to focus/resize works now
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

  // Provide update info function to parent
  useEffect(() => {
    onUpdateInfoUpdate((info: UpdateInfo) => {
      setUpdateInfo(info)
      // Auto-hide "updated" messages after 10 seconds
      if (info?.type === "updated" && info.autoHide !== false) {
        setTimeout(() => {
          setUpdateInfo(null)
        }, 10000)
      }
    })
  }, [onUpdateInfoUpdate])

  // Provide useHttps update function to parent
  useEffect(() => {
    onUseHttpsUpdate((https: boolean) => {
      setUseHttps(https)
    })
  }, [onUseHttpsUpdate])

  // Calculate available lines for logs dynamically based on terminal height and mode
  const calculateMaxVisibleLogs = () => {
    if (isVeryCompact) {
      // In very compact mode, use most of the screen for logs, account for bottom status line
      return Math.max(3, termHeight - 7)
    } else if (isCompact) {
      // In compact mode, reduce header size, account for bottom status line
      return Math.max(3, termHeight - 9)
    } else {
      // Normal mode calculation - account for all UI elements
      const headerBorderLines = 2 // Top border (with title) + bottom border
      const headerContentLines = 4 // Logo is 4 lines tall
      const logBoxBorderLines = 2 // Top and bottom border of log box
      const logBoxHeaderLines = 1 // "Logs (X total)" text
      const logBoxFooterLines = 1 // Always reserve space for "(X lines below)" to keep layout stable
      const bottomStatusLine = 1 // Log path and quit message
      const totalReservedLines =
        headerBorderLines +
        headerContentLines +
        logBoxBorderLines +
        logBoxHeaderLines +
        logBoxFooterLines +
        bottomStatusLine -
        1 // Reclaim the extra blank line
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
    let pendingLogs: LogEntry[] = []
    let flushTimeout: NodeJS.Timeout | null = null

    // Batch log updates to prevent excessive renders
    const flushPendingLogs = () => {
      if (pendingLogs.length === 0) return

      const logsToAdd = pendingLogs
      pendingLogs = []
      flushTimeout = null

      setLogs((prevLogs) => {
        const updated = [...prevLogs, ...logsToAdd]
        // Keep only last N logs to prevent memory issues
        if (updated.length > maxLogs) {
          return updated.slice(-maxLogs)
        }
        return updated
      })

      // Auto-scroll to bottom only if user is already at the bottom
      // Otherwise, increment scroll offset by count of new logs
      setScrollOffset((currentOffset) => {
        return currentOffset === 0 ? 0 : Math.min(maxScrollOffsetRef.current, currentOffset + logsToAdd.length)
      })
    }

    const appendLog = (line: string) => {
      if (NEXTJS_MCP_404_REGEX.test(line)) {
        return
      }

      const newLog: LogEntry = {
        id: logIdCounter.current++,
        content: line
      }

      pendingLogs.push(newLog)

      // Debounce: flush after 50ms of no new logs
      // Terminal synchronized updates prevent flicker, so we can be more responsive
      if (flushTimeout) {
        clearTimeout(flushTimeout)
      }
      flushTimeout = setTimeout(flushPendingLogs, 50)
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
      if (flushTimeout) {
        clearTimeout(flushTimeout)
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
    } else if (input === "G" && key.shift) {
      // Shift+G to go to end
      setScrollOffset(0)
    } else if (input === "g" && !key.shift) {
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

  // Get clean project name (strip hash suffix like "-935beb")
  const cleanProjectName = projectName ? projectName.replace(/-[a-f0-9]{6}$/, "") : ""

  // Render compact header for small terminals
  const renderCompactHeader = () => (
    <Box borderStyle="single" borderColor="#A18CE5" paddingX={1}>
      <Box flexDirection="column" width="100%">
        <Box>
          <Text color="#A18CE5" bold>
            {COMPACT_LOGO}
          </Text>
          <Text dimColor> v{version}</Text>
        </Box>
        {!isVeryCompact && (
          <Box flexDirection="column">
            <Text dimColor>App: localhost:{appPort}</Text>
            <Text dimColor>📋 Logs: {logFile}</Text>
          </Box>
        )}
      </Box>
    </Box>
  )

  // Render normal header
  const renderNormalHeader = () => {
    // Create custom top border with title embedded (like Claude Code)
    // Note: commandName omitted since ASCII art already shows "d3k"
    const title = ` v${version} ${initStatus ? `- ${initStatus} ` : ""}`
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
        <Box borderStyle="round" borderColor="#A18CE5" borderTop={false} paddingX={1}>
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
                <Text color="cyan">
                  🌐 App: {useHttps ? "https" : "http"}://localhost:{appPort}{" "}
                </Text>
                {!portConfirmed && <Spinner type="dots" />}
              </Box>
              <Text color="cyan">📋 Logs: {logFile}</Text>
              {serversOnly && (
                <Text color="cyan">🖥️ Servers-only mode - use Chrome extension for browser monitoring</Text>
              )}
            </Box>
          </Box>
        </Box>
      </Box>
    )
  }

  // Calculate the height for the logs box to ensure stable layout from first render
  // This prevents the layout from shifting as logs fill in
  const logsBoxHeight = maxVisibleLogs + 3 // +3 for header line, borders

  return (
    <Box flexDirection="column" height={termHeight}>
      {/* Header Box - responsive to terminal size */}
      {isCompact ? renderCompactHeader() : renderNormalHeader()}

      {/* Logs Box - explicit height for stable initial render */}
      <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1} height={logsBoxHeight}>
        {!isVeryCompact && (
          <Text color="gray" dimColor>
            Logs ({filteredLogs.length} total{scrollOffset > 0 && `, scrolled up ${scrollOffset} lines`})
          </Text>
        )}

        {/* Logs content area */}
        <Box flexDirection="column">
          {visibleLogs.length === 0 ? (
            <Text dimColor>Waiting for logs...</Text>
          ) : (
            visibleLogs.map((log) => (
              <LogLine key={log.id} log={log} isCompact={isCompact} isVeryCompact={isVeryCompact} />
            ))
          )}
        </Box>

        {/* Scroll indicator - only show when scrolled up and not in very compact mode */}
        {!isVeryCompact && logs.length > maxVisibleLogs && scrollOffset > 0 && (
          <Text dimColor>({scrollOffset} lines below)</Text>
        )}
      </Box>

      {/* Bottom status line */}
      <Box paddingX={1} justifyContent={isCompact ? "flex-end" : "space-between"}>
        {!isCompact && (
          <Box>
            <Text color="#A18CE5">{logFile.replace(process.env.HOME || "", "~")}</Text>
          </Box>
        )}
        <Box gap={2}>
          {isCompact && <Text color="#A18CE5">{cleanProjectName || "d3k"}</Text>}
          {updateInfo?.type === "available" && (
            <Text color="yellow">↑ v{updateInfo.latestVersion} available (d3k upgrade)</Text>
          )}
          {updateInfo?.type === "updated" && <Text color="green">✓ Updated to v{updateInfo.newVersion}</Text>}
          {ctrlCMessage && <Text color="#A18CE5">{ctrlCMessage}</Text>}
        </Box>
      </Box>
    </Box>
  )
}

export async function runTUI(options: TUIOptions): Promise<{
  app: { unmount: () => void }
  updateStatus: (status: string | null) => void
  updateAppPort: (port: string) => void
  updateUpdateInfo: (info: UpdateInfo) => void
  updateUseHttps: (useHttps: boolean) => void
}> {
  return new Promise((resolve, reject) => {
    try {
      let statusUpdater: ((status: string | null) => void) | null = null
      let appPortUpdater: ((port: string) => void) | null = null
      let updateInfoUpdater: ((info: UpdateInfo) => void) | null = null
      let httpsUpdater: ((useHttps: boolean) => void) | null = null

      // Wrap stdout.write to add synchronized update escape sequences
      // This tells the terminal to buffer all output until the end marker
      // Supported by iTerm2, Kitty, WezTerm, and other modern terminals
      const originalWrite = process.stdout.write.bind(process.stdout)
      const syncStart = "\x1b[?2026h" // Begin synchronized update (DECSM 2026)
      const syncEnd = "\x1b[?2026l" // End synchronized update (DECRM 2026)

      process.stdout.write = ((
        chunk: string | Uint8Array,
        encodingOrCb?: BufferEncoding | ((err?: Error | null) => void),
        cb?: (err?: Error | null) => void
      ): boolean => {
        if (typeof chunk === "string" && chunk.length > 0) {
          // Wrap output in synchronized update markers to prevent partial renders
          const wrapped = syncStart + chunk + syncEnd
          if (typeof encodingOrCb === "function") {
            return originalWrite(wrapped, encodingOrCb)
          }
          return originalWrite(wrapped, encodingOrCb, cb)
        }
        if (typeof encodingOrCb === "function") {
          return originalWrite(chunk, encodingOrCb)
        }
        return originalWrite(chunk, encodingOrCb, cb)
      }) as typeof process.stdout.write

      const app = render(
        <TUIApp
          {...options}
          onStatusUpdate={(fn) => {
            statusUpdater = fn
          }}
          onAppPortUpdate={(fn) => {
            appPortUpdater = fn
          }}
          onUpdateInfoUpdate={(fn) => {
            updateInfoUpdater = fn
          }}
          onUseHttpsUpdate={(fn) => {
            httpsUpdater = fn
          }}
        />,
        { exitOnCtrlC: false }
      )

      // Give React one tick to set up the updaters
      setImmediate(() => {
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
          },
          updateUpdateInfo: (info: UpdateInfo) => {
            if (updateInfoUpdater) {
              updateInfoUpdater(info)
            }
          },
          updateUseHttps: (useHttps: boolean) => {
            if (httpsUpdater) {
              httpsUpdater(useHttps)
            }
          }
        })
      })
    } catch (error) {
      console.error("Error in runTUI render:", error)
      reject(error)
    }
  })
}
