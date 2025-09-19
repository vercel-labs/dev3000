import { BoxRenderable, type CliRenderer, createCliRenderer, ScrollBoxRenderable, TextRenderable } from "@opentui/core"
import chalk from "chalk"
import { createReadStream, unwatchFile, watchFile } from "fs"
import type { Readable } from "stream"

export interface TUIOptions {
  appPort: string
  mcpPort: string
  logFile: string
  commandName: string
  serversOnly?: boolean
  version: string
}

export class DevTUI {
  private renderer!: CliRenderer
  private infoBox!: BoxRenderable
  private logScrollBox!: ScrollBoxRenderable
  private logContent!: BoxRenderable
  private options: TUIOptions
  private logStream?: Readable
  private isShuttingDown: boolean = false
  private logLineY: number = 0

  constructor(options: TUIOptions) {
    this.options = options
  }

  async start() {
    // Create renderer with OpenTUI
    this.renderer = await createCliRenderer({
      exitOnCtrlC: false, // We'll handle Ctrl+C ourselves
      useAlternateScreen: true,
      useMouse: true,
      enableMouseMovement: false,
      useConsole: false, // Disable built-in console since we're creating our own UI
      targetFps: 30,
      debounceDelay: 100
    })

    // Setup UI components
    this.setupUI()

    // Start renderer
    this.renderer.start()

    // Start tailing log file
    this.startLogTail()

    // Handle keyboard input for scrolling
    if (process.stdin.setRawMode) {
      process.stdin.setRawMode(true)
    }

    process.stdin.on("data", (data) => {
      const key = data.toString()

      // Handle scrolling
      if (key === "\u001b[A") {
        // Up arrow
        this.scrollUp()
      } else if (key === "\u001b[B") {
        // Down arrow
        this.scrollDown()
      } else if (key === "\u001b[H") {
        // Home
        this.scrollToTop()
      } else if (key === "\u001b[F") {
        // End
        this.scrollToBottom()
      } else if (key === "\u0003") {
        // Ctrl+C
        // Let parent process handle this
        process.emit("SIGINT", "SIGINT")
      }
    })
  }

  private setupUI() {
    // Create info box at the top with fixed height
    this.infoBox = new BoxRenderable(this.renderer, {
      id: "info-box",
      left: 0,
      top: 0,
      width: "100%",
      height: 11, // Fixed height for info
      backgroundColor: "#1a1a1a",
      border: true,
      borderStyle: "rounded",
      borderColor: "#00aaff",
      title: ` ${this.options.commandName} v${this.options.version} `,
      titleAlignment: "center"
    })

    // Create scrollable log area below info box
    this.logScrollBox = new ScrollBoxRenderable(this.renderer, {
      id: "log-scroll-box",
      left: 0,
      top: 11, // Position below info box
      width: "100%",
      height: "90%", // Take most of remaining space
      backgroundColor: "#0a0a0a",
      border: true,
      borderStyle: "single",
      borderColor: "#666666",
      title: " Logs ",
      titleAlignment: "left",
      stickyScroll: true,
      stickyStart: "bottom",
      viewportOptions: {
        backgroundColor: "#0a0a0a"
      },
      scrollbarOptions: {
        // Remove thumbColor as it's not valid
      }
    })

    // Create content container for logs
    this.logContent = new BoxRenderable(this.renderer, {
      id: "log-content",
      left: 0,
      top: 0,
      width: "100%",
      backgroundColor: "transparent"
    })

    // Add components to hierarchy
    this.logScrollBox.add(this.logContent)
    this.renderer.root.add(this.infoBox)
    this.renderer.root.add(this.logScrollBox)

    // Create info content
    this.createInfoContent()
  }

