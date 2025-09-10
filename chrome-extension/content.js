// Dev3000 Content Script
// Injects monitoring capabilities and communicates with background script

;(() => {
  // Prevent multiple injections
  if (window.dev3000Injected) return
  window.dev3000Injected = true

  console.log("DEV3000_TEST: Simple script execution working!")

  class Dev3000ContentScript {
    constructor() {
      this.initialize()
    }

    initialize() {
      // Listen for messages from background script
      chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        this.handleMessage(request, sender, sendResponse)
      })

      // Inject additional monitoring if needed
      this.injectMonitoring()

      // Report page load
      this.reportPageLoad()
    }

    handleMessage(request, _sender, sendResponse) {
      switch (request.type) {
        case "CDP_EVENT":
          // Handle CDP events forwarded from background script
          this.handleCDPEvent(request)
          break

        case "GET_PAGE_INFO":
          sendResponse({
            url: window.location.href,
            title: document.title,
            userAgent: navigator.userAgent,
            timestamp: new Date().toISOString()
          })
          break

        case "EXECUTE_SCRIPT":
          try {
            // Use Function constructor instead of eval for better security
            const result = new Function(`return ${request.script}`)()
            sendResponse({ result, success: true })
          } catch (error) {
            sendResponse({ error: error.message, success: false })
          }
          break

        default:
          sendResponse({ error: "Unknown message type" })
      }
    }

    handleCDPEvent(event) {
      // Handle CDP events forwarded from background script
      if (event.method === "Runtime.consoleAPICalled") {
        // Don't double-log console events
        return
      }

      // CDP event handling can be added here if needed
      // Removed debug logging to reduce noise in application logs
    }

    injectMonitoring() {
      // Inject performance monitoring
      this.monitorPerformance()

      // Monitor DOM changes
      this.monitorDOMChanges()

      // Monitor errors
      this.monitorErrors()

      // Monitor network (limited from content script)
      this.monitorFetch()
    }

    monitorPerformance() {
      // Performance Observer for timing data
      if ("PerformanceObserver" in window) {
        try {
          const observer = new PerformanceObserver((list) => {
            list.getEntries().forEach((entry) => {
              chrome.runtime.sendMessage({
                type: "PERFORMANCE_ENTRY",
                entry: {
                  name: entry.name,
                  type: entry.entryType,
                  startTime: entry.startTime,
                  duration: entry.duration,
                  timestamp: new Date().toISOString()
                }
              })
            })
          })

          observer.observe({ entryTypes: ["navigation", "resource", "measure", "paint"] })
        } catch (error) {
          console.debug("Performance Observer not supported:", error)
        }
      }
    }

    monitorDOMChanges() {
      // MutationObserver for DOM changes
      if ("MutationObserver" in window) {
        const observer = new MutationObserver((mutations) => {
          const significantChanges = mutations.filter(
            (mutation) => mutation.type === "childList" && mutation.addedNodes.length > 0
          )

          if (significantChanges.length > 0) {
            chrome.runtime.sendMessage({
              type: "DOM_CHANGE",
              changes: significantChanges.length,
              timestamp: new Date().toISOString()
            })
          }
        })

        observer.observe(document.body || document.documentElement, {
          childList: true,
          subtree: true,
          attributes: false,
          attributeOldValue: false,
          characterData: false
        })
      }
    }

    monitorErrors() {
      // Global error handler
      window.addEventListener("error", (event) => {
        chrome.runtime.sendMessage({
          type: "JAVASCRIPT_ERROR",
          error: {
            message: event.message,
            filename: event.filename,
            lineno: event.lineno,
            colno: event.colno,
            stack: event.error?.stack,
            timestamp: new Date().toISOString()
          }
        })
      })

      // Promise rejection handler
      window.addEventListener("unhandledrejection", (event) => {
        chrome.runtime.sendMessage({
          type: "PROMISE_REJECTION",
          error: {
            reason: event.reason,
            promise: event.promise.toString(),
            timestamp: new Date().toISOString()
          }
        })
      })
    }

    monitorFetch() {
      // Intercept fetch requests (limited visibility)
      const originalFetch = window.fetch

      window.fetch = async function (...args) {
        const startTime = performance.now()
        const url = typeof args[0] === "string" ? args[0] : args[0]?.url

        try {
          const response = await originalFetch.apply(this, args)
          const endTime = performance.now()

          chrome.runtime.sendMessage({
            type: "FETCH_REQUEST",
            request: {
              url,
              method: args[1]?.method || "GET",
              status: response.status,
              statusText: response.statusText,
              duration: endTime - startTime,
              timestamp: new Date().toISOString()
            }
          })

          return response
        } catch (error) {
          const endTime = performance.now()

          chrome.runtime.sendMessage({
            type: "FETCH_ERROR",
            request: {
              url,
              method: args[1]?.method || "GET",
              error: error.message,
              duration: endTime - startTime,
              timestamp: new Date().toISOString()
            }
          })

          throw error
        }
      }
    }

    reportPageLoad() {
      // Get additional tab context
      const tabContext = {
        url: window.location.href,
        title: document.title,
        referrer: document.referrer,
        timestamp: new Date().toISOString(),
        readyState: document.readyState,
        userAgent: navigator.userAgent,
        language: navigator.language,
        platform: navigator.platform,
        cookieEnabled: navigator.cookieEnabled,
        screenResolution: `${screen.width}x${screen.height}`,
        windowSize: `${window.innerWidth}x${window.innerHeight}`,
        colorDepth: screen.colorDepth,
        pixelRatio: window.devicePixelRatio
      }

      // Report initial page load
      chrome.runtime.sendMessage({
        type: "PAGE_LOAD",
        page: tabContext
      })

      // Report when DOM is ready
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", () => {
          chrome.runtime.sendMessage({
            type: "DOM_READY",
            timestamp: new Date().toISOString()
          })
        })
      }

      // Report when page is fully loaded
      if (document.readyState !== "complete") {
        window.addEventListener("load", () => {
          chrome.runtime.sendMessage({
            type: "PAGE_LOADED",
            timestamp: new Date().toISOString()
          })
        })
      }
    }
  }

  // Initialize content script
  new Dev3000ContentScript()
})()
