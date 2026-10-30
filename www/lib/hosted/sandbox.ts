import { createHmac, randomBytes, randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { Sandbox } from "@vercel/sandbox"
import { sandboxPreviewLink } from "../../../src/runtime/sandbox-preview"
import { workspaceHandler } from "../../../src/runtime/sandbox-workspace"
import { hostedAuth } from "./auth"
import { cloudBootstrap } from "./bootstrap"
import { type HostedProject, selectedProject } from "./config"

const ENTRY = "/tmp/d3k-tools/node_modules/dev3000/dist/runtime/cli.js"
interface Session {
  id: string
  owner: string
  project: string
  sandbox: string | null
  workdir: string | null
  expiresAt: string | number
  phase: string
}

export const sessionSchema = `CREATE TABLE IF NOT EXISTS d3k_hosted_session (
  id uuid PRIMARY KEY, owner text NOT NULL, project text NOT NULL, sandbox text, workdir text,
  "expiresAt" bigint NOT NULL, phase text NOT NULL
); CREATE INDEX IF NOT EXISTS d3k_hosted_session_owner ON d3k_hosted_session(owner);`

function preview(session: Session, sandbox: Sandbox) {
  const { config } = hostedAuth()
  return {
    origin: new URL(sandbox.domain(3000)).origin,
    token: createHmac("sha256", config.secret).update(`preview:${session.id}:${session.expiresAt}`).digest("hex"),
    expiresAt: Number(session.expiresAt)
  }
}

async function vercelApi(project: HostedProject, endpoint: string) {
  const response = await fetch(`https://api.vercel.com${endpoint}?teamId=${project.teamId}`, {
    headers: { Authorization: `Bearer ${hostedAuth().config.vercelToken}` },
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
    redirect: "error"
  })
  if (!response.ok) throw new Error(`Vercel project request failed (${response.status})`)
  return response.json()
}

async function projectSettings(project: HostedProject) {
  const [settings, development] = await Promise.all([
    vercelApi(project, `/v9/projects/${project.projectId}`),
    vercelApi(project, `/v3/env/pull/${project.projectId}/development`)
  ])
  if (settings.id !== project.projectId || settings.accountId !== project.teamId)
    throw new Error("Vercel returned a different project")
  if (!development.env || typeof development.env !== "object") throw new Error("Development env is unavailable")
  const env = Object.fromEntries(
    Object.entries(development.env).filter(
      (entry): entry is [string, string] =>
        typeof entry[1] === "string" &&
        !["VERCEL_TOKEN", "VERCEL_AUTH_TOKEN", "VERCEL_OIDC_TOKEN"].includes(entry[0]) &&
        !entry[0].startsWith("D3K_HOSTED_")
    )
  )
  return { settings, env }
}

async function getSession(owner: string, id: string, allowStopped = false) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("Invalid session ID")
  const { database, config } = hostedAuth()
  const result = await database.query<Session>("SELECT * FROM d3k_hosted_session WHERE id=$1 AND owner=$2", [id, owner])
  const session = result.rows[0]
  if (!session) throw new Error("Session not found")
  const project = selectedProject(config.projects, session.project)
  if (!allowStopped && (Number(session.expiresAt) <= Date.now() || session.phase === "stopped"))
    throw new Error("Session has stopped or expired; resume it with sandbox_start")
  return { session, project }
}

async function getSandbox(session: Session, project: HostedProject) {
  if (!session.sandbox) throw new Error("Sandbox is still being created; poll sandbox_status")
  return Sandbox.get({
    name: session.sandbox,
    token: hostedAuth().config.vercelToken,
    teamId: project.teamId,
    projectId: project.projectId
  })
}