  private createInfoContent() {
    const infoLines = [
      chalk.greenBright(`${this.options.commandName} is running!`),
      "",
      chalk.cyan(`🌐 Your App: http://localhost:${this.options.appPort}`),
      chalk.cyan(`🤖 MCP Server: http://localhost:${this.options.mcpPort}/api/mcp/mcp`),
      chalk.cyan(`📸 Visual Timeline: http://localhost:${this.options.mcpPort}/logs`),
      this.options.serversOnly ? chalk.cyan("🖥️  Servers-only mode - use Chrome extension for browser monitoring") : "",
      "",
      chalk.gray(`💡 To stop: Ctrl-C | Logs: ${this.options.logFile}`)
    ].filter((line) => line !== "")

    // Create a text component for each line
    infoLines.forEach((line, index) => {
      const infoText = new TextRenderable(this.renderer, {
        id: `info-line-${index}`,
        left: 2, // Padding from border
        top: index + 1, // Start from y=1 to leave space after border
        content: line
      })
      this.infoBox.add(infoText)
    })
  }

  private scrollUp() {
    this.logScrollBox.scrollBy(-1) // Simplified for vertical scroll
  }

  private scrollDown() {
    this.logScrollBox.scrollBy(1) // Simplified for vertical scroll
  }

  private scrollToTop() {
    this.logScrollBox.scrollTo(0) // Simplified for vertical scroll
  }

  private scrollToBottom() {
    const scrollHeight = this.logScrollBox.scrollHeight
    const viewportHeight = this.logScrollBox.viewport.height
    if (scrollHeight > viewportHeight) {
      this.logScrollBox.scrollTo(scrollHeight - viewportHeight)
    }
  }

  private startLogTail() {
    // Create a read stream for the log file
    this.logStream = createReadStream(this.options.logFile, {
      encoding: "utf8",
      start: 0
    })

    let buffer = ""

    this.logStream.on("data", (chunk) => {
      buffer += chunk.toString()
      const lines = buffer.split("\n")

      // Keep the last incomplete line in buffer
      buffer = lines.pop() || ""

      // Add complete lines to log content
      for (const line of lines) {
        if (line.trim()) {
          this.appendLog(line)
        }
      }
    })

    this.logStream.on("error", (error) => {
      this.appendLog(chalk.red(`Error reading log file: ${error.message}`))
    })

    // Watch for new content
    this.watchLogFile()
  }

  private watchLogFile() {
    watchFile(this.options.logFile, { interval: 100 }, (curr, prev) => {
      if (curr.size > prev.size) {
        // File has grown, read new content
        const stream = createReadStream(this.options.logFile, {
          encoding: "utf8",
          start: prev.size
        })

        let buffer = ""
        stream.on("data", (chunk) => {
          buffer += chunk.toString()
          const lines = buffer.split("\n")
          buffer = lines.pop() || ""

          for (const line of lines) {
            if (line.trim()) {
              this.appendLog(line)
            }
          }
        })
      }
    })
  }

  private appendLog(line: string) {
    // Create a new text component for this log line
    const logText = new TextRenderable(this.renderer, {
      id: `log-line-${Date.now()}-${Math.random()}`,
      left: 1, // Small padding from border
      top: this.logLineY++,
      content: line
      // wrap is not available in TextOptions
    })

    // Add to log content
    this.logContent.add(logText)

    // Update the height of the content box to fit all logs
    this.logContent.height = this.logLineY + 1

    // Limit the number of log lines to prevent memory issues
    const children = this.logContent.getChildren()
    if (children.length > 1000) {
      // Remove oldest log lines
      const toRemove = children.slice(0, 100)
      toRemove.forEach((child) => {
        this.logContent.remove(child.id)
      })

      // Reposition remaining lines
      this.logContent.getChildren().forEach((child: any, index: number) => {
        child.top = index
      })
      this.logLineY = this.logContent.getChildren().length
      this.logContent.height = this.logLineY + 1
    }

    // Auto-scroll to bottom if sticky scroll is enabled
    this.scrollToBottom()

    // Request re-render
    this.renderer.requestRender()
  }

  async shutdown() {
    if (this.isShuttingDown) return
    this.isShuttingDown = true

    // Reset terminal
    if (process.stdin.setRawMode) {
      process.stdin.setRawMode(false)
    }

    // Stop watching file
    unwatchFile(this.options.logFile)

    // Close log stream
    if (this.logStream) {
      this.logStream.destroy()
    }

    // Stop and destroy renderer
    this.renderer.stop()
    this.renderer.destroy()
  }
}
