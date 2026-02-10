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
  private minScreenshotInterval: number = 1000 
  private navigationInProgress: boolean = false 
  private chromePids: Set<number> = new Set() 
  private onWindowClosedCallback: (() => void) | null = null 
  private appServerPort?: string 
  private headless: boolean = false 

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
    if (debugPort) {
      this.debugPort = debugPort
    }
  }

  private debugLog(message: string) {
    if (this.debug) {
      console.log(`[CDP DEBUG] ${message}`)
    }
  }

  private async runCommand(
    command: string,
    args: string[]
  ): Promise<{ stdout: string; stderr: string; code: number | null }> {
    return await new Promise((resolve) => {
      const proc = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] })
      let stdout = ""
      let stderr = ""
      proc.stdout?.on("data", (data) => {
        stdout += data.toString()
      })
      proc.stderr?.on("data", (data) => {
        stderr += data.toString()
      })
      proc.on("error", (error) => {
        resolve({ stdout, stderr: `${stderr}${error.message}`, code: 1 })
      })
      proc.on("close", (code) => {
        resolve({ stdout, stderr, code })
      })
    })
  }

  private async listProcesses(): Promise<Array<{ pid: number; command: string }>> {
    if (process.platform === "win32") {
      const result = await this.runCommand("powershell", [
        "-NoProfile",
        "-Command",
        "Get-CimInstance Win32_Process | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress"
      ])
      if (result.code !== 0) {
        this.debugLog(`Failed to list processes via PowerShell: ${result.stderr.trim()}`)
        return []
      }
      const raw = result.stdout.trim()
      if (!raw) return []
      try {
        const parsed = JSON.parse(raw) as
          | Array<{ ProcessId?: number; CommandLine?: string }>
          | { ProcessId?: number; CommandLine?: string }
        const items = Array.isArray(parsed) ? parsed : [parsed]
        return items
          .map((item) => ({
            pid: Number(item.ProcessId),
            command: item.CommandLine ?? ""
          }))
          .filter((item) => Number.isFinite(item.pid))
      } catch (error) {
        this.debugLog(`Failed to parse PowerShell process list: ${String(error)}`)
        return []
      }
    }

    let result = await this.runCommand("ps", ["-ax", "-o", "pid=", "-o", "command="])
    if (result.code !== 0) {
      result = await this.runCommand("ps", ["-eo", "pid=,command="])
    }
    if (result.code !== 0) {
      this.debugLog(`Failed to list processes via ps: ${result.stderr.trim()}`)
      return []
    }

    const lines = result.stdout.split("\n")
    const processes: Array<{ pid: number; command: string }> = []
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      const match = trimmed.match(/^(\d+)\s+(.*)$/)
      if (!match) continue
      const pid = Number(match[1])
      if (!Number.isFinite(pid)) continue
      processes.push({ pid, command: match[2] })
    }
    return processes
  }


  private shouldMonitorUrl(url: string): boolean {
    try {
      const urlObj = new URL(url)
      const hostname = urlObj.hostname
      const port = urlObj.port || (urlObj.protocol === "https:" ? "443" : "80")

      const isLocalhost = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "0.0.0.0"
      if (!isLocalhost) {
        return false
      }

      if (this.appServerPort && port !== this.appServerPort) {
        return false
      }

      return true
    } catch {
      return false
    }
  }

  async start(): Promise<void> {
    this.debugLog("Starting Chrome launch process")
    await this.launchChrome()
    this.debugLog("Chrome launch completed")

    this.debugLog("Starting CDP connection")
    await this.connectToCDP()
    this.debugLog("CDP connection completed")

    this.debugLog("Starting CDP domain enablement")
    await this.enableCDPDomains()
    this.debugLog("CDP domain enablement completed")

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
      const processes = await this.listProcesses()
      const pids = processes.filter((proc) => proc.command.includes(this.profileDir)).map((proc) => proc.pid)

      if (this.browser?.pid) {
        pids.push(this.browser.pid)
      }

      for (const pid of pids) {
        this.chromePids.add(pid)
      }

      this.debugLog(
        `Discovered ${this.chromePids.size} Chrome PIDs for this instance: [${Array.from(this.chromePids).join(", ")}]`
      )
    } catch (error) {
      this.debugLog(`Failed to discover Chrome PIDs: ${error}`)
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

    this.browser.removeAllListeners("exit")
    this.browser.removeAllListeners("error")

    this.browser.on("exit", (code, signal) => {
      if (!this.isShuttingDown) {
        const isGracefulQuit = code === 0 && signal === null

        if (isGracefulQuit) {
          this.logger("browser", "[EXIT] Chrome closed by user")
          this.debugLog("Chrome exited gracefully (user quit)")
        } else {
          const crashMsg = `[CRASH] Chrome process exited unexpectedly - Code: ${code}, Signal: ${signal}`
          this.logger("browser", `${crashMsg}`)
          this.debugLog(`Chrome crashed: code=${code}, signal=${signal}`)

          this.logger("browser", "[CRASH] Chrome crashed - check recent server/browser logs for correlation")

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


  private async killExistingChromeWithProfile(): Promise<void> {
    try {
      const processes = await this.listProcesses()
      const pids = processes
        .filter(
          (proc) =>
            proc.command.includes(`--user-data-dir=${this.profileDir}`) || proc.command.includes(this.profileDir)
        )
        .map((proc) => proc.pid)
        .filter((pid) => pid !== this.browser?.pid)

      for (const pid of pids) {
        this.debugLog(`Killing existing Chrome process ${pid} using profile ${this.profileDir}`)
        try {
          process.kill(pid, "SIGTERM")
        } catch {
        }
      }
      if (pids.length > 0) {
        await new Promise((resolve) => setTimeout(resolve, 500))
      }
    } catch {
      this.debugLog("No existing Chrome process found with this profile")
    }
  }


}
