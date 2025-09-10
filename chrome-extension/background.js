// Dev3000 Chrome Extension Background Script
// Replicates CDP functionality using chrome.debugger API

class Dev3000Monitor {
  constructor() {
    this.attachedTabs = new Map()
    this.logBuffer = []
    this.maxLogEntries = 1000
    this.currentIconState = "inactive"
    this.mcpServerStatus = "unknown" // 'connected', 'disconnected', 'unknown'
    this.lastMcpServerCheck = 0
    this.errorCounts = new Map() // Track error counts per tab for crash detection
    this.suspectedCrashes = new Map() // Track suspected crashes

    // Listen for extension events
    chrome.runtime.onStartup.addListener(() => this.initialize())
    chrome.runtime.onInstalled.addListener(() => this.initialize())

    // Listen for tab updates to potentially attach to development servers
    chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
      if (changeInfo.status === "complete" && (await this.isDevelopmentServer(tab.url))) {
        this.attachToTab(tabId)
      }
    })

    // Listen for tab removal to detect potential crashes
    chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
      if (this.attachedTabs.has(tabId)) {
        this.handleTabRemoval(tabId, removeInfo)
      }
    })

    // Listen for debugger events
    chrome.debugger.onEvent.addListener((source, method, params) => {
      this.handleDebuggerEvent(source, method, params)
    })

    // Listen for debugger detach
    chrome.debugger.onDetach.addListener((source, reason) => {
      console.log(`Debugger detached from tab ${source.tabId}: ${reason}`)
      this.handleTabDisconnection(source.tabId, reason)
    })
  }

  initialize() {
    console.log("Dev3000 Monitor initialized")
    this.updateIcon()
  }

  updateIcon() {
    const hasActiveTabs = this.attachedTabs.size > 0
    const newState = hasActiveTabs ? "active" : "inactive"

    if (newState !== this.currentIconState) {
      this.currentIconState = newState

      // Create dynamic icon based on state
      this.setDynamicIcon(newState)

      // Update badge text
      if (hasActiveTabs) {
        chrome.action.setBadgeText({ text: this.attachedTabs.size.toString() })
        chrome.action.setBadgeBackgroundColor({ color: "#22c55e" })
      } else {
        chrome.action.setBadgeText({ text: "" })
      }

      // Update title
      const title = hasActiveTabs
        ? `d3k Monitor - ${this.attachedTabs.size} tab${this.attachedTabs.size > 1 ? "s" : ""} active`
        : "d3k Monitor - No active monitoring"
      chrome.action.setTitle({ title })
    }
  }

  setDynamicIcon(state) {
    // Create canvas icon programmatically
    const canvas = new OffscreenCanvas(16, 16)
    const ctx = canvas.getContext("2d")

    // Background gradient
    const gradient = ctx.createLinearGradient(0, 0, 16, 16)
    gradient.addColorStop(0, "#1a1a2e")
    gradient.addColorStop(1, "#0f3460")

    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, 16, 16)

    // Terminal window
    ctx.fillStyle = state === "active" ? "#1e1e2e" : "rgba(30, 30, 46, 0.7)"
    ctx.fillRect(2, 3, 12, 10)

    // Terminal header
    ctx.fillStyle = state === "active" ? "#2a2a3e" : "rgba(42, 42, 62, 0.7)"
    ctx.fillRect(2, 3, 12, 2)

    // Terminal dots
    ctx.fillStyle = state === "active" ? "#ff5f56" : "rgba(255, 95, 86, 0.5)"
    ctx.beginPath()
    ctx.arc(3.5, 4, 0.3, 0, 2 * Math.PI)
    ctx.fill()

    ctx.fillStyle = state === "active" ? "#ffbd2e" : "rgba(255, 189, 46, 0.5)"
    ctx.beginPath()
    ctx.arc(4.5, 4, 0.3, 0, 2 * Math.PI)
    ctx.fill()

    ctx.fillStyle = state === "active" ? "#27c93f" : "rgba(39, 201, 63, 0.5)"
    ctx.beginPath()
    ctx.arc(5.5, 4, 0.3, 0, 2 * Math.PI)
    ctx.fill()

    // d3k text
    ctx.fillStyle = state === "active" ? "#58a6ff" : "rgba(88, 166, 255, 0.6)"
    ctx.font = "bold 4px monospace"
    ctx.textAlign = "center"
    ctx.fillText("d3k", 8, 9)

    // Log lines
    const opacity = state === "active" ? 0.9 : 0.3
    ctx.fillStyle = `rgba(86, 211, 100, ${opacity})`
    ctx.fillRect(3, 10.5, 6, 0.3)

    ctx.fillStyle = `rgba(88, 166, 255, ${opacity})`
    ctx.fillRect(3, 11.2, 4, 0.3)

    ctx.fillStyle = `rgba(192, 132, 252, ${opacity})`
    ctx.fillRect(3, 11.9, 5, 0.3)

    // Status indicator
    if (state === "active") {
      ctx.fillStyle = "#22c55e"
      ctx.beginPath()
      ctx.arc(13, 3, 1.5, 0, 2 * Math.PI)
      ctx.fill()

      ctx.fillStyle = "#27c93f"
      ctx.beginPath()
      ctx.arc(13, 3, 1, 0, 2 * Math.PI)
      ctx.fill()
    }

    // Convert canvas to ImageData and set icon
    canvas.convertToBlob().then((blob) => {
      const reader = new FileReader()
      reader.onload = () => {
        const imageData = reader.result
        chrome.action.setIcon({
          imageData: {
            16: imageData
          }
        })
      }
      reader.readAsArrayBuffer(blob)
    })
  }

  async isDevelopmentServer(url) {
    if (!url) return false

    // Get user settings
    const settings = await this.getSettings()

    if (!settings.autoAttach) return false

    const urlObj = new URL(url)
    const hostname = urlObj.hostname
    const port = parseInt(urlObj.port, 10) || (urlObj.protocol === "https:" ? 443 : 80)

    // Check if hostname is in allowed hosts
    if (!settings.customHosts.includes(hostname)) return false

    // If monitoring all localhost, allow any localhost port
    if (settings.monitorAllLocalhost && (hostname === "localhost" || hostname === "127.0.0.1")) {
      return true
    }

    // Check if port is in custom ports list
    return settings.customPorts.includes(port)
  }

  async getSettings() {
    try {
      const result = await chrome.storage.sync.get("dev3000Settings")
      const defaultSettings = {
        autoAttach: true,
        customPorts: [3000, 3001, 4200, 5173, 8080],
        customHosts: ["localhost", "127.0.0.1"],
        monitorAllLocalhost: true,
        captureConsole: true,
        captureNetwork: true,
        captureErrors: true,
        capturePerformance: true,
        maxLogEntries: 1000
      }
      return { ...defaultSettings, ...result.dev3000Settings }
    } catch (error) {
      console.error("Failed to load settings:", error)
      return {
        autoAttach: true,
        customPorts: [3000, 3001, 4200, 5173, 8080],
        customHosts: ["localhost", "127.0.0.1"],
        monitorAllLocalhost: true,
        captureConsole: true,
        captureNetwork: true,
        captureErrors: true,
        capturePerformance: true,
        maxLogEntries: 1000
      }
    }
  }

  async attachToTab(tabId) {
    try {
      // Check if already attached
      if (this.attachedTabs.has(tabId)) {
        return
      }

      // Get tab information first
      const tab = await chrome.tabs.get(tabId)

      // Attach to the tab
      await new Promise((resolve, reject) => {
        chrome.debugger.attach({ tabId }, "1.3", () => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError)
          } else {
            resolve()
          }
        })
      })

      // Get user agent and other runtime info
      const runtimeInfo = await this.sendCommand(tabId, "Runtime.evaluate", {
        expression: `({
          userAgent: navigator.userAgent,
          platform: navigator.platform,
          language: navigator.language,
          cookieEnabled: navigator.cookieEnabled,
          onLine: navigator.onLine,
          screenResolution: screen.width + 'x' + screen.height,
          windowSize: window.innerWidth + 'x' + window.innerHeight,
          timestamp: Date.now()
        })`
      })

      const browserInfo = runtimeInfo?.result?.value || {}

      // Create tab metadata
      const tabMetadata = {
        tabId,
        tabIndex: tab.index,
        windowId: tab.windowId,
        url: tab.url,
        title: tab.title,
        favIconUrl: tab.favIconUrl,
        userAgent: browserInfo.userAgent,
        platform: browserInfo.platform,
        language: browserInfo.language,
        screenResolution: browserInfo.screenResolution,
        windowSize: browserInfo.windowSize,
        attached: true,
        startTime: Date.now()
      }

      console.log(`Attached to tab ${tabId} (${tab.title})`)
      this.attachedTabs.set(tabId, tabMetadata)

      // Create a friendly tab identifier
      const tabIdentifier = this.createTabIdentifier(tabMetadata)

      // Log attachment with tab info and mark as Chrome Extension
      this.addLogEntry(
        `[${new Date().toISOString()}] [TAB-${tabIdentifier}] [BROWSER] [ATTACH] Monitoring started - ${tab.title} (${tab.url}) [CHROME_EXTENSION]`
      )
      this.addLogEntry(
        `[${new Date().toISOString()}] [TAB-${tabIdentifier}] [BROWSER] [INFO] User-Agent: ${browserInfo.userAgent || "Unknown"} [CHROME_EXTENSION]`
      )
      this.addLogEntry(
        `[${new Date().toISOString()}] [TAB-${tabIdentifier}] [BROWSER] [INFO] Resolution: ${browserInfo.screenResolution || "Unknown"}, Window: ${browserInfo.windowSize || "Unknown"} [CHROME_EXTENSION]`
      )

      // Enable domains we want to monitor
      await this.enableDomains(tabId)

      // Update icon to show active state
      this.updateIcon()
    } catch (error) {
      console.error(`Failed to attach to tab ${tabId}:`, error)
    }
  }

  createTabIdentifier(tabMetadata) {
    // Create a short, human-readable identifier for the tab
    // Format: WindowId.TabIndex (e.g., "1.0", "1.1", "2.0")
    return `${tabMetadata.windowId}.${tabMetadata.tabIndex}`
  }

  getTabIdentifier(tabId) {
    const tabData = this.attachedTabs.get(tabId)
    return tabData ? this.createTabIdentifier(tabData) : `${tabId}`
  }

  handleTabDisconnection(tabId, reason) {
    const tabData = this.attachedTabs.get(tabId)
    const tabIdentifier = this.getTabIdentifier(tabId)
    const timestamp = new Date().toISOString()

    if (reason === "target_closed" && tabData) {
      // Analyze if this might be a crash rather than normal closure
      const timeSinceAttach = Date.now() - tabData.startTime
      const errorCount = this.errorCounts.get(tabId) || 0
      const recentErrorThreshold = 10 // More than 10 errors might indicate instability
      const quickCloseThreshold = 5000 // Less than 5 seconds might indicate crash

      let suspectedCrash = false
      const crashReasons = []

      if (timeSinceAttach < quickCloseThreshold) {
        suspectedCrash = true
        crashReasons.push(`closed quickly (${Math.round(timeSinceAttach / 1000)}s after attach)`)
      }

      if (errorCount > recentErrorThreshold) {
        suspectedCrash = true
        crashReasons.push(`high error count (${errorCount} errors)`)
      }

      // Check for memory-related errors in recent logs
      const recentLogs = this.getRecentLogsForTab(tabId, 20)
      const memoryErrors = recentLogs.filter(
        (log) =>
          log.includes("memory") ||
          log.includes("heap") ||
          log.includes("allocation") ||
          log.includes("out of memory") ||
          log.includes("FATAL ERROR")
      )

      if (memoryErrors.length > 0) {
        suspectedCrash = true
        crashReasons.push(`memory-related errors (${memoryErrors.length} instances)`)
      }

      if (suspectedCrash) {
        this.suspectedCrashes.set(tabId, {
          tabData,
          reasons: crashReasons,
          timestamp: Date.now(),
          errorCount,
          recentLogs: recentLogs.slice(-10) // Keep last 10 log entries for context
        })

        this.addLogEntry(
          `[${timestamp}] [TAB-${tabIdentifier}] [BROWSER] [SUSPECTED CRASH] Tab disconnected unexpectedly - ${crashReasons.join(", ")} [CHROME_EXTENSION]`
        )

        // Log error context if available
        if (errorCount > 0) {
          this.addLogEntry(
            `[${timestamp}] [TAB-${tabIdentifier}] [BROWSER] [CRASH CONTEXT] ${errorCount} errors preceded disconnection [CHROME_EXTENSION]`
          )
        }

        // Log memory errors if found
        memoryErrors.slice(-3).forEach((errorLog) => {
          this.addLogEntry(
            `[${timestamp}] [TAB-${tabIdentifier}] [BROWSER] [CRASH CONTEXT] Recent error: ${errorLog.split("] [BROWSER] ").pop()} [CHROME_EXTENSION]`
          )
        })
      } else {
        this.addLogEntry(
          `[${timestamp}] [TAB-${tabIdentifier}] [BROWSER] [DISCONNECT] Tab closed normally (${Math.round(timeSinceAttach / 1000)}s runtime, ${errorCount} errors) [CHROME_EXTENSION]`
        )
      }
    } else {
      this.addLogEntry(
        `[${timestamp}] [TAB-${tabIdentifier}] [BROWSER] [DISCONNECT] Debugger detached: ${reason} [CHROME_EXTENSION]`
      )
    }

    // Clean up tracking data
    this.attachedTabs.delete(tabId)
    this.errorCounts.delete(tabId)
    this.updateIcon()
  }

  handleTabRemoval(tabId, removeInfo) {
    const tabData = this.attachedTabs.get(tabId)
    const tabIdentifier = this.getTabIdentifier(tabId)
    const timestamp = new Date().toISOString()

    if (tabData && !removeInfo.isWindowClosing) {
      // Individual tab was closed (not part of window close)
      // This provides additional context for crash detection
      this.addLogEntry(
        `[${timestamp}] [TAB-${tabIdentifier}] [BROWSER] [TAB REMOVED] Individual tab closed (not window closure) [CHROME_EXTENSION]`
      )
    }
  }

  getRecentLogsForTab(tabId, count = 20) {
    const tabIdentifier = this.getTabIdentifier(tabId)
    return this.logBuffer.filter((log) => log.includes(`[TAB-${tabIdentifier}]`)).slice(-count)
  }

  trackErrorForTab(tabId) {
    const currentCount = this.errorCounts.get(tabId) || 0
    this.errorCounts.set(tabId, currentCount + 1)
  }

  async enableDomains(tabId) {
    const domains = ["Runtime", "Network", "Page", "DOM", "Performance", "Security", "Log"]

    for (const domain of domains) {
      try {
        await this.sendCommand(tabId, `${domain}.enable`)
        console.log(`Enabled ${domain} domain for tab ${tabId}`)
      } catch (error) {
        console.error(`Failed to enable ${domain} domain:`, error)
      }
    }
  }

  async sendCommand(tabId, method, params = {}) {
    return new Promise((resolve, reject) => {
      chrome.debugger.sendCommand({ tabId }, method, params, (result) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError)
        } else {
          resolve(result)
        }
      })
    })
  }

  handleDebuggerEvent(source, method, params) {
    const timestamp = new Date().toISOString()
    const tabId = source.tabId
    const tabIdentifier = this.getTabIdentifier(tabId)

    // Format log entry similar to the original CDP monitor
    let logEntry = null

    switch (method) {
      case "Runtime.consoleAPICalled":
        logEntry = this.formatConsoleLog(timestamp, tabIdentifier, params)
        // Track console errors for crash detection
        if (params.type === "error" || params.type === "assert") {
          this.trackErrorForTab(tabId)
        }
        break

      case "Network.responseReceived":
        logEntry = this.formatNetworkResponse(timestamp, tabIdentifier, params)
        break

      case "Page.loadEventFired":
        logEntry = `[${timestamp}] [TAB-${tabIdentifier}] [BROWSER] [PAGE] Load event fired [CHROME_EXTENSION]`
        break

      case "Page.domContentLoadedEventFired":
        logEntry = `[${timestamp}] [TAB-${tabIdentifier}] [BROWSER] [PAGE] DOM content loaded [CHROME_EXTENSION]`
        break

      case "Page.frameNavigated":
        logEntry = `[${timestamp}] [TAB-${tabIdentifier}] [BROWSER] [NAVIGATION] ${params.frame.url} [CHROME_EXTENSION]`
        break

      case "Runtime.exceptionThrown":
        logEntry = this.formatException(timestamp, tabIdentifier, params)
        this.trackErrorForTab(tabId) // Track error for crash detection
        break

      case "Security.securityStateChanged":
        logEntry = `[${timestamp}] [TAB-${tabIdentifier}] [BROWSER] [SECURITY] State changed to ${params.securityState} [CHROME_EXTENSION]`
        break

      default:
        // Skip noisy debug events that aren't useful for application debugging
        // These include: Network.webSocketFrame*, Network.dataReceived, Runtime.executionContextDestroyed, etc.
        // Only log meaningful browser events that help with application debugging
        break
    }

    if (logEntry) {
      this.addLogEntry(logEntry)

      // Send to content script if needed
      chrome.tabs
        .sendMessage(tabId, {
          type: "CDP_EVENT",
          method,
          params,
          timestamp,
          logEntry
        })
        .catch(() => {}) // Ignore if content script not ready
    }
  }

  formatConsoleLog(timestamp, tabIdentifier, params) {
    const level = params.type.toUpperCase()
    const args = params.args || []
    let message = ""

    if (args.length > 0) {
      message = args
        .map((arg) => {
          if (arg.type === "string") {
            return arg.value
          } else if (arg.type === "object" && arg.preview) {
            return JSON.stringify(arg.preview)
          } else {
            return String(arg.value || arg.description || "[Object]")
          }
        })
        .join(" ")
    }

    return `[${timestamp}] [TAB-${tabIdentifier}] [BROWSER] [CONSOLE ${level}] ${message} [CHROME_EXTENSION]`
  }

  formatNetworkResponse(timestamp, tabIdentifier, params) {
    const response = params.response
    const url = response.url
    const status = response.status
    const statusText = response.statusText
    const mimeType = response.mimeType
    const resourceType = params.type || "Unknown"

    return `[${timestamp}] [TAB-${tabIdentifier}] [BROWSER] [NETWORK RESPONSE] ${status} ${statusText} ${url} (${resourceType}) [${mimeType}] [CHROME_EXTENSION]`
  }

  formatException(timestamp, tabIdentifier, params) {
    const exception = params.exceptionDetails
    const message = exception.text || exception.exception?.description || "Unknown error"
    const url = exception.url || "unknown"
    const line = exception.lineNumber || 0
    const col = exception.columnNumber || 0

    return `[${timestamp}] [TAB-${tabIdentifier}] [BROWSER] [ERROR] ${message} at ${url}:${line}:${col} [CHROME_EXTENSION]`
  }

  addLogEntry(entry) {
    // Add to local buffer for popup display
    this.logBuffer.push(entry)

    // Keep buffer size manageable
    if (this.logBuffer.length > this.maxLogEntries) {
      this.logBuffer = this.logBuffer.slice(-this.maxLogEntries)
    }

    // Send to MCP server for unified logging
    this.sendToMcpServer(entry)
  }

  async sendToMcpServer(entry) {
    try {
      const response = await fetch("http://localhost:3684/api/logs/append", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          entry: entry,
          source: "chrome-extension"
        })
      })

      if (response.ok) {
        this.mcpServerStatus = "connected"
      } else {
        this.mcpServerStatus = "disconnected"
        console.warn(`Failed to send log to MCP server: ${response.status}`)
      }
    } catch (error) {
      // Silently fail if MCP server is not running
      // This allows the extension to work independently
      this.mcpServerStatus = "disconnected"
      console.debug("MCP server not available:", error.message)
    }

    this.lastMcpServerCheck = Date.now()
  }

  async checkMcpServerStatus() {
    // Only check every 30 seconds to avoid spam
    if (Date.now() - this.lastMcpServerCheck < 30000) {
      return this.mcpServerStatus
    }

    try {
      const response = await fetch("http://localhost:3684/api/logs/tail?lines=1", {
        method: "GET"
      })

      this.mcpServerStatus = response.ok ? "connected" : "disconnected"
    } catch (_error) {
      this.mcpServerStatus = "disconnected"
    }

    this.lastMcpServerCheck = Date.now()
    return this.mcpServerStatus
  }

  // API for popup and content scripts
  async getLogs(limit = 100) {
    return this.logBuffer.slice(-limit)
  }

  async searchLogs(pattern, limit = 50) {
    const regex = new RegExp(pattern, "i")
    return this.logBuffer.filter((log) => regex.test(log)).slice(-limit)
  }

  async getAttachedTabs() {
    return Array.from(this.attachedTabs.keys())
  }

  async getTabMetadata() {
    const metadata = []
    for (const [tabId, tabData] of this.attachedTabs) {
      metadata.push({
        tabId,
        identifier: this.createTabIdentifier(tabData),
        url: tabData.url,
        title: tabData.title,
        userAgent: tabData.userAgent,
        platform: tabData.platform,
        language: tabData.language,
        screenResolution: tabData.screenResolution,
        windowSize: tabData.windowSize,
        startTime: tabData.startTime,
        duration: Date.now() - tabData.startTime
      })
    }
    return metadata
  }
}

// Initialize the monitor
const monitor = new Dev3000Monitor()

// Handle messages from popup/content scripts
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  switch (request.action) {
    case "getLogs":
      monitor.getLogs(request.limit).then(sendResponse)
      return true // Will respond asynchronously

    case "searchLogs":
      monitor.searchLogs(request.pattern, request.limit).then(sendResponse)
      return true

    case "getAttachedTabs":
      monitor.getAttachedTabs().then(sendResponse)
      return true

    case "attachToTab":
      monitor.attachToTab(request.tabId).then(() => sendResponse({ success: true }))
      return true

    case "getTabMetadata":
      monitor.getTabMetadata().then(sendResponse)
      return true

    case "getMcpServerStatus":
      monitor.checkMcpServerStatus().then(sendResponse)
      return true

    case "settingsChanged":
      // Settings changed from options page
      console.log("Settings updated:", request.settings)
      sendResponse({ success: true })
      break

    default:
      sendResponse({ error: "Unknown action" })
  }
})
