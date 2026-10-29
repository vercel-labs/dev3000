import { spawnSync } from "child_process"
import { accessSync, chmodSync, constants, existsSync, readFileSync } from "fs"
import { homedir } from "os"
import { dirname, join } from "path"
import { RouteStore } from "portless"
import { fileURLToPath } from "url"

const CANONICAL_PROXY_PORT = 443
const PORTLESS_SETUP_HINT = "Run `d3k portless setup` once, or run `portless proxy start --port 443` interactively."

export interface PortlessRuntime {
  name: string
  url: string
  command: string
}

export interface PortlessRuntimeResult {
  success: boolean
  runtime?: PortlessRuntime
  error?: string
}

export interface PortlessProxyStatus {
  installed: boolean
  serviceInstalled: boolean
  proxyRunning: boolean
  canonical: boolean
  target: string | null
  setupRequired: boolean
}

export interface PortlessSetupResult {
  success: boolean
  error?: string
}

function getRunnablePath(searchPath: string): string | null {
  if (!existsSync(searchPath)) {
    return null
  }
  if (process.platform === "win32") {
    return searchPath
  }
  try {
    accessSync(searchPath, constants.X_OK)
    return searchPath
  } catch {
    try {
      chmodSync(searchPath, 0o755)
      accessSync(searchPath, constants.X_OK)
      return searchPath
    } catch {
      return null
    }
  }
}

export function getPortlessCommand(): string {
  if (process.env.PORTLESS_PATH) {
    const runnablePath = getRunnablePath(process.env.PORTLESS_PATH)
    if (runnablePath) {
      return runnablePath
    }
  }

  const searchPaths: string[] = []

  try {
    const currentFile = fileURLToPath(import.meta.url)
    const currentDir = dirname(currentFile)

    if (currentDir.startsWith("/") || currentDir.match(/^[A-Z]:\\/i)) {
      searchPaths.push(
        join(dirname(currentDir), "node_modules", ".bin", "portless"),
        join(dirname(currentDir), "node_modules", "portless", "dist", "cli.js")
      )
    }
  } catch {
    // Ignore virtual paths when bundled by framework toolchains.
  }

  const home = homedir()
  const cwd = process.cwd()
  searchPaths.push(
    join(home, ".bun", "install", "global", "node_modules", "dev3000", "node_modules", ".bin", "portless"),
    join(home, ".bun", "install", "global", "node_modules", ".bin", "portless"),
    join(home, ".bun", "install", "global", "node_modules", "portless", "dist", "cli.js"),
    join(cwd, "node_modules", ".bin", "portless"),
    join(cwd, "node_modules", "portless", "dist", "cli.js"),
    join(cwd, "..", "node_modules", ".bin", "portless"),
    join(cwd, "..", "node_modules", "portless", "dist", "cli.js")
  )

  const globalNodeModules = [
    join("/usr", "local", "lib", "node_modules"),
    join("/opt", "homebrew", "lib", "node_modules")
  ]
  for (const root of globalNodeModules) {
    searchPaths.push(join(root, "dev3000", "node_modules", ".bin", "portless"))
    searchPaths.push(join(root, "portless", "dist", "cli.js"))
  }

  for (const searchPath of searchPaths) {
    const runnablePath = getRunnablePath(searchPath)
    if (runnablePath) {
      return runnablePath
    }
  }

  return "portless"
}

export function isPortlessInstalled(): boolean {
  try {
    const result = spawnSync(getPortlessCommand(), ["--version"], {
      stdio: "ignore",
      timeout: 5000
    })
    return result.status === 0
  } catch {
    return false
  }
}

function runPortlessCommand(args: string[], timeout: number = 30000): { success: boolean; output: string } {
  try {
    const result = spawnSync(getPortlessCommand(), args, {
      encoding: "utf8",
      timeout,
      // A pipe is intentionally non-interactive. Portless must never block an
      // agent-owned d3k startup waiting for sudo or certificate prompts.
      stdio: ["pipe", "pipe", "pipe"]
    })

    const output = `${result.stdout || ""}${result.stderr || ""}`.trim()
    return {
      success: result.status === 0,
      output
    }
  } catch (error) {
    return {
      success: false,
      output: error instanceof Error ? error.message : String(error)
    }
  }
}

export function parsePortlessUrl(output: string): string | null {
  return output.match(/https?:\/\/[^\s]+/)?.[0] || null
}

