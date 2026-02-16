import { type ChildProcess, execSync, spawn, spawnSync } from "child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { dirname, join } from "path"
import { fileURLToPath } from "url"
import { WebSocket } from "ws"

export interface CDPEvent {
  method: string
  params: Record<string, unknown>
  timestamp: number
  sessionId?: string
}

export interface CDPConnection {
  ws: WebSocket
  sessionId: string | null
  nextId: number
}

export class CDPMonitor {
  private browser: ChildProcess | null = null
  private connection: CDPConnection | null = null
  private debugPort: number = 9222
  private eventHandlers = new Map<string, (event: CDPEvent) => void>()
  private profileDir: string
  private screenshotDir: string
  private logger: (source: string, message: string) => void
  private debug: boolean = false
  private browserPath?: string
  private isShuttingDown = false
  private pendingRequests = 0
  private networkIdleTimer: NodeJS.Timeout | null = null
  private pluginReactScan: boolean = false
  private cdpUrl: string | null = null
  private lastScreenshotTime: number = 0
  private minScreenshotInterval: number = 1000 // Minimum 1 second between screenshots
  private navigationInProgress: boolean = false // Track if a navigation event recently occurred
  private chromePids: Set<number> = new Set() // Track all Chrome PIDs for this instance
  private onWindowClosedCallback: (() => void) | null = null // Callback for when window is manually closed
  private appServerPort?: string // Port of the user's app server to monitor
  private headless: boolean = false // Run Chrome in headless mode

  constructor(
    profileDir: string,
    screenshotDir: string,
    logger: (source: string, message: string) => void,
    debug: boolean = false,
    browserPath?: string,
    pluginReactScan: boolean = false,
    appServerPort?: string,
    debugPort?: number,
    headless: boolean = false
  ) {
    this.profileDir = profileDir
    this.screenshotDir = screenshotDir
    this.appServerPort = appServerPort
    this.logger = logger
    this.debug = debug
    this.browserPath = browserPath
    this.pluginReactScan = pluginReactScan
    this.headless = headless
    // Use custom debug port if provided, otherwise use default 9222
    if (debugPort) {
      this.debugPort = debugPort
    }
  }

  private debugLog(message: string) {
    if (this.debug) {
      console.log(`[CDP DEBUG] ${message}`)
    }
  }

  /**
   * Check if a URL should be monitored (i.e., it's from the user's app server, not dev3000's tools service or external sites)
   */
  private shouldMonitorUrl(url: string): boolean {
    try {
      const urlObj = new URL(url)
      const hostname = urlObj.hostname
      const port = urlObj.port || (urlObj.protocol === "https:" ? "443" : "80")

      // Only monitor localhost/127.0.0.1 (the user's local dev server)
      const isLocalhost = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "0.0.0.0"
      if (!isLocalhost) {
        return false
      }

      // If we have an app server port specified, only monitor that specific port
      if (this.appServerPort && port !== this.appServerPort) {
        return false
      }

      return true
    } catch {
      // If URL parsing fails, skip it (safer to under-monitor than over-monitor)
      return false
    }
  }

  async start(): Promise<void> {
    // Launch Chrome with CDP enabled
    this.debugLog("Starting Chrome launch process")
    await this.launchChrome()
    this.debugLog("Chrome launch completed")

    // Connect to Chrome DevTools Protocol
    this.debugLog("Starting CDP connection")
    await this.connectToCDP()
    this.debugLog("CDP connection completed")

    // Enable all the CDP domains we need for comprehensive monitoring
    this.debugLog("Starting CDP domain enablement")
    await this.enableCDPDomains()
    this.debugLog("CDP domain enablement completed")

    // Setup event handlers for comprehensive logging
    this.debugLog("Setting up CDP event handlers")
    this.setupEventHandlers()
    this.debugLog("CDP event handlers setup completed")
  }

  getCdpUrl(): string | null {
    return this.cdpUrl
  }

  getChromePids(): number[] {
    return Array.from(this.chromePids)
  }

  setOnWindowClosedCallback(callback: (() => void) | null): void {
    this.onWindowClosedCallback = callback
  }

