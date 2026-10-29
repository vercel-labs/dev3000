import { spawn } from "node:child_process"
import { createHash, randomBytes, randomUUID } from "node:crypto"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { mkdir, writeFile } from "node:fs/promises"
import { createServer } from "node:net"
import { homedir, tmpdir } from "node:os"
import { dirname, join, posix, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { parseEnv } from "node:util"
import { Sandbox, type SandboxRegion } from "@vercel/sandbox"
import { CDPMonitor } from "../cdp-monitor.js"
import {
  isPortlessHostnameHeld,
  type PortlessRuntime,
  preparePortlessRuntime,
  registerPortlessAlias,
  removePortlessAlias
} from "../portless.js"
import { connectCompanion } from "./bridge.js"
import { portlessCertificatePin, sandboxChromePath } from "./chrome-isolation.js"
import { type Harness, harnessInvocation, harnessSkill } from "./harness.js"
import { startLocalProxy } from "./local-proxy.js"
import { prepareSandboxFx, SANDBOX_AGENT_BIN, SANDBOX_AGENT_DIRECTORY, SANDBOX_TOOLS } from "./sandbox-agent.js"
import { listSandboxSessions, readSandboxSession, type SandboxSession, saveSandboxSession } from "./sandbox-sessions.js"

const REMOTE_TOOLS = SANDBOX_TOOLS
const REMOTE_ENTRY = `${REMOTE_TOOLS}/node_modules/dev3000/dist/runtime/cli.js`
const APP_PORT = 3000
const BRIDGE_PORT = 9223

export interface SandboxOptions {
  project: string
  resume?: string | boolean
  harness?: Harness
  scope?: string
  branch?: string
  name?: string
  attach?: string
  hostname?: string
  region?: string
  command?: string
  installCommand?: string
  shell?: boolean
  headless?: boolean
  timeout?: string
  fx?: boolean
}

interface Project {
  id: string
  accountId: string
  name: string
  rootDirectory?: string | null
  devCommand?: string | null
  installCommand?: string | null
  link?: { type: string; org: string; repo: string; repoId: number; productionBranch?: string }
}

/** No shell interpolation. Bounded captured output also keeps credential-bearing CLI output out of logs. */
async function run(
  binary: string,
  args: string[],
  options: { cwd?: string; inherit?: boolean; env?: NodeJS.ProcessEnv; input?: string; signal?: AbortSignal } = {}
): Promise<string> {
  return new Promise((resolveRun, reject) => {
    if (options.signal?.aborted) {
      reject(new Error("Session ended"))
      return
    }
    const child = spawn(binary, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: options.inherit ? "inherit" : [options.input === undefined ? "ignore" : "pipe", "pipe", "pipe"]
    })
    let killTimer: ReturnType<typeof setTimeout> | undefined
    const abort = () => {
      child.kill("SIGTERM")
      killTimer = setTimeout(() => child.kill("SIGKILL"), 1000)
      killTimer.unref()
    }
    options.signal?.addEventListener("abort", abort, { once: true })
    const cleanup = () => {
      options.signal?.removeEventListener("abort", abort)
      if (killTimer) clearTimeout(killTimer)
    }
    let stdout = ""
    let stderr = ""
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString()
      if (stdout.length > 4 * 1024 * 1024) child.kill()
    })
    child.stderr?.on("data", (chunk) => {
      stderr = (stderr + chunk.toString()).slice(-8192)
    })
    child.on("error", (error) => {
      cleanup()
      reject(error)
    })
    child.stdin?.on("error", () => {}) // Early CLI exits still report their bounded stderr below.
    if (options.input !== undefined) child.stdin?.end(options.input)
    child.on("exit", (code) => {
      cleanup()
      if (options.signal?.aborted) resolveRun(stdout)
      else if (code === 0) resolveRun(stdout)
      else reject(new Error(`${binary} ${args[0]} failed: ${stderr || `exit ${code}`}`))
    })
  })
}

export function sandboxWorkdir(rootDirectory?: string | null, repositoryRoot = "/vercel/sandbox"): string {
  const root = posix.resolve(repositoryRoot, rootDirectory || ".")
  if (root !== repositoryRoot && !root.startsWith(`${repositoryRoot}/`))
    throw new Error("Project rootDirectory escapes the repository")
  return root
}

async function freePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolvePort, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolvePort)
  })
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("No Chrome port available")
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()))
  return address.port
}