export function isCanonicalPortlessUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return false
    }

    // URL normalizes explicit default ports away, so inspect the original
    // authority to ensure the user-facing URL truly contains no port number.
    return !/^https?:\/\/(?:\[[^\]]+\]|[^/?#:]+):\d+(?:[/?#]|$)/i.test(url)
  } catch {
    return false
  }
}

/**
 * Whether `${name}.localhost` is already held in Portless's route table, by a
 * live process or a static alias (pid 0). Portless refuses to register a held
 * hostname, so callers use this to pick a different name up front. Stale routes
 * left by exited processes do not count; Portless replaces them.
 */
export function isPortlessHostnameHeld(
  name: string,
  stateDir: string = process.env.PORTLESS_STATE_DIR || join(homedir(), ".portless")
): boolean {
  let routes: unknown
  try {
    routes = JSON.parse(readFileSync(join(stateDir, "routes.json"), "utf8"))
  } catch {
    return false
  }
  if (!Array.isArray(routes)) return false
  const hostname = `${name}.localhost`
  return routes.some((route) => route?.hostname === hostname && isLiveOrStaticRoutePid(route.pid))
}

function isLiveOrStaticRoutePid(pid: unknown): boolean {
  if (pid === 0) return true
  if (typeof pid !== "number" || !Number.isSafeInteger(pid) || pid < 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // EPERM: the process exists but belongs to another user.
    return (error as NodeJS.ErrnoException).code === "EPERM"
  }
}

function getPortlessUrl(name: string): string | null {
  const result = runPortlessCommand(["get", name], 5000)
  return result.success ? parsePortlessUrl(result.output) : null
}

export function parsePortlessProxyStatus(
  doctorOutput: string,
  serviceOutput: string,
  installed: boolean = true
): PortlessProxyStatus {
  const target = doctorOutput.match(/^Proxy target:\s*(https?:\/\/\S+)/im)?.[1] || null
  const proxyRunning = /ok\s+Proxy is (?:running|responding)\b/i.test(doctorOutput)
  const serviceInstalled = /Installed:\s*yes\b/i.test(serviceOutput)
  let canonical = false

  if (proxyRunning && target) {
    try {
      const parsed = new URL(target)
      canonical = parsed.protocol === "https:" && (parsed.port === "" || parsed.port === String(CANONICAL_PROXY_PORT))
    } catch {
      canonical = false
    }
  }

  return {
    installed,
    serviceInstalled,
    proxyRunning,
    canonical,
    target,
    setupRequired: !installed || !canonical || !serviceInstalled
  }
}

export function getPortlessProxyStatus(): PortlessProxyStatus {
  const installed = isPortlessInstalled()
  if (!installed) {
    return {
      installed: false,
      serviceInstalled: false,
      proxyRunning: false,
      canonical: false,
      target: null,
      setupRequired: true
    }
  }

  const doctor = runPortlessCommand(["doctor"], 10000)
  const service = runPortlessCommand(["service", "status"], 10000)
  return parsePortlessProxyStatus(doctor.output, service.output, true)
}

export async function installPortlessService(): Promise<PortlessSetupResult> {
  const existingStatus = getPortlessProxyStatus()
  if (!existingStatus.setupRequired) {
    return { success: true }
  }

  const portlessCommand = getPortlessCommand()
  let result: ReturnType<typeof spawnSync>

  if (process.platform === "darwin" && process.getuid?.() !== 0) {
    const path = process.env.PATH || "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
    const username = process.env.USER || process.env.LOGNAME
    const uid = process.getuid?.()
    const gid = process.getgid?.()
    const command = [
      "env",
      `HOME=${shellQuote(homedir())}`,
      `PATH=${shellQuote(path)}`,
      ...(username ? [`SUDO_USER=${shellQuote(username)}`] : []),
      ...(uid !== undefined ? [`SUDO_UID=${uid}`] : []),
      ...(gid !== undefined ? [`SUDO_GID=${gid}`] : []),
      shellQuote(portlessCommand),
      "service",
      "install",
      "--port",
      String(CANONICAL_PROXY_PORT)
    ].join(" ")
    const appleScript = `do shell script ${JSON.stringify(command)} with administrator privileges`
    result = spawnSync("osascript", ["-e", appleScript], { stdio: "inherit" })
  } else {
    result = spawnSync(portlessCommand, ["service", "install", "--port", String(CANONICAL_PROXY_PORT)], {
      stdio: "inherit"
    })
  }

  if (result.status !== 0) {
    return {
      success: false,
      error: result.error?.message || "Portless service installer did not complete successfully"
    }
  }

  const deadline = Date.now() + 10000
  let status = getPortlessProxyStatus()
  while ((!status.canonical || !status.serviceInstalled) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 250))
    status = getPortlessProxyStatus()
  }

  if (!status.canonical || !status.serviceInstalled) {
    return {
      success: false,
      error: `Portless service installation completed, but canonical HTTPS routing did not become ready (target: ${status.target || "unavailable"}).`
    }
  }

  return { success: true }
}

