import { createHash, randomBytes, randomUUID } from "node:crypto"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { mkdir, writeFile } from "node:fs/promises"
import { createServer } from "node:net"
import { homedir, tmpdir } from "node:os"
import { dirname, join, posix, resolve } from "node:path"
import { fileURLToPath } from "node:url"
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
import { type Harness, type HarnessLocation, harnessInvocation, harnessSkill } from "./harness.js"
import { startLocalProxy } from "./local-proxy.js"
import {
  configureSandboxFxGateway,
  prepareSandboxFx,
  SANDBOX_AGENT_BIN,
  SANDBOX_AGENT_DIRECTORY,
  SANDBOX_TOOLS
} from "./sandbox-agent.js"
import { closeSandboxResources } from "./sandbox-cleanup.js"
import { DEFAULT_SANDBOX_TIMEOUT_MINUTES } from "./sandbox-command.js"
import { sandboxFxContext } from "./sandbox-context.js"
import { discoverLegacyFxWorkspace } from "./sandbox-fx-resume.js"
import { createSandboxGateway } from "./sandbox-gateway.js"
import { createLocalSandboxWorkspace, launchLocalSandboxHarness } from "./sandbox-local-harness.js"
import { sandboxPreviewLink } from "./sandbox-preview.js"
import { runSandboxCli } from "./sandbox-process.js"
import { sandboxRecovery } from "./sandbox-recovery.js"
import {
  listSandboxSessions,
  readSandboxSession,
  type SandboxSession,
  sandboxFxWorkspace,
  saveSandboxSession
} from "./sandbox-sessions.js"
import { runSandboxShell, SandboxShellDisconnected } from "./sandbox-shell.js"
import { watchSandboxRuntime } from "./sandbox-watch.js"
import { finishTerminalCleanup, holdTerminalForCleanup } from "./terminal.js"

const REMOTE_TOOLS = SANDBOX_TOOLS
const REMOTE_ENTRY = `${REMOTE_TOOLS}/node_modules/dev3000/dist/runtime/cli.js`
const APP_PORT = 3000
const BRIDGE_PORT = 9223

