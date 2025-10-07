import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { WebSocket } from "ws"

export interface ScreencastFrame {
  timestamp: number // ms since navigation start
  path: string
  sessionId: string // ISO timestamp for grouping
}

interface BufferedFrame {
  timestamp: number
  data: string // base64 PNG
  absoluteTime: number // Date.now()
}

interface LayoutShiftSource {
  node?: string
  previousRect?: { x: number; y: number; width: number; height: number }
  currentRect?: { x: number; y: number; width: number; height: number }
  actualRect?: { x: number; y: number; width: number; height: number } | null
}

/**
 * ScreencastManager - Passive screencast capture for navigation events
 *
 * Listens for Page.frameStartedLoading and automatically captures 5 seconds
 * of screencast frames for jank detection. No artificial page reloads needed!
 */
export class ScreencastManager {
  private ws: WebSocket | null = null
  private buffer: BufferedFrame[] = []
  private isCapturing = false
  private navigationStartTime = 0
  private currentSessionId = ""
  private screenshotDir: string
  private messageId = 1000 // Start high to avoid conflicts
  private appPort: string
  private layoutShifts: Array<{ score: number; timestamp: number; sources?: LayoutShiftSource[] }> = []
  private viewportInfo: Record<string, number> = {}

  constructor(
    private cdpUrl: string,
    private logFn: (msg: string) => void,
    appPort?: string
  ) {
    this.screenshotDir = process.env.SCREENSHOT_DIR || join(tmpdir(), "dev3000-mcp-deps", "public", "screenshots")
    this.appPort = appPort || process.env.APP_PORT || "3000"
    if (!existsSync(this.screenshotDir)) {
      mkdirSync(this.screenshotDir, { recursive: true })
    }
  }

  /**
   * Start listening for navigation events and capturing screencasts
   */
  async start(): Promise<void> {
    if (this.ws) {
      return
    }

    try {
      this.ws = new WebSocket(this.cdpUrl)

      this.ws.on("open", () => {
        // Enable Page domain to receive navigation events
        this.send("Page.enable", {})
        // Enable Runtime domain for URL checking
        this.send("Runtime.enable", {})
      })

      this.ws.on("message", (data) => {
        this.handleMessage(JSON.parse(data.toString()))
      })

      this.ws.on("error", () => {
        // Silently handle errors
      })

      this.ws.on("close", () => {
        this.ws = null
      })
    } catch {
      // Silently handle errors
    }
  }

  /**
   * Stop capturing and cleanup
   */
  async stop(): Promise<void> {
    if (this.isCapturing) {
      await this.stopScreencast()
    }
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
    // this.logFn("[CDP] Stopped")
  }

  /**
   * Handle CDP messages
   */
  private handleMessage(message: {
    method?: string
    params?: Record<string, unknown>
    id?: number
    result?: unknown
  }): void {
    // Uncomment for CDP event debugging:
    // if (message.method && (message.method.startsWith("Page.") || message.method.startsWith("Network."))) {
    //   this.logFn(`[CDP] Received CDP event: ${message.method}`)
    // }

    // Navigation started - check URL before capturing
    // Note: Page.frameStartedNavigating fires earlier than Page.frameStartedLoading
    if (message.method === "Page.frameStartedNavigating" || message.method === "Page.frameStartedLoading") {
      this.checkUrlAndStartCapture()
    }

    // Navigation finished - save and stop
    else if (message.method === "Page.loadEventFired") {
      this.onNavigationComplete()
    }

    // Screencast frame received
    else if (message.method === "Page.screencastFrame" && message.params) {
      this.onScreencastFrame(message.params as { data: string; sessionId: string })
    }
  }