export async function launchSandbox(options: SandboxOptions): Promise<void> {
  const scope = options.scope ? ["--scope", options.scope] : []
  const log = (message: string) => console.error(`[d3k sandbox] ${message}`)
  const isolatedBrowserPath = await sandboxChromePath(log)
  const temporary = mkdtempSync(join(tmpdir(), "d3k-sandbox-"))
  let localProxy: Awaited<ReturnType<typeof startLocalProxy>> | undefined
  let localRoute: PortlessRuntime | undefined
  let aliasRegistered = false
  let sandbox: Sandbox | undefined
  let browser: CDPMonitor | undefined
  let companion: ReturnType<typeof connectCompanion> | undefined
  let savedSession: SandboxSession | undefined
  let remoteStarted = false
  let originalPorts: number[] | undefined
  let closing = false
  let signalReceived = false
  let remoteWorkdir = "/vercel/sandbox"
  let finish: () => void = () => {}
  const shellAbort = new AbortController()
  const ended = new Promise<void>((resolveEnd) => {
    finish = () => {
      browser?.prepareShutdown()
      companion?.close()
      shellAbort.abort()
      resolveEnd()
    }
  })
  const onSignal = () => {
    signalReceived = true
    finish()
  }
  process.on("SIGINT", onSignal)
  process.on("SIGTERM", onSignal)
  try {
    const routing = preparePortlessRuntime(
      `${options.hostname || options.project.toLowerCase().replace(/[^a-z0-9-]/g, "-")}.d3k`
    )
    if (!routing.runtime) throw new Error(routing.error || "Canonical Portless is required")
    localRoute = routing.runtime
    if (isPortlessHostnameHeld(localRoute.name))
      throw new Error(`${localRoute.url} is already in use; stop that session or choose another --hostname`)
    log(`Resolving ${options.project} through Vercel CLI`)
    const project = JSON.parse(
      await run("vercel", ["api", `/v9/projects/${encodeURIComponent(options.project)}`, ...scope, "--raw"], {
        cwd: temporary
      })
    ) as Project
    if (!project.id || !project.accountId || !project.name) throw new Error("Vercel returned an invalid project")
    sandboxWorkdir(project.rootDirectory)
    const { token } = JSON.parse(
      await run("vercel", ["project", "token", project.id, "--scope", project.accountId, "--format", "json"], {
        cwd: temporary
      })
    ) as { token: string }
    if (!token) throw new Error("Vercel CLI did not return a project OIDC token; update the CLI and run vercel login")
    const credentials = { token, projectId: project.id, teamId: project.accountId }
    if (signalReceived) return
    if (options.attach) {
      // Read configured routes before resuming: resume responses may also contain reserved system ports.
      // The first command below resumes compute automatically after user ports have been configured.
      sandbox = await Sandbox.get({ ...credentials, name: options.attach })
      await sandbox.update({ timeout: Number(options.timeout || 30) * 60000 })
      const ports = sandbox.routes.map((route) => route.port)
      if (!ports.includes(APP_PORT) || !ports.includes(BRIDGE_PORT)) {
        originalPorts = ports
        await sandbox.update({ ports: [...new Set([...ports, APP_PORT, BRIDGE_PORT])] })
      }
    } else {
      if (project.link?.type !== "github" || !project.link.org || !project.link.repo)
        throw new Error("This project needs a linked GitHub repository")
      log("Creating a sandbox and cloning the linked public repository remotely")
      sandbox = await Sandbox.create({
        ...credentials,
        ...(options.name ? { name: options.name } : {}),
        ...(options.region ? { region: options.region as SandboxRegion } : {}),
        timeout: Number(options.timeout || 30) * 60000,
        ports: [APP_PORT, BRIDGE_PORT],
        source: {
          type: "git",
          url: `https://github.com/${project.link.org}/${project.link.repo}.git`,
          ...(options.branch ? { revision: options.branch } : {})
        }
      }).catch((error: unknown) => {
        throw new Error(
          `${error instanceof Error ? error.message : "Could not create the source sandbox"}. Automatic cloning currently requires a public GitHub repository. For a private repository, use --attach <name> with an existing sandbox that already contains the checkout.`,
          { cause: error }
        )
      })
    }
    log(`Sandbox ${sandbox.name} is running`)
    // Image WORKDIR and source checkout location differ between Sandbox images.
    let repositoryRoot: string | undefined
    const candidates = [sandbox.cwd, ...(project.link ? [posix.join(sandbox.cwd, project.link.repo)] : [])]
    for (const cwd of candidates) {
      const result = await sandbox
        .runCommand({ cmd: "git", args: ["rev-parse", "--show-toplevel"], cwd })
        .catch(() => null)
      if (result?.exitCode === 0) {
        repositoryRoot = (await result.stdout()).trim()
        break
      }
    }
    if (!repositoryRoot)
      throw new Error(
        "Could not locate the repository in this sandbox; expected its working directory or a directory named after the linked repository"
      )
    const workdir = sandboxWorkdir(project.rootDirectory, repositoryRoot)
    remoteWorkdir = workdir
    if (signalReceived) return
    // Install this exact d3k distribution, including unreleased local changes. No project checkout is used locally.
    const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
    if (!existsSync(join(packageRoot, "dist/runtime/cli.js")))
      throw new Error("Build d3k before starting a sandbox from a source checkout")
    const archive = join(temporary, "dev3000.tgz")
    await run("bun", ["pm", "pack", "--filename", archive, "--quiet"], { cwd: packageRoot })
    const mkdirResult = await sandbox.runCommand("mkdir", ["-p", REMOTE_TOOLS])
    if (mkdirResult.exitCode !== 0) throw new Error("Could not prepare remote d3k tools directory")
    await sandbox.writeFiles([{ path: `${REMOTE_TOOLS}/dev3000.tgz`, content: readFileSync(archive) }])
    log("Installing d3k in the sandbox")
    const installTools = await sandbox.runCommand({
      cmd: "bun",
      args: ["add", "--cwd", REMOTE_TOOLS, `${REMOTE_TOOLS}/dev3000.tgz`],
      timeoutMs: 180000
    })
    if (installTools.exitCode !== 0)
      throw new Error(`Remote d3k install failed: ${(await installTools.stderr()).slice(-4000)}`)
    const existing = await sandbox.runCommand({ cmd: "node", args: [REMOTE_ENTRY, "status"], cwd: workdir })
    if (existing.exitCode === 0 && JSON.parse(await existing.stdout()).running) {
      if (typeof options.resume !== "string")
        throw new Error("A runtime is already active in this sandbox; stop it before pairing a different browser")
      log("Stopping the previous remote runtime before creating a fresh browser connection")
      const stopped = await sandbox.runCommand({
        cmd: "node",
        args: [REMOTE_ENTRY, "stop"],
        cwd: workdir,
        timeoutMs: 10000
      })
      if (stopped.exitCode !== 0) throw new Error("Could not stop the previous remote runtime")
      const stopDeadline = Date.now() + 15000
      let stoppedRuntime = false
      while (Date.now() < stopDeadline) {
        const status = await sandbox.runCommand({ cmd: "node", args: [REMOTE_ENTRY, "status"], cwd: workdir })
        if (status.exitCode === 0 && !JSON.parse(await status.stdout()).running) {
          stoppedRuntime = true
          break
        }
        await new Promise((resolveWait) => setTimeout(resolveWait, 300))
      }
      if (!stoppedRuntime) throw new Error("Previous remote runtime did not finish stopping")
    }
    const previous =
      typeof options.resume === "string"
        ? readSandboxSession(options.resume)
        : listSandboxSessions().find(
            (record) =>
              record.project === project.id && record.team === project.accountId && record.sandbox === sandbox?.name
          )
    const branchResult = await sandbox.runCommand({ cmd: "git", args: ["branch", "--show-current"], cwd: workdir })
    const now = new Date().toISOString()
    savedSession = {
      version: 1,
      id: previous?.id || randomUUID(),
      project: project.id,
      projectName: project.name,
      team: project.accountId,
      scope: previous?.scope || options.scope,
      sandbox: sandbox.name,
      hostname: localRoute.name.replace(/\.d3k$/, ""),
      appUrl: localRoute.url,
      workdir,
      branch: branchResult.exitCode === 0 ? (await branchResult.stdout()).trim() || undefined : undefined,
      command: options.command || project.devCommand || undefined,
      installCommand: options.installCommand,
      timeout: options.timeout || "30",
      fx: options.fx !== false,
      harness: options.harness,
      ownsSandbox: previous?.ownsSandbox ?? !options.attach,
      createdAt: previous?.createdAt || now,
      lastUsedAt: now,
      launcherPid: process.pid
    }
    saveSandboxSession(savedSession)
    log("Loading Development environment through Vercel CLI")
    const envPath = join(temporary, "development.env")
    await run(
      "vercel",
      [
        "env",
        "pull",
        envPath,
        "--project",
        project.id,
        "--scope",
        project.accountId,
        "--environment",
        "development",
        "--yes"
      ],
      { cwd: temporary }
    )
    const development = readFileSync(envPath, "utf8")
    rmSync(envPath)
    const appEnv: Record<string, string> = Object.fromEntries(
      Object.entries(parseEnv(development)).filter((entry): entry is [string, string] => typeof entry[1] === "string")
    )
    // A development OIDC token manages infrastructure; it does not belong in app/agent environment.
    delete appEnv.VERCEL_OIDC_TOKEN
    delete appEnv.VERCEL_TOKEN
    delete appEnv.VERCEL_AUTH_TOKEN
    // Remove credentials from pre-hardening sessions before any repository code runs.
    const legacyCleanup = await sandbox.runCommand({
      cmd: "rm",
      args: ["-f", `${SANDBOX_AGENT_DIRECTORY}/gateway.json`, `${SANDBOX_AGENT_BIN}/fx`]
    })
    if (legacyCleanup.exitCode !== 0) throw new Error("Could not remove legacy sandbox harness credentials")
    const setup = options.installCommand || project.installCommand || "bun install"
    log(`Installing project dependencies: ${setup}`)
    const installed = await sandbox.runCommand({
      cmd: "sh",
      args: ["-c", setup],
      cwd: workdir,
      env: appEnv,
      timeoutMs: 300000
    })
    if (installed.exitCode !== 0)
      throw new Error(`Project dependency installation failed: ${(await installed.stderr()).slice(-4000)}`)
    if (signalReceived) return
    if (options.fx !== false && options.shell !== false) {
      log("Preparing fx; authenticate the harness in the sandbox before use")
      await prepareSandboxFx(sandbox)
    }
    if (signalReceived) return
    const upstreamUrl = sandbox.domain(APP_PORT)
    const appUrl = localRoute.url
    const proxyToken = randomBytes(32).toString("hex")
    localProxy = await startLocalProxy({ appUrl, upstreamUrl, token: proxyToken })
    registerPortlessAlias(localRoute, localProxy.port)
    aliasRegistered = true
    const bridgeUrl = `${sandbox.domain(BRIDGE_PORT).replace(/^https:/, "wss:")}/bridge`
    const pairingToken = randomBytes(32).toString("hex")
    const config = { appUrl, serverPort: APP_PORT, bridgePort: BRIDGE_PORT, token: pairingToken, proxyToken }
    const args = [REMOTE_ENTRY, "sandbox-serve", "--startup-timeout", "300000"]
    const command = options.command || project.devCommand
    if (command) args.push("--command", command)
    log("Starting the remote dev server and browser bridge")
    const remote = await sandbox.runCommand({
      cmd: "node",
      args,
      cwd: workdir,
      env: appEnv,
      stdin: true,
      detached: true
    })
    let remoteExit: number | undefined
    void remote
      .wait()
      .then((result) => {
        remoteExit = result.exitCode
        finish()
      })
      .catch(() => {
        remoteExit = -1
        finish()
      })
    await remote.writeStdin(JSON.stringify(config))
    await remote.closeStdin()
    remoteStarted = true
    // The profile key uses remote project identity, never the caller's local cwd.
    const key = createHash("sha256").update(`${project.accountId}/${project.id}`).digest("hex").slice(0, 20)
    const directory = join(homedir(), ".d3k", "sandboxes", key)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    await writeFile(
      join(directory, "session.json"),
      JSON.stringify({ project: project.id, team: project.accountId, name: sandbox.name, appUrl }),
      { mode: 0o600 }
    )
    const chromePort = await freePort()
    browser = new CDPMonitor(
      join(directory, "chrome-profile"),
      (_source, message) => {
        if (message.startsWith("[CDP]")) log(message)
      },
      false,
      isolatedBrowserPath,
      undefined,
      undefined,
      60000,
      chromePort,
      options.headless
    )
    browser.requireFilesystemIsolation(await portlessCertificatePin(appUrl))
    browser.setOnWindowClosedCallback(onSignal)
    await browser.start()
    companion = connectCompanion({
      url: bridgeUrl,
      token: pairingToken,
      chromePort,
      onState: (connected) => {
        if (!closing && !signalReceived)
          log(connected ? "Local Chrome connected" : "Browser disconnected; reconnecting")
      }
    })
    const deadline = Date.now() + 300000
    let ready = false
    while (!signalReceived && Date.now() < deadline) {
      const status = await sandbox.runCommand({ cmd: "node", args: [REMOTE_ENTRY, "status"], cwd: workdir })
      if (status.exitCode === 0) {
        const state = JSON.parse(await status.stdout()) as { ready?: boolean; browserConnected?: boolean }
        if (state.ready && state.browserConnected) {
          ready = true
          break
        }
      }
      if (remoteExit !== undefined) {
        throw new Error(`Remote runtime exited during startup: ${(await remote.stderr()).slice(-4000)}`)
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, 1500))
    }
    if (signalReceived) return
    if (!ready) throw new Error("Sandbox runtime did not become ready within five minutes")
    log(`Ready: ${appUrl}`)
    log(`Sandbox: ${sandbox.name}. Shell directory: ${workdir}`)
    if (options.shell !== false && process.stdin.isTTY) {
      const path = await sandbox.runCommand({ cmd: "printenv", args: ["PATH"] })
      if (path.exitCode !== 0) throw new Error("Could not resolve remote shell PATH")
      const contextDirectory = `${REMOTE_TOOLS}/harness-context`
      const skillPath = `${contextDirectory}/.fx/skills/d3k/SKILL.md`
      if (options.harness) {
        const prepared = await sandbox.runCommand({ cmd: "mkdir", args: ["-p", `${contextDirectory}/.fx/skills/d3k`] })
        if (prepared.exitCode !== 0) throw new Error("Could not prepare harness skill context")
        await sandbox.writeFiles([{ path: skillPath, content: Buffer.from(harnessSkill()) }])
      }
      const invocation = options.harness ? harnessInvocation(options.harness, skillPath, contextDirectory) : undefined
      await run(
        "vercel",
        [
          "sandbox",
          invocation ? "exec" : "connect",
          sandbox.name,
          "--project",
          project.id,
          "--scope",
          project.accountId,
          "--workdir",
          workdir,
          "--env",
          `PATH=${options.fx !== false ? `${SANDBOX_AGENT_BIN}:` : ""}${REMOTE_TOOLS}/node_modules/.bin:${(await path.stdout()).trim()}`,
          ...(invocation ? ["--interactive", "--", invocation.binary, ...invocation.args] : [])
        ],
        { inherit: true, env: { ...process.env, VERCEL_OIDC_TOKEN: token }, signal: shellAbort.signal }
      )
    } else {
      log(
        options.attach
          ? "Companion retained. Press Ctrl+C to stop this runtime; the attached sandbox stays running."
          : "Companion retained. Press Ctrl+C to stop compute and preserve the sandbox filesystem."
      )
      await ended
      if (!signalReceived && remoteExit !== undefined && remoteExit !== 0)
        throw new Error(`Remote runtime exited (${remoteExit}): ${(await remote.stderr()).slice(-4000)}`)
    }
  } finally {
    if (!closing) {
      closing = true
      companion?.close()
      if (aliasRegistered && localRoute) {
        try {
          removePortlessAlias(localRoute)
        } catch {
          log("Could not remove the local proxy route")
        }
      }
      await localProxy?.close()
      await browser?.shutdown().catch(() => {})
      if (sandbox) {
        if (options.harness)
          await sandbox.runCommand({ cmd: "rm", args: ["-rf", `${REMOTE_TOOLS}/harness-context`] }).catch(() => {})
        if (remoteStarted)
          await sandbox
            .runCommand({ cmd: "node", args: [REMOTE_ENTRY, "stop"], cwd: remoteWorkdir, timeoutMs: 10000 })
            .catch(() => {})
        // An attached sandbox belongs to its existing owner. Only stop sandboxes created by this invocation.
        if (!options.attach || (typeof options.resume === "string" && savedSession?.ownsSandbox))
          await sandbox
            .stop()
            .catch(() => log(`Could not stop sandbox ${sandbox?.name}; stop it with vercel sandbox stop`))
        else if (originalPorts)
          await sandbox.update({ ports: originalPorts }).catch(() => log("Could not restore attached sandbox ports"))
      }
    }
    process.off("SIGINT", onSignal)
    process.off("SIGTERM", onSignal)
    rmSync(temporary, { recursive: true, force: true })
    if (savedSession) {
      savedSession.closedAt = new Date().toISOString()
      delete savedSession.launcherPid
      try {
        saveSandboxSession(savedSession)
      } catch {
        log("Could not update saved session metadata")
      }
      console.log(`Resume this sandbox: d3k --resume ${savedSession.id}`)
    }
    if (remoteStarted) log("Session closed")
  }
}
