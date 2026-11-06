import { randomBytes } from "node:crypto"
import { existsSync } from "node:fs"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { homedir, tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"
import { Sandbox } from "@vercel/sandbox"
import { eveBuildCacheProbe, eveBuildFingerprint } from "./build-cache.mjs"
import { eveClient, runClient } from "./client.mjs"
import {
  openEveConversation,
  prepareEveWorkspaceScript,
  saveEveConversationScript,
  validateConversation
} from "./conversation.mjs"
import { ModelSelection } from "./model-command.mjs"
import { waitToReconnect } from "./reconnect.mjs"
import { EVE_INSTALL_CONFIG, EVE_MODEL, EVE_VERSION } from "./settings.mjs"

// Use source in the checkout and built modules in the locally installed package.
const runtimeModules = existsSync(new URL("../../src/runtime/sandbox-gateway.ts", import.meta.url)) ? "src" : "dist"
const extension = runtimeModules === "src" ? "ts" : "js"
const { createSandboxGateway } = await import(
  new URL(`../../${runtimeModules}/runtime/sandbox-gateway.${extension}`, import.meta.url)
)
const { runSandboxCli } = await import(
  new URL(`../../${runtimeModules}/runtime/sandbox-process.${extension}`, import.meta.url)
)
const { harnessStartupContext } = await import(
  new URL(`../../${runtimeModules}/runtime/harness.${extension}`, import.meta.url)
)
const { configuredGitIdentity, configureSandboxGitIdentity } = await import(
  new URL(`../../${runtimeModules}/runtime/git-identity.${extension}`, import.meta.url)
)

const { values } = parseArgs({ options: { resume: { type: "string" }, check: { type: "boolean" } } })
if (!values.resume || !/^[a-f\d-]{36}$/.test(values.resume))
  throw new Error("Use: bun scripts/eve/launch.mjs --resume <d3k saved-session ID> [--check]")
if (!values.check && !process.stdin.isTTY) throw new Error("Run Eve in an interactive terminal")
const source = dirname(fileURLToPath(import.meta.url))
const record = JSON.parse(await readFile(join(homedir(), ".d3k/sandbox-sessions", `${values.resume}.json`), "utf8"))
const cli = (binary, args, options = {}) => runSandboxCli(binary, args, { timeoutMs: 120000, ...options })
const auth = JSON.parse(
  await cli("vercel", ["project", "token", record.project, "--scope", record.team, "--format", "json"])
)
const credentials = { token: auth.token, projectId: record.project, teamId: record.team, name: record.sandbox }
const sandbox = await Sandbox.get({ ...credentials, resume: false })
const runtime = "/tmp/d3k-tools/node_modules/.bin/d3k-runtime"
const statusCommand = await sandbox.runCommand({ cmd: runtime, args: ["status"], cwd: record.workdir })
const status = JSON.parse(await statusCommand.stdout())
if (!status.running || !status.ready) throw new Error("Start/resume d3k first; Eve uses its existing sandbox")
const startedAt = sandbox.session.startedAt?.getTime()
if (!Number.isFinite(startedAt)) throw new Error("Could not determine the current sandbox session's lifetime")
const remainingMinutes = Math.floor((startedAt + sandbox.session.timeout - Date.now()) / 60000) - 1
const minutes = Math.min(values.check ? 10 : 30, remainingMinutes)
if (minutes < 1) throw new Error("The sandbox is about to expire; extend it or resume d3k before testing")
const port = 3001
if (sandbox.routes.some((route) => route.port === port)) throw new Error("Sandbox port 3001 is already in use")
let directory
let localDirectory
let gateway
let server
let serviceUrl
let stopping = false
const shutdown = new AbortController()
const interrupt = () => {
  stopping = true
  shutdown.abort()
}
process.on("SIGINT", interrupt)
process.on("SIGTERM", interrupt)

async function remote(command, args, options = {}) {
  if (stopping) throw new Error("Eve session stopped")
  const result = await sandbox.runCommand({ cmd: command, args, cwd: directory, ...options })
  if (!options.detached && result.exitCode !== 0)
    throw new Error((await result.stderr()).slice(-3000) || `${command} failed (${result.exitCode})`)
  return result
}

try {
  console.log(`Preparing Eve ${EVE_VERSION} in ${record.sandbox}; the local browser stays paired through d3k…`)
  const names = [
    "connection.mjs",
    "settings.mjs",
    "supervisor.mjs",
    "agent/agent.ts",
    "agent/sandbox.ts",
    "agent/instructions.md",
    "agent/channels/eve.ts"
  ]
  const manifest = JSON.stringify({
    private: true,
    type: "module",
    dependencies: { eve: EVE_VERSION, ai: "7.0.159", zod: "4.6.7" }
  })
  const files = [
    ...(await Promise.all(
      names.map(async (name) => ({
        path: name,
        content:
          name === "agent/instructions.md"
            ? Buffer.from(
                `${await readFile(join(source, name), "utf8")}\n\n${harnessStartupContext({ workdir: record.workdir, appUrl: status.appUrl })}`
              )
            : await readFile(join(source, name))
      }))
    )),
    { path: "package.json", content: Buffer.from(manifest) },
    { path: "bunfig.toml", content: Buffer.from(EVE_INSTALL_CONFIG) }
  ]
  const buildFingerprint = eveBuildFingerprint(files)
  directory = values.check
    ? `/tmp/d3k-eve-check-${randomBytes(6).toString("hex")}`
    : `/tmp/d3k-eve-sessions/${record.id}`
  const prepared = await sandbox.runCommand({
    cmd: "node",
    args: ["-e", prepareEveWorkspaceScript, directory, record.id, record.workdir, status.appUrl]
  })
  if (prepared.exitCode !== 0)
    throw new Error(`Could not recover the Eve workspace: ${(await prepared.stderr()).slice(-2000)}`)
  const { state: conversationState, migrated } = JSON.parse(await prepared.stdout())
  if (conversationState) validateConversation(conversationState, { owner: record.id, workdir: record.workdir })
  const created = await sandbox.runCommand({ cmd: "mkdir", args: ["-p", `${directory}/agent/channels`] })
  if (created.exitCode !== 0) throw new Error("Could not prepare the remote Eve directory")
  const cached = await sandbox.runCommand({
    cmd: "node",
    args: ["-e", eveBuildCacheProbe, buildFingerprint],
    cwd: directory
  })
  const reuseBuild = cached.exitCode === 0
  if (!reuseBuild) {
    await remote("rm", ["-f", ".d3k-build.sha256"])
    await sandbox.writeFiles(files.map((file) => ({ ...file, path: `${directory}/${file.path}` })))
  }
  const gitIdentity = await configureSandboxGitIdentity(sandbox, record.workdir, await configuredGitIdentity(cli))
  const env = {
    ...gitIdentity,
    D3K_EVE_WORKDIR: record.workdir,
    D3K_EVE_ISOLATED_HOST: "1",
    EVE_SCHEDULES_DISABLED: "1"
  }
  console.log(
    reuseBuild
      ? "Reusing the built remote Eve service; preparing the local client…"
      : "Building the remote service and preparing the local client…"
  )
  const timed = async (label, operation) => {
    const started = performance.now()
    await operation()
    console.log(`${label} (${((performance.now() - started) / 1000).toFixed(1)}s)`)
  }
  // Both preparations are independent. Wait for both even if one fails so
  // finally cannot remove the client's directory while its install is writing.
  const preparations = await Promise.allSettled([
    (async () => {
      if (reuseBuild) return
      await timed("Remote Eve dependencies installed", () => remote("bun", ["install"]))
      await timed("Remote Eve service built", () => remote("node", ["node_modules/eve/bin/eve.js", "build"], { env }))
      await sandbox.writeFiles([{ path: `${directory}/.d3k-build.sha256`, content: Buffer.from(buildFingerprint) }])
    })(),
    timed("Local Eve client ready", async () => {
      localDirectory = await mkdtemp(join(tmpdir(), "d3k-eve-client-"))
      await writeFile(join(localDirectory, "package.json"), manifest)
      await writeFile(join(localDirectory, "bunfig.toml"), EVE_INSTALL_CONFIG)
      await cli("bun", ["install"], { cwd: localDirectory })
    })
  ])
  for (const result of preparations) if (result.status === "rejected") throw result.reason
  process.env.D3K_EVE_MODEL_ID = EVE_MODEL
  process.env.D3K_EVE_PACKAGE_ROOT = join(localDirectory, "node_modules/eve")
  gateway = await createSandboxGateway(cli, {
    projectId: record.project,
    teamId: record.team,
    sessionId: `${record.id} Eve session`,
    minutes,
    budget:
      record.gatewayBudgetConfigured && record.gatewayBudget && record.gatewayBudget !== "none"
        ? Number(record.gatewayBudget)
        : undefined
  })
  const token = randomBytes(32).toString("hex")
  await sandbox.update({ ports: [...sandbox.routes.map((route) => route.port), port] })
  serviceUrl = sandbox.domain(port)
  server = await remote("node", ["supervisor.mjs"], {
    detached: true,
    env: {
      ...env,
      AI_GATEWAY_API_KEY: gateway.key,
      D3K_EVE_TOKEN: token,
      D3K_EVE_EXPIRES_AT: String(gateway.expiresAt),
      D3K_EVE_PORT: String(port)
    }
  })
  for (let attempt = 0; ; attempt++) {
    if (stopping) throw new Error("Eve session stopped")
    const healthy = await fetch(`${serviceUrl}/eve/v1/health`, { signal: AbortSignal.timeout(3000) })
      .then((response) => response.ok)
      .catch(() => false)
    if (healthy) break
    if (attempt >= 30) throw new Error("Eve did not become healthy")
    await delay(500)
  }
  const { Client } = await eveClient()
  const models = new ModelSelection(EVE_MODEL)
  const client = new Client({ baseUrl: serviceUrl, auth: { bearer: token }, headers: () => models.headers() })
  const session = values.check
    ? (await client.sessions.create()).session
    : await openEveConversation({
        client,
        state: conversationState,
        owner: record.id,
        workdir: record.workdir,
        save: async (state) => {
          await remote("node", ["-e", saveEveConversationScript, directory, JSON.stringify(state)])
        },
        signal: AbortSignal.any([shutdown.signal, AbortSignal.timeout(20000)])
      })
  if (!values.check)
    console.log(
      `${conversationState ? (migrated ? "Recovered the most recent existing" : "Resuming") : "Created"} Eve conversation ${session.id}.`
    )
  console.log(`Ready. Local input → remote Eve → ${record.workdir}`)
  const spendingLimit =
    record.gatewayBudgetConfigured && record.gatewayBudget && record.gatewayBudget !== "none"
      ? `$${record.gatewayBudget} maximum`
      : "no session spending cap"
  console.log(`Team AI Gateway: ${spendingLimit}; access expires ${new Date(gateway.expiresAt).toLocaleTimeString()}.`)
  if (values.check) {
    const denied = await fetch(`${serviceUrl}/eve/v1/session`, { method: "POST" })
    if (denied.status !== 401) throw new Error(`Expected 401, got ${denied.status}`)
    const probe = await client.sessions.create({ message: "Reply with exactly EVE_READY. Do not call tools." })
    const result = await probe.delivery.result({ signal: AbortSignal.timeout(60000) })
    if (result.status !== "completed" || result.reply.trim() !== "EVE_READY") throw new Error(JSON.stringify(result))
    console.log("PASS: Eve setup, HTTPS authorization, and real model response")
  } else {
    console.log(
      "Try: inspect the current browser; paste an image path or Ctrl+V for a clipboard image; or a slow shell command."
    )
    console.log("/detach opens the reconnect menu. Ctrl-C at that prompt exits.")
    const expiry = AbortSignal.timeout(Math.max(0, gateway.expiresAt - Date.now()))
    const signal = AbortSignal.any([shutdown.signal, expiry])
    while (!signal.aborted) {
      await runClient({ baseUrl: serviceUrl, token, sessionId: session.id, models, signal })
      if (signal.aborted) break
      if (!(await waitToReconnect({ signal, onInterrupt: interrupt }))) break
    }
    if (expiry.aborted)
      console.log(
        "Eve's session time limit was reached. Remote Eve has stopped; no message was retried. Resume d3k to return to this conversation with renewed access."
      )
  }
} finally {
  process.off("SIGINT", interrupt)
  process.off("SIGTERM", interrupt)
  const failures = []
  if (server) await server.kill("SIGTERM").catch((error) => failures.push(`service: ${error.message}`))
  if (gateway)
    await cli("vercel", ["ai-gateway", "api-keys", "remove", gateway.id, "--scope", record.team, "--yes"]).catch(
      (error) => failures.push(`Gateway key removal: ${error.message}`)
    )
  if (serviceUrl) {
    await (async () => {
      const current = await Sandbox.get({ ...credentials, resume: false })
      if (current.routes.some((route) => route.port === port && route.url === serviceUrl))
        await current.update({
          ports: current.routes.filter((route) => route.port !== port).map((route) => route.port)
        })
    })().catch((error) => failures.push(`route: ${error.message}`))
  }
  if (localDirectory) await rm(localDirectory, { recursive: true, force: true })
  if (failures.length)
    console.error(`Cleanup needs attention (access still expires automatically): ${failures.join("; ")}`)
  else console.log("Eve stopped; temporary model access removed.")
}
