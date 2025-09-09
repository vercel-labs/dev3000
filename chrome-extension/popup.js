// Dev3000 Extension Popup Script

class Dev3000Popup {
  constructor() {
    this.currentTab = null
    this.logs = []
    this.attachedTabs = []

    this.initialize()
  }

  async initialize() {
    // Get current tab
    await this.getCurrentTab()

    // Setup event listeners
    this.setupEventListeners()

    // Load initial data
    await this.loadData()

    // Auto-refresh every 2 seconds
    setInterval(() => this.refreshLogs(), 2000)
  }

  async getCurrentTab() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      this.currentTab = tab
      this.updateTabInfo()
    } catch (error) {
      console.error("Failed to get current tab:", error)
    }
  }

  async updateTabInfo() {
    const tabInfo = document.getElementById("tabInfo")

    if (this.currentTab) {
      const isDevServer = await this.isDevelopmentServer(this.currentTab.url)
      const isAttached = this.attachedTabs.includes(this.currentTab.id)

      tabInfo.innerHTML = `
        <div><strong>URL:</strong> ${this.currentTab.url}</div>
        <div><strong>Title:</strong> ${this.currentTab.title}</div>
        <div><strong>Dev Server:</strong> ${isDevServer ? "Yes" : "No"}</div>
        <div><strong>Monitoring:</strong> ${isAttached ? "Active" : "Inactive"}</div>
      `

      // Update status
      const statusIndicator = document.getElementById("statusIndicator")
      const statusText = document.getElementById("statusText")

      if (isAttached) {
        statusIndicator.className = "status-indicator active"
        statusText.textContent = "Monitoring Active"
      } else {
        statusIndicator.className = "status-indicator inactive"
        statusText.textContent = isDevServer ? "Ready to Monitor" : "Not a Dev Server"
      }

      // Update attach button
      const attachBtn = document.getElementById("attachBtn")
      attachBtn.textContent = isAttached ? "Detach from Tab" : "Attach to Tab"
      attachBtn.disabled = !isDevServer
    } else {
      tabInfo.innerHTML = '<div class="loading">Unable to access tab information</div>'
    }
  }

  async isDevelopmentServer(url) {
    if (!url) return false

    try {
      // Get settings to check user configuration
      const result = await chrome.storage.sync.get("dev3000Settings")
      const defaultSettings = {
        autoAttach: true,
        customPorts: [3000, 3001, 4200, 5173, 8080],
        customHosts: ["localhost", "127.0.0.1"],
        monitorAllLocalhost: true
      }
      const settings = { ...defaultSettings, ...result.dev3000Settings }

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
    } catch (error) {
      console.error("Error checking development server:", error)
      // Fallback to basic detection
      const devPatterns = [/localhost:\d+/, /127\.0\.0\.1:\d+/]
      return devPatterns.some((pattern) => pattern.test(url))
    }
  }

  setupEventListeners() {
    // Attach/Detach button
    document.getElementById("attachBtn").addEventListener("click", () => {
      this.toggleAttachment()
    })

    // Refresh button
    document.getElementById("refreshBtn").addEventListener("click", () => {
      this.refreshLogs()
    })

    // Clear button
    document.getElementById("clearBtn").addEventListener("click", () => {
      this.clearLogs()
    })

    // Search input
    const searchInput = document.getElementById("searchInput")
    let searchTimeout
    searchInput.addEventListener("input", (e) => {
      clearTimeout(searchTimeout)
      searchTimeout = setTimeout(() => {
        this.searchLogs(e.target.value)
      }, 300)
    })
  }

  async loadData() {
    await Promise.all([this.refreshLogs(), this.loadAttachedTabs(), this.loadTabMetadata(), this.loadMcpServerStatus()])
  }

  async refreshLogs() {
    try {
      const response = await chrome.runtime.sendMessage({
        action: "getLogs",
        limit: 100
      })

      this.logs = response || []
      this.renderLogs()
    } catch (error) {
      console.error("Failed to load logs:", error)
    }
  }

  async searchLogs(pattern) {
    if (!pattern.trim()) {
      this.renderLogs()
      return
    }

    try {
      const response = await chrome.runtime.sendMessage({
        action: "searchLogs",
        pattern,
        limit: 50
      })

      const searchResults = response || []
      this.renderLogs(searchResults)
    } catch (error) {
      console.error("Failed to search logs:", error)
    }
  }

  async loadAttachedTabs() {
    try {
      const response = await chrome.runtime.sendMessage({
        action: "getAttachedTabs"
      })

      this.attachedTabs = response || []
      this.updateStats()
      await this.updateTabInfo()
    } catch (error) {
      console.error("Failed to load attached tabs:", error)
    }
  }

  async toggleAttachment() {
    if (!this.currentTab) return

    const isAttached = this.attachedTabs.includes(this.currentTab.id)

    if (isAttached) {
      // Detach (not directly supported, would need to implement in background)
      console.log("Detach not implemented yet")
    } else {
      // Attach
      try {
        await chrome.runtime.sendMessage({
          action: "attachToTab",
          tabId: this.currentTab.id
        })

        // Refresh data
        await this.loadAttachedTabs()
      } catch (error) {
        console.error("Failed to attach to tab:", error)
      }
    }
  }

  renderLogs(logsToRender = this.logs) {
    const container = document.getElementById("logsContainer")

    if (!logsToRender || logsToRender.length === 0) {
      container.innerHTML = '<div class="loading">No logs available</div>'
      return
    }

    const logEntries = logsToRender
      .map((log) => {
        const className = this.getLogClassName(log)
        return `<div class="log-entry ${className}">${this.escapeHtml(log)}</div>`
      })
      .join("")

    container.innerHTML = logEntries

    // Scroll to bottom
    container.scrollTop = container.scrollHeight

    // Update count
    this.updateStats()
  }

  getLogClassName(log) {
    if (log.includes("[ERROR]") || log.includes("[BROWSER] [ERROR]")) {
      return "error"
    } else if (log.includes("[NETWORK]")) {
      return "network"
    } else if (log.includes("[CONSOLE]")) {
      return "console"
    }
    return ""
  }

  escapeHtml(text) {
    const div = document.createElement("div")
    div.textContent = text
    return div.innerHTML
  }

  async loadTabMetadata() {
    try {
      const response = await chrome.runtime.sendMessage({
        action: "getTabMetadata"
      })

      this.tabMetadata = response || []
      this.updateTabsInfo()
    } catch (error) {
      console.error("Failed to load tab metadata:", error)
    }
  }

  updateTabsInfo() {
    const tabsInfo = document.getElementById("tabsInfo")

    if (this.tabMetadata && this.tabMetadata.length > 0) {
      const tabsHtml = this.tabMetadata
        .map((tab) => {
          const duration = Math.round(tab.duration / 1000)
          const browser = this.getBrowserFromUserAgent(tab.userAgent)
          return `<div style="margin-bottom: 4px;">
          <strong>TAB-${tab.identifier}</strong>: ${tab.title.substring(0, 30)}${tab.title.length > 30 ? "..." : ""}<br>
          <span style="color: #9ca3af;">🌐 ${browser} • ⏱️ ${duration}s • 📱 ${tab.platform}</span>
        </div>`
        })
        .join("")

      tabsInfo.innerHTML = tabsHtml
    } else {
      tabsInfo.innerHTML = ""
    }
  }

  getBrowserFromUserAgent(userAgent) {
    if (!userAgent) return "Unknown"

    if (userAgent.includes("Chrome")) return "Chrome"
    if (userAgent.includes("Firefox")) return "Firefox"
    if (userAgent.includes("Safari") && !userAgent.includes("Chrome")) return "Safari"
    if (userAgent.includes("Edge")) return "Edge"
    return "Browser"
  }

  async loadMcpServerStatus() {
    try {
      const status = await chrome.runtime.sendMessage({
        action: "getMcpServerStatus"
      })

      this.updateMcpServerStatus(status)
    } catch (error) {
      console.error("Failed to load MCP server status:", error)
      this.updateMcpServerStatus("disconnected")
    }
  }

  updateMcpServerStatus(status) {
    const mcpStatusIndicator = document.getElementById("mcpStatusIndicator")
    const mcpStatusText = document.getElementById("mcpStatusText")

    switch (status) {
      case "connected":
        mcpStatusIndicator.className = "status-indicator active"
        mcpStatusText.textContent = "MCP Server: Connected ✓ (logs → /tmp/dev3000.log)"
        break
      case "disconnected":
        mcpStatusIndicator.className = "status-indicator inactive"
        mcpStatusText.textContent = "MCP Server: Offline (logs in extension only)"
        break
      default:
        mcpStatusIndicator.className = "status-indicator inactive"
        mcpStatusText.textContent = "MCP Server: Checking..."
    }
  }

  updateStats() {
    document.getElementById("logCount").textContent = `${this.logs.length} entries`
    document.getElementById("attachedTabs").textContent = `${this.attachedTabs.length} tabs monitored`
  }

  async clearLogs() {
    try {
      // Clear logs in background script (would need to implement this method)
      this.logs = []
      this.renderLogs()
    } catch (error) {
      console.error("Failed to clear logs:", error)
    }
  }
}

// Initialize popup when DOM is ready
document.addEventListener("DOMContentLoaded", () => {
  new Dev3000Popup()
})
