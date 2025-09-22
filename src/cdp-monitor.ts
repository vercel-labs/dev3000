import { type ChildProcess, spawn } from "child_process"
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

  constructor(
    profileDir: string,
    screenshotDir: string,
    logger: (source: string, message: string) => void,
    debug: boolean = false,
    browserPath?: string
  ) {
    this.profileDir = profileDir
    this.screenshotDir = screenshotDir
    this.logger = logger
    this.debug = debug
    this.browserPath = browserPath
  }

  private debugLog(message: string) {
    if (this.debug) {
      console.log(`[CDP DEBUG] ${message}`)
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
        const crashMsg = `[CHROME CRASH] Chrome process exited unexpectedly - Code: ${code}, Signal: ${signal}`
        // this.logger("browser", `${crashMsg} `)  // [PLAYWRIGHT] tag removed
        this.logger("browser", `${crashMsg}`)
        this.debugLog(`Chrome crashed: code=${code}, signal=${signal}`)

        // Log context for crash correlation
        this.logger(
          "browser",
          "[CRASH CONTEXT] Chrome crashed - check recent server/browser logs for correlation" // [PLAYWRIGHT] tag removed
        )

        // Take screenshot if still connected (for crash context)
        if (this.connection && this.connection.ws.readyState === 1) {
          this.takeScreenshot("crash")
        }
      }
    })

    this.browser.on("error", (error) => {
      if (!this.isShuttingDown) {
        this.logger("browser", `[CHROME ERROR] Chrome process error: ${error.message} `) // [PLAYWRIGHT] tag removed
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
        : ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "google-chrome", "chrome", "chromium"]

      const browserType = this.browserPath ? "custom browser" : "Chrome"
      this.debugLog(`Attempting to launch ${browserType} for CDP monitoring on port ${this.debugPort}`)
      this.debugLog(`Profile directory: ${this.profileDir}`)
      if (this.browserPath) {
        this.debugLog(`Custom browser path: ${this.browserPath}`)
      }

      let attemptIndex = 0

      const tryNextChrome = () => {
        if (attemptIndex >= chromeCommands.length) {
          reject(new Error("Failed to launch Chrome: all browser paths exhausted"))
          return
        }

        const chromePath = chromeCommands[attemptIndex]
        this.debugLog(`Trying Chrome path [${attemptIndex}]: ${chromePath}`)
        attemptIndex++

        this.browser = spawn(
          chromePath,
          [
            `--remote-debugging-port=${this.debugPort}`,
            `--user-data-dir=${this.profileDir}`,
            "--no-first-run",
            this.createLoadingPage()
          ],
          {
            stdio: "pipe",
            detached: false
          }
        )

        if (!this.browser) {
          this.debugLog(`Failed to spawn Chrome process for path: ${chromePath}`)
          setTimeout(tryNextChrome, 100)
          return
        }

        let processExited = false

        this.browser.on("error", (error) => {
          this.debugLog(`Chrome launch error for ${chromePath}: ${error.message}`)
          if (!this.isShuttingDown && !processExited) {
            processExited = true
            setTimeout(tryNextChrome, 100)
          }
        })

        this.browser.on("exit", (code, signal) => {
          if (!this.isShuttingDown && !processExited && code !== 0) {
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

        // Give Chrome time to start up
        setTimeout(() => {
          if (!processExited) {
            this.debugLog(`Chrome successfully started with path: ${chromePath}`)

            // Set up runtime crash monitoring after successful launch
            this.setupRuntimeCrashMonitoring()

            resolve()
          }
        }, 3000)
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

        // Find the first page target (tab)
        const pageTarget = targets.find(
          (target: { type: string; webSocketDebuggerUrl: string }) => target.type === "page"
        )
        if (!pageTarget) {
          throw new Error("No page target found in Chrome")
        }

        const wsUrl = pageTarget.webSocketDebuggerUrl
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
              this.logger("browser", `[CDP ERROR] Failed to parse message: ${error} `) // [PLAYWRIGHT] tag removed
            }
          })

          ws.on("close", (code, reason) => {
            this.debugLog(`WebSocket closed with code ${code}, reason: ${reason}`)
            if (!this.isShuttingDown) {
              this.logger(
                "browser",
                `[CDP DISCONNECT] Connection lost unexpectedly (code: ${code}, reason: ${reason})` // [PLAYWRIGHT] tag removed
              )
              this.logger(
                "browser",
                "[DISCONNECT CONTEXT] CDP connection lost - check for Chrome crash or server issues" // [PLAYWRIGHT] tag removed
              )

              // Log current Chrome process status
              if (this.browser && !this.browser.killed) {
                this.logger("browser", "[CHROME STATUS] Chrome process still running after CDP disconnect") // [PLAYWRIGHT] tag removed
              } else {
                this.logger("browser", "[CHROME STATUS] Chrome process not available after CDP disconnect") // [PLAYWRIGHT] tag removed
              }
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
      "Log" // Browser console logs
      // Note: Input domain is for dispatching events, not monitoring them - we use JS injection instead
    ]

    for (const domain of domains) {
      try {
        this.debugLog(`Enabling CDP domain: ${domain}`)
        await this.sendCDPCommand(`${domain}.enable`)
        this.debugLog(`Successfully enabled CDP domain: ${domain}`)
        if (this.debug) {
          this.logger("browser", `[CDP] Enabled ${domain} domain `) // [PLAYWRIGHT] tag removed
        }
      } catch (error) {
        this.debugLog(`Failed to enable CDP domain ${domain}: ${error}`)
        // Only log CDP errors when debug mode is enabled
        if (this.debug) {
          this.logger("browser", `[CDP ERROR] Failed to enable ${domain}: ${error} `) // [PLAYWRIGHT] tag removed
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
  }

  private setupEventHandlers(): void {
    // Console messages with full context
    this.onCDPEvent("Runtime.consoleAPICalled", (event) => {
      const params = event.params as {
        type?: string
        args?: Array<{ type: string; value?: string; preview?: unknown }>
        stackTrace?: { callFrames: Array<{ functionName?: string; url: string; lineNumber: number }> }
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
          this.logger("browser", `[DEBUG] Interaction tracking script loaded successfully `) // [PLAYWRIGHT] tag removed
        }
      }

      // Log regular console messages with enhanced context
      const values = (args || [])
        .map((arg: { type: string; value?: string; preview?: unknown }) => {
          if (arg.type === "object" && arg.preview) {
            return JSON.stringify(arg.preview)
          }
          return arg.value || "[object]"
        })
        .join(" ")

      let logMsg = `[CONSOLE ${(type || "log").toUpperCase()}] ${values}`

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

      this.logger("browser", `${logMsg} `) // [PLAYWRIGHT] tag removed
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
          stackTrace?: { callFrames: Array<{ functionName?: string; url: string; lineNumber: number }> }
        }
      }
      const { text, lineNumber, columnNumber, url, stackTrace } = params.exceptionDetails

      let errorMsg = `[RUNTIME ERROR] ${text}`
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

      this.logger("browser", `${errorMsg} `) // [PLAYWRIGHT] tag removed

      // Take screenshot immediately on errors (no delay needed)
      this.takeScreenshot("error")
    })

    // Browser console logs via Log domain (additional capture method)
    this.onCDPEvent("Log.entryAdded", (event) => {
      const params = event.params as { entry: { level?: string; text: string; url?: string; lineNumber?: number } }
      const { level, text, url, lineNumber } = params.entry

      let logMsg = `[CONSOLE ${(level || "log").toUpperCase()}] ${text}`
      if (url && lineNumber) {
        logMsg += ` at ${url}:${lineNumber}`
      }

      // Only log if it's an error/warning or if we're not already capturing it via Runtime
      if (level === "error" || level === "warning") {
        this.logger("browser", `${logMsg} `) // [PLAYWRIGHT] tag removed
      }
    })

    // Network requests with full details
    this.onCDPEvent("Network.requestWillBeSent", (event) => {
      const params = event.params as {
        request: { url: string; method: string; headers?: Record<string, string>; postData?: string }
        type?: string
        initiator?: { type: string }
      }
      const { url, method, headers, postData } = params.request
      const { type, initiator } = params

      let logMsg = `[NETWORK REQUEST] ${method} ${url}`
      if (type) logMsg += ` (${type})`
      if (initiator?.type) logMsg += ` initiated by ${initiator.type}`

      // Log important headers
      const importantHeaders = ["content-type", "authorization", "cookie"]
      const headerInfo = importantHeaders
        .filter((h) => headers?.[h])
        .map((h) => `${h}: ${headers?.[h]?.slice(0, 50) || ""}${(headers?.[h]?.length || 0) > 50 ? "..." : ""}`)
        .join(", ")

      if (headerInfo) logMsg += ` [${headerInfo}]`
      if (postData) logMsg += ` body: ${postData.slice(0, 100)}${postData.length > 100 ? "..." : ""}`

      this.logger("browser", `${logMsg} `) // [PLAYWRIGHT] tag removed
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

      let logMsg = `[NETWORK] ${status} ${statusText} ${url}`
      if (type) logMsg += ` (${type})`
      if (mimeType) logMsg += ` [${mimeType}]`

      // Add timing info if available
      const timing = params.response.timing
      if (timing) {
        const totalTime = Math.round(timing.receiveHeadersEnd - timing.requestTime)
        if (totalTime > 0) logMsg += ` (${totalTime}ms)`
      }

      this.logger("browser", `${logMsg} `) // [PLAYWRIGHT] tag removed
    })

    // Page navigation with full context
    this.onCDPEvent("Page.frameNavigated", (event) => {
      const params = event.params as { frame?: { url?: string; parentId?: string } }
      const { frame } = params
      if (frame?.parentId) return // Only log main frame navigation

      this.logger("browser", `[NAVIGATION] ${frame?.url || "unknown"} `) // [PLAYWRIGHT] tag removed

      // Take screenshot on navigation to catch initial render
      setTimeout(() => {
        this.takeScreenshot("frame-navigated")
      }, 200)
    })

    // Page load events for better screenshot timing
    this.onCDPEvent("Page.loadEventFired", async (_event) => {
      this.logger("browser", "[PAGE] Load event fired") // [PLAYWRIGHT] tag removed
      this.takeScreenshot("page-loaded")
      // Reinject interaction tracking on page load
      await this.setupInteractionTracking()
    })

    this.onCDPEvent("Page.domContentEventFired", async (_event) => {
      this.logger("browser", "[PAGE] DOM content loaded") // [PLAYWRIGHT] tag removed
      // Take screenshot on DOM content loaded too for earlier capture
      this.takeScreenshot("dom-content-loaded")
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
      this.logger("browser", "[DOM] Document updated") // [PLAYWRIGHT] tag removed
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
        this.logger("browser", `[CDP ERROR] Navigation failed: ${result.errorText}`)
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
      this.logger("browser", `[CDP ERROR] Navigation failed: ${error}`)
      throw error
    }

    // Take an immediate screenshot after navigation command
    setTimeout(() => {
      this.takeScreenshot("navigation-immediate")
    }, 100)

    // Take backup screenshots with increasing delays to catch different loading states
    setTimeout(() => {
      this.takeScreenshot("navigation-1s")
    }, 1000)

    setTimeout(() => {
      this.takeScreenshot("navigation-3s")
    }, 3000)

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
      })) as any

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
        this.logger("browser", `[CDP ERROR] Tracking script syntax error: ${errorMessage} `) // [PLAYWRIGHT] tag removed
        throw new Error(`Invalid tracking script syntax: ${errorMessage}`)
      }

      const result = await this.sendCDPCommand("Runtime.evaluate", {
        expression: trackingScript,
        includeCommandLineAPI: false
      })

      this.debugLog(`Interaction tracking script injected. Result: ${JSON.stringify(result)}`)

      // Log any errors from the script injection
      const resultWithDetails = result as { exceptionDetails?: { exception?: { description?: string } } }
      if (resultWithDetails.exceptionDetails) {
        this.debugLog(`Script injection exception: ${JSON.stringify(resultWithDetails.exceptionDetails)}`)
        this.logger(
          "browser",
          `[DEBUG] Script injection exception: ${resultWithDetails.exceptionDetails.exception?.description || "Unknown error"}`
        )
      }
    } catch (error) {
      this.debugLog(`Failed to inject interaction tracking: ${error}`)
      this.logger("browser", `[CDP ERROR] Interaction tracking failed: ${error} `) // [PLAYWRIGHT] tag removed
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
        })) as { result?: { value?: Array<{ timestamp: number; message: string }> } }

        const interactions = result.result?.value || []

        for (const interaction of interactions) {
          this.logger("browser", `[INTERACTION] ${interaction.message} `) // [PLAYWRIGHT] tag removed

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

      // Log screenshot with proper format that dev3000 expects
      this.logger("browser", `[SCREENSHOT] ${filename} `) // [PLAYWRIGHT] tag removed

      return filename
    } catch (error) {
      this.logger("browser", `[CDP ERROR] Screenshot failed: ${error} `) // [PLAYWRIGHT] tag removed
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
          this.logger("browser", `[REPLAY] Unknown interaction type: ${interaction.type} `) // [PLAYWRIGHT] tag removed
      }
    } catch (error) {
      this.logger("browser", `[REPLAY ERROR] Failed to execute ${interaction.type}: ${error} `) // [PLAYWRIGHT] tag removed
    }
  }

  async shutdown(): Promise<void> {
    this.isShuttingDown = true

    // Close CDP connection
    if (this.connection) {
      this.connection.ws.close()
      this.connection = null
    }

    // Close browser
    if (this.browser) {
      this.browser.kill("SIGTERM")

      // Force kill after 2 seconds if not closed
      setTimeout(() => {
        if (this.browser) {
          this.browser.kill("SIGKILL")
        }
      }, 2000)

      this.browser = null
    }
  }
}
