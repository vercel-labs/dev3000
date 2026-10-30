#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { Command } from "commander"
import { getPortlessProxyStatus, installPortlessService } from "../portless.js"
import { getAgentBrowserBinaryPath } from "../utils/agent-browser.js"
import { captureBrowserMetrics } from "./browser-metrics.js"
import { readRecentEvents, selectEventView } from "./event-views.js"
import { parseHarness } from "./harness.js"
import { startRuntime } from "./runtime.js"
import { addSandboxProjectOptions, registerSandboxCommand, runSandboxProject } from "./sandbox-command.js"
import { runSandboxCli } from "./sandbox-process.js"
import { queryRuntime, type RuntimeSession, readRuntimeSession } from "./session.js"

if (process.env.D3K_BOOTSTRAP_CWD) {
  process.chdir(process.env.D3K_BOOTSTRAP_CWD)
  delete process.env.D3K_BOOTSTRAP_CWD
}

const print = (value: unknown) => console.log(JSON.stringify(value))
const version = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")).version as string
const program = new Command()
  .name("d3k")
  .version(version)
  .description("Dev server and managed browser with a bounded, in-memory event timeline")
program
  .command("mcp")
  .description("Serve sandbox and local browser tools to desktop clients over MCP stdio")
  .option("--print-config", "Print desktop MCP configuration with absolute paths, then exit")
  .action(async (options) => {
    const { desktopMcpConfig, runDesktopMcp } = await import("./desktop-mcp.js")
    if (options.printConfig) return print(desktopMcpConfig())
    await runDesktopMcp()
  })
registerSandboxCommand(program)
addSandboxProjectOptions(program)
  .option("--command <command>", "Remote dev command")
  .option("--headless", "Run local Chrome headlessly")
  .action(runSandboxProject)

function positiveInteger(value: string): number {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error("Expected a positive integer")
  return parsed
}

program
  .command("sandbox-serve", { hidden: true })
  .option("--command <command>")
  .option("--startup-timeout <ms>", "Server startup deadline in milliseconds", "300000")
  .action(async (options) => {
    let input = ""
    for await (const chunk of process.stdin) {
      input += chunk.toString()
      if (input.length > 8192) throw new Error("Sandbox configuration too large")
    }
    const sandbox = JSON.parse(input) as NonNullable<Parameters<typeof startRuntime>[0]>["sandbox"]
    if (
      !sandbox ||
      ![sandbox.serverPort, sandbox.bridgePort].every(
        (port) => Number.isSafeInteger(port) && port > 0 && port <= 65535
      ) ||
      sandbox.serverPort === sandbox.bridgePort
    )
      throw new Error("Invalid sandbox ports")
    await startRuntime({
      command: options.command,
      startupTimeout: positiveInteger(options.startupTimeout),
      sandbox,
      ...(sandbox.cloudBrowser ? { headless: true, browser: sandbox.browserPath } : {})
    })
  })
program
  .command("start")
  .description("Start the local app and browser; retain this process while testing")
  .option("--harness <name>", "Run fx, codex, or claude in this terminal when ready", parseHarness)
  .option("--command <command>", "Dev command (defaults to the package manager's dev script)")
  .option("--headless", "Headless browser for CI")
  .option("--servers-only", "Intentionally omit browser monitoring")
  .option("--startup-timeout <ms>", "Server startup deadline in milliseconds", "120000")
  .option("--browser-navigation-timeout <ms>", "Browser navigation deadline in milliseconds", "30000")
  .option("--browser <path>", "Browser executable path")
  .option("--profile-dir <dir>", "Browser profile directory (defaults to the project profile)")
  .option("--debug", "Browser diagnostic output")
  .action(async (options) => {
    if (options.serversOnly && (options.headless || options.browser || options.profileDir || options.harness))
      throw new Error("--servers-only cannot be combined with browser options")
    if (options.harness && !process.stdin.isTTY) throw new Error("--harness requires an interactive terminal")
    await startRuntime({
      ...options,
      startupTimeout: positiveInteger(options.startupTimeout),
      browserNavigationTimeout: positiveInteger(options.browserNavigationTimeout)
    })
  })
program
  .command("status")
  .description("Show live runtime status")
  .option("--json", "Output JSON (also the default)")
  .action(async () => {
    if (!readRuntimeSession()) return print({ running: false, ready: false })
    print(await queryRuntime("/status"))
  })
