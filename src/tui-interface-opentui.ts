import {
  BoxRenderable,
  bold,
  type CliRenderer,
  type CliRendererConfig,
  createCliRenderer,
  cyan,
  dim,
  fg,
  green,
  MacOSScrollAccel,
  RGBA,
  ScrollBoxRenderable,
  type StyledText,
  TextRenderable,
  t,
  yellow
} from "@opentui/core"
import { appendFileSync, createReadStream, mkdirSync, unwatchFile, watchFile, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { LOG_COLORS } from "./constants/log-colors.js"
import { formatTimeDelta, parseTimestampToMs } from "./utils/timestamp.js"

export type UpdateInfo =
  | { type: "available"; latestVersion: string }
  | { type: "updated"; newVersion: string; autoHide?: boolean }
  | null

export interface TUIOptions {
  appPort: string
  logFile: string
  commandName: string
  serversOnly?: boolean
  version: string
  projectName?: string
  updateInfo?: UpdateInfo
  useHttps?: boolean
  onRequestShutdown?: () => void
}

interface LogEntry {
  id: number
  content: string
  timestamp?: string // Extracted timestamp like "12:34:56.789"
}

// Compact ASCII logo for very small terminals
const COMPACT_LOGO = "d3k"

// Full ASCII logo lines
const FULL_LOGO = ["   ▐▌▄▄▄▄ █  ▄ ", "   ▐▌   █ █▄▀  ", "▗▞▀▜▌▀▀▀█ █ ▀▄ ", "▝▚▄▟▌▄▄▄█ █  █ "]

// Brand purple color
const BRAND_PURPLE = "#A18CE5"

// Type colors map
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

// Color for delta timestamps
const DELTA_COLOR = "#FFD700" // Gold/yellow for visibility

// Helper to format log line with StyledText
function formatLogLine(content: string, isCompact: boolean, baseTimestampMs?: number, isBaseLog?: boolean): StyledText {
  const parts = content.match(/^\[(.*?)\] \[(.*?)\] (?:\[(.*?)\] )?(.*)$/)

  if (parts) {
    let [, timestamp, source, type, message] = parts

    // Extract HTTP method from SERVER logs
    if (source === "SERVER" && !type && message) {
      const methodMatch = message.match(/^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s/)
      if (methodMatch) {
        type = methodMatch[1]
        message = message.slice(type.length + 1)
      }
    }

    // Replace warning emoji
    if (message && (type === "ERROR" || type === "WARNING")) {
      message = message.replace(/\u26A0/g, "[!]")
    }

    const sourceColor = source === "BROWSER" ? LOG_COLORS.BROWSER : LOG_COLORS.SERVER
    const typeColor = TYPE_COLORS[type] || "#A0A0A0"

    // Format timestamp - show delta if base timestamp is set
    let displayTimestamp = timestamp
    // Track which style to use: 0 = dim (normal), 1 = delta color, 2 = delta bold (base log)
    let timestampMode = 0

    if (baseTimestampMs !== undefined) {
      const currentMs = parseTimestampToMs(timestamp)
      if (currentMs !== null) {
        if (isBaseLog) {
          // The base log shows "BASE" indicator (padded to match delta width)
          displayTimestamp = isCompact ? "BASE" : "      BASE "
          timestampMode = 2
        } else {
          // Other logs show delta from base
          const delta = formatTimeDelta(currentMs - baseTimestampMs)
          displayTimestamp = isCompact ? delta : `${delta.padStart(10)} `
          timestampMode = 1
        }
      }
    }
    // Always show full timestamp (HH:MM:SS.mmm) - no truncation

    // Build styled timestamp based on mode
    const styledTimestamp =
      timestampMode === 2
        ? bold(fg(DELTA_COLOR)(displayTimestamp))
        : timestampMode === 1
          ? fg(DELTA_COLOR)(displayTimestamp)
          : dim(displayTimestamp)

    // Add leading space to account for scroll indicator overlap
    const pad = "  "

    if (isCompact) {
      const sourceChar = source.charAt(0)
      if (type) {
        const typeChar = type.charAt(0)
        // Compact mode: single char tags with space after timestamp
        return t`${pad}${styledTimestamp}  ${fg(sourceColor)(`[${sourceChar}]`)}${fg(typeColor)(`[${typeChar}]`)} ${message || ""}`
      }
      return t`${pad}${styledTimestamp}  ${fg(sourceColor)(`[${sourceChar}]`)} ${message || ""}`
    }

    if (type) {
      return t`${pad}${styledTimestamp} ${bold(fg(sourceColor)(`[${source}]`))} ${fg(typeColor)(`[${type}]`)} ${message || ""}`
    }
    return t`${pad}${styledTimestamp} ${bold(fg(sourceColor)(`[${source}]`))} ${message || ""}`
  }

  // Fallback for unparseable lines - still add padding
  return t`  ${content}`
}

class D3kTUI {
  private renderer: CliRenderer | null = null
  private options: TUIOptions
  private logs: LogEntry[] = []
  private logIdCounter = 0
  private clearFromLogId = 0
  private maxLogs = 1000

  // UI Components
  private headerBox: BoxRenderable | null = null
  private logsScrollBox: ScrollBoxRenderable | null = null
  private logsContainer: BoxRenderable | null = null
  private statusText: TextRenderable | null = null

  // State
  private appPort: string
  private useHttps: boolean
  private portConfirmed = false
  private updateInfo: UpdateInfo
  private initStatus: string | null = null
  private ctrlCMessage = ""
  private ctrlCTimeout: NodeJS.Timeout | null = null

  // Base timestamp for delta display (set via keyboard, not mouse click)
  private baseTimestampMs: number | undefined = undefined
  private baseLogId: number | undefined = undefined

  // Debug mode for tracking selection/focus issues
  private debugMode = false
  private lastFocusedId: string | null = null
  private debugLogFile: string = join(process.env.HOME || tmpdir(), ".d3k", "tui-debug.log")

  constructor(options: TUIOptions) {
    this.options = options
    this.appPort = options.appPort
    this.useHttps = options.useHttps || false
    this.updateInfo = options.updateInfo || null
  }

  async start(): Promise<{
    app: { unmount: () => void }
    updateStatus: (status: string | null) => void
    updateAppPort: (port: string) => void
    updateUpdateInfo: (info: UpdateInfo) => void
    updateUseHttps: (useHttps: boolean) => void
  }> {
    const config: CliRendererConfig = {
      useMouse: true,
      exitOnCtrlC: false,
      useAlternateScreen: true
    }

    // Filter out OpenTUI's terminal detection messages from stdout and stderr
    // These messages like "info(terminal): Terminal detected..." interfere with TUI rendering
    const createFilteredWrite = (originalWrite: typeof process.stdout.write) => {
      return function (
        this: NodeJS.WriteStream,
        chunk: string | Uint8Array,
        encodingOrCallback?: BufferEncoding | ((err?: Error | null) => void),
        callback?: (err?: Error | null) => void
      ): boolean {
        const str = typeof chunk === "string" ? chunk : chunk.toString()
        if (str.includes("info(terminal)") || str.includes("Terminal detected")) {
          return true // Silently ignore
        }
        if (typeof encodingOrCallback === "function") {
          return originalWrite(chunk, encodingOrCallback)
        }
        return originalWrite(chunk, encodingOrCallback, callback)
      } as typeof process.stdout.write
    }

    const originalStdoutWrite = process.stdout.write.bind(process.stdout)
    const originalStderrWrite = process.stderr.write.bind(process.stderr)
    process.stdout.write = createFilteredWrite(originalStdoutWrite)
    process.stderr.write = createFilteredWrite(originalStderrWrite)

    this.renderer = await createCliRenderer(config)

    // Setup UI after renderer is created
    this.setupUI()
    this.setupKeyboardHandlers()
    this.setupFocusTracking()
    this.renderer.start()

    // Delay log file watcher start to allow layout to compute valid positions
    // Without this delay, initial logs get NaN X positions and selection fails
    setTimeout(() => {
      this.startLogFileWatcher()
    }, 100)

    // Force a redraw after start to ensure borders render correctly
    process.stdout.write("\x1b[2J\x1b[H")
    this.renderer.requestRender()

    return {
      app: { unmount: () => this.shutdown() },
      updateStatus: (status) => this.setStatus(status),
      updateAppPort: (port) => this.setAppPort(port),
      updateUpdateInfo: (info) => this.setUpdateInfo(info),
      updateUseHttps: (useHttps) => this.setUseHttps(useHttps)
    }
  }

  private setupUI() {
    if (!this.renderer) return

    const { width, height } = this.renderer
    const isCompact = width < 100
    const isVeryCompact = width < 60 || height < 15

    // Main container
    const mainContainer = new BoxRenderable(this.renderer, {
      id: "main",
      width: "100%",
      height: "100%",
      flexDirection: "column"
    })
    this.renderer.root.add(mainContainer)

    // Header
    this.headerBox = this.createHeader(isCompact, isVeryCompact)
    mainContainer.add(this.headerBox)

    // Logs section (scrollable)
    const logsSection = new BoxRenderable(this.renderer, {
      id: "logs-section",
      flexGrow: 1,
      flexDirection: "column",
      border: true,
      borderStyle: "single",
      borderColor: "#808080",
      paddingRight: 1
    })
    mainContainer.add(logsSection)

    // Scrollable logs container
    this.logsScrollBox = new ScrollBoxRenderable(this.renderer, {
      id: "logs-scroll",
      flexGrow: 1,
      scrollY: true,
      scrollX: false,
      stickyScroll: true,
      stickyStart: "bottom",
      scrollAcceleration: new MacOSScrollAccel({ maxMultiplier: 8 }),
      viewportCulling: false, // Disable culling to ensure all items are in hit grid
      paddingLeft: 1, // Force left position calculation for selection hit testing
      onMouse: (event) => {
        // Log ALL mouse events to understand the flow
        if (event.type === "down" || event.type === "up") {
          const target = event.target
          const targetId = target?.id || "(none)"
          const targetX = target?.x ?? "?"
          const targetY = target?.y ?? "?"
          const targetW = target?.width ?? "?"
          const targetH = target?.height ?? "?"
          this.debugLog(
            `[MOUSE_${event.type.toUpperCase()}] screen(${event.x},${event.y}) target=${targetId} pos(${targetX},${targetY}) size(${targetW}x${targetH}) selectable=${target?.selectable} hasSelection=${this.renderer?.hasSelection}`
          )
        }
      },
      onMouseDown: (event) => {
        const target = event.target
        const targetId = target?.id || "(none)"
        const selection = this.renderer?.getSelection()
        this.debugLog(
          `[MOUSE_DOWN_CB] x=${event.x}, y=${event.y}, target=${targetId}, hasSelection=${this.renderer?.hasSelection}, isSelecting=${selection?.isSelecting}`
        )
      },
      onMouseUp: (event) => {
        const selection = this.renderer?.getSelection()
        const selectedText = selection?.getSelectedText() || "(none)"
        this.debugLog(
          `[MOUSE_UP] x=${event.x}, y=${event.y}, hasSelection=${this.renderer?.hasSelection}, text="${selectedText.slice(0, 30)}"`
        )
      },
      onMouseDrag: (event) => {
        const target = event.target
        const targetId = target?.id || "(none)"
        this.debugLog(`[MOUSE_DRAG] x=${event.x}, y=${event.y}, target=${targetId}, isSelecting=${event.isSelecting}`)
      }
    })
    logsSection.add(this.logsScrollBox)

    // Track focus changes on scroll box
    this.logsScrollBox.on("focused", () => {
      this.debugLog(`[FOCUS] logsScrollBox focused`)
    })
    this.logsScrollBox.on("blurred", () => {
      this.debugLog(`[FOCUS] logsScrollBox blurred`)
    })

    // Container for log lines inside scroll box - provides valid X positions
    this.logsContainer = new BoxRenderable(this.renderer, {
      id: "logs-content",
      flexDirection: "column",
      width: "100%"
    })
    this.logsScrollBox.add(this.logsContainer)

    // Bottom status line - show "agent has access" hint in both modes
    const statusLine = new BoxRenderable(this.renderer, {
      id: "status-line",
      height: 1,
      flexDirection: "row",
      justifyContent: "space-between",
      paddingLeft: 1,
      paddingRight: 1
    })
    mainContainer.add(statusLine)

    // Help text (left side) - always show agent access hint
    const helpText = new TextRenderable(this.renderer, {
      id: "help-text",
      content: t`${dim("<- agent has access to ↑")}`
    })
    statusLine.add(helpText)

    // Status info (right side) - only in non-compact mode
    if (!isCompact) {
      this.statusText = new TextRenderable(this.renderer, {
        id: "status-text",
        content: this.buildStatusContent(false),
        marginLeft: "auto"
      })
      statusLine.add(this.statusText)
    } else {
      this.statusText = null
    }

    // Handle resize - do NOT rebuild, let flex layout adapt naturally
    // Rebuilding causes NaN positions that break text selection
    this.renderer.root.onSizeChange = () => {
      // Just request a render, don't rebuild - flex layout handles resize
      this.renderer?.requestRender()
    }
  }

  private createHeader(isCompact: boolean, isVeryCompact: boolean): BoxRenderable {
    if (!this.renderer) throw new Error("Renderer not initialized")

    // In compact mode, no box border - just logo and version
    if (isCompact || isVeryCompact) {
      const headerBox = new BoxRenderable(this.renderer, {
        id: "header",
        flexDirection: "row",
        paddingLeft: 1,
        height: 1
      })

      // Only: logo and version
      const logoText = new TextRenderable(this.renderer, {
        id: "logo-compact",
        content: t`${bold(fg(BRAND_PURPLE)(COMPACT_LOGO))}${dim(`-v${this.options.version}`)}`
      })
      headerBox.add(logoText)

      return headerBox
    }

    // Full mode: bordered box with ASCII logo and info
    const headerBox = new BoxRenderable(this.renderer, {
      id: "header",
      border: true,
      borderStyle: "single",
      borderColor: BRAND_PURPLE,
      paddingLeft: 1,
      paddingRight: 1,
      flexDirection: "row",
      alignItems: "flex-start",
      height: 6
    })

    // ASCII logo column
    const logoCol = new BoxRenderable(this.renderer, {
      id: "logo-col",
      flexDirection: "column",
      marginRight: 2
    })
    headerBox.add(logoCol)

    for (const line of FULL_LOGO) {
      const logoLine = new TextRenderable(this.renderer, {
        content: t`${bold(fg(BRAND_PURPLE)(line))}`
      })
      logoCol.add(logoLine)
    }

    // Info column
    const infoCol = new BoxRenderable(this.renderer, {
      id: "info-col",
      flexDirection: "column",
      flexGrow: 1
    })
    headerBox.add(infoCol)

    const protocol = this.useHttps ? "https" : "http"
    const portStatus = this.portConfirmed ? "" : " ..."
    const appLine = new TextRenderable(this.renderer, {
      id: "app-url",
      content: this.portConfirmed
        ? t`${cyan(`🌐 App: ${protocol}://localhost:${this.appPort}`)}`
        : t`${cyan(`🌐 App: ${protocol}://localhost:${this.appPort}`)}${yellow(portStatus)}`
    })
    infoCol.add(appLine)

    // Show logs path with ~/ instead of full home path
    const logsPath = this.options.logFile.replace(process.env.HOME || "", "~")
    const logsLine = new TextRenderable(this.renderer, {
      id: "logs-file",
      content: t`${cyan(`📋 Logs: ${logsPath}`)}`
    })
    infoCol.add(logsLine)

    if (this.options.serversOnly) {
      const serversLine = new TextRenderable(this.renderer, {
        id: "servers-only",
        content: t`${cyan("🖥️ Servers-only mode")}`
      })
      infoCol.add(serversLine)
    }

    if (this.initStatus) {
      const statusLine = new TextRenderable(this.renderer, {
        id: "init-status",
        content: t`${bold(fg(BRAND_PURPLE)(this.initStatus))}`
      })
      infoCol.add(statusLine)
    }

    return headerBox
  }

  private buildStatusContent(isCompact: boolean): StyledText {
    const parts: string[] = []

    if (isCompact) {
      const cleanName = this.options.projectName?.replace(/-[a-f0-9]{6}$/, "") || "d3k"
      parts.push(cleanName)
    }

    if (this.updateInfo?.type === "available") {
      return t`${yellow(`↑ v${this.updateInfo.latestVersion} available (d3k upgrade)`)}`
    }
    if (this.updateInfo?.type === "updated") {
      return t`${green(`✓ Updated to v${this.updateInfo.newVersion}`)}`
    }

    if (this.ctrlCMessage) {
      return t`${fg(BRAND_PURPLE)(this.ctrlCMessage)}`
    }

    if (parts.length > 0) {
      return t`${fg(BRAND_PURPLE)(parts.join("  "))}`
    }

    return t``
  }

  private rebuildUI() {
    if (!this.renderer) return

    // Clear and rebuild - OpenTUI handles resize
    const root = this.renderer.root
    for (const child of root.getChildren()) {
      child.destroy()
    }

    this.setupUI()

    // Delay log refresh to allow layout to compute valid positions
    // Without this delay, logs get NaN X positions and selection fails
    setTimeout(() => {
      this.refreshLogs()
    }, 100)
  }

  private setupKeyboardHandlers() {
    if (!this.renderer) return

    let ctrlCPending = false

    this.renderer.keyInput.on("keypress", (key) => {
      // Handle Ctrl+C with double-tap protection
      if (key.ctrl && key.name === "c") {
        if (ctrlCPending) {
          // Second Ctrl+C - call shutdown callback directly
          // This bypasses signal handling which can be unreliable in TUI mode
          if (this.options.onRequestShutdown) {
            this.options.onRequestShutdown()
          } else {
            // Fallback to signal if no callback provided
            process.emit("SIGINT")
          }
        } else {
          // First Ctrl+C - show warning
          ctrlCPending = true
          this.ctrlCMessage = "⚠️ ^C again to quit"
          this.updateStatusDisplay()

          setTimeout(() => {
            ctrlCPending = false
            this.ctrlCMessage = ""
            this.updateStatusDisplay()
          }, 3000)
        }
        return
      }

      // Handle Ctrl+L to clear logs
      if (key.ctrl && key.name === "l") {
        this.clearFromLogId = this.logs.length > 0 ? this.logs[this.logs.length - 1].id : this.logIdCounter
        this.logsScrollBox?.scrollTo({ x: 0, y: 0 })
        this.refreshLogs()
        return
      }

      // Handle Escape to clear base timestamp (exit delta mode)
      if (key.name === "escape") {
        if (this.baseTimestampMs !== undefined) {
          this.baseTimestampMs = undefined
          this.baseLogId = undefined
          this.refreshLogs()
        }
        this.renderer?.clearSelection()
        return
      }

      // Debug: Shift+D to toggle debug mode (verbose logging to file)
      if (key.name === "d" && key.shift && !key.ctrl) {
        this.debugMode = !this.debugMode
        if (this.debugMode) {
          // Ensure directory exists and clear the debug log file when enabling
          try {
            mkdirSync(join(process.env.HOME || tmpdir(), ".d3k"), { recursive: true })
            writeFileSync(this.debugLogFile, `Debug mode enabled at ${new Date().toISOString()}\n`)
          } catch {
            // Ignore write errors
          }
        }
        const entry: LogEntry = {
          id: ++this.logIdCounter,
          content: `[DEBUG] Debug mode ${this.debugMode ? `ENABLED - logging to ${this.debugLogFile}` : "DISABLED"}`
        }
        this.logs.push(entry)
        this.addLogLines([entry])
        return
      }

      // Debug: Press 'd' to check selection state and focus info (shows in UI and writes to file)
      if (key.name === "d" && !key.ctrl && !key.shift) {
        const selection = this.renderer?.getSelection()
        const hasSelection = this.renderer?.hasSelection
        const selectedText = selection?.getSelectedText() || "(none)"
        const focusedRenderable = this.renderer?.currentFocusedRenderable
        const focusedId = focusedRenderable?.id || "(none)"
        const selectionContainer = this.renderer?.getSelectionContainer()
        const containerId = selectionContainer?.id || "(none)"
        const message = `hasSelection: ${hasSelection}, isSelecting: ${selection?.isSelecting}, renderables: ${selection?.selectedRenderables?.length ?? 0}, focus: ${focusedId}, container: ${containerId}, text: "${selectedText.slice(0, 30)}"`
        // Write to file if debug mode is on
        this.debugLog(`[SELECTION_STATE] ${message}`)
        // Always show in UI
        const debugEntry: LogEntry = {
          id: ++this.logIdCounter,
          content: `[DEBUG] ${message}`
        }
        this.logs.push(debugEntry)
        this.addLogLines([debugEntry])
        return
      }

      // Keyboard scrolling (also works alongside mouse scroll)
      if (this.logsScrollBox) {
        if (key.name === "up") {
          this.logsScrollBox.scrollBy(-1)
        } else if (key.name === "down") {
          this.logsScrollBox.scrollBy(1)
        } else if (key.name === "pageup") {
          this.logsScrollBox.scrollBy(-10)
        } else if (key.name === "pagedown") {
          this.logsScrollBox.scrollBy(10)
        } else if (key.name === "g" && !key.shift) {
          // g - go to top
          this.logsScrollBox.scrollTo({ x: 0, y: 0 })
        } else if (key.name === "g" && key.shift) {
          // G - go to bottom
          this.logsScrollBox.scrollTo({ x: 0, y: this.logsScrollBox.scrollHeight })
        }
      }
    })
  }

  private setupFocusTracking() {
    if (!this.renderer) return

    // Track focus changes via frame callback (since there's no global focus event)
    this.renderer.setFrameCallback(async () => {
      if (!this.debugMode || !this.renderer) return

      const focused = this.renderer.currentFocusedRenderable
      const currentId = focused?.id || null

      if (currentId !== this.lastFocusedId) {
        this.debugLog(`[FOCUS_CHANGE] ${this.lastFocusedId || "(none)"} -> ${currentId || "(none)"}`)
        this.lastFocusedId = currentId
      }
    })
  }

  private startLogFileWatcher() {
    let buffer = ""
    let pendingLogs: LogEntry[] = []
    let flushTimeout: NodeJS.Timeout | null = null

    const flushPendingLogs = () => {
      if (pendingLogs.length === 0) return

      const logsToAdd = pendingLogs
      pendingLogs = []
      flushTimeout = null

      this.logs.push(...logsToAdd)
      if (this.logs.length > this.maxLogs) {
        this.logs = this.logs.slice(-this.maxLogs)
      }

      this.addLogLines(logsToAdd)
    }

    const appendLog = (line: string) => {
      // Extract timestamp from log line format: [timestamp] [source] ...
      const timestampMatch = line.match(/^\[(.*?)\]/)
      const timestamp = timestampMatch ? timestampMatch[1] : undefined

      const newLog: LogEntry = {
        id: this.logIdCounter++,
        content: line,
        timestamp
      }

      pendingLogs.push(newLog)

      if (flushTimeout) {
        clearTimeout(flushTimeout)
      }
      flushTimeout = setTimeout(flushPendingLogs, 50)
    }

    // Initial read
    const logStream = createReadStream(this.options.logFile, {
      encoding: "utf8",
      start: 0
    })

    logStream.on("data", (chunk) => {
      buffer += chunk.toString()
      const lines = buffer.split("\n")
      buffer = lines.pop() || ""

      for (const line of lines) {
        if (line.trim()) {
          appendLog(line)
        }
      }
    })

    logStream.on("error", (error) => {
      appendLog(`Error reading log file: ${error.message}`)
    })

    // Watch for changes
    watchFile(this.options.logFile, { interval: 100 }, (curr, prev) => {
      if (curr.size > prev.size) {
        const stream = createReadStream(this.options.logFile, {
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
  }

  private addLogLines(newLogs: LogEntry[]) {
    if (!this.renderer || !this.logsContainer) return

    const isCompact = this.renderer.width < 100

    for (const log of newLogs) {
      if (log.id <= this.clearFromLogId) continue

      const isBaseLog = this.baseLogId === log.id
      const formatted = formatLogLine(log.content, isCompact, this.baseTimestampMs, isBaseLog)
      // Wrap TextRenderable in a BoxRenderable to force valid X position
      const logWrapper = new BoxRenderable(this.renderer, {
        id: `log-wrapper-${log.id}`,
        width: "100%",
        flexShrink: 0,
        paddingLeft: 0, // Explicit padding to force position calculation
        marginLeft: 0 // Explicit margin to force position calculation
      })

      // Track click start position to detect clicks vs drags
      let clickStartX = -1
      let clickStartY = -1

      const logLine = new TextRenderable(this.renderer, {
        id: `log-${log.id}`,
        content: formatted,
        wrapMode: "none",
        selectable: true,
        selectionBg: RGBA.fromInts(70, 130, 180), // Steel blue highlight
        selectionFg: RGBA.fromInts(255, 255, 255), // White text on selection
        width: "100%",
        onMouseDown: (event) => {
          // Record start position for click detection
          clickStartX = event.x
          clickStartY = event.y
          this.debugLog(
            `[TEXT_DOWN] id=${logLine.id} screen(${event.x},${event.y}) pos(${logLine.x},${logLine.y}) size(${logLine.width}x${logLine.height})`
          )
        },
        onMouseUp: (event) => {
          // Check if this was a click (no movement) vs a drag
          const isClick = clickStartX === event.x && clickStartY === event.y
          if (isClick && log.timestamp) {
            // Only trigger baseline on clicks within timestamp column (first ~15 chars)
            // Calculate position within the text (accounting for renderable's X position)
            const textLocalX = event.x - (logLine.x || 0)
            const TIMESTAMP_COLUMN_WIDTH = 15 // "[HH:MM:SS.mmm] " is ~14 chars

            if (textLocalX <= TIMESTAMP_COLUMN_WIDTH) {
              // Toggle baseline timestamp on click
              const timestampMs = parseTimestampToMs(log.timestamp)
              if (timestampMs !== null) {
                if (this.baseLogId === log.id) {
                  // Clicking same log clears the baseline
                  this.baseTimestampMs = undefined
                  this.baseLogId = undefined
                } else {
                  // Set this log as the new baseline
                  this.baseTimestampMs = timestampMs
                  this.baseLogId = log.id
                }
                this.refreshLogs()
              }
            }
          }
          // Reset click tracking
          clickStartX = -1
          clickStartY = -1
        }
      })

      logWrapper.add(logLine)
      this.logsContainer.add(logWrapper)
    }

    // Force render to update hit grid after adding new logs
    // This prevents stale hit grid when new logs trigger scroll/layout changes
    this.renderer.requestRender()
  }

  private refreshLogs() {
    if (!this.renderer || !this.logsContainer) return

    // Clear existing log lines
    for (const child of this.logsContainer.getChildren()) {
      child.destroy()
    }

    // Re-add filtered logs
    const filteredLogs = this.logs.filter((log) => log.id > this.clearFromLogId)
    this.addLogLines(filteredLogs)
  }

  private updateStatusDisplay() {
    if (!this.statusText || !this.renderer) return
    const isCompact = this.renderer.width < 100
    this.statusText.content = this.buildStatusContent(isCompact)
  }

  // Public update methods
  setStatus(status: string | null) {
    if (status?.includes("Press Ctrl+C again")) {
      this.ctrlCMessage = "⚠️ ^C again to quit"
      this.initStatus = null
      this.updateStatusDisplay()

      if (this.ctrlCTimeout) clearTimeout(this.ctrlCTimeout)
      this.ctrlCTimeout = setTimeout(() => {
        this.ctrlCMessage = ""
        this.updateStatusDisplay()
      }, 3000)
    } else {
      this.initStatus = status
      this.rebuildUI()
    }
  }

  setAppPort(port: string) {
    this.appPort = port
    this.portConfirmed = true
    this.rebuildUI()
  }

  setUpdateInfo(info: UpdateInfo) {
    this.updateInfo = info
    this.updateStatusDisplay()

    if (info?.type === "updated" && info.autoHide !== false) {
      setTimeout(() => {
        this.updateInfo = null
        this.updateStatusDisplay()
      }, 10000)
    }
  }

  setUseHttps(useHttps: boolean) {
    this.useHttps = useHttps
    this.rebuildUI()
  }

  private debugLog(message: string) {
    if (!this.debugMode) return
    const timestamp = new Date().toISOString()
    const logLine = `[${timestamp}] ${message}\n`
    try {
      appendFileSync(this.debugLogFile, logLine)
    } catch {
      // Ignore write errors
    }
  }

  shutdown() {
    unwatchFile(this.options.logFile)
    if (this.renderer) {
      try {
        this.renderer.destroy()
      } catch (error) {
        this.debugLog(`Renderer destroy failed during shutdown: ${error}`)
      }
      this.renderer = null
    }
    // Explicitly reset terminal state:
    // - Disable mouse tracking modes (SGR, all motion, cell motion, basic)
    // - Exit alternate screen buffer
    // - Clear screen and scrollback
    // - Show cursor
    process.stdout.write(
      "\x1b[?1006l" + // Disable SGR extended mouse mode
        "\x1b[?1003l" + // Disable all motion tracking
        "\x1b[?1002l" + // Disable cell motion tracking
        "\x1b[?1000l" + // Disable basic mouse tracking
        "\x1b[?1049l" + // Exit alternate screen buffer
        "\x1b[2J\x1b[H\x1b[3J" + // Clear screen and scrollback
        "\x1b[?25h" // Show cursor
    )
  }
}

export async function runTUI(options: TUIOptions): Promise<{
  app: { unmount: () => void }
  updateStatus: (status: string | null) => void
  updateAppPort: (port: string) => void
  updateUpdateInfo: (info: UpdateInfo) => void
  updateUseHttps: (useHttps: boolean) => void
}> {
  const tui = new D3kTUI(options)
  return tui.start()
}