export interface SandboxOptions {
  project: string
  resume?: string | boolean
  harness?: Harness
  harnessLocation?: HarnessLocation
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
  preview?: boolean
  timeout?: string
  fx?: boolean
  gateway?: boolean
  gatewayBudget?: string
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

export interface SandboxLifecycle {
  signal?: AbortSignal
  log?: (message: string) => void
  onClosing?: () => void
  onReady?: (workspace: {
    session: SandboxSession
    preview?: { url: string; expiresAt: string }
    call: Awaited<ReturnType<typeof createLocalSandboxWorkspace>>
  }) => void
}

export async function launchSandbox(options: SandboxOptions, lifecycle: SandboxLifecycle = {}): Promise<void> {
  const localHarness = !!options.harness && options.harnessLocation !== "sandbox"
  const timeoutMinutes = Number(options.timeout ?? DEFAULT_SANDBOX_TIMEOUT_MINUTES)
  const expiresAt = Date.now() + timeoutMinutes * 60000
  const scope = options.scope ? ["--scope", options.scope] : []
  const log = (message: string) => {
    console.error(`[d3k sandbox] ${message}`)
    lifecycle.log?.(message)
  }
  const temporary = mkdtempSync(join(tmpdir(), "d3k-sandbox-"))
  let localProxy: Awaited<ReturnType<typeof startLocalProxy>> | undefined
  let localRoute: PortlessRuntime | undefined
  let aliasRegistered = false
  let sandbox: Sandbox | undefined
  let browser: CDPMonitor | undefined
  let companion: ReturnType<typeof connectCompanion> | undefined
  let gateway: Awaited<ReturnType<typeof createSandboxGateway>> | undefined
  let fxBinary: string | undefined
  let fxContextInstalled = false
  let savedSession: SandboxSession | undefined
  let remoteStarted = false
  let originalPorts: number[] | undefined
  let closing = false
  let signalReceived = false
  let remoteWorkdir = "/vercel/sandbox"
  let finish: () => void = () => {}
  const shellAbort = new AbortController()
  const run: typeof runSandboxCli = (binary, args, config) =>
    runSandboxCli(binary, args, { signal: shellAbort.signal, timeoutMs: 60000, ...config })
  const watchAbort = new AbortController()
  let shellActive = false
  const ended = new Promise<void>((resolveEnd) => {
    finish = () => {
      browser?.prepareShutdown()
      companion?.close()
      watchAbort.abort()
      shellAbort.abort()
      resolveEnd()
    }
  })
  const onSignal = (signal: NodeJS.Signals) => {
    if (closing) return
    if (!signalReceived) log(`Received ${signal}; closing session`)
    signalReceived = true
    finish()
  }
  const onAbort = () => onSignal("SIGTERM")
  if (lifecycle.signal) lifecycle.signal.addEventListener("abort", onAbort, { once: true })
  else {
    process.on("SIGINT", onSignal)
    process.on("SIGTERM", onSignal)
  }
  try {
    if (lifecycle.signal?.aborted) return
    const routing = preparePortlessRuntime(
      `${options.hostname || options.project.toLowerCase().replace(/[^a-z0-9-]/g, "-")}.d3k`
    )
    if (!routing.runtime) throw new Error(routing.error || "Canonical Portless is required")
    localRoute = routing.runtime
    if (isPortlessHostnameHeld(localRoute.name))
      throw new Error(`${localRoute.url} is already in use; stop that session or choose another --hostname`)
    const isolatedBrowserPath = await sandboxChromePath(log)
    if (signalReceived) return
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
      sandbox = await Sandbox.get({ ...credentials, name: options.attach, signal: shellAbort.signal })
      await sandbox.update({ timeout: timeoutMinutes * 60000 })
      const ports = sandbox.routes.map((route) => route.port)
      if (!ports.includes(APP_PORT) || !ports.includes(BRIDGE_PORT)) {
        originalPorts = ports
        await sandbox.update({ ports: [...new Set([...ports, APP_PORT, BRIDGE_PORT])] })
      }
    } else {
      if (project.link?.type !== "github" || !project.link.org || !project.link.repo)
        throw new Error("This project needs a linked GitHub repository")
      const repository = `${project.link.org}/${project.link.repo}`
      log("Creating a sandbox and cloning the linked public repository remotely")
      sandbox = await Sandbox.create({
        ...credentials,
        signal: shellAbort.signal,
        ...(options.name ? { name: options.name } : {}),
        ...(options.region ? { region: options.region as SandboxRegion } : {}),
        timeout: timeoutMinutes * 60000,
        ports: [APP_PORT, BRIDGE_PORT],
        source: {
          type: "git",
          url: `https://github.com/${repository}.git`,
          ...(options.branch ? { revision: options.branch } : {})
        }
      }).catch((error: unknown) => {
        throw new Error(
          `Could not create the sandbox from ${repository}${options.branch ? ` at ${options.branch}` : ""}: ${error instanceof Error ? error.message : "Unknown creation error"}. Check Sandbox access, connectivity, and that the repository and requested revision are publicly accessible. This failure does not establish that the repository is private. No existing checkout was reused.`,
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
      timeoutMs: 180000,
      signal: shellAbort.signal
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
    let fxWorkspace = previous?.fxWorkspace
    if (
      localHarness &&
      options.harness === "fx" &&
      typeof options.resume === "string" &&
      previous?.harness === "fx" &&
      previous.harnessLocation !== "sandbox" &&
      !fxWorkspace
    ) {
      try {
        fxWorkspace = await discoverLegacyFxWorkspace(previous, listSandboxSessions(), (args) =>
          run("fx", args, { timeoutMs: 10000 })
        )
      } catch {
        // Older fx versions may not expose machine-readable session discovery.
      }
      if (!fxWorkspace)
        throw new Error(
          "Cannot identify this older sandbox's fx workspace safely. Use fx sessions --all to locate its conversation before resuming."
        )
    }
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
      timeout: String(timeoutMinutes),
      fx: options.fx !== false,
      gateway: options.gateway !== false,
      gatewayBudget: options.gatewayBudget || "5",
      harness: options.harness,
      harnessLocation: options.harnessLocation || "local",
      fxWorkspace,
      ownsSandbox: previous?.ownsSandbox ?? !options.attach,
      createdAt: previous?.createdAt || now,
      lastUsedAt: now,
      launcherPid: process.pid
    }
    if (localHarness && options.harness === "fx") savedSession.fxWorkspace = sandboxFxWorkspace(savedSession)
    saveSandboxSession(savedSession)
    log("Loading Development environment through Vercel CLI")
    // Use the same resolved Development-env endpoint as `vercel env pull`,
    // keeping the values in memory rather than writing an env file on the laptop.
    const development = JSON.parse(
      await run("vercel", ["api", `/v3/env/pull/${project.id}/development`, "--scope", project.accountId, "--raw"], {
        cwd: temporary
      })
    ) as { env?: Record<string, string> }
    if (!development.env || typeof development.env !== "object")
      throw new Error("Could not load Development environment")
    const appEnv: Record<string, string> = Object.fromEntries(
      Object.entries(development.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")
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
      timeoutMs: 300000,
      signal: shellAbort.signal
    })
    if (installed.exitCode !== 0)
      throw new Error(`Project dependency installation failed: ${(await installed.stderr()).slice(-4000)}`)
    if (signalReceived) return
    if (!localHarness && options.fx !== false && options.shell !== false) {
      log("Preparing fx")
      fxBinary = await prepareSandboxFx(sandbox)
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
    const preview = options.preview
      ? { origin: new URL(upstreamUrl).origin, token: randomBytes(32).toString("hex"), expiresAt }
      : undefined
    const config = { appUrl, serverPort: APP_PORT, bridgePort: BRIDGE_PORT, token: pairingToken, proxyToken, preview }
    const args = [REMOTE_ENTRY, "sandbox-serve", "--startup-timeout", "300000"]
    const command = options.command || project.devCommand
    if (command) args.push("--command", command)
    const runtimeSandbox = sandbox
    const runRemote = () =>
      runtimeSandbox.runCommand({
        cmd: "node",
        args,
        cwd: workdir,
        env: appEnv,
        stdin: true,
        detached: true,
        signal: shellAbort.signal
      })
    log("Starting the remote dev server and browser bridge")
    let remote = await runRemote()
    let remoteExit: number | undefined
    let workspaceReady = false
    let generationAbort = new AbortController()
    const monitorRemote = async () => {
      generationAbort.abort()
      generationAbort = new AbortController()
      remoteExit = undefined
      const current = remote
      void watchSandboxRuntime({
        status: (signal) => runtimeSandbox.getCommand(current.cmdId, { signal }),
        signal: AbortSignal.any([watchAbort.signal, generationAbort.signal]),
        log,
        onExit: (code) => {
          if (current !== remote) return
          remoteExit = code
          log(`Remote dev runtime exited (code ${code})`)
          if (workspaceReady)
            log(
              "Keeping your agent and browser open. Use sandbox_recover to restore the dev runtime and bridge; your edits are preserved."
            )
          else if (shellActive)
            log(
              "Keeping your coding shell open. Exit it and use the resume command to restore the dev server and browser."
            )
          else finish()
        }
      })
      await current.writeStdin(JSON.stringify(config))
      await current.closeStdin()
      remoteStarted = true
    }
    await monitorRemote()
    const readStatus = async () => {
      const result = await runtimeSandbox.runCommand({
        cmd: "node",
        args: [REMOTE_ENTRY, "status"],
        cwd: workdir,
        timeoutMs: 10000,
        signal: shellAbort.signal
      })
      if (result.exitCode !== 0) throw new Error("Could not read remote runtime status")
      return JSON.parse(await result.stdout()) as {
        running?: boolean
        ready?: boolean
        browserConnected?: boolean
        sessionId?: string
        cursor?: number
      }
    }
    const waitReady = async () => {
      const deadline = Date.now() + 300000
      while (!signalReceived && Date.now() < deadline) {
        const state = await readStatus()
        if (state.ready && state.browserConnected) return state
        if (remoteExit !== undefined)
          throw new Error(`Remote runtime exited during startup: ${(await remote.stderr()).slice(-4000)}`)
        await new Promise((resolveWait) => setTimeout(resolveWait, 1500))
      }
      throw new Error(signalReceived ? "Session ended" : "Sandbox runtime did not become ready within five minutes")
    }
    const recover = sandboxRecovery(async () => {
      const state = await readStatus()
      if (state.ready && state.browserConnected) return { restarted: false, evidenceGap: false, status: state }
      log("Recovering the dev runtime and browser bridge in the existing sandbox; no clone or install")
      // Stop only our managed runtime; do not kill other builds or agent processes.
      generationAbort.abort()
      if (state.running) {
        const stopped = await runtimeSandbox.runCommand({
          cmd: "node",
          args: [REMOTE_ENTRY, "stop"],
          cwd: workdir,
          timeoutMs: 10000,
          signal: shellAbort.signal
        })
        if (stopped.exitCode !== 0) throw new Error("Could not stop the unhealthy dev runtime")
        const deadline = Date.now() + 15000
        while ((await readStatus()).running) {
          if (Date.now() > deadline) throw new Error("Previous dev runtime did not finish stopping")
          await new Promise((resolveWait) => setTimeout(resolveWait, 300))
        }
      }
      if (signalReceived) throw new Error("Session ended")
      remote = await runRemote()
      await monitorRemote()
      const status = await waitReady()
      log("Dev runtime and browser bridge recovered. Old in-memory evidence is lost; reread status before testing.")
      return { restarted: true, evidenceGap: true, status }
    }, shellAbort.signal)
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
    if (signalReceived) return
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
    browser.setOnWindowClosedCallback(() => {
      if (!closing && !signalReceived) log("Local browser window closed; closing session")
      if (closing) return
      signalReceived = true
      finish()
    })
    await browser.start()
    companion = connectCompanion({
      url: bridgeUrl,
      token: pairingToken,
      chromePort,
      onState: (connected) => {
        if (!closing && !signalReceived)
          log(
            connected
              ? "Local Chrome connected"
              : remoteExit === undefined
                ? "Browser disconnected; reconnecting"
                : "Dev runtime is stopped; use sandbox_recover"
          )
      }
    })
    await waitReady()
    if (signalReceived) return
    workspaceReady = localHarness || !!lifecycle.onReady
    log(`Ready: ${appUrl}`)
    log(`Sandbox: ${sandbox.name}. Shell directory: ${workdir}`)
    if (lifecycle.onReady) {
      const call = await createLocalSandboxWorkspace({
        directory: join(temporary, "control"),
        sandbox,
        workdir,
        appUrl,
        signal: shellAbort.signal,
        chromePort,
        sessionId: savedSession.id,
        recover,
        repository: project.link?.type === "github" ? `${project.link.org}/${project.link.repo}` : undefined
      })
      if (signalReceived) return
      lifecycle.onReady({
        session: savedSession,
        call,
        ...(preview
          ? { preview: { url: sandboxPreviewLink(preview), expiresAt: new Date(expiresAt).toISOString() } }
          : {})
      })
    }
    if (options.shell !== false && process.stdin.isTTY) {
      if (
        (fxBinary || (localHarness && options.harness === "fx")) &&
        options.gateway !== false &&
        (!options.harness || options.harness === "fx")
      ) {
        log(`Connecting fx to the project's team Gateway ($${options.gatewayBudget || "5"} session budget)`)
        try {
          gateway = await createSandboxGateway(
            (binary, args, config) =>
              run(binary, args, { ...config, cwd: temporary, isolated: true, timeoutMs: 10000 }),
            {
              projectId: project.id,
              teamId: project.accountId,
              sessionId: savedSession.id,
              minutes: timeoutMinutes,
              budget: Number(options.gatewayBudget || 5)
            }
          )
          if (!localHarness && fxBinary) await configureSandboxFxGateway(sandbox, fxBinary, gateway)
        } catch {
          throw new Error(
            "Could not configure sandbox Gateway authentication. Check team API-key permissions or use --no-gateway for manual authentication."
          )
        }
      }
      if (localHarness && options.harness) {
        if (remoteExit !== undefined)
          throw new Error(`Remote runtime exited before the harness opened (code ${remoteExit})`)
        log(`Starting local ${options.harness}; project files and commands stay in ${workdir}`)
        shellActive = true
        await launchLocalSandboxHarness({
          harness: options.harness,
          directory: options.harness === "fx" ? sandboxFxWorkspace(savedSession) : join(temporary, "control"),
          resume:
            typeof options.resume === "string" && previous?.harness === "fx" && previous.harnessLocation !== "sandbox",
          sandbox,
          workdir,
          appUrl,
          signal: shellAbort.signal,
          gateway,
          chromePort,
          sessionId: savedSession.id,
          recover,
          repository: project.link?.type === "github" ? `${project.link.org}/${project.link.repo}` : undefined
        })
        return
      }
      const path = await sandbox.runCommand({ cmd: "printenv", args: ["PATH"] })
      if (path.exitCode !== 0) throw new Error("Could not resolve remote shell PATH")
      const contextDirectory = `${REMOTE_TOOLS}/harness-context`
      const skillPath = `${contextDirectory}/.fx/skills/d3k/SKILL.md`
      const harnessContext = { workdir, appUrl }
      if (options.harness || fxBinary) {
        const prepared = await sandbox.runCommand({ cmd: "mkdir", args: ["-p", `${contextDirectory}/.fx/skills/d3k`] })
        if (prepared.exitCode !== 0) throw new Error("Could not prepare harness skill context")
        await sandbox.writeFiles([{ path: skillPath, content: Buffer.from(harnessSkill(harnessContext)) }])
      }
      if (fxBinary && (!options.harness || options.harness === "fx")) {
        await sandboxFxContext(sandbox, harnessContext)
        fxContextInstalled = true
      }
      const invocation = options.harness
        ? harnessInvocation(
            options.harness,
            skillPath,
            contextDirectory,
            harnessContext,
            typeof options.resume === "string" && previous?.harness === "fx" && previous.harnessLocation === "sandbox"
          )
        : undefined
      if (remoteExit !== undefined)
        throw new Error(`Remote runtime exited before the shell opened (code ${remoteExit})`)
      shellActive = true
      try {
        const exitCode = await runSandboxShell({
          sandbox,
          cwd: workdir,
          execution: invocation
            ? [options.harness === "fx" && fxBinary ? `${SANDBOX_AGENT_BIN}/fx` : invocation.binary, ...invocation.args]
            : ["/bin/bash", "--noprofile", "--norc", "-i"],
          env: {
            PATH: `${options.fx !== false ? `${SANDBOX_AGENT_BIN}:` : ""}${REMOTE_TOOLS}/node_modules/.bin:${(await path.stdout()).trim()}`
          },
          signal: shellAbort.signal
        })
        if (exitCode !== undefined) {
          log(`Remote ${options.harness || "shell"} exited (code ${exitCode})`)
          if (exitCode !== 0) throw new Error(`Remote ${options.harness || "shell"} exited (code ${exitCode})`)
        }
      } catch (error) {
        if (signalReceived) return
        if (!(error instanceof SandboxShellDisconnected)) throw error
        log(error.message)
        log("The terminal disconnected; keeping the sandbox and browser running. No agent command was replayed.")
        const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`
        log(
          `Reconnect from another terminal: vercel sandbox connect ${quote(sandbox.name)} --project ${quote(project.id)} --scope ${quote(project.accountId)} --workdir ${quote(workdir)}`
        )
        log(`Your saved session is ${savedSession.id}. Press Ctrl+C here when you want to close it.`)
        await ended
      }
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
    const releaseTerminal = lifecycle.onReady ? () => {} : holdTerminalForCleanup()
    try {
      lifecycle.onClosing?.()
      watchAbort.abort()
      if (!closing) {
        closing = true
        signalReceived = true
        browser?.prepareShutdown()
        companion?.close()
        log("Closing session…")
        if (gateway)
          log(
            `Session Gateway key expires at ${new Date(gateway.expiresAt).toLocaleString(undefined, { timeZoneName: "short" })}`
          )
        if (aliasRegistered && localRoute) {
          try {
            removePortlessAlias(localRoute)
          } catch {
            log("Could not remove the local proxy route")
          }
        }
        await closeSandboxResources({
          closeProxy: localProxy?.close.bind(localProxy),
          closeBrowser: browser?.shutdown.bind(browser),
          sandbox,
          ownsSandbox: !options.attach || (typeof options.resume === "string" && savedSession?.ownsSandbox === true),
          fxContextInstalled,
          remoteStarted,
          remoteWorkdir,
          originalPorts,
          log
        })
      }
      rmSync(temporary, { recursive: true, force: true })
      if (savedSession) {
        savedSession.closedAt = new Date().toISOString()
        delete savedSession.launcherPid
        try {
          saveSandboxSession(savedSession)
        } catch {
          log("Could not update saved session metadata")
        }
      }
      if (remoteStarted) log("Session closed")
    } finally {
      try {
        const resume = savedSession ? `Resume this sandbox: d3k --resume ${savedSession.id}` : undefined
        // Keep signal handlers through restoration and output flushing. A late Ctrl-C
        // must not interrupt the final line. MCP stdout belongs exclusively to JSON-RPC.
        await finishTerminalCleanup(releaseTerminal, lifecycle.onReady ? undefined : resume)
        if (lifecycle.onReady && resume) log(resume)
      } finally {
        process.off("SIGINT", onSignal)
        process.off("SIGTERM", onSignal)
        lifecycle.signal?.removeEventListener("abort", onAbort)
      }
    }
  }
}