  /**
   * Check URL before starting capture - only capture localhost:{appPort}
   */
  private async checkUrlAndStartCapture(): Promise<void> {
    try {
      // Query current page URL using Runtime.evaluate
      const evalId = this.messageId++
      this.send(
        "Runtime.evaluate",
        {
          expression: "window.location.href",
          returnByValue: true
        },
        evalId
      )

      // Wait for response (hacky but works for now)
      const checkResponse = (message: { id?: number; result?: { result?: { value?: string } } }): void => {
        if (message.id === evalId && message.result?.result?.value) {
          const url = message.result.result.value
          // this.logFn(`[CDP] Current URL: ${url}`)

          // Only capture if it's the app URL (localhost:appPort)
          if (url.includes(`localhost:${this.appPort}`)) {
            // this.logFn("[CDP] URL matches app, starting capture")
            this.onNavigationStart()
          } else {
            // this.logFn(`[CDP] Skipping capture - URL does not match localhost:${this.appPort}`)
          }

          // Remove listener after handling
          if (this.ws) {
            this.ws.off("message", responseHandler)
          }
        }
      }

      const responseHandler = (data: Buffer): void => {
        checkResponse(JSON.parse(data.toString()))
      }

      if (this.ws) {
        this.ws.on("message", responseHandler)

        // Timeout after 500ms
        setTimeout(() => {
          if (this.ws) {
            this.ws.off("message", responseHandler)
          }
        }, 500)
      }
    } catch (error) {
      this.logFn(`[CDP] Failed to check URL - ${error}`)
      // Fall back to capturing anyway
      this.onNavigationStart()
    }
  }

  /**
   * Navigation started - begin capturing screencast
   */
  private onNavigationStart(): void {
    // this.logFn("[CDP] Navigation started, beginning screencast capture")

    // Stop any existing capture first
    if (this.isCapturing) {
      this.send("Page.stopScreencast", {})
    }

    this.navigationStartTime = Date.now()
    this.currentSessionId = new Date()
      .toISOString()
      .replace(/:/g, "-")
      .replace(/\.\d{3}Z$/, "Z")
    this.buffer = []
    this.layoutShifts = []
    this.isCapturing = true

    // Install CLS observer if not already present
    this.installCLSObserver()

    // Start screencast at 15fps with good quality
    this.send("Page.startScreencast", {
      format: "png",
      quality: 80,
      maxWidth: 1920,
      maxHeight: 1080,
      everyNthFrame: 1
    })
  }