async function bootstrap(session: Session, sandbox: Sandbox, project: HostedProject, recover = false) {
  const { settings, env } = await projectSettings(project)
  if (!session.workdir) {
    let root: string | undefined
    for (const cwd of [sandbox.cwd, path.posix.join(sandbox.cwd, settings.link.repo)]) {
      const git = await sandbox
        .runCommand({ cmd: "git", args: ["rev-parse", "--show-toplevel"], cwd })
        .catch(() => null)
      if (git?.exitCode === 0) {
        root = (await git.stdout()).trim()
        break
      }
    }
    if (!root) throw new Error("Could not locate the remote checkout")
    const workdir = path.posix.resolve(root, settings.rootDirectory || ".")
    if (workdir !== root && !workdir.startsWith(`${root}/`)) throw new Error("Project root escapes checkout")
    session.workdir = workdir
  }
  if (!recover) {
    const archive = await readFile(path.join(process.cwd(), "hosted-runtime/dev3000.tgz"))
    const directory = await sandbox.runCommand("mkdir", ["-p", "/tmp/d3k-tools"])
    if (directory.exitCode !== 0) throw new Error("Could not prepare sandbox tools")
    await sandbox.writeFiles([
      { path: "/tmp/d3k-tools/dev3000.tgz", content: archive },
      { path: "/tmp/d3k-tools/bootstrap.mjs", content: Buffer.from(cloudBootstrap) }
    ])
  }
  await sandbox.writeFiles([
    { path: "/tmp/d3k-cloud-state.json", content: Buffer.from(JSON.stringify({ phase: "starting" })) }
  ])
  const execution = await sandbox.runCommand({
    cmd: "node",
    args: ["/tmp/d3k-tools/bootstrap.mjs"],
    env,
    stdin: true,
    detached: true
  })
  await execution.writeStdin(
    JSON.stringify({
      workdir: session.workdir,
      command: settings.devCommand,
      installCommand: settings.installCommand,
      preview: preview(session, sandbox),
      unusedBridgeToken: randomBytes(32).toString("hex"),
      recover
    })
  )
  await execution.closeStdin()
  await hostedAuth().database.query("UPDATE d3k_hosted_session SET workdir=$1, phase=$2 WHERE id=$3", [
    session.workdir,
    "starting",
    session.id
  ])
}

/** Reserve capacity before any SDK call can start or auto-resume compute. */
async function reserveSession(session: Session, resume = false) {
  const { database } = hostedAuth()
  const client = await database.connect()
  try {
    await client.query("BEGIN")
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [session.owner])
    if (resume) {
      const current = await client.query<Session>("SELECT * FROM d3k_hosted_session WHERE id=$1 AND owner=$2", [
        session.id,
        session.owner
      ])
      if (!current.rows[0]) throw new Error("Session not found")
      Object.assign(session, current.rows[0])
      if (!["stopped", "failed"].includes(session.phase) && Number(session.expiresAt) > Date.now()) {
        await client.query("COMMIT")
        return false
      }
    }
    const active = await client.query(
      'SELECT count(*) FROM d3k_hosted_session WHERE owner=$1 AND "expiresAt">$2 AND phase NOT IN ($3,$4) AND id<>$5',
      [session.owner, Date.now(), "stopped", "failed", session.id]
    )
    if (Number(active.rows[0].count) >= 2)
      throw new Error("The hosted pilot allows two active workspaces; stop one first")
    session.expiresAt = Date.now() + 60 * 60000
    session.phase = resume ? "starting" : "creating"
    if (resume) {
      await client.query('UPDATE d3k_hosted_session SET "expiresAt"=$1,phase=$2 WHERE id=$3', [
        session.expiresAt,
        session.phase,
        session.id
      ])
    } else {
      await client.query(
        'INSERT INTO d3k_hosted_session (id,owner,project,"expiresAt",phase) VALUES ($1,$2,$3,$4,$5)',
        [session.id, session.owner, session.project, session.expiresAt, session.phase]
      )
    }
    await client.query("COMMIT")
    return true
  } catch (error) {
    await client.query("ROLLBACK")
    throw error
  } finally {
    client.release()
  }
}

