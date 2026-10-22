#!/usr/bin/env node
import { spawn } from "node:child_process"
import { Command } from "commander"
import { getPortlessProxyStatus, installPortlessService } from "../portless.js"
import { getAgentBrowserBinaryPath } from "../utils/agent-browser.js"
import { startRuntime } from "./runtime.js"
import { queryRuntime, type RuntimeSession, readRuntimeSession } from "./session.js"

const print = (value: unknown) => console.log(JSON.stringify(value))
const program = new Command()
  .name("d3k-runtime")
  .description("Skill-owned dev server and browser evidence, held in memory")
program
  .command("start")
  .option("--command <command>", "Dev server command (defaults to package manager's dev script)")
  .option("--headless", "Headless browser for CI")
  .option("--servers-only", "Intentionally omit browser monitoring")
  .option("--startup-timeout <ms>", "Server startup deadline", "120000")
  .action(async (options) => {
    const startupTimeout = Number(options.startupTimeout)
    if (!Number.isSafeInteger(startupTimeout) || startupTimeout < 1) throw new Error("Invalid startup timeout")
    await startRuntime({ ...options, startupTimeout })
  })
program.command("status").action(async () => {
  if (!readRuntimeSession()) {
    print({ running: false, ready: false })
    return
  }
  print(await queryRuntime("/status"))
})
program
  .command("events")
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
program.command("stop").action(async () => print(await queryRuntime("/stop", process.cwd(), "POST")))
program
  .command("browser")
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
    await new Promise<void>((resolveRun, reject) => {
      const child = spawn(
        getAgentBrowserBinaryPath(),
        ["--session", `d3k-${session.sessionId}`, "--cdp", port, ...args],
        { stdio: "inherit" }
      )
      child.on("error", reject)
      child.on("exit", (code) => {
        if (code !== 0) reject(new Error(`agent-browser exited ${code}`))
        else resolveRun()
      })
    })
  })
const portless = program.command("portless")
portless.command("status").action(() => print(getPortlessProxyStatus()))
portless.command("setup").action(async () => {
  const result = await installPortlessService()
  print(result)
  if (!result.success) process.exitCode = 1
})
program.parseAsync().catch((error) => {
  console.error(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
  process.exitCode = 1
})