  /**
   * Navigation completed - save frames and stop (after delay to catch hydration)
   */
  private async onNavigationComplete(): Promise<void> {
    if (!this.isCapturing) return

    // this.logFn(`[CDP] Page loaded, capturing 2 more seconds for hydration jank...`)

    // Continue capturing for 2 more seconds to catch hydration issues
    // Hydration often happens right after page load completes
    setTimeout(async () => {
      if (!this.isCapturing) return

      // this.logFn(`[CDP] Navigation complete, saving ${this.buffer.length} frames`)

      // Save all buffered frames
      for (const frame of this.buffer) {
        const screenshotPath = join(this.screenshotDir, `${this.currentSessionId}-jank-${frame.timestamp}ms.png`)
        try {
          const buffer = Buffer.from(frame.data, "base64")
          writeFileSync(screenshotPath, buffer)
        } catch (error) {
          this.logFn(`[CDP] Failed to save frame - ${error}`)
        }
      }

      // this.logFn(`[CDP] Saved ${this.buffer.length} frames for session ${this.currentSessionId}`)

      // Save session metadata with CLS data
      const metadataPath = join(this.screenshotDir, `${this.currentSessionId}-metadata.json`)
      const totalCLS = this.layoutShifts.reduce((sum, shift) => sum + shift.score, 0)

      const metadata = {
        sessionId: this.currentSessionId,
        frameCount: this.buffer.length,
        navigationStartTime: this.navigationStartTime,
        captureEndTime: Date.now(),
        appPort: this.appPort,
        cssViewport: this.viewportInfo, // CSS viewport dimensions from window.innerWidth
        layoutShifts: this.layoutShifts,
        totalCLS,
        clsGrade: totalCLS <= 0.1 ? "good" : totalCLS <= 0.25 ? "needs-improvement" : "poor"
      }
      try {
        writeFileSync(metadataPath, JSON.stringify(metadata, null, 2))
        if (totalCLS > 0) {
          this.logFn(`[CDP] Detected ${this.layoutShifts.length} layout shifts (CLS: ${totalCLS.toFixed(4)})`)

          // Generate detailed CLS analysis for each shift
          this.layoutShifts.forEach((shift, index) => {
            // Find the frame closest to this shift timestamp
            const shiftFrame = this.buffer.find((f) => Math.abs(f.timestamp - shift.timestamp) < 500)
            const previousFrame = this.buffer.find(
              (f) => f.timestamp < shift.timestamp && Math.abs(f.timestamp - shift.timestamp) < 1000
            )

            if (shiftFrame && shift.sources && shift.sources.length > 0) {
              const mcpPort = process.env.MCP_PORT || "3684"
              const shiftFilename = `${this.currentSessionId}-jank-${shiftFrame.timestamp}ms.png`
              const previousFilename = previousFrame
                ? `${this.currentSessionId}-jank-${previousFrame.timestamp}ms.png`
                : null

              // Generate human-readable description of the shift
              const descriptions: string[] = []
              shift.sources.forEach((source) => {
                if (source.node && source.previousRect && source.currentRect) {
                  const deltaX = source.currentRect.x - source.previousRect.x
                  const deltaY = source.currentRect.y - source.previousRect.y
                  const direction = deltaY > 0 ? "down" : deltaY < 0 ? "up" : deltaX > 0 ? "right" : "left"
                  const distance = Math.abs(deltaY || deltaX)
                  descriptions.push(`<${source.node}> shifted ${direction} by ${distance.toFixed(0)}px`)
                }
              })

              this.logFn(
                `[CDP] CLS #${index + 1} (score: ${shift.score.toFixed(4)}, time: ${shift.timestamp.toFixed(0)}ms):`
              )
              descriptions.forEach((desc) => {
                this.logFn(`[CDP]   - ${desc}`)
              })

              if (previousFilename) {
                this.logFn(`[CDP]   Before: http://localhost:${mcpPort}/api/screenshots/${previousFilename}`)
              }
              this.logFn(`[CDP]   After:  http://localhost:${mcpPort}/api/screenshots/${shiftFilename}`)
              this.logFn(`[CDP]   💡 Analyze both images to identify visual differences causing the layout shift`)
            }
          })
        }
      } catch (error) {
        this.logFn(`[CDP] Failed to save metadata - ${error}`)
      }

      this.logFn(
        `[CDP] View all frames: http://localhost:${process.env.MCP_PORT || "3684"}/video/${this.currentSessionId}`
      )

      await this.stopScreencast()
    }, 2000)
  }

  /**
   * Received a screencast frame - add to buffer
   */
  private onScreencastFrame(params: { data: string; sessionId: string }): void {
    if (!this.isCapturing) return

    const frameTimestamp = Date.now() - this.navigationStartTime
    const frameData = params.data
    const sessionId = params.sessionId

    // Acknowledge frame so we get more
    this.send("Page.screencastFrameAck", { sessionId })

    // Buffer frames (no time limit, onNavigationComplete handles stopping)
    this.buffer.push({
      timestamp: frameTimestamp,
      data: frameData,
      absoluteTime: Date.now()
    })

    // Keep buffer trimmed to prevent memory issues (max 10 seconds of frames)
    const now = Date.now()
    this.buffer = this.buffer.filter((f) => now - f.absoluteTime < 10000)
  }

  /**
   * Stop screencast capture
   */
  private async stopScreencast(): Promise<void> {
    if (!this.isCapturing) return

    this.send("Page.stopScreencast", {})
    this.isCapturing = false
    this.buffer = []
    // this.logFn("[CDP] Stopped screencast capture")
  }

