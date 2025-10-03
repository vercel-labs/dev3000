export interface TUIOptions {
  appPort: string
  mcpPort: string
  logFile: string
  commandName: string
  serversOnly?: boolean
  version: string
  projectName?: string
}

type InkApp = { unmount: () => void }

export class DevTUI {
  private options: TUIOptions
  private app: InkApp | null = null
  private updateStatusFn: ((status: string | null) => void) | null = null
  private updateAppPortFn: ((port: string) => void) | null = null

  constructor(options: TUIOptions) {
    this.options = options
  }

  async start(): Promise<void> {
    try {
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

      // Use dynamic import to load the TSX implementation at runtime
      const { runTUI } = await import("./tui-interface-impl.js")
      const { app, updateStatus, updateAppPort } = await runTUI(this.options)
      this.app = app
      this.updateStatusFn = updateStatus
      this.updateAppPortFn = updateAppPort

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

  async shutdown(): Promise<void> {
    if (this.app) {
      this.app.unmount()
    }
  }
}
