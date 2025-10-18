import { type ChildProcess, spawn } from "child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { dirname, join } from "path"
import { fileURLToPath } from "url"
import { WebSocket } from "ws"
import { LogLevel, type Logger as StructuredLogger } from "./utils/logger.js"

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
  private fileLogger: (source: string, message: string) => void // File logging callback
  private logger: StructuredLogger // Structured console logger
  private browserPath?: string
  private isShuttingDown = false
  private pendingRequests = 0
  private networkIdleTimer: NodeJS.Timeout | null = null
  private pluginReactScan: boolean = false
  private cdpUrl: string | null = null
  private lastScreenshotTime: number = 0
  private minScreenshotInterval: number = 1000 // Minimum 1 second between screenshots
  private chromePids: Set<number> = new Set() // Track all Chrome PIDs for this instance
  private onWindowClosedCallback: (() => void) | null = null // Callback for when window is manually closed
  private appServerPort?: string // Port of the user's app server to monitor
  private mcpServerPort?: string // Port of dev3000's MCP server to ignore

  constructor(
    profileDir: string,
    screenshotDir: string,
    fileLogger: (source: string, message: string) => void,
    structuredLogger: StructuredLogger,
    browserPath?: string,
    pluginReactScan: boolean = false,
    appServerPort?: string,
    mcpServerPort?: string
  ) {
    this.profileDir = profileDir
    this.screenshotDir = screenshotDir
    this.appServerPort = appServerPort
    this.mcpServerPort = mcpServerPort
    this.fileLogger = fileLogger
    this.logger = structuredLogger.child("cdp")
    this.browserPath = browserPath
    this.pluginReactScan = pluginReactScan
  }

  private debugLog(message: string) {
    this.logger.debug(message)
  }

  /**
   * Check if a URL should be monitored (i.e., it's from the user's app server, not dev3000's MCP server or external sites)
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

      // Skip dev3000's MCP server port
      if (this.mcpServerPort && port === this.mcpServerPort) {
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
    this.logger.info("━━━ CDP Monitor Starting ━━━")

    // Check for external CDP configuration (Docker/WSL mode)
    const externalCdpUrl = process.env.DEV3000_CDP_URL
    const skipLaunch = process.env.DEV3000_CDP_SKIP_LAUNCH === "1"

    this.logger.logFields(LogLevel.DEBUG, "CDP Configuration", {
      "External CDP URL": externalCdpUrl || "(not set)",
      "Skip Chrome Launch": skipLaunch ? "yes" : "no",
      Mode: externalCdpUrl ? "External (Docker/WSL)" : "Local",
      "Profile Directory": this.profileDir,
      "Screenshot Directory": this.screenshotDir,
      "Browser Path": this.browserPath || "(auto-detect)",
      "Debug Port": this.debugPort.toString()
    })

    if (externalCdpUrl) {
      this.logger.info(`External CDP mode: ${externalCdpUrl}`)
      this.debugLog(`External CDP URL provided: ${externalCdpUrl}`)
    }
    if (skipLaunch) {
      this.logger.info("Skipping Chrome launch (using external instance)")
      this.debugLog("Skipping Chrome launch (DEV3000_CDP_SKIP_LAUNCH=1)")
    }

    // Launch Chrome with CDP enabled (unless using external CDP)
    if (!skipLaunch && !externalCdpUrl) {
      this.logger.info("Launching Chrome with CDP enabled")
      this.debugLog("Starting Chrome launch process")
      await this.launchChrome()
      this.logger.info("✓ Chrome launched successfully")
      this.debugLog("Chrome launch completed")
    } else {
      this.logger.info("Using external Chrome instance")
      this.debugLog("Using external Chrome instance via CDP")
    }

    // Connect to Chrome DevTools Protocol
    this.debugLog("Starting CDP connection")
    await this.connectToCDP(externalCdpUrl || undefined)
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
        const crashMsg = `[CRASH] Chrome process exited unexpectedly - Code: ${code}, Signal: ${signal}`
        // this.logger("browser", `${crashMsg} `)  // [PLAYWRIGHT] tag removed
        this.fileLogger("browser", `${crashMsg}`)
        this.debugLog(`Chrome crashed: code=${code}, signal=${signal}`)

        // Log context for crash correlation
        this.fileLogger("browser", "[CRASH] Chrome crashed - check recent server/browser logs for correlation")

        // Take screenshot if still connected (for crash context)
        if (this.connection && this.connection.ws.readyState === 1) {
          this.takeScreenshot("crash")
        }
      }
    })

    this.browser.on("error", (error) => {
      if (!this.isShuttingDown) {
        this.fileLogger("browser", `[CHROME] Chrome process error: ${error.message}`)
        this.debugLog(`Chrome process error during runtime: ${error}`)
      }
    })

    this.debugLog("Runtime crash monitoring enabled for Chrome process")
  }

  private async launchChrome(): Promise<void> {
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
            "/Applications/Comet.app/Contents/MacOS/Comet"
          ]

      const browserType = this.browserPath ? "custom browser" : "Chrome"

      this.logger.debug("━━━ Chrome Launch Process ━━━")
      this.logger.logFields(LogLevel.DEBUG, "Launch configuration", {
        "Browser type": browserType,
        "CDP port": this.debugPort.toString(),
        "Profile directory": this.profileDir,
        "Custom path": this.browserPath || "(none)",
        Candidates: chromeCommands.length.toString(),
        Platform: process.platform,
        Architecture: process.arch
      })

      if (chromeCommands.length > 1) {
        this.logger.debug(`Will try ${chromeCommands.length} Chrome paths in order:`)
        chromeCommands.forEach((path, i) => {
          this.logger.trace(`  [${i + 1}] ${path}`)
        })
      }

      this.debugLog(`Attempting to launch ${browserType} for CDP monitoring on port ${this.debugPort}`)
      this.debugLog(`Profile directory: ${this.profileDir}`)
      if (this.browserPath) {
        this.debugLog(`Custom browser path: ${this.browserPath}`)
      }

      let attemptIndex = 0

      const tryNextChrome = () => {
        if (attemptIndex >= chromeCommands.length) {
          const errorMsg = [
            "\n❌ CHROME LAUNCH FAILED",
            `CAUSE: No Chrome executable found on this system`,
            `\nSEARCHED PATHS (${chromeCommands.length}):`,
            ...chromeCommands.map((path, i) => `  [${i + 1}] ${path}`),
            `\nEXPECTED: At least one Chrome/Chromium executable to be installed`,
            `ACTUAL: None of the searched paths contain a valid executable`,
            `\nDEBUG STEPS:`,
            `  1. Install Chrome: https://www.google.com/chrome/`,
            `  2. Check if Chrome is in PATH: which chrome || which google-chrome`,
            `  3. Use --browser flag to specify custom path: dev3000 --browser /path/to/chrome`,
            `  4. For Docker/WSL: Set DEV3000_CDP_URL to connect to external Chrome`,
            `\nPLATFORM: ${process.platform}`,
            `ARCH: ${process.arch}`
          ].join("\n")

          this.debugLog(errorMsg)
          this.fileLogger("browser", errorMsg)
          reject(new Error("Failed to launch Chrome: all browser paths exhausted"))
          return
        }

        const chromePath = chromeCommands[attemptIndex]
        this.logger.debug(`Attempting launch [${attemptIndex + 1}/${chromeCommands.length}]: ${chromePath}`)
        this.debugLog(`Trying Chrome path [${attemptIndex}]: ${chromePath}`)
        attemptIndex++

        const launchArgs = [
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
          "--disable-restore-session-state",
          this.createLoadingPage()
        ]

        this.logger.trace(`Launch arguments: ${launchArgs.slice(0, 3).join(" ")} ... (${launchArgs.length} total)`)

        this.browser = spawn(chromePath, launchArgs, {
          stdio: "pipe",
          detached: false // Keep it attached so it dies with parent
        })

        if (!this.browser) {
          this.logger.warn(`✗ Failed to spawn process: ${chromePath}`)
          this.debugLog(`Failed to spawn Chrome process for path: ${chromePath}`)
          setTimeout(tryNextChrome, 100)
          return
        }

        this.logger.debug(`Process spawned (PID: ${this.browser.pid || "unknown"})`)

        let processExited = false

        this.browser.on("error", (error) => {
          this.logger.warn(`✗ Launch error for ${chromePath}: ${error.message}`)
          this.debugLog(`Chrome launch error for ${chromePath}: ${error.message}`)
          if (!this.isShuttingDown && !processExited) {
            processExited = true
            setTimeout(tryNextChrome, 100)
          }
        })

        this.browser.on("exit", (code, signal) => {
          if (!this.isShuttingDown && !processExited && code !== 0) {
            this.logger.warn(`✗ Process exited early (code: ${code}, signal: ${signal})`)
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

          if (attempts === 0) {
            this.logger.debug("Checking Chrome readiness...")
          }

          if (attempts >= maxAttempts) {
            const timeoutMs = maxAttempts * 500
            this.logger.warn(`✗ Readiness check timed out after ${timeoutMs}ms`)
            this.debugLog(`Chrome readiness check timed out after ${timeoutMs}ms`)
            processExited = true
            setTimeout(tryNextChrome, 100)
            return
          }

          // Log progress every 5 attempts (2.5 seconds)
          if (attempts > 0 && attempts % 5 === 0) {
            this.logger.trace(`Still waiting... (${attempts * 500}ms elapsed)`)
          }

          try {
            // Try to connect to CDP to verify Chrome is ready
            const response = await fetch(`http://localhost:${this.debugPort}/json`, {
              signal: AbortSignal.timeout(500)
            })
            if (response.ok) {
              const readyTime = attempts * 500
              this.logger.info(`✓ Chrome ready (${readyTime}ms startup time)`)
              this.logger.debug(`Successful launch path: ${chromePath}`)
              this.debugLog(`Chrome successfully started with path: ${chromePath} (after ${readyTime}ms)`)

              // Discover all Chrome PIDs for this instance
              this.logger.debug("Discovering Chrome process PIDs...")
              await this.discoverChromePids()
              this.logger.debug(`Found ${this.chromePids.size} Chrome processes`)

              // Set up runtime crash monitoring after successful launch
              this.logger.debug("Setting up runtime crash monitoring")
              this.setupRuntimeCrashMonitoring()

              resolve()
              return
            }
          } catch (error) {
            // Chrome not ready yet, retry
            if (attempts === 0) {
              this.logger.trace(`Initial check failed, will retry...`)
            }
          }

          setTimeout(() => checkChromeReady(attempts + 1), 500)
        }

        // Start checking after a small delay
        setTimeout(() => checkChromeReady(), 500)
      }

      tryNextChrome()
    })
  }

  private async connectToCDP(externalCdpUrl?: string): Promise<void> {
    this.logger.info("━━━ CDP Connection Process ━━━")
    this.logger.debug(`Mode: ${externalCdpUrl ? "External (Docker/WSL)" : "Local"}`)
    this.debugLog(`Attempting to connect to CDP${externalCdpUrl ? " (external)" : ` on port ${this.debugPort}`}`)

    // Retry connection with exponential backoff
    let retryCount = 0
    const maxRetries = 5
    let lastError: Error | null = null

    this.logger.logFields(LogLevel.DEBUG, "Connection parameters", {
      "Max retries": maxRetries.toString(),
      "External URL": externalCdpUrl || "(none)",
      "Debug port": this.debugPort.toString()
    })

    while (retryCount < maxRetries) {
      try {
        if (retryCount > 0) {
          this.logger.debug(`Retry attempt ${retryCount}/${maxRetries}`)
        }

        let wsUrl: string

        if (externalCdpUrl) {
          // External CDP mode (Docker/WSL) - fetch WebSocket URL from HTTP endpoint
          this.logger.debug("Fetching WebSocket URL from external CDP endpoint...")
          this.debugLog(`Fetching CDP targets from external endpoint: ${externalCdpUrl}`)

          // Check if externalCdpUrl is already a WebSocket URL or HTTP endpoint
          if (externalCdpUrl.startsWith("ws://") || externalCdpUrl.startsWith("wss://")) {
            // Already a WebSocket URL - use directly
            wsUrl = externalCdpUrl
            this.cdpUrl = wsUrl
            this.debugLog(`Using external WebSocket URL directly: ${wsUrl}`)
          } else {
            // HTTP endpoint - fetch targets and extract WebSocket URL (same as local mode)
            const httpEndpoint = externalCdpUrl.endsWith("/json") ? externalCdpUrl : `${externalCdpUrl}/json`
            this.debugLog(`Fetching targets from: ${httpEndpoint}`)

            let targetsResponse: { ok: boolean; status: number; statusText: string; json: () => Promise<unknown> }
            try {
              // Support both http and https endpoints
              const url = new URL(httpEndpoint)
              const httpMod = url.protocol === "https:" ? await import("https") : await import("http")

              targetsResponse = await new Promise((resolve, reject) => {
                const options = {
                  hostname: url.hostname,
                  port: url.port || (url.protocol === "https:" ? 443 : 80),
                  path: url.pathname + (url.search || ""),
                  method: "GET",
                  // Avoid forcing Host header; let Node set it based on target
                  headers: {}
                }

                const req = httpMod.get(options, (res) => {
                  let data = ""
                  res.on("data", (chunk) => {
                    data += chunk
                  })
                  res.on("end", () => {
                    resolve({
                      ok: res.statusCode === 200,
                      status: res.statusCode || 0,
                      statusText: res.statusMessage || "",
                      json: async () => JSON.parse(data)
                    })
                  })
                })

                req.on("error", reject)
                req.setTimeout(5000, () => {
                  req.destroy()
                  reject(new Error("Request timeout"))
                })
              })
            } catch (fetchError) {
              const errorMsg = [
                "\n❌ EXTERNAL CDP ENDPOINT UNREACHABLE",
                `URL: ${httpEndpoint}`,
                `Error: ${fetchError instanceof Error ? fetchError.message : String(fetchError)}`,
                `\nCAUSE: Cannot connect to external Chrome's DevTools Protocol endpoint`,
                `\nPOSSIBLE REASONS:`,
                `  - Chrome is not running on host`,
                `  - CDP not enabled (missing --remote-debugging-port=9222)`,
                `  - Network routing issue (Docker: host.docker.internal)`,
                `  - Firewall blocking port 9222`,
                `\nDEBUG STEPS:`,
                `  1. Verify Chrome is running with CDP: curl http://localhost:9222/json`,
                `  2. From container: docker exec <container> curl http://host.docker.internal:9222/json`,
                `  3. Check DEV3000_CDP_URL environment variable`,
                `  4. Ensure Chrome started with --remote-debugging-address=0.0.0.0`,
                `\nAttempt ${retryCount + 1}/${maxRetries}`
              ].join("\n")
              this.debugLog(errorMsg)
              throw new Error(errorMsg)
            }

            if (!targetsResponse.ok) {
              const errorMsg = [
                "\n❌ EXTERNAL CDP ENDPOINT RETURNED ERROR",
                `URL: ${httpEndpoint}`,
                `Status: ${targetsResponse.status} ${targetsResponse.statusText}`,
                `\nCAUSE: External Chrome's CDP endpoint is responding but returned an error`,
                `\nDEBUG STEPS:`,
                `  1. Check Chrome logs for errors`,
                `  2. Verify Chrome is fully started`,
                `  3. Try manual request with Host header: curl -H "Host: localhost:9222" ${httpEndpoint}`,
                `\nAttempt ${retryCount + 1}/${maxRetries}`
              ].join("\n")
              this.debugLog(errorMsg)
              throw new Error(errorMsg)
            }

            const targets = (await targetsResponse.json()) as Array<{
              type: string
              webSocketDebuggerUrl: string
              title?: string
            }>
            const pageTarget = targets.find((target) => target.type === "page")

            if (!pageTarget) {
              const errorMsg = [
                "\n❌ NO PAGE TARGET FOUND IN EXTERNAL CHROME",
                `CDP Endpoint: ${httpEndpoint}`,
                `\nCAUSE: External Chrome is running but has no page/tab available`,
                `\nDEBUG STEPS:`,
                `  1. Check if Chrome window is open with at least one tab`,
                `  2. Manually inspect targets: curl -H "Host: localhost:9222" ${httpEndpoint}`,
                `\nAttempt ${retryCount + 1}/${maxRetries}`
              ].join("\n")
              this.debugLog(errorMsg)
              throw new Error(errorMsg)
            }

            wsUrl = pageTarget.webSocketDebuggerUrl
            // Replace localhost with host.docker.internal for Docker environments
            if (externalCdpUrl.includes("host.docker.internal")) {
              wsUrl = wsUrl.replace("localhost", "host.docker.internal")
            }
            this.cdpUrl = wsUrl
            this.debugLog(`Found page target in external Chrome: ${pageTarget.title || "Unknown"}`)
            this.debugLog(`External CDP WebSocket URL: ${wsUrl}`)
          }
        } else {
          // Get the WebSocket URL from Chrome's debug endpoint (normal mode)
          let targetsResponse: Response
          try {
            targetsResponse = await fetch(`http://localhost:${this.debugPort}/json`)
          } catch (fetchError) {
            const errorMsg = [
              "\n❌ CDP ENDPOINT UNREACHABLE",
              `URL: http://localhost:${this.debugPort}/json`,
              `Error: ${fetchError instanceof Error ? fetchError.message : String(fetchError)}`,
              `\nCAUSE: Cannot connect to Chrome's DevTools Protocol endpoint`,
              `\nPOSSIBLE REASONS:`,
              `  - Chrome failed to start or crashed during startup`,
              `  - CDP port ${this.debugPort} is blocked by firewall`,
              `  - Another Chrome instance is using port ${this.debugPort}`,
              `  - Chrome started without --remote-debugging-port flag`,
              `\nDEBUG STEPS:`,
              `  1. Check if Chrome is running: ps aux | grep chrome`,
              `  2. Check CDP port: lsof -i :${this.debugPort}`,
              `  3. Try manual connection: curl http://localhost:${this.debugPort}/json`,
              `  4. Check Chrome stderr logs above for startup errors`,
              `\nAttempt ${retryCount + 1}/${maxRetries}`
            ].join("\n")
            this.debugLog(errorMsg)
            throw new Error(errorMsg)
          }

          if (!targetsResponse.ok) {
            const errorMsg = [
              "\n❌ CDP ENDPOINT RETURNED ERROR",
              `URL: http://localhost:${this.debugPort}/json`,
              `Status: ${targetsResponse.status} ${targetsResponse.statusText}`,
              `\nCAUSE: Chrome's CDP endpoint is responding but returned an error`,
              `\nEXPECTED: HTTP 200 OK with JSON array of targets`,
              `ACTUAL: HTTP ${targetsResponse.status} ${targetsResponse.statusText}`,
              `\nDEBUG STEPS:`,
              `  1. Verify Chrome is fully started (wait a few seconds)`,
              `  2. Check if Chrome crashed during startup`,
              `  3. Try manual request: curl -v http://localhost:${this.debugPort}/json`,
              `\nAttempt ${retryCount + 1}/${maxRetries}`
            ].join("\n")
            this.debugLog(errorMsg)
            throw new Error(errorMsg)
          }

          const targets = await targetsResponse.json()

          // Find the first page target (tab)
          const pageTarget = targets.find(
            (target: { type: string; webSocketDebuggerUrl: string }) => target.type === "page"
          )
          if (!pageTarget) {
            const errorMsg = [
              "\n❌ NO PAGE TARGET FOUND",
              `CDP Endpoint: http://localhost:${this.debugPort}/json`,
              `\nCAUSE: Chrome is running but has no page/tab available`,
              `\nEXPECTED: At least one target with type='page'`,
              `ACTUAL: ${targets.length} targets found:`,
              ...targets
                .slice(0, 5)
                .map(
                  (t: { type: string; title?: string; url?: string }, i: number) =>
                    `  [${i + 1}] Type: ${t.type}, Title: ${t.title || "N/A"}, URL: ${t.url?.substring(0, 50) || "N/A"}`
                ),
              ...(targets.length > 5 ? [`  ... and ${targets.length - 5} more targets`] : []),
              `\nDEBUG STEPS:`,
              `  1. Chrome may still be initializing (wait 2-3 seconds)`,
              `  2. Check if Chrome was launched with --headless (may not create page targets)`,
              `  3. Manually inspect targets: curl http://localhost:${this.debugPort}/json | jq`,
              `\nAttempt ${retryCount + 1}/${maxRetries}`
            ].join("\n")
            this.debugLog(errorMsg)
            throw new Error(errorMsg)
          }

          wsUrl = pageTarget.webSocketDebuggerUrl
          this.cdpUrl = wsUrl // Store the CDP URL
          this.debugLog(`Found page target: ${pageTarget.title || "Unknown"} - ${pageTarget.url}`)
          this.debugLog(`Got CDP WebSocket URL: ${wsUrl}`)
        }

        return new Promise((resolve, reject) => {
          this.logger.debug("Establishing WebSocket connection...")
          this.logger.trace(`WebSocket URL: ${wsUrl}`)
          this.debugLog(`Creating WebSocket connection to: ${wsUrl}`)
          const ws = new WebSocket(wsUrl)

          // Increase max listeners to prevent warnings
          ws.setMaxListeners(20)

          ws.on("open", () => {
            this.logger.info("✓ WebSocket connection established")
            this.debugLog("WebSocket connection opened successfully")
            this.connection = {
              ws,
              sessionId: null,
              nextId: 1
            }
            resolve()
          })

          ws.on("error", (error) => {
            const errorMsg = [
              "\n❌ CDP WEBSOCKET CONNECTION FAILED",
              `WebSocket URL: ${wsUrl}`,
              `Error: ${error instanceof Error ? error.message : String(error)}`,
              `\nCAUSE: Failed to establish WebSocket connection to Chrome`,
              `\nPOSSIBLE REASONS:`,
              `  - Chrome tab/page was closed before connection established`,
              `  - CDP WebSocket URL is invalid or expired`,
              `  - Network issues preventing WebSocket upgrade`,
              `  - Chrome is rejecting the connection (security/CORS)`,
              `\nDEBUG STEPS:`,
              `  1. Verify Chrome is still running: ps aux | grep chrome`,
              `  2. Get fresh CDP URL: curl http://localhost:${this.debugPort}/json`,
              `  3. Check if URL format is correct: ws://localhost:${this.debugPort}/devtools/...`,
              `  4. For Docker: Verify host.docker.internal is resolvable`,
              `\nAttempt ${retryCount + 1}/${maxRetries}`
            ].join("\n")
            this.debugLog(errorMsg)
            reject(new Error(errorMsg))
          })

          ws.on("message", (data) => {
            try {
              const message = JSON.parse(data.toString())
              this.handleCDPMessage(message)
            } catch (error) {
              this.fileLogger("browser", `[CDP] Failed to parse message: ${error}`)
            }
          })

          ws.on("close", (code, reason) => {
            this.debugLog(`WebSocket closed with code ${code}, reason: ${reason}`)
            if (!this.isShuttingDown) {
              this.fileLogger("browser", `[CDP] Connection lost unexpectedly (code: ${code}, reason: ${reason})`)
              this.fileLogger("browser", "[CDP] CDP connection lost - check for Chrome crash or server issues")

              // Log current Chrome process status
              if (this.browser && !this.browser.killed) {
                this.fileLogger("browser", "[CDP] Chrome process still running after CDP disconnect")
              } else {
                this.fileLogger("browser", "[CDP] Chrome process not available after CDP disconnect")
              }

              // If Chrome process is gone or connection loss seems permanent, trigger shutdown
              // Use a small delay to distinguish between temporary reconnects and permanent failures
              setTimeout(() => {
                if (!this.isShuttingDown && this.onWindowClosedCallback) {
                  // Check if Chrome process is still alive
                  if (!this.browser || this.browser.killed || !this.browser.pid) {
                    this.debugLog("Chrome process is dead and CDP connection lost, triggering d3k shutdown")
                    this.fileLogger("browser", "[CDP] Chrome process terminated, shutting down d3k")
                    this.onWindowClosedCallback()
                  } else {
                    // Chrome is alive but CDP connection is lost - this could be recoverable
                    this.debugLog("Chrome process alive but CDP connection lost - attempting recovery")
                    this.fileLogger("browser", "[CDP] Attempting to recover from connection loss")
                    // Could add reconnection logic here in the future
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
              const errorMsg = [
                "\n❌ CDP WEBSOCKET CONNECTION TIMEOUT",
                `WebSocket URL: ${wsUrl}`,
                `State: CONNECTING (hung for 5 seconds)`,
                `\nCAUSE: WebSocket connection didn't complete within 5 seconds`,
                `\nPOSSIBLE REASONS:`,
                `  - Network latency too high`,
                `  - Chrome is frozen or unresponsive`,
                `  - Firewall blocking WebSocket connections`,
                `  - For Docker: host.docker.internal routing issues`,
                `\nDEBUG STEPS:`,
                `  1. Check Chrome responsiveness (can you interact with it?)`,
                `  2. Test WebSocket manually: wscat -c ${wsUrl}`,
                `  3. Check firewall rules for WebSocket traffic`,
                `  4. For Docker: Ping host.docker.internal from container`,
                `\nAttempt ${retryCount + 1}/${maxRetries}`
              ].join("\n")
              this.debugLog(errorMsg)
              reject(new Error(errorMsg))
            }
          }, 5000)
        })
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))
        retryCount++
        this.debugLog(`CDP connection attempt ${retryCount} failed: ${error}`)

        if (retryCount >= maxRetries) {
          const errorMsg = [
            "\n❌ CDP CONNECTION FAILED AFTER ALL RETRIES",
            `Attempts: ${maxRetries}`,
            `Mode: ${externalCdpUrl ? "External (Docker/WSL)" : `Local port ${this.debugPort}`}`,
            externalCdpUrl ? `External CDP URL: ${externalCdpUrl}` : `CDP Port: ${this.debugPort}`,
            `\nLAST ERROR:`,
            `${lastError.message}`,
            `\nCAUSE: Unable to establish CDP connection after ${maxRetries} retry attempts`,
            `\nFINAL DEBUG STEPS:`,
            `  1. Review all error messages above for specific failure reasons`,
            `  2. Verify Chrome is installed and executable`,
            `  3. For Docker mode:`,
            `     - Check DEV3000_CDP_URL is set correctly`,
            `     - Verify Chrome is running on host with --remote-debugging-port=${this.debugPort}`,
            `     - Test connection: docker exec -it dev3000 curl http://host.docker.internal:${this.debugPort}/json`,
            `  4. For local mode:`,
            `     - Kill all Chrome processes: pkill -9 chrome`,
            `     - Restart dev3000`,
            `  5. Check system logs for Chrome crashes: dmesg | grep chrome`
          ].join("\n")
          this.debugLog(errorMsg)
          this.fileLogger("browser", errorMsg)
          throw new Error(`Failed to connect to CDP after ${maxRetries} attempts`)
        }

        // Exponential backoff
        const delay = Math.min(1000 * 2 ** (retryCount - 1), 5000)
        this.debugLog(`Retrying CDP connection in ${delay}ms`)
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
    }
  }

  private async sendCDPCommand(method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    if (!this.connection) {
      const errorMsg = [
        "\n❌ CDP COMMAND FAILED - NO CONNECTION",
        `Command: ${method}`,
        `Params: ${JSON.stringify(params).substring(0, 100)}`,
        `\nCAUSE: Attempted to send CDP command without active connection`,
        `\nPOSSIBLE REASONS:`,
        `  - CDP connection was never established`,
        `  - CDP connection was closed/lost`,
        `  - Chrome crashed or was closed`,
        `\nDEBUG STEPS:`,
        `  1. Check if CDP connection was successful during startup`,
        `  2. Check for "WebSocket closed" messages in logs`,
        `  3. Verify Chrome is still running: ps aux | grep chrome`
      ].join("\n")
      this.debugLog(errorMsg)
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
        const errorMsg = [
          "\n❌ CDP COMMAND TIMEOUT",
          `Command: ${method}`,
          `Params: ${JSON.stringify(params).substring(0, 200)}`,
          `Timeout: 10000ms`,
          `\nCAUSE: Chrome didn't respond to CDP command within timeout`,
          `\nPOSSIBLE REASONS:`,
          `  - Chrome is frozen or unresponsive`,
          `  - Command triggered a long-running operation`,
          `  - WebSocket connection is degraded but not closed`,
          `  - Chrome is under heavy load`,
          `\nDEBUG STEPS:`,
          `  1. Check Chrome responsiveness (can you interact with it?)`,
          `  2. Check Chrome CPU/memory usage: ps aux | grep chrome`,
          `  3. Check WebSocket state (should see heartbeat in --debug mode)`,
          `  4. Try closing and restarting Chrome`
        ].join("\n")
        this.debugLog(errorMsg)
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
        this.fileLogger("browser", `[CDP] Enabled ${domain} domain`)
      } catch (error) {
        this.debugLog(`Failed to enable CDP domain ${domain}: ${error}`)
        this.fileLogger("browser", `[CDP] Failed to enable ${domain}: ${error}`)
        // Continue with other domains instead of throwing
      }
    }

    this.debugLog("Enabling runtime for console and exception capture")
    await this.sendCDPCommand("Runtime.enable")
    await this.sendCDPCommand("Runtime.setAsyncCallStackDepth", {
      maxDepth: 32
    })
    this.debugLog("CDP domains enabled successfully")
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
        this.fileLogger("browser", `[DEBUG] Interaction tracking script loaded successfully`)
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

      this.fileLogger("browser", logMsg)
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

      this.fileLogger("browser", errorMsg)

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
        this.fileLogger("browser", logMsg)
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

      // Skip requests to dev3000's MCP server
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

      this.fileLogger("browser", logMsg)
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

      // Skip responses from dev3000's MCP server
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

      this.fileLogger("browser", logMsg)
    })

    // Page navigation with full context
    this.onCDPEvent("Page.frameNavigated", (event) => {
      const params = event.params as {
        frame?: { url?: string; parentId?: string }
      }
      const { frame } = params
      if (frame?.parentId) return // Only log main frame navigation

      const url = frame?.url || "unknown"

      // Skip navigation to dev3000's MCP server
      if (!this.shouldMonitorUrl(url)) {
        return
      }

      this.fileLogger("browser", `[NAVIGATION] ${url}`)

      // Don't take a screenshot here - wait for page load
    })

    // Page load events for better screenshot timing
    this.onCDPEvent("Page.loadEventFired", async (_event) => {
      this.fileLogger("browser", "[DOM] Load event fired")
      this.takeScreenshot("page-loaded")
      // Reinject interaction tracking on page load
      await this.setupInteractionTracking()
    })

    this.onCDPEvent("Page.domContentEventFired", async (_event) => {
      this.fileLogger("browser", "[DOM] DOM content loaded")
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
      this.fileLogger("browser", "[DOM] Document updated")
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
      this.fileLogger("browser", `[TARGET] Window/tab closed: ${params.targetId}`)

      // If this is our main tab/window being closed, trigger shutdown callback
      if (this.onWindowClosedCallback && !this.isShuttingDown) {
        this.debugLog("Chrome window was manually closed, triggering d3k shutdown")
        this.fileLogger("browser", "[TARGET] Chrome window manually closed, shutting down d3k")
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

  async navigateToApp(port: string): Promise<void> {
    if (!this.connection) {
      throw new Error("No CDP connection available")
    }

    const navigationStartTime = Date.now()
    this.debugLog(`Navigating to http://localhost:${port}`)

    // Navigate to the app
    try {
      const result = await this.sendCDPCommand("Page.navigate", {
        url: `http://localhost:${port}`
      })

      const navigationTime = Date.now() - navigationStartTime
      this.debugLog(`Navigation command sent successfully (${navigationTime}ms)`)
      this.debugLog(`Navigation result: ${JSON.stringify(result)}`)

      // Check if navigation was successful
      if (result.errorText) {
        this.debugLog(`Navigation error: ${result.errorText}`)
        this.fileLogger("browser", `[CDP] Navigation failed: ${result.errorText}`)
      }

      // Wait for navigation to complete
      if (result.frameId) {
        this.debugLog(`Waiting for frame ${result.frameId} to finish loading...`)
        try {
          // Enable Page events if not already enabled
          await this.sendCDPCommand("Page.enable")

          // Wait for frameStoppedLoading event
          await new Promise<void>((resolve) => {
            const timeout = setTimeout(() => {
              this.debugLog("Navigation wait timed out after 10s")
              resolve()
            }, 10000)

            const handler = (data: Buffer) => {
              const message = JSON.parse(data.toString())
              if (message.method === "Page.frameStoppedLoading" && message.params.frameId === result.frameId) {
                clearTimeout(timeout)
                this.connection?.ws.removeListener("message", handler)
                this.debugLog(`Frame ${result.frameId} finished loading`)
                resolve()
              }
            }

            this.connection?.ws.on("message", handler)
          })
        } catch (waitError) {
          this.debugLog(`Error waiting for navigation: ${waitError}`)
        }
      }
    } catch (error) {
      this.debugLog(`Navigation failed: ${error}`)
      this.fileLogger("browser", `[CDP] Navigation failed: ${error}`)
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
        this.fileLogger("browser", `[CDP] Tracking script syntax error: ${errorMessage}`)
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
        this.fileLogger(
          "browser",
          `[DEBUG] Script injection exception: ${
            resultWithDetails.exceptionDetails.exception?.description || "Unknown error"
          }`
        )
      }
    } catch (error) {
      this.debugLog(`Failed to inject interaction tracking: ${error}`)
      this.fileLogger("browser", `[CDP] Interaction tracking failed: ${error}`)
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
          this.fileLogger("browser", `[INTERACTION] ${interaction.message}`)

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
    // Only schedule if we have 0 pending requests
    if (this.pendingRequests === 0) {
      if (this.networkIdleTimer) {
        clearTimeout(this.networkIdleTimer)
      }

      // Wait 500ms of network idle before taking screenshot
      this.networkIdleTimer = setTimeout(() => {
        this.takeScreenshot("network-idle")
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

      // Log screenshot filename (UI will construct the full URL)
      this.fileLogger("browser", `[SCREENSHOT] ${filename}`)

      return filename
    } catch (error) {
      this.fileLogger("browser", `[CDP] Screenshot failed: ${error}`)
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
          this.fileLogger("browser", `[REPLAY] Unknown interaction type: ${interaction.type}`)
      }
    } catch (error) {
      this.fileLogger("browser", `[REPLAY] Failed to execute ${interaction.type}: ${error}`)
    }
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
