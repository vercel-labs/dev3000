export interface TUIOptions {
  appPort: string
  mcpPort: string
  logFile: string
  commandName: string
  serversOnly?: boolean
  version: string
  projectName?: string
  onShutdown?: () => void
}

type InkApp = { unmount: () => void }

export class DevTUI {
  private options: TUIOptions
  private app: InkApp | null = null
  private updateStatusFn: ((status: string | null) => void) | null = null

  constructor(options: TUIOptions) {
    this.options = options
  }

  async start(): Promise<void> {
    // Use dynamic import to load the TSX implementation at runtime
    const { runTUI } = await import("./tui-interface-impl.js")
    const { app, updateStatus } = await runTUI(this.options)
    this.app = app
    this.updateStatusFn = updateStatus
  }

  updateStatus(status: string | null): void {
    if (this.updateStatusFn) {
      this.updateStatusFn(status)
    }
  }

  async shutdown(): Promise<void> {
    if (this.app) {
      this.app.unmount()
    }
  }
}