program
  .command("events")
  .description("Read timeline events after a cursor")
  .option("--after <cursor>", "Read after this sequence number", "0")
  .option("--session <id>", "Previous session id, to detect resets")
  .option("--limit <count>", "Maximum events, 1–500", "100")
  .option("--source <source>", "server, browser, or runtime")
  .option("--level <level>", "debug, info, warn, or error")
  .action(async (options) => {
    const params = new URLSearchParams({ after: options.after, limit: options.limit })
    if (options.session) params.set("sessionId", options.session)
    if (options.source) params.set("source", options.source)
    if (options.level) params.set("level", options.level)
    print(await queryRuntime(`/events?${params}`))
  })
for (const errors of [false, true]) {
  const command = program
    .command(errors ? "errors" : "logs")
    .description(errors ? "Show recent errors from the live timeline" : "Show recent events from the live timeline")
    .option("-n, --count <count>", "Number of matching events, 1–500", errors ? "10" : "50")
    .option("--json", "Include event cursor and evidence-gap metadata as JSON")
  if (errors) command.option("-c, --context", "Include up to five preceding events per error")
  else command.option("--type <source>", "Filter by server, browser, runtime, or all", "all")
  command.action(async (options) => {
    const source = options.type && options.type !== "all" ? options.type : undefined
    if (source && !["server", "browser", "runtime"].includes(source)) throw new Error("Invalid event source")
    const count = positiveInteger(options.count)
    if (count > 500) throw new Error("count must be 1–500")
    const view = selectEventView(await readRecentEvents(queryRuntime), {
      count,
      source,
      errors,
      context: options.context
    })
    if (options.json) return print(view)
    if (view.dropped) console.log(`[runtime] ${view.dropped} earlier events are no longer retained`)
    for (const event of view.events) console.log(`${event.timestamp} [${event.source}/${event.level}] ${event.message}`)
    if (!view.events.length) console.log("No matching events in the retained timeline.")
  })
}
program
  .command("stop")
  .description("Stop this project's app and browser")
  .action(async () => print(await queryRuntime("/stop", process.cwd(), "POST")))
program
  .command("browser")
  .description("Drive the runtime's monitored browser with agent-browser")
  .allowUnknownOption()
  .argument("[args...]")
  .action(async (args: string[]) => {
    const session = (await queryRuntime("/status")) as RuntimeSession
    if (!session?.ready || !session.cdpUrl) throw new Error("The managed browser is not ready")
    if (
      args.some((arg) =>
        /^(--(cdp|profile|profile-dir|session|session-name|auto-connect|provider|engine|executable-path|config)|connect|close)(=|$)/.test(
          arg
        )
      )
    )
      throw new Error("Browser ownership options are managed by the runtime")
    const port = new URL(session.cdpUrl).port
    if (args[0] === "metrics") {
      return print(
        await captureBrowserMetrics(args.slice(1), (command) =>
          runSandboxCli(
            getAgentBrowserBinaryPath(),
            ["--session", `d3k-${session.sessionId}`, "--cdp", port, ...command],
            { timeoutMs: 30000 }
          )
        )
      )
    }
    await new Promise<void>((resolveRun, reject) => {
      const child = spawn(
        getAgentBrowserBinaryPath(),
        ["--session", `d3k-${session.sessionId}`, "--cdp", port, ...args],
        { stdio: "inherit" }
      )
      child.on("error", reject)
      child.on("exit", (code, signal) =>
        code !== 0
          ? reject(new Error(`agent-browser ${signal ? `terminated by ${signal}` : `exited ${code}`}`))
          : resolveRun()
      )
    })
  })
const portless = program.command("portless").description("Prepare canonical local HTTPS")
portless
  .command("status")
  .option("--json", "Output JSON (also the default)")
  .action(() => print(getPortlessProxyStatus()))
portless.command("setup").action(async () => {
  const result = await installPortlessService()
  print(result)
  if (!result.success) process.exitCode = 1
})
program
  .command("upgrade")
  .description("Explicitly upgrade the global package with Bun")
  .action(() => {
    const result = spawnSync("bun", ["add", "--global", "dev3000@latest"], { stdio: "inherit", shell: false })
    if (result.error) throw result.error
    process.exitCode = result.status ?? 1
  })
program.parseAsync().catch((error) => {
  console.error(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
  process.exitCode = 1
})
