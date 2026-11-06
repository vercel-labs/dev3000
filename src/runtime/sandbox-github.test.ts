import { spawn } from "node:child_process"
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
process.stdout.write(JSON.stringify({number:123,head:{ref:'feature'}}));});
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
