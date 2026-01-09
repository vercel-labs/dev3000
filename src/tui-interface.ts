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

type InkApp = { unmount: () => void }

export class DevTUI {
  private options: TUIOptions
  private app: InkApp | null = null
  private updateStatusFn: ((status: string | null) => void) | null = null
  private updateAppPortFn: ((port: string) => void) | null = null
  private updateUpdateInfoFn: ((info: UpdateInfo) => void) | null = null
  private updateUseHttpsFn: ((useHttps: boolean) => void) | null = null

  constructor(options: TUIOptions) {
    this.options = options
  }

  async start(): Promise<void> {
    try {
      // Clear screen and scrollback before starting TUI
      process.stdout.write("\x1b[2J\x1b[H\x1b[3J")

      // Temporarily suppress React hook warnings during TUI startup
      const originalError = console.error
      const suppressReactHookWarnings = (...args: unknown[]) => {
        const message = args[0]
        if (typeof message === "string" && message.includes("Invalid hook call")) {
          // Suppress React hook warnings during TUI startup - these are known compatibility issues with React 19 canary + Ink
          return
        }
        originalError(...args)
      }
      console.error = suppressReactHookWarnings

      // Use dynamic import to load the OpenTUI implementation at runtime
      const { runTUI } = await import("./tui-interface-opentui.js")
      const { app, updateStatus, updateAppPort, updateUpdateInfo, updateUseHttps } = await runTUI(this.options)
      this.app = app
      this.updateStatusFn = updateStatus
      this.updateAppPortFn = updateAppPort
      this.updateUpdateInfoFn = updateUpdateInfo
      this.updateUseHttpsFn = updateUseHttps

      // Restore original error logging after startup
      setTimeout(() => {
        console.error = originalError
      }, 1000)
    } catch (error) {
      console.error("Failed to start TUI:", error)
      throw error
    }
  }

  updateStatus(status: string | null): void {
    if (this.updateStatusFn) {
      this.updateStatusFn(status)
    }
  }

  updateAppPort(port: string): void {
    if (this.updateAppPortFn) {
      this.updateAppPortFn(port)
    }
  }

  updateUpdateInfo(info: UpdateInfo): void {
    if (this.updateUpdateInfoFn) {
      this.updateUpdateInfoFn(info)
    }
  }

  updateUseHttps(useHttps: boolean): void {
    if (this.updateUseHttpsFn) {
      this.updateUseHttpsFn(useHttps)
    }
  }

  async shutdown(): Promise<void> {
    if (this.app) {
      this.app.unmount()
    }
    // Clear screen and scrollback on shutdown
    process.stdout.write("\x1b[2J\x1b[H\x1b[3J")
  }
}