export async function startCloudSession(owner: string, args: { project?: string; resume?: string }) {
  const { database, config } = hostedAuth()
  if (args.resume) {
    const { session, project } = await getSession(owner, args.resume, true)
    if (!(await reserveSession(session, true)))
      return { session: session.id, phase: session.phase, message: "Session already exists; use sandbox_status" }
    let sandbox: Sandbox | undefined
    try {
      sandbox = await getSandbox(session, project)
      await sandbox.update({ timeout: 60 * 60000 })
      await bootstrap(session, sandbox, project, true)
      return { session: session.id, phase: "starting" }
    } catch (error) {
      await database.query("UPDATE d3k_hosted_session SET phase=$1 WHERE id=$2", ["failed", session.id])
      await sandbox?.stop().catch(() => {})
      throw error
    }
  }
  const project = selectedProject(config.projects, args.project || "")
  const { settings } = await projectSettings(project)
  const repository = settings.link?.type === "github" ? `${settings.link.org}/${settings.link.repo}` : ""
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error("Project needs a linked public GitHub repository")
  const session: Session = {
    id: randomUUID(),
    owner,
    project: project.slug,
    sandbox: null,
    workdir: null,
    expiresAt: 0,
    phase: "creating"
  }
  await reserveSession(session)
  let sandbox: Sandbox | undefined
  try {
    sandbox = await Sandbox.create({
      token: config.vercelToken,
      teamId: project.teamId,
      projectId: project.projectId,
      runtime: "node24",
      ports: [3000],
      timeout: 60 * 60000,
      source: { type: "git", url: `https://github.com/${repository}.git` },
      tags: { "d3k-session": session.id }
    })
    session.sandbox = sandbox.name
    await database.query("UPDATE d3k_hosted_session SET sandbox=$1 WHERE id=$2", [sandbox.name, session.id])
    await bootstrap(session, sandbox, project)
    return { session: session.id, phase: "starting" }
  } catch (error) {
    await database.query("UPDATE d3k_hosted_session SET phase=$1 WHERE id=$2", ["failed", session.id])
    await sandbox?.stop().catch(() => {})
    throw error
  }
}

export async function callCloudSession(owner: string, name: string, args: Record<string, unknown>) {
  const { database } = hostedAuth()
  if (name === "sandbox_sessions") {
    const result = await database.query(
      'SELECT id AS session,project,phase,"expiresAt" FROM d3k_hosted_session WHERE owner=$1 ORDER BY "expiresAt" DESC LIMIT 30',
      [owner]
    )
    return result.rows
  }
  const { session, project } = await getSession(owner, String(args.session || ""), name === "sandbox_stop")
  const sandbox = await getSandbox(session, project)
  if (name === "sandbox_stop") {
    await sandbox.stop()
    await database.query("UPDATE d3k_hosted_session SET phase=$1 WHERE id=$2", ["stopped", session.id])
    return {
      session: session.id,
      phase: "stopped",
      resume: { tool: "sandbox_start", arguments: { resume: session.id } }
    }
  }
  if (name === "sandbox_status") {
    const bytes = await sandbox.readFileToBuffer({ path: "/tmp/d3k-cloud-state.json" }).catch(() => null)
    const state = bytes ? JSON.parse(bytes.toString()) : { phase: "starting" }
    let runtime: Record<string, unknown> | undefined
    if (state.phase === "ready") {
      const execution = await sandbox.runCommand({
        cmd: "node",
        args: [ENTRY, "status"],
        cwd: session.workdir || undefined
      })
      if (execution.exitCode === 0) runtime = JSON.parse(await execution.stdout())
      if (!runtime?.running || !runtime.ready) state.phase = "needs_recovery"
    }
    await database.query("UPDATE d3k_hosted_session SET phase=$1 WHERE id=$2", [String(state.phase), session.id])
    return {
      session: session.id,
      ...state,
      expiresAt: new Date(Number(session.expiresAt)).toISOString(),
      ...(state.phase === "ready" ? { preview: { url: sandboxPreviewLink(preview(session, sandbox)) } } : {}),
      ...(runtime
        ? {
            runtime: {
              running: runtime.running,
              ready: runtime.ready,
              sessionId: runtime.sessionId,
              cursor: runtime.cursor
            }
          }
        : {})
    }
  }
  if (name === "sandbox_recover") {
    const status = await sandbox.runCommand({ cmd: "node", args: [ENTRY, "status"], cwd: session.workdir || undefined })
    if (status.exitCode !== 0) throw new Error("Could not check runtime state before recovery")
    if (JSON.parse(await status.stdout()).running)
      throw new Error("Runtime is still running; inspect status before recovering")
    await bootstrap(session, sandbox, project, true)
    return {
      session: session.id,
      phase: "starting",
      message: "Poll sandbox_status; files and compute deadline are preserved"
    }
  }
  if (!session.workdir) throw new Error("Workspace is still starting")
  return workspaceHandler(sandbox, session.workdir)(name, args)
}