  private async discoverChromePids(): Promise<void> {
    try {
      const { spawn } = await import("child_process")

      // Find all Chrome processes with our profile directory
      const profileDirEscaped = this.profileDir.replace(/'/g, "'\\''")
      const pidsOutput = await new Promise<string>((resolve) => {
        const proc = spawn("sh", ["-c", `pgrep -f '${profileDirEscaped}'`], {
          stdio: "pipe"
        })
        let output = ""
        proc.stdout?.on("data", (data) => {
          output += data.toString()
        })
        proc.on("exit", () => resolve(output.trim()))
      })

      const pids = pidsOutput
        .split("\n")
        .filter(Boolean)
        .map((pid) => parseInt(pid.trim(), 10))
        .filter((pid) => !Number.isNaN(pid))

      // Add main browser PID if we have it
      if (this.browser?.pid) {
        pids.push(this.browser.pid)
      }

      // Store unique PIDs
      for (const pid of pids) {
        this.chromePids.add(pid)
      }

      this.debugLog(
        `Discovered ${this.chromePids.size} Chrome PIDs for this instance: [${Array.from(this.chromePids).join(", ")}]`
      )
    } catch (error) {
      this.debugLog(`Failed to discover Chrome PIDs: ${error}`)
      // Fallback to just the main browser PID if we have it
      if (this.browser?.pid) {
        this.chromePids.add(this.browser.pid)
      }
    }
  }

  private createLoadingPage(): string {
    const loadingDir = join(tmpdir(), "dev3000-loading")
    if (!existsSync(loadingDir)) {
      mkdirSync(loadingDir, { recursive: true })
    }

    const loadingPath = join(loadingDir, "loading.html")

    // Read the loading HTML from the source file
    const currentFile = fileURLToPath(import.meta.url)
    const currentDir = dirname(currentFile)
    const loadingHtmlPath = join(currentDir, "src/loading.html")
    let loadingHtml: string

    try {
      loadingHtml = readFileSync(loadingHtmlPath, "utf-8")
    } catch (_error) {
      // Fallback to a simple loading page if file not found
      loadingHtml = `<!DOCTYPE html>
<html>
<head><title>dev3000 - Starting...</title></head>
<body style="font-family: system-ui; background: #1e1e1e; color: #fff; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0;">
  <div style="text-align: center;">
    <h1>dev3000</h1>
    <p>Starting development environment...</p>
  </div>
</body>
</html>`
    }

    writeFileSync(loadingPath, loadingHtml)
    return `file://${loadingPath}`
  }

  private setupRuntimeCrashMonitoring(): void {
    if (!this.browser) return

    // Remove existing launch-phase handlers to avoid duplicates
    this.browser.removeAllListeners("exit")
    this.browser.removeAllListeners("error")

    // Monitor for Chrome crashes during runtime
    this.browser.on("exit", (code, signal) => {
      if (!this.isShuttingDown) {
        // Distinguish between graceful quit (code 0, no signal) and actual crashes
        const isGracefulQuit = code === 0 && signal === null

        if (isGracefulQuit) {
          // User quit Chrome normally (e.g., Cmd+Q)
          this.logger("browser", "[EXIT] Chrome closed by user")
          this.debugLog("Chrome exited gracefully (user quit)")
        } else {
          // Actual crash - non-zero exit code or signal
          const crashMsg = `[CRASH] Chrome process exited unexpectedly - Code: ${code}, Signal: ${signal}`
          this.logger("browser", `${crashMsg}`)
          this.debugLog(`Chrome crashed: code=${code}, signal=${signal}`)

          // Log context for crash correlation
          this.logger("browser", "[CRASH] Chrome crashed - check recent server/browser logs for correlation")

          // Take screenshot if still connected (for crash context)
          if (this.connection && this.connection.ws.readyState === 1) {
            this.takeScreenshot("crash")
          }
        }
      }
    })

    this.browser.on("error", (error) => {
      if (!this.isShuttingDown) {
        this.logger("browser", `[CHROME] Chrome process error: ${error.message}`)
        this.debugLog(`Chrome process error during runtime: ${error}`)
      }
    })

    this.debugLog("Runtime crash monitoring enabled for Chrome process")
  }

  /**
   * Kill any existing Chrome process using this profile directory.
   * This prevents issues where Chrome defers to an existing instance
   * instead of starting a new one with CDP enabled.
   */
  private killExistingChromeWithProfile(): void {
    try {
      // Find Chrome processes using this profile directory without invoking a shell
      const psResult = spawnSync("ps", ["aux"], {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"]
      })

      if (psResult.error || psResult.status !== 0 || !psResult.stdout) {
        this.debugLog("Unable to list processes with ps")
        return
      }

      const searchToken = `user-data-dir=${this.profileDir}`
      const lines = psResult.stdout.split("\n")
      const pids: string[] = []

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue

        // Skip header line that typically starts with "USER"
        if (trimmed.toUpperCase().startsWith("USER")) continue

        if (trimmed.includes(searchToken)) {
          // ps aux format: USER PID %CPU %MEM VSZ RSS TTY STAT START TIME COMMAND
          const parts = trimmed.split(/\s+/)
          if (parts.length > 1) {
            const pid = parts[1]
            if (pid && /^\d+$/.test(pid)) {
              pids.push(pid)
            }
          }
        }
      }

      if (pids.length > 0) {
        for (const pid of pids) {
          this.debugLog(`Killing existing Chrome process ${pid} using profile ${this.profileDir}`)
          try {
            process.kill(Number.parseInt(pid, 10), "SIGTERM")
          } catch {
            // Process may have already exited
          }
        }
        // Give Chrome a moment to clean up
        execSync("sleep 0.5")
      }
    } catch {
      // No existing Chrome found or ps/grep not available
      this.debugLog("No existing Chrome process found with this profile")
    }
  }

  private async launchChrome(): Promise<void> {
    // Kill any existing Chrome using this profile to prevent CDP conflicts
    this.killExistingChromeWithProfile()

    return new Promise((resolve, reject) => {
      // Use custom browser path if provided, otherwise try different Chrome executables based on platform
      const chromeCommands = this.browserPath
        ? [this.browserPath]
        : [
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            "google-chrome",
            "chrome",
            "chromium",
            "/Applications/Arc.app/Contents/MacOS/Arc",
            "/Applications/Comet.app/Contents/MacOS/Comet",
            "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
          ]

      const browserType = this.browserPath ? "custom browser" : "Chrome"
      // Always log critical startup info (not just in debug mode)
      this.logger("browser", `[CDP] Launching ${browserType} on port ${this.debugPort}, headless=${this.headless}`)
      if (this.browserPath) {
        this.logger("browser", `[CDP] Custom browser path: ${this.browserPath}`)
      }
      this.debugLog(`Attempting to launch ${browserType} for CDP monitoring on port ${this.debugPort}`)
      this.debugLog(`Profile directory: ${this.profileDir}`)
      if (this.browserPath) {
        this.debugLog(`Custom browser path: ${this.browserPath}`)
      }

      let attemptIndex = 0

      const tryNextChrome = () => {
        if (attemptIndex >= chromeCommands.length) {
          const errorMsg = `Failed to launch Chrome: all ${chromeCommands.length} browser paths exhausted`
          this.logger("browser", `[CDP] ${errorMsg}`)
          reject(new Error(errorMsg))
          return
        }

        const chromePath = chromeCommands[attemptIndex]
        this.debugLog(`Trying Chrome path [${attemptIndex}]: ${chromePath}`)
        attemptIndex++

        // Build Chrome args - add headless flag if enabled
        const chromeArgs = [
          `--remote-debugging-port=${this.debugPort}`,
          `--user-data-dir=${this.profileDir}`,
          "--no-first-run",
          "--no-default-browser-check",
          "--disable-component-extensions-with-background-pages",
          "--disable-background-networking",
          "--disable-sync",
          "--metrics-recording-only",
          "--disable-default-apps",
          "--disable-session-crashed-bubble",
          "--disable-restore-session-state"
        ]

        if (this.headless) {
          // Use new headless mode (Chrome 112+) which has better compatibility
          chromeArgs.push("--headless=new")
          // Additional flags needed for headless in serverless environments
          chromeArgs.push("--no-sandbox")
          chromeArgs.push("--disable-setuid-sandbox")
          chromeArgs.push("--disable-gpu")
          chromeArgs.push("--disable-dev-shm-usage")
          this.debugLog("Launching Chrome in headless mode")
        } else {
          chromeArgs.push("--new-window") // Force new window (only for non-headless)
        }

        // Add initial page
        chromeArgs.push(this.createLoadingPage())

        this.browser = spawn(chromePath, chromeArgs, {
          stdio: "pipe",
          detached: true // Separate process group so Chrome doesn't receive SIGINT on Ctrl+C
        })

        if (!this.browser) {
          this.debugLog(`Failed to spawn Chrome process for path: ${chromePath}`)
          setTimeout(tryNextChrome, 100)
          return
        }

        let processExited = false

        this.browser.on("error", (error) => {
          // Always log spawn errors - critical for debugging sandbox issues
          this.logger("browser", `[CDP] Chrome spawn error: ${error.message}`)
          this.debugLog(`Chrome launch error for ${chromePath}: ${error.message}`)
          if (!this.isShuttingDown && !processExited) {
            processExited = true
            setTimeout(tryNextChrome, 100)
          }
        })

        this.browser.on("exit", (code, signal) => {
          if (!this.isShuttingDown && !processExited && code !== 0) {
            // Always log early exit - critical for debugging sandbox issues
            this.logger("browser", `[CDP] Chrome exited early with code ${code}, signal ${signal}`)
            this.debugLog(`Chrome exited early for ${chromePath} with code ${code}, signal ${signal}`)
            processExited = true
            setTimeout(tryNextChrome, 100)
          }
        })

        this.browser.stderr?.on("data", (data) => {
          this.debugLog(`Chrome stderr: ${data.toString().trim()}`)
        })

        this.browser.stdout?.on("data", (data) => {
          this.debugLog(`Chrome stdout: ${data.toString().trim()}`)
        })

        // Poll for Chrome readiness instead of fixed timeout
        const checkChromeReady = async (attempts = 0): Promise<void> => {
          const maxAttempts = 30 // 30 attempts = 15 seconds max

          if (processExited) {
            return
          }

          if (attempts >= maxAttempts) {
            const timeoutMsg = `Chrome readiness check timed out after ${maxAttempts * 500}ms`
            this.logger("browser", `[CDP] ${timeoutMsg}`)
            this.debugLog(timeoutMsg)
            processExited = true
            // Kill the unresponsive Chrome process before trying next browser
            if (this.browser && !this.browser.killed) {
              this.debugLog("Killing unresponsive Chrome process before trying next browser")
              this.browser.kill("SIGTERM")
            }
            setTimeout(tryNextChrome, 100)
            return
          }

          try {
            // Try to connect to CDP to verify Chrome is ready
            const response = await fetch(`http://localhost:${this.debugPort}/json`, {
              signal: AbortSignal.timeout(500)
            })
            if (response.ok) {
              this.logger("browser", `[CDP] Chrome successfully started (after ${attempts * 500}ms)`)
              this.debugLog(`Chrome successfully started with path: ${chromePath} (after ${attempts * 500}ms)`)

              // Discover all Chrome PIDs for this instance
              await this.discoverChromePids()

              // Set up runtime crash monitoring after successful launch
              this.setupRuntimeCrashMonitoring()

              resolve()
              return
            }
          } catch (_error) {
            // Chrome not ready yet, retry
          }

          setTimeout(() => checkChromeReady(attempts + 1), 500)
        }

        // Start checking after a small delay
        setTimeout(() => checkChromeReady(), 500)
      }

      tryNextChrome()
    })
  }