function canStartCanonicalProxyNonInteractively(): boolean {
  if (process.platform !== "darwin" && process.platform !== "linux") {
    return true
  }
  if (process.getuid?.() === 0) {
    return true
  }

  try {
    const result = spawnSync("sudo", ["-n", "true"], {
      stdio: "ignore",
      timeout: 2000
    })
    return result.status === 0
  } catch {
    return false
  }
}

export function preparePortlessRuntime(name: string): PortlessRuntimeResult {
  if (process.env.PORTLESS === "0") {
    return { success: false, error: "Disabled by PORTLESS=0" }
  }

  const status = getPortlessProxyStatus()
  if (!status.installed) {
    return { success: false, error: "Portless is not installed" }
  }

  if (!status.canonical || !status.serviceInstalled) {
    if (status.proxyRunning) {
      return {
        success: false,
        error: status.canonical
          ? `Portless is running on canonical HTTPS port 443, but its startup service is not installed. ${PORTLESS_SETUP_HINT}`
          : `Portless is running at ${status.target || "a non-canonical address"}, not canonical HTTPS port 443. ${PORTLESS_SETUP_HINT}`
      }
    }

    if (!canStartCanonicalProxyNonInteractively()) {
      return {
        success: false,
        error: `A port-free Portless proxy requires one-time setup. ${PORTLESS_SETUP_HINT}`
      }
    }

    // Requiring the canonical proxy port prevents Portless from silently
    // falling back to :1355 when elevation is unavailable. Piped stdio keeps
    // agent-owned startup non-interactive; users can perform setup once.
    const startResult = runPortlessCommand(["proxy", "start", "--port", String(CANONICAL_PROXY_PORT)])

    if (!startResult.success) {
      return {
        success: false,
        error: `A port-free Portless proxy is not available. ${PORTLESS_SETUP_HINT}`
      }
    }

    const startedStatus = getPortlessProxyStatus()
    if (!startedStatus.canonical) {
      return {
        success: false,
        error: `Portless did not start on canonical HTTPS port 443. ${PORTLESS_SETUP_HINT}`
      }
    }
  }

  const url = getPortlessUrl(name)
  if (!url) {
    return { success: false, error: "Portless did not return a URL" }
  }

  if (!isCanonicalPortlessUrl(url)) {
    return {
      success: false,
      error: `Portless returned ${url}, which includes an explicit port. ${PORTLESS_SETUP_HINT}`
    }
  }

  return {
    success: true,
    runtime: {
      name,
      url,
      command: getPortlessCommand()
    }
  }
}

function shellQuote(value: string): string {
  if (process.platform === "win32") {
    return `"${value.replace(/"/g, '\\"')}"`
  }
  return `'${value.replace(/'/g, `'\\''`)}'`
}

export function buildPortlessServerCommand(
  runtime: PortlessRuntime,
  serverCommand: string,
  options: { appPort?: string; customCommand?: boolean } = {}
): string {
  const args = [shellQuote(runtime.command), "run", "--name", shellQuote(runtime.name)]
  if (options.appPort) {
    args.push("--app-port", shellQuote(options.appPort))
  }
  args.push("--")

  if (options.customCommand) {
    if (process.platform === "win32") {
      args.push("cmd.exe", "/d", "/s", "/c", shellQuote(serverCommand))
    } else {
      args.push("sh", "-c", shellQuote(serverCommand))
    }
  } else {
    args.push(serverCommand)
  }

  return args.join(" ")
}

/** Register a loopback service without replacing an existing route. */
export function registerPortlessAlias(runtime: PortlessRuntime, port: number): void {
  const store = new RouteStore(process.env.PORTLESS_STATE_DIR || join(homedir(), ".portless"))
  store.addRoute(new URL(runtime.url).hostname, port, process.pid)
}

export function removePortlessAlias(runtime: PortlessRuntime): void {
  const store = new RouteStore(process.env.PORTLESS_STATE_DIR || join(homedir(), ".portless"))
  store.removeRoute(new URL(runtime.url).hostname, process.pid)
}