  /**
   * Install PerformanceObserver for layout shifts (passive, no reload needed)
   */
  private installCLSObserver(): void {
    const observerScript = `
      (function() {
        // Reset layout shifts array for new navigation
        window.__dev3000_layout_shifts__ = [];

        // Update viewport info for current navigation
        window.__dev3000_viewport__ = {
          width: window.innerWidth,
          height: window.innerHeight,
          devicePixelRatio: window.devicePixelRatio || 1
        };

        // Install observer if not already present
        if (window.__dev3000_cls_observer__) return;
        window.__dev3000_cls_observer__ = true;

        try {
          const observer = new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
              if (entry.entryType === 'layout-shift' && !entry.hadRecentInput) {
                // For each shift, try to get the actual current bounding box
                const sources = entry.sources ? entry.sources.map(s => {
                  let actualRect = null;
                  if (s.node && s.node.nodeName) {
                    try {
                      // Query the first matching element (nav, header, etc.)
                      const element = document.querySelector(s.node.nodeName.toLowerCase());
                      if (element) {
                        const rect = element.getBoundingClientRect();
                        actualRect = {
                          x: rect.x,
                          y: rect.y,
                          width: rect.width,
                          height: rect.height
                        };
                      }
                    } catch (e) {
                      // Ignore errors
                    }
                  }

                  return {
                    node: s.node ? s.node.nodeName : undefined,
                    previousRect: s.previousRect ? {
                      x: s.previousRect.x,
                      y: s.previousRect.y,
                      width: s.previousRect.width,
                      height: s.previousRect.height
                    } : {},
                    currentRect: s.currentRect ? {
                      x: s.currentRect.x,
                      y: s.currentRect.y,
                      width: s.currentRect.width,
                      height: s.currentRect.height
                    } : {},
                    actualRect: actualRect
                  };
                }) : [];

                window.__dev3000_layout_shifts__.push({
                  score: entry.value,
                  timestamp: entry.startTime,
                  sources: sources
                });
              }
            }
          });

          observer.observe({ type: 'layout-shift', buffered: true });
          console.log('[dev3000] CLS observer installed');
        } catch (e) {
          console.error('[dev3000] Failed to install CLS observer:', e);
        }
      })();
    `

    // Inject observer via Runtime.evaluate (reinstall on each navigation to reset)
    const evalId = this.messageId++
    this.send("Runtime.evaluate", { expression: observerScript, returnByValue: false }, evalId)

    // Set up periodic polling to retrieve layout shift data
    this.pollLayoutShifts()
    // this.logFn("Installed CLS observer")
  }

  /**
   * Poll for layout shift data from the injected observer
   */
  private pollLayoutShifts(): void {
    if (!this.isCapturing) return

    const pollId = this.messageId++
    const viewportId = this.messageId++

    this.send(
      "Runtime.evaluate",
      {
        expression: "window.__dev3000_layout_shifts__ || []",
        returnByValue: true
      },
      pollId
    )

    // Also get viewport info
    this.send(
      "Runtime.evaluate",
      {
        expression: "window.__dev3000_viewport__ || {}",
        returnByValue: true
      },
      viewportId
    )

    // Listen for response
    const handlePollResponse = (message: {
      id?: number
      result?: { result?: { value?: unknown[] | Record<string, number> } }
    }): void => {
      if (message.id === pollId && message.result?.result?.value) {
        const shifts = message.result.result.value as Array<{
          score: number
          timestamp: number
          sources?: LayoutShiftSource[]
        }>
        if (shifts.length > this.layoutShifts.length) {
          // New shifts detected
          const newShifts = shifts.slice(this.layoutShifts.length)
          this.layoutShifts.push(...newShifts)
          newShifts.forEach((shift) => {
            this.logFn(
              `[CDP] Layout shift detected (score: ${shift.score.toFixed(4)}, time: ${shift.timestamp.toFixed(0)}ms)`
            )
          })
        }
      }

      if (message.id === viewportId && message.result?.result?.value) {
        this.viewportInfo = message.result.result.value as Record<string, number>
      }
    }

    const responseHandler = (data: Buffer): void => {
      handlePollResponse(JSON.parse(data.toString()))
    }

    if (this.ws) {
      this.ws.on("message", responseHandler)

      // Timeout after 500ms
      setTimeout(() => {
        if (this.ws) {
          this.ws.off("message", responseHandler)
        }
      }, 500)
    }

    // Poll every 500ms while capturing
    if (this.isCapturing) {
      setTimeout(() => this.pollLayoutShifts(), 500)
    }
  }

  /**
   * Send CDP command
   */
  private send(method: string, params: Record<string, unknown>, id?: number): void {
    if (!this.ws) return
    this.ws.send(
      JSON.stringify({
        id: id ?? this.messageId++,
        method,
        params
      })
    )
  }

  /**
   * Get the most recent session ID (for fix_my_app to reference)
   */
  getLatestSessionId(): string {
    return this.currentSessionId
  }
}
