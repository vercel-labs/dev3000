import { type ChildProcess, spawn } from "node:child_process"
import { randomBytes } from "node:crypto"
import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs"
import { createServer, get as httpGet } from "node:http"
import { get as httpsGet } from "node:https"
import { createServer as createTcpServer } from "node:net"
import { homedir } from "node:os"
import { join, resolve } from "node:path"
import { stripVTControlCharacters } from "node:util"
import { CDPMonitor } from "../cdp-monitor.js"
import {
  buildPortlessServerCommand,
  getPortlessProxyStatus,
  isPortlessHostnameHeld,
  preparePortlessRuntime
} from "../portless.js"
import { getPortlessName } from "../utils/project-name.js"
import { startBridge } from "./bridge.js"
import { createBrowserEventRecorder } from "./browser-events.js"
import { type Harness, launchLocalHarness, parseHarness } from "./harness.js"
import type { SandboxPreview } from "./sandbox-preview.js"
import { startSandboxProxy } from "./sandbox-proxy.js"
import { queryRuntime, type RuntimeSession, readRuntimeSession, runtimePaths } from "./session.js"
import { type EventLevel, type EventSource, Timeline } from "./timeline.js"

// Trust the installed Portless CA explicitly; Node/Bun need not inherit the OS trust store.
async function probeServer(url: string): Promise<boolean> {
  const caPath = join(process.env.PORTLESS_STATE_DIR || join(homedir(), ".portless"), "ca.pem")
  const ca = existsSync(caPath) ? readFileSync(caPath) : undefined
  return new Promise((resolveProbe) => {
    const request = (url.startsWith("https:") ? httpsGet : httpGet)(url, { ca, timeout: 1500 }, (response) => {
      response.destroy()
      resolveProbe(![502, 503].includes(response.statusCode || 503))
    })
    request.on("timeout", () => request.destroy())
    request.on("error", () => resolveProbe(false))
  })
}

export interface RuntimeOptions {
  command?: string
  harness?: Harness
  cwd?: string
  headless?: boolean
  serversOnly?: boolean
  startupTimeout?: number
  browserNavigationTimeout?: number
  browser?: string
  profileDir?: string
  debug?: boolean
  /** Sandbox mode uses the companion’s stable local HTTPS origin; only the companion needs Portless. */
  sandbox?: {
    appUrl: string
    serverPort: number
    bridgePort: number
    token: string
    proxyToken?: string
    preview?: SandboxPreview
    cloudBrowser?: boolean
    browserPath?: string
  }
}

async function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createTcpServer()
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (!address || typeof address === "string") {
        server.close()
        reject(new Error("No available port"))
        return
      }
      server.close(() => resolvePort(address.port))
    })
  })
}

function defaultCommand(cwd: string): string {
  const pkg = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8"))
  if (!pkg.scripts?.dev) throw new Error("No dev script; pass --command with the project's dev command")
  const manager =
    typeof pkg.packageManager === "string"
      ? pkg.packageManager.split("@")[0]
      : existsSync(join(cwd, "bun.lock")) || existsSync(join(cwd, "bun.lockb"))
        ? "bun"
        : existsSync(join(cwd, "pnpm-lock.yaml"))
          ? "pnpm"
          : existsSync(join(cwd, "yarn.lock"))
            ? "yarn"
            : "npm"
  if (!["bun", "pnpm", "yarn", "npm"].includes(manager)) throw new Error("Unknown package manager; pass --command")
  return `${manager} run dev`
}

