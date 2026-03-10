import { spawnSync } from "child_process"
import { accessSync, chmodSync, constants, existsSync, readFileSync } from "fs"
import { homedir } from "os"
import { dirname, join } from "path"
import { fileURLToPath } from "url"

const DEFAULT_PROXY_PORT = 1355
const SYSTEM_STATE_DIR = "/tmp/portless"
const USER_STATE_DIR = join(homedir(), ".portless")
const TLS_MARKER_FILE = "proxy.tls"
const PORT_FILE = "proxy.port"

export interface PortlessState {
  dir: string
  port: number
  tls: boolean
}

function getDefaultPortlessPort(): number {
  const envPort = Number.parseInt(process.env.PORTLESS_PORT || "", 10)
  if (!Number.isNaN(envPort) && envPort >= 1 && envPort <= 65535) {
    return envPort
  }
  return DEFAULT_PROXY_PORT
}

function resolveStateDir(port: number): string {
  if (process.env.PORTLESS_STATE_DIR) {
    return process.env.PORTLESS_STATE_DIR
  }
  return port < 1024 ? SYSTEM_STATE_DIR : USER_STATE_DIR
}

function readPortFromDir(dir: string): number | null {
  try {
    const port = Number.parseInt(readFileSync(join(dir, PORT_FILE), "utf8").trim(), 10)
    return Number.isNaN(port) ? null : port
  } catch {
    return null
  }
}

function readTlsMarker(dir: string): boolean {
  return existsSync(join(dir, TLS_MARKER_FILE))
}

export function discoverPortlessState(): PortlessState {
  const defaultPort = getDefaultPortlessPort()
  const defaultDir = resolveStateDir(defaultPort)
  const defaultTls = process.env.PORTLESS_HTTPS === "1" || process.env.PORTLESS_HTTPS === "true"

  if (process.env.PORTLESS_STATE_DIR) {
    return {
      dir: defaultDir,
      port: readPortFromDir(defaultDir) ?? defaultPort,
      tls: readTlsMarker(defaultDir) || defaultTls
    }
  }

  const userPort = readPortFromDir(USER_STATE_DIR)
  if (userPort !== null) {
    return { dir: USER_STATE_DIR, port: userPort, tls: readTlsMarker(USER_STATE_DIR) }
  }

  const systemPort = readPortFromDir(SYSTEM_STATE_DIR)
  if (systemPort !== null) {
    return { dir: SYSTEM_STATE_DIR, port: systemPort, tls: readTlsMarker(SYSTEM_STATE_DIR) }
  }

  return { dir: defaultDir, port: defaultPort, tls: defaultTls }
}

export function getPortlessUrl(hostname: string, state: PortlessState = discoverPortlessState()): string {
  return `${state.tls ? "https" : "http"}://${hostname}.localhost:${state.port}`
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

function getPortlessCommand(): string {
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
  if (process.platform === "win32") {
    return false
  }

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

function runPortlessCommand(args: string[]): { success: boolean; output: string } {
  try {
    const result = spawnSync(getPortlessCommand(), args, {
      encoding: "utf8",
      timeout: 30000
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

export function ensurePortlessAlias(
  hostname: string,
  appPort: string | number
): {
  success: boolean
  url: string
  error?: string
} {
  const initialState = discoverPortlessState()
  const fallbackUrl = getPortlessUrl(hostname, initialState)

  const proxyResult = runPortlessCommand(["proxy", "start"])
  if (!proxyResult.success) {
    return {
      success: false,
      url: fallbackUrl,
      error: proxyResult.output || "Failed to start portless proxy"
    }
  }

  const aliasResult = runPortlessCommand(["alias", hostname, String(appPort), "--force"])
  if (!aliasResult.success) {
    return {
      success: false,
      url: fallbackUrl,
      error: aliasResult.output || "Failed to register portless alias"
    }
  }

  return {
    success: true,
    url: getPortlessUrl(hostname)
  }
}

export function removePortlessAlias(hostname: string): void {
  runPortlessCommand(["alias", "--remove", hostname])
}