  private async connectToCDP(): Promise<void> {
    this.debugLog(`Attempting to connect to CDP on port ${this.debugPort}`)

    // Retry connection with exponential backoff
    let retryCount = 0
    const maxRetries = 5

    while (retryCount < maxRetries) {
      try {
        // Get the WebSocket URL from Chrome's debug endpoint
        const targetsResponse = await fetch(`http://localhost:${this.debugPort}/json`)
        const targets = await targetsResponse.json()

        this.debugLog(
          `Found ${targets.length} targets: ${JSON.stringify(targets.map((t: { type: string; url: string }) => ({ type: t.type, url: t.url })))}`
        )

        // Find the first page target (tab) - prefer 'page' type but accept any target with a webSocketDebuggerUrl
        let pageTarget = targets.find(
          (target: { type: string; webSocketDebuggerUrl: string }) => target.type === "page"
        )

        // Fallback: if no 'page' type found, try to use any target with a debugger URL
        if (!pageTarget && targets.length > 0) {
          pageTarget = targets.find((target: { webSocketDebuggerUrl?: string }) => target.webSocketDebuggerUrl)
          if (pageTarget) {
            this.debugLog(`No 'page' type target found, using target of type '${pageTarget.type}' instead`)
          }
        }

        if (!pageTarget) {
          throw new Error(`No debuggable target found in Chrome (found ${targets.length} targets)`)
        }

        const wsUrl = pageTarget.webSocketDebuggerUrl
        this.cdpUrl = wsUrl // Store the CDP URL
        this.debugLog(`Found page target: ${pageTarget.title || "Unknown"} - ${pageTarget.url}`)
        this.debugLog(`Got CDP WebSocket URL: ${wsUrl}`)

        return new Promise((resolve, reject) => {
          this.debugLog(`Creating WebSocket connection to: ${wsUrl}`)
          const ws = new WebSocket(wsUrl)

          // Increase max listeners to prevent warnings
          ws.setMaxListeners(20)

          ws.on("open", () => {
            this.debugLog("WebSocket connection opened successfully")
            this.connection = {
              ws,
              sessionId: null,
              nextId: 1
            }
            resolve()
          })

          ws.on("error", (error) => {
            this.debugLog(`WebSocket connection error: ${error}`)
            reject(error)
          })

          ws.on("message", (data) => {
            try {
              const message = JSON.parse(data.toString())
              this.handleCDPMessage(message)
            } catch (error) {
              this.logger("browser", `[CDP] Failed to parse message: ${error}`)
            }
          })

          ws.on("close", (code, reason) => {
            this.debugLog(`WebSocket closed with code ${code}, reason: ${reason}`)
            if (!this.isShuttingDown) {
              this.logger("browser", `[CDP] Connection lost unexpectedly (code: ${code}, reason: ${reason})`)
              this.logger("browser", "[CDP] CDP connection lost - check for Chrome crash or server issues")

              // Log current Chrome process status
              if (this.browser && !this.browser.killed) {
                this.logger("browser", "[CDP] Chrome process still running after CDP disconnect")
              } else {
                this.logger("browser", "[CDP] Chrome process not available after CDP disconnect")
              }

              // If Chrome process is gone or connection loss seems permanent, trigger shutdown
              // Use a small delay to distinguish between temporary reconnects and permanent failures
              setTimeout(() => {
                if (!this.isShuttingDown && this.onWindowClosedCallback) {
                  // Check if Chrome process is still alive
                  if (!this.browser || this.browser.killed || !this.browser.pid) {
                    this.debugLog("Chrome process is dead and CDP connection lost, triggering d3k shutdown")
                    this.logger("browser", "[CDP] Chrome process terminated, shutting down d3k")
                    this.onWindowClosedCallback()
                  } else {
                    // Chrome is alive but CDP connection is lost - this could be recoverable
                    this.debugLog("Chrome process alive but CDP connection lost - attempting recovery")
                    this.logger("browser", "[CDP] Attempting to recover from connection loss")
                    // Attempt to reconnect
                    this.attemptReconnect().catch((err) => {
                      this.logger("browser", `[CDP] Reconnection failed: ${err.message}`)
                    })
                  }
                }
              }, 2000) // Wait 2 seconds to see if it's a temporary disconnect
            }
          })

          // Connection timeout
          setTimeout(() => {
            this.debugLog(`WebSocket readyState: ${ws.readyState} (CONNECTING=0, OPEN=1, CLOSING=2, CLOSED=3)`)
            if (ws.readyState === WebSocket.CONNECTING) {
              this.debugLog("WebSocket connection timed out, closing")
              ws.close()
              reject(new Error("CDP connection timeout"))
            }
          }, 5000)
        })
      } catch (error) {
        retryCount++
        this.debugLog(`CDP connection attempt ${retryCount} failed: ${error}`)

        if (retryCount >= maxRetries) {
          throw new Error(`Failed to connect to CDP after ${maxRetries} attempts: ${error}`)
        }

        // Exponential backoff
        const delay = Math.min(1000 * 2 ** (retryCount - 1), 5000)
        this.debugLog(`Retrying CDP connection in ${delay}ms`)
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
    }
  }

  private async attemptReconnect(): Promise<void> {
    this.debugLog("Starting CDP reconnection attempt")
    this.logger("browser", "[CDP] Starting reconnection process...")

    // Close existing connection if any
    if (this.connection) {
      try {
        this.connection.ws.close()
      } catch (err) {
        this.debugLog(`Error closing old connection: ${err}`)
      }
      this.connection = null
    }

    // Attempt to reconnect
    try {
      await this.connectToCDP()
      this.logger("browser", "[CDP] Reconnection successful!")
      this.debugLog("CDP reconnection completed successfully")
    } catch (err) {
      this.logger("browser", `[CDP] Reconnection failed: ${err}`)
      throw err
    }
  }

  private async sendCDPCommand(method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    if (!this.connection) {
      throw new Error("No CDP connection available")
    }

    return new Promise((resolve, reject) => {
      const id = (this.connection as CDPConnection).nextId++
      const command = {
        id,
        method,
        params
      }

      const messageHandler = (data: Buffer) => {
        try {
          const message = JSON.parse(data.toString())
          if (message.id === id) {
            this.connection?.ws.removeListener("message", messageHandler)
            if (message.error) {
              reject(new Error(message.error.message))
            } else {
              resolve(message.result)
            }
          }
        } catch (error) {
          this.connection?.ws.removeListener("message", messageHandler)
          reject(error)
        }
      }

      this.connection?.ws.on("message", messageHandler)

      // Command timeout
      const timeout = setTimeout(() => {
        this.connection?.ws.removeListener("message", messageHandler)
        reject(new Error(`CDP command timeout: ${method}`))
      }, 10000)

      // Clear timeout if command succeeds/fails
      const originalResolve = resolve
      const originalReject = reject
      resolve = (value: Record<string, unknown> | PromiseLike<Record<string, unknown>>) => {
        clearTimeout(timeout)
        originalResolve(value)
      }
      reject = (reason: unknown) => {
        clearTimeout(timeout)
        originalReject(reason)
      }

      this.connection?.ws.send(JSON.stringify(command))
    })
  }

  private async enableCDPDomains(): Promise<void> {
    const domains = [
      "Runtime", // Console logs, exceptions
      "Network", // Network requests/responses
      "Page", // Page events, navigation
      "DOM", // DOM mutations
      "Performance", // Performance metrics
      "Security", // Security events
      "Log", // Browser console logs
      "Target" // Target events (window/tab creation/destruction)
      // Note: Input domain is for dispatching events, not monitoring them - we use JS injection instead
    ]

    for (const domain of domains) {
      try {
        this.debugLog(`Enabling CDP domain: ${domain}`)
        await this.sendCDPCommand(`${domain}.enable`)
        this.debugLog(`Successfully enabled CDP domain: ${domain}`)
        if (this.debug) {
          this.logger("browser", `[CDP] Enabled ${domain} domain`)
        }
      } catch (error) {
        this.debugLog(`Failed to enable CDP domain ${domain}: ${error}`)
        // Only log CDP errors when debug mode is enabled
        if (this.debug) {
          this.logger("browser", `[CDP] Failed to enable ${domain}: ${error}`)
        }
        // Continue with other domains instead of throwing
      }
    }

    this.debugLog("Enabling runtime for console and exception capture")
    await this.sendCDPCommand("Runtime.enable")
    await this.sendCDPCommand("Runtime.setAsyncCallStackDepth", {
      maxDepth: 32
    })
    this.debugLog("CDP domains enabled successfully")

    // Set viewport for headless mode to ensure consistent CLS measurements
    // Without this, headless Chrome defaults to 800x600 which can cause
    // different layout behavior than typical desktop viewports
    if (this.headless) {
      this.debugLog("Setting viewport for headless mode (1920x1080)")
      try {
        await this.sendCDPCommand("Emulation.setDeviceMetricsOverride", {
          width: 1920,
          height: 1080,
          deviceScaleFactor: 1,
          mobile: false
        })
        this.logger("browser", "[CDP] Set viewport to 1920x1080 for headless mode")
      } catch (error) {
        this.debugLog(`Failed to set viewport: ${error}`)
      }
    }
  }

  private setupEventHandlers(): void {
    // Console messages with full context
    this.onCDPEvent("Runtime.consoleAPICalled", (event) => {
      const params = event.params as {
        type?: string
        args?: Array<{ type: string; value?: string; preview?: unknown }>
        stackTrace?: {
          callFrames: Array<{
            functionName?: string
            url: string
            lineNumber: number
          }>
        }
      }
      this.debugLog(`Runtime.consoleAPICalled event received: ${params.type}`)
      const { type, args, stackTrace } = params

      // Debug: Log all console messages to see if tracking script is working
      if (args && args.length > 0) {
        this.debugLog(`Console message value: ${args[0].value}`)
        this.debugLog(`Console message full arg: ${JSON.stringify(args[0])}`)
      }

      // Debug: Log all console messages to see if tracking script is even running
      if (args && args.length > 0 && args[0].value?.includes("CDP tracking initialized")) {
        if (this.debug) {
          this.logger("browser", `[DEBUG] Interaction tracking script loaded successfully`)
        }
      }

      // Log regular console messages with enhanced context
      // Handle console formatting: if first arg has %c, skip style string args
      let formatCount = 0
      if (args && args.length > 0 && args[0].type === "string" && args[0].value) {
        formatCount = (args[0].value.match(/%c/g) || []).length
      }

      const values = (args || [])
        .map((arg: { type: string; value?: string; preview?: unknown }, index: number) => {
          // Skip style string arguments (they come after the format string)
          if (formatCount > 0 && index > 0 && index <= formatCount && arg.type === "string") {
            return null // Skip style strings
          }

          if (arg.type === "object" && arg.preview) {
            return JSON.stringify(arg.preview)
          }

          // For the first string argument, strip %c formatting directives
          if (index === 0 && arg.type === "string" && arg.value && formatCount > 0) {
            return arg.value.replace(/%c/g, "")
          }

          return arg.value || "[object]"
        })
        .filter((v) => v !== null) // Remove skipped style strings
        .join(" ")

      // Simplify console tags - we already have [BROWSER] prefix
      const typeTag =
        type === "error"
          ? "ERROR"
          : type === "warn"
            ? "WARNING"
            : type === "info"
              ? "INFO"
              : type === "debug"
                ? "DEBUG"
                : "LOG"
      let logMsg = `[${typeTag}] ${values}`

      // Add stack trace for errors
      if (stackTrace && (type === "error" || type === "assert")) {
        logMsg += `\n[STACK] ${stackTrace.callFrames
          .slice(0, 3)
          .map(
            (frame: { functionName?: string; url: string; lineNumber: number }) =>
              `${frame.functionName || "anonymous"}@${frame.url}:${frame.lineNumber}`
          )
          .join(" -> ")}`
      }

      this.logger("browser", logMsg)
    })

    // Runtime exceptions with full stack traces
    this.onCDPEvent("Runtime.exceptionThrown", (event) => {
      this.debugLog("Runtime.exceptionThrown event received")
      const params = event.params as {
        exceptionDetails: {
          text: string
          lineNumber: number
          columnNumber: number
          url?: string
          stackTrace?: {
            callFrames: Array<{
              functionName?: string
              url: string
              lineNumber: number
            }>
          }
        }
      }
      const { text, lineNumber, columnNumber, url, stackTrace } = params.exceptionDetails

      let errorMsg = `[ERROR] ${text}`
      if (url) errorMsg += ` at ${url}:${lineNumber}:${columnNumber}`

      if (stackTrace) {
        errorMsg += `\n[STACK] ${stackTrace.callFrames
          .slice(0, 5)
          .map(
            (frame: { functionName?: string; url: string; lineNumber: number }) =>
              `${frame.functionName || "anonymous"}@${frame.url}:${frame.lineNumber}`
          )
          .join(" -> ")}`
      }

      this.logger("browser", errorMsg)

      // Take screenshot immediately on errors (no delay needed)
      this.takeScreenshot("error")
    })

    // Browser console logs via Log domain (additional capture method)
    this.onCDPEvent("Log.entryAdded", (event) => {
      const params = event.params as {
        entry: {
          level?: string
          text: string
          url?: string
          lineNumber?: number
        }
      }
      const { level, text, url, lineNumber } = params.entry

      let logMsg = `[CONSOLE ${(level || "log").toUpperCase()}] ${text}`
      if (url && lineNumber) {
        logMsg += ` at ${url}:${lineNumber}`
      }

      // Only log if it's an error/warning or if we're not already capturing it via Runtime
      if (level === "error" || level === "warning") {
        this.logger("browser", logMsg)
      }
    })

    // Network requests with full details
    this.onCDPEvent("Network.requestWillBeSent", (event) => {
      const params = event.params as {
        request: {
          url: string
          method: string
          headers?: Record<string, string>
          postData?: string
        }
        type?: string
        initiator?: { type: string }
      }
      const { url, method, headers, postData } = params.request
      const { type, initiator } = params

      // Skip requests to dev3000's tools service
      if (!this.shouldMonitorUrl(url)) {
        return
      }

      let logMsg = `[NETWORK] ${method} ${url}`
      if (type) logMsg += ` (${type})`
      if (initiator?.type) logMsg += ` initiated by ${initiator.type}`

      // Log important headers
      const importantHeaders = ["content-type", "authorization", "cookie"]
      const headerInfo = importantHeaders
        .filter((h) => headers?.[h])
        .map((h) => {
          const maxLength = h === "authorization" ? 10 : 50
          return `${h}: ${headers?.[h]?.slice(0, maxLength) || ""}${
            (headers?.[h]?.length || 0) > maxLength ? "..." : ""
          }`
        })
        .join(", ")

      if (headerInfo) logMsg += ` [${headerInfo}]`
      if (postData) logMsg += ` body: ${postData.slice(0, 100)}${postData.length > 100 ? "..." : ""}`

      this.logger("browser", logMsg)
    })

    // Network responses with full details
    this.onCDPEvent("Network.responseReceived", (event) => {
      const params = event.params as {
        response: {
          url: string
          status: number
          statusText: string
          mimeType?: string
          timing?: { receiveHeadersEnd: number; requestTime: number }
        }
        type?: string
      }
      const { url, status, statusText, mimeType } = params.response
      const { type } = params

      // Skip responses from dev3000's tools service
      if (!this.shouldMonitorUrl(url)) {
        return
      }

      let logMsg = `[NETWORK] ${status} ${statusText} ${url}`
      if (type) logMsg += ` (${type})`
      if (mimeType) logMsg += ` [${mimeType}]`

      // Add timing info if available
      const timing = params.response.timing
      if (timing) {
        const totalTime = Math.round(timing.receiveHeadersEnd - timing.requestTime)
        if (totalTime > 0) logMsg += ` (${totalTime}ms)`
      }

      this.logger("browser", logMsg)
    })

    // Page navigation with full context
    this.onCDPEvent("Page.frameNavigated", (event) => {
      const params = event.params as {
        frame?: { url?: string; parentId?: string }
      }
      const { frame } = params
      if (frame?.parentId) return // Only log main frame navigation

      const url = frame?.url || "unknown"

      // Skip navigation to dev3000's tools service
      if (!this.shouldMonitorUrl(url)) {
        return
      }

      this.logger("browser", `[NAVIGATION] ${url}`)

      // Mark that we're in a navigation - we'll take a screenshot when it settles
      this.navigationInProgress = true
    })

    // Page load events for better screenshot timing
    this.onCDPEvent("Page.loadEventFired", async (_event) => {
      this.logger("browser", "[DOM] Load event fired")
      this.takeScreenshot("page-loaded")
      // Reinject interaction tracking on page load
      await this.setupInteractionTracking()
    })

    this.onCDPEvent("Page.domContentEventFired", async (_event) => {
      this.logger("browser", "[DOM] DOM content loaded")
      // Skip screenshot on DOM content loaded - we'll get one on page-loaded
      // Reinject interaction tracking on DOM content loaded
      await this.setupInteractionTracking()
    })

    // Network activity tracking for better screenshot timing
    this.onCDPEvent("Network.requestWillBeSent", (_event) => {
      this.pendingRequests++
      if (this.networkIdleTimer) {
        clearTimeout(this.networkIdleTimer)
        this.networkIdleTimer = null
      }
    })

    this.onCDPEvent("Network.loadingFinished", (_event) => {
      this.pendingRequests--
      this.scheduleNetworkIdleScreenshot()
    })

    this.onCDPEvent("Network.loadingFailed", (_event) => {
      this.pendingRequests--
      this.scheduleNetworkIdleScreenshot()
    })

    // DOM mutations for interaction context
    this.onCDPEvent("DOM.documentUpdated", () => {
      // Document structure changed - useful for SPA routing
      this.logger("browser", "[DOM] Document updated")
    })

    // Note: Input.dispatchMouseEvent and Input.dispatchKeyEvent are for SENDING events, not capturing them
    // We need to rely on JavaScript injection for user input capture since CDP doesn't have
    // direct "user input monitoring" events - it's designed for automation, not monitoring

    // Performance metrics - disabled to reduce log noise
    // this.onCDPEvent('Performance.metrics', (event) => {
    //   const metrics = event.params.metrics;
    //   const importantMetrics = metrics.filter((m: any) =>
    //     ['JSHeapUsedSize', 'JSHeapTotalSize', 'Nodes', 'Documents'].includes(m.name)
    //   );
    //
    //   if (importantMetrics.length > 0) {
    //     const metricsStr = importantMetrics
    //       .map((m: any) => `${m.name}:${Math.round(m.value)}`)
    //       .join(' ');
    //     this.logger('browser', `[PERFORMANCE] ${metricsStr}`);
    //   }
    // });

    // Target events - handle window/tab destruction
    this.onCDPEvent("Target.targetDestroyed", (event) => {
      const params = event.params as { targetId: string }
      this.debugLog(`Target destroyed: ${params.targetId}`)
      this.logger("browser", `[TARGET] Window/tab closed: ${params.targetId}`)

      // If this is our main tab/window being closed, trigger shutdown callback
      if (this.onWindowClosedCallback && !this.isShuttingDown) {
        this.debugLog("Chrome window was manually closed, triggering d3k shutdown")
        this.logger("browser", "[TARGET] Chrome window manually closed, shutting down d3k")
        this.onWindowClosedCallback()
      }
    })
  }

  private onCDPEvent(method: string, handler: (event: CDPEvent) => void): void {
    this.eventHandlers.set(method, handler)
  }

  private handleCDPMessage(message: { method?: string; params?: Record<string, unknown>; sessionId?: string }): void {
    if (message.method) {
      const handler = this.eventHandlers.get(message.method)
      if (handler) {
        const event: CDPEvent = {
          method: message.method,
          params: message.params || {},
          timestamp: Date.now(),
          sessionId: message.sessionId
        }
        handler(event)
      }
    }
  }

  async navigateToApp(port: string, useHttps: boolean = false): Promise<void> {
    if (!this.connection) {
      throw new Error("No CDP connection available")
    }

    const protocol = useHttps ? "https" : "http"
    const url = `${protocol}://localhost:${port}`
    const navigationStartTime = Date.now()
    this.debugLog(`Navigating to ${url}`)

    // Navigate to the app
    try {
      const result = await this.sendCDPCommand("Page.navigate", {
        url
      })

      const navigationTime = Date.now() - navigationStartTime
      this.debugLog(`Navigation command sent successfully (${navigationTime}ms)`)
      this.debugLog(`Navigation result: ${JSON.stringify(result)}`)

      // Check if navigation was successful
      if (result.errorText) {
        this.debugLog(`Navigation error: ${result.errorText}`)
        this.logger("browser", `[CDP] Navigation failed: ${result.errorText}`)
      }

      // No need to wait for navigation to complete - Chrome will fire events as the page loads
      // and we'll capture errors/logs via our CDP event handlers. This allows slow-compiling
      // apps (like Next.js on first load) to take as long as they need.
      if (result.frameId) {
        this.debugLog(`Navigation initiated for frame ${result.frameId} - not blocking on load completion`)
      }
    } catch (error) {
      this.debugLog(`Navigation failed: ${error}`)
      this.logger("browser", `[CDP] Navigation failed: ${error}`)
      throw error
    }

    // Take a delayed screenshot to catch dynamic content
    setTimeout(() => {
      this.takeScreenshot("navigation-delayed")
    }, 2000)

    // Set up interaction tracking - but be more efficient about it
    const trackingStartTime = Date.now()
    this.debugLog("Setting up interaction tracking")

    // Initial setup - this should be enough for most cases
    await this.setupInteractionTracking()

    // Only add one backup setup with a shorter delay (removing redundant 2s delay)
    setTimeout(async () => {
      this.debugLog("Running backup interaction tracking setup")
      await this.setupInteractionTracking()
    }, 500) // Reduced from 1000ms

    const trackingTime = Date.now() - trackingStartTime
    this.debugLog(`Interaction tracking setup completed (${trackingTime}ms)`)

    // Start polling for interactions from the injected script
    this.startInteractionPolling()

    // Multiple screenshot triggers will ensure we catch the initial page load
  }

  private async setupInteractionTracking(): Promise<void> {
    try {
      // First check if tracking is already set up to avoid redundant injections
      this.debugLog("About to check if tracking is already set up...")
      const checkResult = (await this.sendCDPCommand("Runtime.evaluate", {
        expression: "!!window.__dev3000_cdp_tracking",
        returnByValue: true
      })) as { result?: { value?: unknown } }

      if (checkResult.result?.value === true) {
        this.debugLog("Interaction tracking already set up, skipping")
        return
      }

      this.debugLog("About to inject tracking script...")
      // Full interaction tracking script with element details for replay
      const trackingScript = `
        try {
          if (!window.__dev3000_cdp_tracking) {
            window.__dev3000_cdp_tracking = true;
            
            ${
              this.pluginReactScan
                ? `
            // Inject react-scan for React performance monitoring
            if (!window.__REACT_SCAN_INJECTED__) {
              const script = document.createElement('script');
              script.src = 'https://unpkg.com/react-scan@latest/dist/auto.global.js';
              script.onload = () => {
                console.debug('[DEV3000] react-scan loaded successfully');
                window.__REACT_SCAN_INJECTED__ = true;
                
                // Optional: Configure react-scan
                if (window.ReactScan && window.ReactScan.configure) {
                  window.ReactScan.configure({
                    // Add any configuration options here
                    playSound: false,
                    showToolbar: true
                  });
                }
              };
              script.onerror = (err) => {
                console.debug('[DEV3000] Failed to load react-scan:', err);
              };
              document.head.appendChild(script);
            }
            `
                : ""
            }
            
            // Helper function to generate CSS selector for element
            function getElementSelector(el) {
              if (!el || el === document) return 'document';
              
              // Try ID first (most reliable)
              if (el.id) return '#' + el.id;
              
              // Build path with tag + classes
              let selector = el.tagName.toLowerCase();
              if (el.className && typeof el.className === 'string') {
                let classes = el.className.trim().split(/\\\\s+/).filter(c => c.length > 0);
                if (classes.length > 0) selector += '.' + classes.join('.');
              }
              
              // Add nth-child if needed to make unique
              if (el.parentNode) {
                let siblings = Array.from(el.parentNode.children).filter(child => 
                  child.tagName === el.tagName && 
                  child.className === el.className
                );
                if (siblings.length > 1) {
                  let index = siblings.indexOf(el) + 1;
                  selector += ':nth-child(' + index + ')';
                }
              }
              
              return selector;
            }
            
            // Helper to get element details for replay
            function getElementDetails(el) {
              let details = {
                selector: getElementSelector(el),
                tag: el.tagName.toLowerCase(),
                text: el.textContent ? el.textContent.trim().substring(0, 50) : '',
                id: el.id || '',
                className: el.className || '',
                name: el.name || '',
                type: el.type || '',
                value: el.value || ''
              };
              return JSON.stringify(details);
            }
            
            // Scroll coalescing variables  
            let scrollTimeout = null;
            let lastScrollX = 0;
            let lastScrollY = 0;
            let scrollStartX = 0;
            let scrollStartY = 0;
            let scrollTarget = 'document';
            
            // Add click tracking with element details
            document.addEventListener('click', function(e) {
              let details = getElementDetails(e.target);
              // Send interaction data via custom event instead of console.log to avoid user visibility
              window.dispatchEvent(new CustomEvent('dev3000-interaction', {
                detail: { type: 'CLICK', x: e.clientX, y: e.clientY, element: details }
              }));
            });
            
            // Add key tracking with element details
            document.addEventListener('keydown', function(e) {
              let details = getElementDetails(e.target);
              // Send interaction data via custom event instead of console.log to avoid user visibility
              window.dispatchEvent(new CustomEvent('dev3000-interaction', {
                detail: { type: 'KEY', key: e.key, element: details }
              }));
            });
            
            // Add coalesced scroll tracking with capture to catch all scroll events
            document.addEventListener('scroll', function(e) {
              let target = e.target === document ? 'document' : getElementSelector(e.target);
              let currentScrollX, currentScrollY;
              
              // Get scroll position from the actual scrolling element
              if (e.target === document) {
                currentScrollX = window.scrollX;
                currentScrollY = window.scrollY;
              } else {
                currentScrollX = e.target.scrollLeft;
                currentScrollY = e.target.scrollTop;
              }
              
              // If this is the first scroll event or different target, reset
              if (scrollTimeout === null || scrollTarget !== target) {
                scrollStartX = currentScrollX;
                scrollStartY = currentScrollY;
                scrollTarget = target;
              } else {
                clearTimeout(scrollTimeout);
              }
              
              // Update current position
              lastScrollX = currentScrollX;
              lastScrollY = currentScrollY;
              
              // Set timeout to log scroll after 300ms of no scrolling (scroll settled)
              scrollTimeout = setTimeout(function() {
                // Only log if there was actual movement (threshold of 5 pixels)
                let deltaX = Math.abs(lastScrollX - scrollStartX);
                let deltaY = Math.abs(lastScrollY - scrollStartY);
                
                if (deltaX > 5 || deltaY > 5) {
                  // Send interaction data via custom event instead of console.log to avoid user visibility
                  window.dispatchEvent(new CustomEvent('dev3000-interaction', {
                    detail: { type: 'SCROLL', from: { x: scrollStartX, y: scrollStartY }, to: { x: lastScrollX, y: lastScrollY }, target: target }
                  }));
                  window.dispatchEvent(new CustomEvent('dev3000-interaction', {
                    detail: { type: 'SCROLL_SETTLED', x: lastScrollX, y: lastScrollY }
                  }));
                }
                scrollTimeout = null;
              }, 300);
            }, true); // Use capture: true to catch scroll events on all elements
            
            // Listen for our custom interaction events and store them for CDP polling
            window.__dev3000_interactions = [];
            
            window.addEventListener('dev3000-interaction', function(e) {
              const detail = e.detail;
              let message = '';
              
              switch(detail.type) {
                case 'CLICK':
                  message = 'CLICK at ' + detail.x + ',' + detail.y + ' on ' + detail.element;
                  break;
                case 'KEY':
                  message = 'KEY ' + detail.key + ' in ' + detail.element;
                  break;
                case 'SCROLL':
                  message = 'SCROLL from ' + detail.from.x + ',' + detail.from.y + ' to ' + detail.to.x + ',' + detail.to.y + ' in ' + detail.target;
                  break;
                case 'SCROLL_SETTLED':
                  message = 'SCROLL_SETTLED at ' + detail.x + ',' + detail.y;
                  break;
              }
              
              if (message) {
                // Store interaction in array for CDP to poll, don't log to console
                window.__dev3000_interactions.push({
                  timestamp: Date.now(),
                  message: message
                });
                
                // Keep only last 100 interactions to avoid memory issues
                if (window.__dev3000_interactions.length > 100) {
                  window.__dev3000_interactions = window.__dev3000_interactions.slice(-100);
                }
              }
            });
            
            console.debug('CDP tracking initialized');
          }
        } catch (err) {
          console.debug('[DEV3000_INTERACTION] ERROR: ' + err.message);
        }
      `

      this.debugLog("About to inject tracking script...")

      // Validate JavaScript syntax before injection
      try {
        new Function(trackingScript)
        this.debugLog("JavaScript syntax validation passed")
      } catch (syntaxError) {
        const errorMessage = syntaxError instanceof Error ? syntaxError.message : String(syntaxError)
        this.debugLog(`JavaScript syntax error detected: ${errorMessage}`)
        this.logger("browser", `[CDP] Tracking script syntax error: ${errorMessage}`)
        throw new Error(`Invalid tracking script syntax: ${errorMessage}`)
      }

      const result = await this.sendCDPCommand("Runtime.evaluate", {
        expression: trackingScript,
        includeCommandLineAPI: false
      })

      this.debugLog(`Interaction tracking script injected. Result: ${JSON.stringify(result)}`)

      // Log any errors from the script injection
      const resultWithDetails = result as {
        exceptionDetails?: { exception?: { description?: string } }
      }
      if (resultWithDetails.exceptionDetails) {
        this.debugLog(`Script injection exception: ${JSON.stringify(resultWithDetails.exceptionDetails)}`)
        this.logger(
          "browser",
          `[DEBUG] Script injection exception: ${
            resultWithDetails.exceptionDetails.exception?.description || "Unknown error"
          }`
        )
      }
    } catch (error) {
      this.debugLog(`Failed to inject interaction tracking: ${error}`)
      this.logger("browser", `[CDP] Interaction tracking failed: ${error}`)
    }
  }

  private startInteractionPolling(): void {
    // Poll for interactions every 500ms to avoid console.log spam
    const pollInteractions = async () => {
      if (this.isShuttingDown) return

      try {
        const result = (await this.sendCDPCommand("Runtime.evaluate", {
          expression: `
            (() => {
              if (window.__dev3000_interactions && window.__dev3000_interactions.length > 0) {
                const interactions = [...window.__dev3000_interactions];
                window.__dev3000_interactions = []; // Clear the array
                return interactions;
              }
              return [];
            })()
          `,
          returnByValue: true
        })) as {
          result?: { value?: Array<{ timestamp: number; message: string }> }
        }

        const interactions = result.result?.value || []

        for (const interaction of interactions) {
          this.logger("browser", `[INTERACTION] ${interaction.message}`)

          // Take screenshot when scroll settles
          if (interaction.message.startsWith("SCROLL_SETTLED")) {
            this.takeScreenshot("scroll-settled")
          }
        }
      } catch (error) {
        this.debugLog(`Failed to poll interactions: ${error}`)
      }

      // Continue polling if not shutting down
      if (!this.isShuttingDown) {
        setTimeout(pollInteractions, 500)
      }
    }

    // Start polling after a brief delay to ensure injection script is ready
    setTimeout(() => {
      pollInteractions()
    }, 1000)
  }

  private scheduleNetworkIdleScreenshot(): void {
    // Only take network-idle screenshots after a navigation event
    // This prevents screenshot spam from background AJAX/fetch polls
    if (!this.navigationInProgress) {
      return
    }

    // Only schedule if we have 0 pending requests
    if (this.pendingRequests === 0) {
      if (this.networkIdleTimer) {
        clearTimeout(this.networkIdleTimer)
      }

      // Wait 500ms of network idle before taking screenshot
      this.networkIdleTimer = setTimeout(() => {
        this.takeScreenshot("navigation-settled")
        // Reset navigation flag since we've captured the settled state
        this.navigationInProgress = false
        this.networkIdleTimer = null
      }, 500)
    }
  }

  private async takeScreenshot(event: string): Promise<string | null> {
    try {
      // Throttle screenshots to avoid spam
      const now = Date.now()
      const timeSinceLastScreenshot = now - this.lastScreenshotTime

      // Special cases that should always take screenshots
      const priorityEvents = ["error", "crash"]

      // If not a priority event and we took a screenshot recently, skip it
      if (!priorityEvents.includes(event) && timeSinceLastScreenshot < this.minScreenshotInterval) {
        this.debugLog(`Skipping screenshot for ${event} - only ${timeSinceLastScreenshot}ms since last screenshot`)
        return null
      }

      // Update last screenshot time
      this.lastScreenshotTime = now
      const result = await this.sendCDPCommand("Page.captureScreenshot", {
        format: "png",
        quality: 80,
        clip: undefined, // Full viewport
        fromSurface: true
      })

      const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
      const filename = `${timestamp}-${event}.png`
      const screenshotPath = join(this.screenshotDir, filename)

      // Save the base64 image
      const resultWithData = result as { data: string }
      const buffer = Buffer.from(resultWithData.data, "base64")
      writeFileSync(screenshotPath, buffer)

      // Log screenshot with file path
      this.logger("browser", `[SCREENSHOT] ${screenshotPath}`)

      return filename
    } catch (error) {
      this.logger("browser", `[CDP] Screenshot failed: ${error}`)
      return null
    }
  }

  // Enhanced replay functionality using CDP
  async executeInteraction(interaction: {
    type: string
    coordinates?: { x: number; y: number }
    key?: string
    code?: string
    modifiers?: Record<string, unknown>
    to?: { x: number; y: number }
    from?: { x: number; y: number }
  }): Promise<void> {
    if (!this.connection) {
      throw new Error("No CDP connection available")
    }

    try {
      switch (interaction.type) {
        case "CLICK":
          if (!interaction.coordinates) break
          await this.sendCDPCommand("Input.dispatchMouseEvent", {
            type: "mousePressed",
            x: interaction.coordinates.x,
            y: interaction.coordinates.y,
            button: "left",
            clickCount: 1
          })

          await this.sendCDPCommand("Input.dispatchMouseEvent", {
            type: "mouseReleased",
            x: interaction.coordinates.x,
            y: interaction.coordinates.y,
            button: "left",
            clickCount: 1
          })
          break

        case "KEYDOWN":
          await this.sendCDPCommand("Input.dispatchKeyEvent", {
            type: "keyDown",
            key: interaction.key,
            code: interaction.code,
            ...interaction.modifiers
          })
          break

        case "SCROLL":
          if (!interaction.to || !interaction.from) break
          await this.sendCDPCommand("Input.dispatchMouseEvent", {
            type: "mouseWheel",
            x: interaction.to.x,
            y: interaction.to.y,
            deltaX: interaction.to.x - interaction.from.x,
            deltaY: interaction.to.y - interaction.from.y
          })
          break

        default:
          this.logger("browser", `[REPLAY] Unknown interaction type: ${interaction.type}`)
      }
    } catch (error) {
      this.logger("browser", `[REPLAY] Failed to execute ${interaction.type}: ${error}`)
    }
  }

  /**
   * Signal that shutdown is starting - stops reconnection attempts.
   * Call this before killing the app server to prevent CDP reconnection loops.
   */
  prepareShutdown(): void {
    this.isShuttingDown = true
    this.debugLog("Shutdown signaled - reconnection attempts will be blocked")
  }

  async shutdown(): Promise<void> {
    this.isShuttingDown = true

    // Try to close the page first, then the tab
    if (this.connection?.sessionId) {
      try {
        // Try to close the page
        await this.sendCDPCommand("Page.close")
        this.debugLog("Sent Page.close command")
        await new Promise((resolve) => setTimeout(resolve, 100))
      } catch (_e) {
        this.debugLog("Page.close failed, trying Target.closeTarget")
      }

      try {
        // Get the list of targets to find our specific tab
        const targets = (await this.sendCDPCommand("Target.getTargets")) as {
          targetInfos: Array<{ targetId: string; type: string }>
        }
        this.debugLog(`Found ${targets.targetInfos?.length || 0} targets`)

        // Find our page target
        const pageTarget = targets.targetInfos?.find((t) => t.type === "page")
        if (pageTarget) {
          this.debugLog(`Closing page target: ${pageTarget.targetId}`)
          await this.sendCDPCommand("Target.closeTarget", {
            targetId: pageTarget.targetId
          })
          this.debugLog("Closed Chrome tab via CDP")
        }

        // Give it more time for the tab to close
        await new Promise((resolve) => setTimeout(resolve, 1000))
      } catch (_e) {
        this.debugLog("Failed to close tab via CDP, will force close Chrome")
      }
    }

    // Close CDP connection
    if (this.connection) {
      try {
        this.connection.ws.close()
      } catch (_e) {
        // Ignore close errors
      }
      this.connection = null
    }

    // Kill only the Chrome processes for THIS instance
    await this.killInstanceChromeProcesses()
  }

  private async killInstanceChromeProcesses(): Promise<void> {
    try {
      // Re-discover PIDs in case any new processes spawned
      await this.discoverChromePids()

      if (this.chromePids.size === 0) {
        this.debugLog("No Chrome PIDs to kill for this instance")
        return
      }

      const pidsArray = Array.from(this.chromePids)
      this.debugLog(`Killing Chrome PIDs for this instance: [${pidsArray.join(", ")}]`)

      // Kill each PID individually with proper error handling
      for (const pid of pidsArray) {
        try {
          // Check if process still exists
          process.kill(pid, 0)

          // Process exists, kill it
          this.debugLog(`Killing Chrome process ${pid}`)
          process.kill(pid, "SIGTERM")

          // Give it a moment to close gracefully
          await new Promise((resolve) => setTimeout(resolve, 200))

          // Check if it's still alive and force kill if needed
          try {
            process.kill(pid, 0)
            this.debugLog(`Chrome process ${pid} didn't die from SIGTERM, sending SIGKILL`)
            process.kill(pid, "SIGKILL")
          } catch {
            this.debugLog(`Chrome process ${pid} terminated after SIGTERM`)
          }
        } catch {
          this.debugLog(`Chrome process ${pid} is already dead`)
        }
      }

      // Clear our PID tracking
      this.chromePids.clear()

      this.debugLog("Completed killing Chrome processes for this instance")
    } catch (error) {
      this.debugLog(`Error killing instance Chrome processes: ${error}`)
    }
  }
}