/** Own the server, browser, and evidence until the retained process is stopped. */
export async function startRuntime(options: RuntimeOptions = {}): Promise<void> {
  const cwd = resolve(options.cwd || process.cwd())
  if (options.harness) parseHarness(options.harness)
  if (options.harness && options.serversOnly) throw new Error("--harness requires browser monitoring")
  if (options.harness && !process.stdin.isTTY) throw new Error("--harness requires an interactive terminal")
  const existing = readRuntimeSession(cwd)
  if (existing) {
    console.log(JSON.stringify(await queryRuntime("/status", cwd)))
    if (options.harness) await launchLocalHarness(options.harness, cwd, new AbortController().signal)
    return
  }
  if (options.sandbox) {
    const url = new URL(options.sandbox.appUrl)
    if (url.protocol !== "https:" || url.username || url.password || url.port)
      throw new Error("Sandbox app must have a port-free HTTPS URL")
  } else {
    const status = getPortlessProxyStatus()
    if (!status.canonical || !status.serviceInstalled || status.setupRequired)
      throw new Error("Canonical Portless is required. Run d3k-runtime portless setup, then retry.")
  }
  const prepared = options.sandbox ? undefined : preparePortlessRuntime(getPortlessName(cwd, isPortlessHostnameHeld))
  const portless = prepared?.runtime
  if (!options.sandbox && !portless) throw new Error(prepared?.error || "Portless is unavailable")
  const appUrl = options.sandbox?.appUrl || portless?.url
  if (!appUrl) throw new Error("No app URL available")
  const command = options.command || defaultCommand(cwd)
  const paths = runtimePaths(cwd)
  mkdirSync(paths.directory, { recursive: true, mode: 0o700 })
  const lockFile = join(paths.directory, "runtime.lock")
  // Exclusive creation also closes the race between two simultaneous agent starts.
  try {
    const fd = openSync(lockFile, "wx", 0o600)
    writeFileSync(fd, String(process.pid))
    closeSync(fd)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
    const owner = Number(readFileSync(lockFile, "utf8"))
    if (!Number.isSafeInteger(owner) || owner <= 0) throw new Error("Invalid runtime lock; inspect it before removing")
    try {
      process.kill(owner, 0)
      throw new Error("A runtime is already starting for this project")
    } catch (lockError) {
      if ((lockError as NodeJS.ErrnoException).code !== "ESRCH") throw lockError
    }
    unlinkSync(lockFile)
    return startRuntime(options)
  }

  const timeline = new Timeline()
  const session: RuntimeSession = {
    sessionId: timeline.sessionId,
    pid: process.pid,
    cwd,
    socketPath: paths.socketPath,
    token: randomBytes(32).toString("hex"),
    appUrl,
    ready: false,
    cdpUrl: null
  }
  let child: ChildProcess | undefined
  let monitor: CDPMonitor | undefined
  let bridge: Awaited<ReturnType<typeof startBridge>> | undefined
  let proxy: Awaited<ReturnType<typeof startSandboxProxy>> | undefined
  let serverPort = options.sandbox?.serverPort
  let closing = false
  let failed = false
  const persist = () => writeFileSync(paths.sessionFile, JSON.stringify(session), { mode: 0o600 })
  const log = (kind: string, message: string, level: EventLevel = "info") =>
    timeline.append({ source: "runtime", level, kind, message })
  const server = createServer((request, response) => {
    response.setHeader("content-type", "application/json")
    response.setHeader("cache-control", "no-store")
    const send = (code: number, value: unknown) => {
      response.statusCode = code
      response.end(JSON.stringify(value))
    }
    if (request.headers.authorization !== `Bearer ${session.token}`) {
      send(403, { error: "Forbidden" })
      return
    }
    const url = new URL(request.url || "/", "http://runtime")
    try {
      if (request.method === "GET" && url.pathname === "/status") {
        const cdpUrl = monitor?.getCdpUrl() ?? null
        const { token: _token, socketPath: _socket, ...publicSession } = session
        send(200, {
          ...publicSession,
          running: !closing,
          ready: session.ready && !closing && (options.serversOnly || Boolean(cdpUrl)),
          cdpUrl,
          browserConnected: Boolean(cdpUrl),
          cursor: timeline.read({ limit: 1 }).latest
        })
      } else if (request.method === "GET" && url.pathname === "/events") {
        const source = url.searchParams.get("source") || undefined
        const level = url.searchParams.get("level") || undefined
        if (source && !["server", "browser", "runtime"].includes(source)) throw new Error("Invalid source")
        if (level && !["debug", "info", "warn", "error"].includes(level)) throw new Error("Invalid level")
        send(
          200,
          timeline.read({
            after: Number(url.searchParams.get("after") || 0),
            limit: Number(url.searchParams.get("limit") || 100),
            source: source as EventSource,
            level: level as EventLevel,
            sessionId: url.searchParams.get("sessionId") || undefined
          })
        )
      } else if (request.method === "POST" && url.pathname === "/stop") {
        send(200, { stopping: true })
        void shutdown()
      } else send(404, { error: "Not found" })
    } catch (error) {
      send(400, { error: String(error) })
    }
  })

  const harnessAbort = new AbortController()
  const shutdown = async () => {
    if (closing) return
    closing = true
    harnessAbort.abort()
    console.log(
      JSON.stringify({
        stopped: true,
        sessionId: session.sessionId,
        events: timeline.read({ after: Math.max(0, timeline.read({ limit: 1 }).latest - (failed ? 25 : 0)) }).events
      })
    )
    session.ready = false
    monitor?.prepareShutdown()
    if (child?.pid) {
      try {
        if (process.platform === "win32") child.kill("SIGTERM")
        else process.kill(-child.pid, "SIGTERM")
      } catch {
        /* Already exited. */
      }
    }
    await monitor?.shutdown().catch(() => {})
    await bridge?.close()
    await proxy?.close()
    if (child?.pid && process.platform !== "win32") {
      const pid = child.pid
      await new Promise((resolveWait) => setTimeout(resolveWait, 300))
      try {
        process.kill(-pid, "SIGKILL")
      } catch {
        /* Process group exited. */
      }
    }
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()))
    for (const path of [paths.sessionFile, lockFile]) {
      try {
        unlinkSync(path)
      } catch {
        /* Already removed. */
      }
    }
    process.off("SIGTERM", onSignal)
    process.off("SIGINT", onSignal)
  }
  const onSignal = () => {
    void shutdown()
  }
  process.on("SIGTERM", onSignal)
  process.on("SIGINT", onSignal)

  try {
    if (process.platform !== "win32") {
      try {
        unlinkSync(paths.socketPath)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
      }
    }
    await new Promise<void>((resolveListen, reject) => {
      server.once("error", reject)
      server.listen(paths.socketPath, resolveListen)
    })
    if (process.platform !== "win32") chmodSync(paths.socketPath, 0o600)
    persist()
    if (options.sandbox) {
      serverPort = await freePort()
      proxy = await startSandboxProxy({
        port: options.sandbox.serverPort,
        targetPort: serverPort,
        appUrl: session.appUrl,
        token: options.sandbox.proxyToken,
        preview: options.sandbox.preview
      })
      if (!options.sandbox.cloudBrowser)
        bridge = await startBridge({
          token: options.sandbox.token,
          port: options.sandbox.bridgePort,
          onState: (connected) => {
            log(
              "browser-bridge",
              connected
                ? "Local browser companion connected"
                : "Browser bridge disconnected; evidence gap until reattached",
              connected ? "info" : "warn"
            )
            if (connected && session.ready && !closing)
              void monitor?.recoverExternalConnection().catch((error) => {
                log("browser-recovery", `Could not restore browser monitoring: ${String(error)}`, "warn")
              })
          }
        })
    }
    log("starting", `Starting ${command}`)
    child = spawn(portless ? buildPortlessServerCommand(portless, command, { customCommand: true }) : command, {
      cwd,
      shell: true,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        FORCE_COLOR: "0",
        ...(options.sandbox ? { PORT: String(serverPort), HOST: "0.0.0.0", HOSTNAME: "0.0.0.0" } : {})
      }
    })
    for (const [stream, name] of [
      [child.stdout, "stdout"],
      [child.stderr, "stderr"]
    ] as const) {
      if (!stream) continue
      // Split arbitrarily long lines too, so a server without newlines cannot grow memory forever.
      stream.setEncoding("utf8")
      let pending = ""
      const emit = (line: string) =>
        timeline.append({
          source: "server",
          level: /\b(error|exception|failed)\b/i.test(line) ? "error" : /\bwarn(ing)?\b/i.test(line) ? "warn" : "info",
          kind: name,
          message: stripVTControlCharacters(line)
        })
      stream.on("data", (chunk: string) => {
        pending += chunk
        let newline = pending.indexOf("\n")
        while (newline !== -1 || pending.length >= 8192) {
          const end = newline !== -1 ? Math.min(newline, 8192) : 8192
          emit(pending.slice(0, end))
          pending = pending.slice(end + (end === newline ? 1 : 0))
          newline = pending.indexOf("\n")
        }
      })
      stream.on("end", () => {
        if (pending) emit(pending)
        pending = ""
      })
    }
    child.once("error", (error) => {
      if (closing) return
      failed = true
      process.exitCode = 1
      log("server-error", String(error), "error")
      void shutdown()
    })
    child.once("exit", (code, signal) => {
      if (closing) return
      failed = true
      process.exitCode = 1
      log("server-exit", `Server exited (${code ?? signal})`, "error")
      void shutdown()
    })
    const deadline = Date.now() + (options.startupTimeout ?? 120000)
    let listening = false
    while (!closing && Date.now() < deadline) {
      if (await probeServer(options.sandbox ? `http://127.0.0.1:${serverPort}` : session.appUrl)) {
        listening = true
        break
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, 300))
    }
    if (closing) {
      if (failed) throw new Error("Dev server exited during startup")
      return
    }
    if (!listening) throw new Error(`Server did not become ready within ${options.startupTimeout ?? 120000}ms`)
    if (!options.serversOnly) {
      while (bridge && !bridge.connected() && !closing && Date.now() < deadline) {
        await new Promise((resolveWait) => setTimeout(resolveWait, 250))
      }
      if (closing) return
      if (bridge && !bridge.connected())
        throw new Error("Local browser companion did not connect before the startup deadline")
      monitor = new CDPMonitor(
        options.profileDir ? resolve(options.profileDir) : join(paths.directory, "chrome-profile"),
        (_source, message) => {
          if (message.startsWith("[INTERACTION]"))
            timeline.append({ source: "browser", level: "info", kind: "interaction", message })
          else if (message.startsWith("[CDP]") || message.startsWith("[CRASH]")) log("browser-status", message)
        },
        options.debug,
        options.browser,
        undefined,
        session.appUrl,
        options.browserNavigationTimeout ?? 30000,
        await freePort(),
        options.headless,
        undefined,
        bridge?.cdpBase
      )
      monitor.setEventObserver(
        createBrowserEventRecorder(timeline, {
          appUrl: session.appUrl,
          readResponseBody: monitor.readResponseBody.bind(monitor)
        })
      )
      monitor.setOnWindowClosedCallback(() => {
        void shutdown()
      })
      await monitor.start()
      if (closing) {
        await monitor.shutdown()
        return
      }
      if (options.sandbox?.cloudBrowser && options.sandbox.preview)
        await monitor.setSessionCookie({
          name: "__Host-d3k-preview",
          value: options.sandbox.preview.token,
          url: options.sandbox.preview.origin,
          expires: Math.floor(options.sandbox.preview.expiresAt / 1000)
        })
      await monitor.navigateToUrl(session.appUrl)
      session.cdpUrl = monitor.getCdpUrl()
    }
    session.ready = true
    persist()
    log("ready", session.appUrl)
    console.log(
      JSON.stringify({ sessionId: session.sessionId, ready: true, appUrl: session.appUrl, cdpUrl: session.cdpUrl })
    )
    if (options.harness) {
      await launchLocalHarness(options.harness, cwd, harnessAbort.signal)
      await shutdown()
    }
  } catch (error) {
    // Surface recent startup evidence before the in-memory session is torn down.
    console.error(
      JSON.stringify({
        startupEvents: timeline.read({ after: Math.max(0, timeline.read({ limit: 1 }).latest - 20) }).events
      })
    )
    await shutdown()
    throw error
  }
}
