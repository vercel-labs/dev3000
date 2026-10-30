import { execFileSync } from "node:child_process"
import { randomBytes } from "node:crypto"
import { readFileSync } from "node:fs"
import path from "node:path"
import { Sandbox } from "@vercel/sandbox"
import { cloudBootstrap } from "../www/lib/hosted/bootstrap"

// Explicit operator test: a NEW disposable VM, never an existing user's session.
const [slug] = process.argv.slice(2)
if (!slug || !/^[\w.-]+\/[\w.-]+$/.test(slug)) throw Error("Usage: bun scripts/hosted-mcp-smoke.ts <team/project>")
const [scope, project] = slug.split("/")
const settings = JSON.parse(
  execFileSync("vercel", ["api", `/v9/projects/${project}`, "--scope", scope, "--raw"], { encoding: "utf8" })
)
if (settings.link?.type !== "github") throw Error("Smoke test requires a public GitHub repository")
const projectId = settings.id
const teamId = settings.accountId
const token = JSON.parse(
  execFileSync("vercel", ["project", "token", projectId, "--scope", teamId, "--format", "json"], { encoding: "utf8" })
).token
const development = JSON.parse(
  execFileSync("vercel", ["api", `/v3/env/pull/${projectId}/development`, "--scope", teamId, "--raw"], {
    encoding: "utf8"
  })
)
const env = Object.fromEntries(
  Object.entries(development.env).filter(
    ([name, value]) =>
      typeof value === "string" &&
      !["VERCEL_OIDC_TOKEN", "VERCEL_TOKEN", "VERCEL_AUTH_TOKEN"].includes(name) &&
      !name.startsWith("D3K_HOSTED_")
  )
) as Record<string, string>
const sandbox = await Sandbox.create({
  token,
  projectId,
  teamId,
  runtime: "node24",
  timeout: 15 * 60000,
  ports: [3000],
  source: { type: "git", url: `https://github.com/${settings.link.org}/${settings.link.repo}.git` }
})
console.log(JSON.stringify({ phase: "created", sandbox: sandbox.name }))
try {
  const root = await sandbox.runCommand({ cmd: "git", args: ["rev-parse", "--show-toplevel"], cwd: sandbox.cwd })
  if (root.exitCode !== 0) throw Error("Could not locate checkout")
  const checkout = (await root.stdout()).trim()
  const workdir = path.posix.resolve(checkout, settings.rootDirectory || ".")
  if (workdir !== checkout && !workdir.startsWith(`${checkout}/`)) throw Error("Invalid project root")
  await sandbox.runCommand("mkdir", ["-p", "/tmp/d3k-tools"])
  await sandbox.writeFiles([
    { path: "/tmp/d3k-tools/dev3000.tgz", content: readFileSync("www/hosted-runtime/dev3000.tgz") },
    { path: "/tmp/d3k-tools/bootstrap.mjs", content: Buffer.from(cloudBootstrap) }
  ])
  const preview = {
    origin: new URL(sandbox.domain(3000)).origin,
    token: randomBytes(32).toString("hex"),
    expiresAt: Date.now() + 14 * 60000
  }
  const launch = async (recover = false) => {
    await sandbox.writeFiles([
      { path: "/tmp/d3k-cloud-state.json", content: Buffer.from(JSON.stringify({ phase: "starting" })) }
    ])
    const execution = await sandbox.runCommand({
      cmd: "node",
      args: ["/tmp/d3k-tools/bootstrap.mjs"],
      stdin: true,
      env,
      detached: true
    })
    await execution.writeStdin(
      JSON.stringify({
        workdir,
        preview,
        command: settings.devCommand,
        installCommand: settings.installCommand,
        unusedBridgeToken: randomBytes(32).toString("hex"),
        recover
      })
    )
    await execution.closeStdin()
    const deadline = Date.now() + 10 * 60000
    let ready = false
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10000))
      const bytes = await sandbox.readFileToBuffer({ path: "/tmp/d3k-cloud-state.json" }).catch(() => null)
      const state = bytes ? JSON.parse(bytes.toString()) : { phase: "starting" }
      console.log(JSON.stringify(state))
      if (state.phase === "failed") throw Error("Cloud startup failed")
      if (state.phase === "ready") {
        ready = true
        break
      }
    }
    if (!ready) throw Error("Cloud startup timed out")
  }
  await launch()
  const entry = "/tmp/d3k-tools/node_modules/dev3000/dist/runtime/cli.js"
  const browser = await sandbox.runCommand({ cmd: "node", args: [entry, "browser", "snapshot", "-i"], cwd: workdir })
  const snapshot = await browser.stdout()
  if (browser.exitCode !== 0 || !snapshot.includes("link")) throw Error("Cloud browser did not render the project")
  const denied = await fetch(preview.origin)
  if (denied.status !== 403) throw Error("Unauthenticated preview was not denied")
  const auth = await fetch(`${preview.origin}/.d3k/preview/authorize`, {
    method: "POST",
    headers: { Origin: preview.origin, "Content-Type": "text/plain" },
    body: preview.token
  })
  const cookie = auth.headers.get("set-cookie")?.split(";")[0]
  if (auth.status !== 204 || !cookie) throw Error("Preview credential exchange failed")
  const page = await fetch(preview.origin, { headers: { Cookie: cookie } })
  if (page.status !== 200) throw Error(`Authenticated preview returned ${page.status}`)
  // Verify edits survive both runtime recovery and a stopped compute session.
  const marker = `.d3k-smoke-${randomBytes(8).toString("hex")}`
  await sandbox.writeFiles([{ path: path.posix.join(workdir, marker), content: Buffer.from("remote edit") }])
  const stopped = await sandbox.runCommand({ cmd: "node", args: [entry, "stop"], cwd: workdir })
  if (stopped.exitCode !== 0) throw Error("Could not stop runtime for recovery test")
  await launch(true)
  await sandbox.stop()
  await sandbox.runCommand({ cmd: "true" }) // SDK resumes this sandbox from its saved filesystem.
  preview.origin = new URL(sandbox.domain(3000)).origin
  preview.token = randomBytes(32).toString("hex")
  await launch(true)
  const saved = await sandbox.readFileToBuffer({ path: path.posix.join(workdir, marker) })
  if (saved?.toString() !== "remote edit") throw Error("Remote edits were lost on resume")
  const resumedBrowser = await sandbox.runCommand({
    cmd: "node",
    args: [entry, "browser", "snapshot", "-i"],
    cwd: workdir
  })
  if (resumedBrowser.exitCode !== 0 || !(await resumedBrowser.stdout()).includes("link"))
    throw Error("Browser did not reconnect after resume")
  console.log(
    JSON.stringify({
      phase: "passed",
      cloudBrowser: true,
      recoveredAndResumed: true,
      unauthenticatedStatus: denied.status,
      previewStatus: page.status,
      snapshot: snapshot.slice(0, 1000)
    })
  )
} finally {
  await sandbox.stop()
  console.log(JSON.stringify({ phase: "stopped", sandbox: sandbox.name }))
}
