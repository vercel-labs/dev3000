import { execFileSync, spawn } from "node:child_process"
import { randomBytes } from "node:crypto"
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { expect, it, vi } from "vitest"
import { connectCompanion } from "./bridge.js"
import { callSandboxGithub } from "./sandbox-github.js"
import { runSandboxCli } from "./sandbox-process.js"

async function freePort() {
  const server = createServer()
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const port = (server.address() as { port: number }).port
  await new Promise<void>((resolve) => server.close(() => resolve()))
  return port
}

it("routes the source CLI through the sandbox runtime and companion to local repository-scoped gh", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "d3k-github-proof-")))
  const runtimeSource = fileURLToPath(new URL("./runtime.ts", import.meta.url))
  const helper = fileURLToPath(new URL("../../skills/d3k/scripts/runtime.mjs", import.meta.url))
  const capture = join(root, "local-gh.jsonl")
  writeFileSync(
    join(root, "app.cjs"),
    "require('node:http').createServer((q,s)=>s.end('ok')).listen(process.env.PORT,'127.0.0.1')"
  )
  writeFileSync(
    join(root, "gh"),
    `#!/usr/bin/env node
const fs=require('node:fs');
let input='';process.stdin.on('data',c=>input+=c);process.stdin.on('end',()=>{
fs.appendFileSync(${JSON.stringify(capture)},JSON.stringify({args:process.argv.slice(2),input})+'\\n');
const fixture=${JSON.stringify(join(root, "publish-responses.json"))};
if(fs.existsSync(fixture)) {
  const data=JSON.parse(fs.readFileSync(fixture,'utf8'));
  const args=process.argv.slice(2), method=args[4], path=args[5].replace('repos/owner/linked-project','');
  let response=data.responses[method+' '+path];
  if(method==='GET' && path.startsWith('/git/matching-refs/')) response=data.refs;
  if(method==='GET' && path.startsWith('/pulls?')) response=data.pulls;
  if(method==='POST' && path==='/git/refs') {const b=JSON.parse(input);data.refs=[{ref:b.ref,object:{sha:b.sha}}];response={};}
  if(method==='POST' && path==='/pulls') {data.pulls=[data.pull];response=data.pull;}
  if(response===undefined) {process.stderr.write('Unexpected request '+method+' '+path);process.exitCode=1;return;}
  fs.writeFileSync(fixture,JSON.stringify(data));
  process.stdout.write(JSON.stringify(response));
} else process.stdout.write(JSON.stringify({number:123,head:{ref:'feature'}}));});
`,
    { mode: 0o700 }
  )
  const bridgePort = await freePort()
  const proxyPort = await freePort()
  const token = randomBytes(32).toString("hex")
  // The VM-side fixture is spawned before installing the laptop-only gh fixture on PATH.
  const env = { ...process.env, D3K_DATA_DIR: join(root, "discovery") }
  const child = spawn(
    "bun",
    [
      "-e",
      `import {startRuntime} from ${JSON.stringify(runtimeSource)};
await startRuntime(${JSON.stringify({
        cwd: root,
        serversOnly: true,
        startupTimeout: 10000,
        command: `'${process.execPath.replaceAll("'", "'\\''")}' app.cjs`,
        sandbox: { appUrl: "https://fixture.d3k.localhost", serverPort: proxyPort, bridgePort, token }
      })});`
    ],
    { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] }
  )
  let output = ""
  child.stdout.on("data", (chunk) => {
    output += chunk
  })
  child.stderr.on("data", (chunk) => {
    output += chunk
  })
  const exited = new Promise((resolve) => child.once("exit", resolve))
  let connected = false
  // Only the laptop side sees this fake gh. It never contacts GitHub.
  vi.stubEnv("PATH", `${root}:${process.env.PATH}`)
  const companion = connectCompanion({
    url: `ws://127.0.0.1:${bridgePort}/bridge`,
    token,
    chromePort: 1,
    allowLoopback: true,
    onState: (state) => {
      connected = state
    },
    github: (args, signal) => callSandboxGithub("owner/linked-project", args, { cwd: root, signal })
  })
  const cli = (args: string[], input?: string) =>
    runSandboxCli(process.execPath, [helper, ...args], { cwd: root, env, input, timeoutMs: 15000 })
  try {
    const deadline = Date.now() + 10000
    while (!connected || !output.includes('"ready":true')) {
      if (child.exitCode !== null || Date.now() > deadline) throw new Error(`Runtime fixture failed: ${output}`)
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    const body = { title: "Fixture", head: "feature", base: "main", body: "Fixture only", draft: true }
    expect(JSON.parse(await cli(["github", "POST", "/pulls", "--input", "-"], JSON.stringify(body)))).toMatchObject({
      number: 123
    })
    const call = JSON.parse(readFileSync(capture, "utf8").trim())
    expect(call).toEqual({
      args: ["api", "--hostname", "github.com", "--method", "POST", "repos/owner/linked-project/pulls", "--input", "-"],
      input: JSON.stringify(body)
    })
    await expect(cli(["github", "GET", "https://evil.example/pulls"])).rejects.toThrow("repo-relative")
    await expect(cli(["github", "PATCH", "/git/refs/heads/feature", "--input", "-"], '{"force":true}')).rejects.toThrow(
      "Force pushes"
    )
    expect(readFileSync(capture, "utf8").trim().split("\n")).toHaveLength(1)
    // Exercise the new command end-to-end through source CLI, Unix socket, WSS
    // companion and laptop-only gh. The VM-side CLI still has no GitHub credentials.
    const git = (...args: string[]) =>
      execFileSync("git", args, {
        cwd: root,
        env: {
          ...env,
          GIT_AUTHOR_NAME: "Fixture",
          GIT_AUTHOR_EMAIL: "fixture@example.com",
          GIT_COMMITTER_NAME: "Fixture",
          GIT_COMMITTER_EMAIL: "fixture@example.com",
          GIT_AUTHOR_DATE: "1793942187 +0000",
          GIT_COMMITTER_DATE: "1793942187 +0000"
        }
      })
        .toString()
        .trim()
    git("init", "-b", "main")
    writeFileSync(join(root, "page"), "before\n")
    git("add", "page")
    git("-c", "commit.gpgsign=false", "commit", "-m", "Base")
    const baseSha = git("rev-parse", "HEAD")
    git("checkout", "-b", "codex/publish-fixture")
    writeFileSync(join(root, "page"), "after\n")
    git("add", "page")
    git("-c", "commit.gpgsign=false", "commit", "-m", "Update page")
    const headSha = git("rev-parse", "HEAD")
    writeFileSync(join(root, "pr.md"), "Verified fixture.\n")
    writeFileSync(
      join(root, "publish-responses.json"),
      JSON.stringify({
        responses: {
          "GET /git/ref/heads/main": { object: { sha: baseSha } },
          "POST /git/blobs": { sha: git("rev-parse", "HEAD:page") },
          "POST /git/trees": { sha: git("rev-parse", "HEAD^{tree}") },
          "POST /git/commits": { sha: headSha }
        },
        refs: [],
        pulls: [],
        pull: {
          number: 124,
          html_url: "https://github.com/owner/linked-project/pull/124",
          head: { ref: "codex/publish-fixture", repo: { full_name: "owner/linked-project" } },
          base: { ref: "main", repo: { full_name: "owner/linked-project" } }
        }
      })
    )
    const publishArgs = ["publish", "--base", "main", "--title", "Update page", "--body-file", "pr.md"]
    const published = JSON.parse(await cli(publishArgs))
    expect(published).toMatchObject({ number: 124, sha: headSha })
    const publishCalls = readFileSync(capture, "utf8")
      .trim()
      .split("\n")
      .slice(1)
      .map((line) => JSON.parse(line))
    expect(JSON.parse(publishCalls.find((call) => call.args[5].endsWith("/git/commits")).input).message).toBe(
      "Update page\n"
    )
    expect(
      JSON.parse(publishCalls.find((call) => call.args[5].endsWith("/pulls") && call.args[4] === "POST").input)
    ).toMatchObject({ draft: true, body: "Verified fixture.\n" })
    expect(JSON.parse(await cli(publishArgs))).toEqual(published)
    const repeated = readFileSync(capture, "utf8")
      .trim()
      .split("\n")
      .slice(1 + publishCalls.length)
      .map((line) => JSON.parse(line))
    expect(repeated.every((call) => call.args[4] === "GET")).toBe(true)
    companion.close()
    while (connected) await new Promise((resolve) => setTimeout(resolve, 10))
    await expect(cli(["github", "GET", "/pulls"])).rejects.toThrow("companion connected")
  } finally {
    companion.close()
    vi.unstubAllEnvs()
    child.kill("SIGTERM")
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 2000))])
    if (child.exitCode === null) {
      child.kill("SIGKILL")
      await exited
    }
    rmSync(root, { recursive: true, force: true })
  }
}, 25000)
