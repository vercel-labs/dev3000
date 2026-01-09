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
  ScrollBoxRenderable,
  type StyledText,
  TextRenderable,
  t,
  yellow
} from "@opentui/core"
import { createReadStream, unwatchFile, watchFile } from "fs"
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

// Full ASCII logo lines
const FULL_LOGO = ["   ▐▌▄▄▄▄ █  ▄ ", "   ▐▌   █ █▄▀  ", "▗╞▀▜▌▀▀▀█ █ ▀▄ ", "▝▚▄▟▌▄▄▄█ █  █ "]

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

// Helper to format log line with StyledText
function formatLogLine(content: string, isCompact: boolean): StyledText {
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

    // Format timestamp - in compact mode just show HH:MM:SS, otherwise full timestamp without brackets
    let displayTimestamp = timestamp
    if (isCompact) {
      // Extract just the time part (HH:MM:SS) from timestamps like "12:34:56.789"
      const timeMatch = timestamp.match(/^(\d{1,2}:\d{2}:\d{2})/)
      displayTimestamp = timeMatch ? timeMatch[1] : timestamp
    }

    if (isCompact) {
      const sourceChar = source.charAt(0)
      if (type) {
        const typeChar = type.charAt(0)
        // No bold, no space between tags in compact mode
        return t`${dim(displayTimestamp)} ${fg(sourceColor)(`[${sourceChar}]`)}${fg(typeColor)(`[${typeChar}]`)} ${message || ""}`
      }
      return t`${dim(displayTimestamp)} ${fg(sourceColor)(`[${sourceChar}]`)} ${message || ""}`
    }

    if (type) {
      return t`${dim(displayTimestamp)} ${bold(fg(sourceColor)(`[${source}]`))} ${fg(typeColor)(`[${type}]`)} ${message || ""}`
    }
    return t`${dim(displayTimestamp)} ${bold(fg(sourceColor)(`[${source}]`))} ${message || ""}`
  }

  return t`${content}`
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

    // Temporarily suppress stdout/stderr during renderer creation to hide OpenTUI's
    // terminal detection messages (e.g., "info(terminal): Terminal detect...")
    const originalStdoutWrite = process.stdout.write.bind(process.stdout)
    const originalStderrWrite = process.stderr.write.bind(process.stderr)
    process.stdout.write = () => true
    process.stderr.write = () => true
    try {
      this.renderer = await createCliRenderer(config)
    } finally {
      process.stdout.write = originalStdoutWrite
      process.stderr.write = originalStderrWrite
    }

    // Setup UI after renderer is created and stdout is restored
    this.setupUI()
    this.setupKeyboardHandlers()
    this.startLogFileWatcher()
    this.renderer.start()

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
    const isCompact = width < 80 || height < 20
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
      paddingLeft: 1,
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
      scrollAcceleration: new MacOSScrollAccel({ maxMultiplier: 8 })
    })
    logsSection.add(this.logsScrollBox)

    // Container for log lines inside scroll box
    this.logsContainer = new BoxRenderable(this.renderer, {
      id: "logs-content",
      flexDirection: "column",
      width: "100%",
      overflow: "hidden"
    })
    this.logsScrollBox.add(this.logsContainer)

    // Bottom status line (skip in compact mode - logs take all space)
    if (!isCompact) {
      const statusLine = new BoxRenderable(this.renderer, {
        id: "status-line",
        height: 1,
        flexDirection: "row",
        justifyContent: "space-between",
        paddingLeft: 1,
        paddingRight: 1
      })
      mainContainer.add(statusLine)

      // Log file path (left side)
      const logPath = this.options.logFile.replace(process.env.HOME || "", "~")
      const logPathText = new TextRenderable(this.renderer, {
        id: "log-path",
        content: t`${fg(BRAND_PURPLE)(logPath)}`
      })
      statusLine.add(logPathText)

      // Status info (right side)
      this.statusText = new TextRenderable(this.renderer, {
        id: "status-text",
        content: this.buildStatusContent(false),
        marginLeft: "auto"
      })
      statusLine.add(this.statusText)
    } else {
      // In compact mode, show a simple footer explaining d3k's purpose
      const statusLine = new BoxRenderable(this.renderer, {
        id: "status-line",
        height: 1,
        flexDirection: "row",
        paddingLeft: 1
      })
      mainContainer.add(statusLine)

      const helpText = new TextRenderable(this.renderer, {
        id: "help-text",
        content: t`${dim("<- agent has access to ↑")}`
      })
      statusLine.add(helpText)
      this.statusText = null
    }

    // Handle resize
    this.renderer.root.onSizeChange = () => {
      this.rebuildUI()
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

    const mcpLine = new TextRenderable(this.renderer, {
      id: "mcp-url",
      content: t`${cyan(`🤖 MCP: http://localhost:${this.options.mcpPort}`)}`
    })
    infoCol.add(mcpLine)

    const logsUrl = this.buildLogsUrl()
    const logsLine = new TextRenderable(this.renderer, {
      id: "logs-url-full",
      content: t`${cyan(`📸 Logs: ${logsUrl}`)}`
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
        content: t`${yellow(this.initStatus)}`
      })
      infoCol.add(statusLine)
    }

    return headerBox
  }

  private buildLogsUrl(): string {
    const base = `http://localhost:${this.options.mcpPort}/logs`
    if (this.options.projectName) {
      return `${base}?project=${encodeURIComponent(this.options.projectName)}`
    }
    return base
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
    this.refreshLogs()
  }

  private setupKeyboardHandlers() {
    if (!this.renderer) return

    let ctrlCPending = false

    this.renderer.keyInput.on("keypress", (key) => {
      // Handle Ctrl+C with double-tap protection
      if (key.ctrl && key.name === "c") {
        if (ctrlCPending) {
          // Second Ctrl+C - emit SIGINT event directly to trigger shutdown
          // Using emit() instead of kill() ensures the handler runs synchronously
          // The process handler knows we're in TUI mode and will proceed directly
          process.emit("SIGINT")
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
      if (NEXTJS_MCP_404_REGEX.test(line)) {
        return
      }

      const newLog: LogEntry = {
        id: this.logIdCounter++,
        content: line
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

    const isCompact = this.renderer.width < 80

    for (const log of newLogs) {
      if (log.id <= this.clearFromLogId) continue

      const formatted = formatLogLine(log.content, isCompact)
      const logLine = new TextRenderable(this.renderer, {
        id: `log-${log.id}`,
        content: formatted,
        wrapMode: "none"
      })
      this.logsContainer.add(logLine)
    }
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
    const isCompact = this.renderer.width < 80
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

  shutdown() {
    unwatchFile(this.options.logFile)
    if (this.renderer) {
      this.renderer.destroy()
      this.renderer = null
    }
    // Clear screen
    process.stdout.write("\x1b[2J\x1b[H\x1b[3J")
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
