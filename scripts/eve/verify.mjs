import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { randomBytes } from "node:crypto"
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import { fileURLToPath, pathToFileURL } from "node:url"
import { eveClient, imageAttachment, pendingInteractions } from "./client.mjs"
import { connect } from "./connection.mjs"
import { EVE_INSTALL_CONFIG, EVE_MODEL, EVE_VERSION, MODEL_HEADER } from "./settings.mjs"

const source = dirname(fileURLToPath(import.meta.url))
const root = await mkdtemp(join(tmpdir(), "d3k-eve-proof-"))
const workspace = join(root, "checkout")
const token = randomBytes(32).toString("hex")
let server
const output = []
const env = {
  ...process.env,
  D3K_EVE_WORKDIR: workspace,
  D3K_EVE_MODEL_ID: EVE_MODEL,
  // The fixture is deliberately allowed to operate on its temporary local checkout.
  D3K_EVE_ISOLATED_HOST: "1",
  D3K_EVE_TOKEN: token,
  D3K_EVE_EXPIRES_AT: String(Date.now() + 10 * 60000),
  EVE_SCHEDULES_DISABLED: "1"
}
for (const key of ["AI_GATEWAY_API_KEY", "VERCEL_TOKEN", "VERCEL_AUTH_TOKEN", "VERCEL_OIDC_TOKEN"]) delete env[key]

async function run(command, args, options = {}) {
  const child = spawn(command, args, { cwd: root, env, stdio: ["ignore", "pipe", "pipe"], ...options })
  let text = ""
  child.stdout?.on("data", (chunk) => {
    text += chunk
  })
  child.stderr?.on("data", (chunk) => {
    text += chunk
  })
  const timer = setTimeout(() => child.kill("SIGKILL"), 120000)
  try {
    await new Promise((resolve, reject) => {
      child.once("error", reject)
      child.once("exit", (code) =>
        code === 0 ? resolve() : reject(new Error(`${command} failed (${code}): ${text.slice(-4000)}`))
      )
    })
    return text
  } finally {
    clearTimeout(timer)
  }
}

async function stopServer() {
  if (!server || server.exitCode !== null) return
  const stopped = new Promise((resolve) => server.once("exit", resolve))
  // eve start supervises a child; terminate the entire fixture process group.
  process.kill(-server.pid, "SIGTERM")
  await Promise.race([stopped, delay(5000)])
  try {
    process.kill(-server.pid, "SIGKILL")
  } catch (error) {
    if (error.code !== "ESRCH") throw error
  }
  server = undefined
}

try {
  await mkdir(workspace)
  await cp(join(source, "agent"), join(root, "agent"), { recursive: true })
  // Use the launcher's shared connected-session skill, generated from source.
  const connected = await run("bun", [
    "-e",
    `
    import {harnessStartupContext} from ${JSON.stringify(join(source, "../../src/runtime/harness.ts"))};
    console.log(harnessStartupContext(${JSON.stringify({ workdir: workspace, appUrl: "https://fixture.d3k.localhost" })}));
  `
  ])
  const instructionsFile = join(root, "agent/instructions.md")
  await writeFile(instructionsFile, `${await readFile(instructionsFile, "utf8")}\n\n${connected}`)
  await cp(join(source, "connection.mjs"), join(root, "connection.mjs"))
  await cp(join(source, "settings.mjs"), join(root, "settings.mjs"))
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({
      private: true,
      type: "module",
      engines: { node: ">=24" },
      dependencies: { eve: EVE_VERSION, ai: "7.0.159", zod: "4.6.7" }
    })
  )
  if (process.env.D3K_EVE_PACKAGE_ROOT) {
    await symlink(dirname(process.env.D3K_EVE_PACKAGE_ROOT), join(root, "node_modules"))
  } else {
    console.log("Installing pinned Eve fixture dependencies in a temporary directory…")
    await writeFile(join(root, "bunfig.toml"), EVE_INSTALL_CONFIG)
    await run("bun", ["add", "--exact", `eve@${EVE_VERSION}`, "ai@7.0.159", "zod@4.6.7"])
    process.env.D3K_EVE_PACKAGE_ROOT = join(root, "node_modules/eve")
  }
  const { version } = JSON.parse(await readFile(join(root, "node_modules/eve/package.json"), "utf8"))
  assert.equal(version, EVE_VERSION, "Revalidate the contract before upgrading Eve")
  const eve = join(root, "node_modules/eve/bin/eve.js")
  console.log("Checking the real-agent scaffold builds without model credentials…")
  await run(process.execPath, [eve, "build"])
  await cp(join(source, "fixture-agent.ts"), join(root, "agent/agent.ts"))
  console.log("Building the real Eve service with the existing-checkout provider…")
  await run(process.execPath, [eve, "build"])
  const portServer = createServer()
  await new Promise((resolve) => portServer.listen(0, "127.0.0.1", resolve))
  const port = portServer.address().port
  await new Promise((resolve) => portServer.close(resolve))
  const baseUrl = `http://127.0.0.1:${port}`
  async function startServer() {
    server = spawn(process.execPath, [eve, "start", "--host", "127.0.0.1", "--port", String(port), "--no-schedules"], {
      cwd: root,
      env,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"]
    })
    server.stdout.on("data", (chunk) => output.push(chunk.toString()))
    server.stderr.on("data", (chunk) => output.push(chunk.toString()))
    for (let attempt = 0; attempt < 100; attempt++) {
      if (
        await fetch(`${baseUrl}/eve/v1/health`)
          .then((response) => response.ok)
          .catch(() => false)
      )
        return
      if (server.exitCode !== null) throw new Error(output.join("").slice(-5000))
      await delay(100)
    }
    throw new Error("Eve service did not become healthy")
  }
  await startServer()
  const { Client, SessionStore } = await eveClient()
  const client = new Client({ baseUrl, auth: { bearer: token } })
  const request = {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: "denied" })
  }
  assert.equal((await fetch(`${baseUrl}/eve/v1/session`, request)).status, 401)
  console.log("PASS: unauthenticated session creation rejected")

  const context = await client.sessions.create({ message: "context-case" })
  const contextResult = await context.delivery.result({ signal: AbortSignal.timeout(20000) })
  assert.equal(contextResult.status, "completed")
  assert.equal(contextResult.reply, "CONTEXT_READY")
  console.log(
    "PASS: Eve's model receives the shared d3k skill, exact remote checkout/URL, and UI verification instructions"
  )

  // A real separate client process exits while the tool is running.
  const detachCode = `
    import {Client} from ${JSON.stringify(pathToFileURL(join(root, "node_modules/eve/dist/src/client/index.js")).href)};
    const client=new Client({baseUrl:process.env.PROOF_URL,auth:{bearer:process.env.D3K_EVE_TOKEN}});
    const {session}=await client.sessions.create({message:'disconnect-case'});
    const signal=new AbortController();
    for await(const event of session.stream({signal:signal.signal})) {
      if(event.type==='call.started') { console.log(session.id);signal.abort();break; }
    }
  `
  const sessionId = (
    await run(process.execPath, ["--input-type=module", "-e", detachCode], { env: { ...env, PROOF_URL: baseUrl } })
  ).trim()
  assert.ok(sessionId.startsWith("wrun_"))
  // There is no client observing this period. Poll the filesystem, not the session stream.
  for (let attempt = 0; attempt < 100; attempt++) {
    if ((await readFile(join(workspace, "proof.txt"), "utf8").catch(() => "")) === "completed") break
    await delay(100)
  }
  assert.equal(await readFile(join(workspace, "proof.txt"), "utf8"), "completed")
  const store = new SessionStore({ client, initialSession: { sessionId, streamIndex: 0 } })
  const release = store.observe()
  try {
    await store.resume()
    assert.equal(store.snapshot.session.sessionId, sessionId)
    assert.equal(store.snapshot.events.filter((event) => event.type === "delivery.admitted").length, 1)
    assert.ok(store.snapshot.messages.some((message) => message.role === "assistant"))
    // No unauthenticated history reads or continuation, either.
    for (const [method, suffix] of [
      ["GET", "/stream"],
      ["POST", ""]
    ])
      assert.equal(
        (
          await fetch(`${baseUrl}/eve/v1/session/${sessionId}${suffix}`, {
            ...request,
            method,
            body: method === "GET" ? undefined : request.body
          })
        ).status,
        401
      )
  } finally {
    release()
  }
  console.log("PASS: command finished after client exit; same conversation replayed with one admitted prompt")

  const approval = await client.sessions.create({ message: "approval-case" })
  const waiting = await approval.delivery.result({ signal: AbortSignal.timeout(20000) })
  assert.equal(waiting.status, "awaiting-input")
  const waitingId = approval.session.id
  assert.equal(await readFile(join(workspace, "approval.txt"), "utf8").catch(() => "missing"), "missing")
  if (process.env.D3K_EVE_TEST_RESTART === "1") {
    await stopServer()
    await startServer()
    console.log("Replaying the pending approval after server restart…")
  }
  const resumed = new SessionStore({ client, initialSession: { sessionId: waitingId, streamIndex: 0 } })
  const releaseApproval = resumed.observe()
  try {
    await resumed.resume()
    const pending = pendingInteractions(resumed.snapshot)
    assert.equal(pending.length, 1)
    assert.equal(pending[0].request.kind, "approval")
    const approve = pending[0].request.options.find((option) => option.id === "approve")
    assert.ok(approve)
    const accepted = await resumed.send({
      answers: [{ interactionId: pending[0].interactionId, optionId: approve.id }]
    })
    console.log("Approval answer accepted; waiting for the tool…")
    assert.equal((await accepted.result({ signal: AbortSignal.timeout(60000) })).status, "completed")
    assert.equal(await readFile(join(workspace, "approval.txt"), "utf8"), "approved")
  } finally {
    releaseApproval()
  }
  console.log("PASS: new client recovered the pending approval; answering ran its tool once")

  const imagePath = join(root, "pixel.png")
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
    "base64"
  )
  await writeFile(imagePath, png)
  const image = await client.sessions.create({
    message: [{ type: "text", text: "Inspect this local image" }, await imageAttachment(imagePath)]
  })
  const imageResult = await image.delivery.result({ signal: AbortSignal.timeout(20000) })
  assert.equal(imageResult.status, "completed")
  assert.match(imageResult.reply, /IMAGE_RECEIVED/)
  console.log("PASS: local PNG uploaded and reached Eve's model as image content")

  const terminal = spawn(process.execPath, [join(source, "client.mjs"), "--session", image.session.id], {
    cwd: root,
    env: { ...env, D3K_EVE_URL: baseUrl, D3K_EVE_PACKAGE_ROOT: process.env.D3K_EVE_PACKAGE_ROOT },
    stdio: ["pipe", "pipe", "pipe"]
  })
  let terminalOutput = ""
  terminal.stdout.on("data", (chunk) => {
    terminalOutput += chunk
  })
  terminal.stderr.on("data", (chunk) => {
    terminalOutput += chunk
  })
  const terminalExited = new Promise((resolve) => terminal.once("exit", resolve))
  async function terminalShows(predicate) {
    for (let attempt = 0; attempt < 200; attempt++) {
      if (predicate(terminalOutput)) return
      if (terminal.exitCode !== null) break
      await delay(50)
    }
    throw new Error(`Local client did not reach the expected state: ${terminalOutput.slice(-3000)}`)
  }
  try {
    await terminalShows((text) => text.includes("eve> "))
    terminal.stdin.write("/model\n")
    await terminalShows((text) => text.includes(`Configured model: ${EVE_MODEL}`))
    terminal.stdin.write(`/attach ${imagePath}\nInspect this second image\n`)
    await terminalShows((text) => text.split("IMAGE_RECEIVED").length >= 3)
    terminal.stdin.write("/detach\n")
    assert.equal(await Promise.race([terminalExited, delay(5000).then(() => "timeout")]), 0)
    const history = await image.session.snapshot()
    assert.equal(history.events.filter((event) => event.type === "delivery.admitted").length, 2)
  } finally {
    terminal.stdin.end()
    if (terminal.exitCode === null) terminal.kill("SIGKILL")
  }
  console.log("PASS: local terminal reattached, uploaded an image, and detached without a new conversation")

  // Exercise readline's real terminal key parser without reading or changing the
  // user's clipboard. A delayed synthetic clipboard also checks paste/Enter order.
  const keyboard = await client.sessions.create()
  const keyboardCode = `
    import {runClient,imageAttachment} from ${JSON.stringify(pathToFileURL(join(source, "client.mjs")).href)};
    Object.defineProperty(process.stdin,'isTTY',{value:true});
    Object.defineProperty(process.stdout,'isTTY',{value:true});
    await runClient({baseUrl:process.env.PROOF_URL,token:process.env.D3K_EVE_TOKEN,sessionId:process.env.PROOF_SESSION,
      readClipboard:async()=>{await new Promise(resolve=>setTimeout(resolve,100));return imageAttachment(process.env.PROOF_IMAGE);}});
  `
  const keyboardTerminal = spawn(process.execPath, ["--input-type=module", "-e", keyboardCode], {
    cwd: root,
    env: {
      ...env,
      D3K_EVE_PACKAGE_ROOT: process.env.D3K_EVE_PACKAGE_ROOT,
      D3K_EVE_PLAIN_CLIENT: "1",
      PROOF_URL: baseUrl,
      PROOF_SESSION: keyboard.session.id,
      PROOF_IMAGE: imagePath
    },
    stdio: ["pipe", "pipe", "pipe"]
  })
  let keyboardOutput = ""
  keyboardTerminal.stdout.on("data", (chunk) => {
    keyboardOutput += chunk
  })
  keyboardTerminal.stderr.on("data", (chunk) => {
    keyboardOutput += chunk
  })
  const keyboardExited = new Promise((resolve) => keyboardTerminal.once("exit", resolve))
  async function keyboardShows(text) {
    for (let attempt = 0; attempt < 200; attempt++) {
      if (keyboardOutput.includes(text)) return
      if (keyboardTerminal.exitCode !== null) break
      await delay(50)
    }
    throw new Error(`Keyboard paste did not reach ${text}: ${keyboardOutput.slice(-3000)}`)
  }
  try {
    await keyboardShows("eve> ")
    // Draft text exists before the paste, and Enter arrives before clipboard read completes.
    keyboardTerminal.stdin.write("Inspect this \u0016keyboard image\r")
    await keyboardShows("Attached pixel.png")
    await keyboardShows("IMAGE_RECEIVED")
    keyboardTerminal.stdin.write("/detach\r")
    assert.equal(await Promise.race([keyboardExited, delay(5000).then(() => "timeout")]), 0)
    const keyboardStore = new SessionStore({
      client,
      initialSession: { sessionId: keyboard.session.id, streamIndex: 0 }
    })
    const releaseKeyboard = keyboardStore.observe()
    try {
      await keyboardStore.resume()
      assert.equal(keyboardStore.snapshot.events.filter((event) => event.type === "delivery.admitted").length, 1)
      const draft = keyboardStore.snapshot.messages.find((message) => message.role === "user")
      assert.equal(draft.parts.find((part) => part.type === "text").text.split("\n")[0], "Inspect this keyboard image")
    } finally {
      releaseKeyboard()
    }
  } finally {
    keyboardTerminal.stdin.end()
    if (keyboardTerminal.exitCode === null) keyboardTerminal.kill("SIGKILL")
  }
  console.log("PASS: Ctrl+V attached an image, preserved the draft, and included it when Enter arrived immediately")

  // Run Eve's real renderer and key parser, with synthetic terminal/clipboard IO.
  const cleanShotPath = join(root, "Application Support", "CleanShot 2026-11-05 at 09.52.33@2x.png")
  await mkdir(dirname(cleanShotPath))
  await writeFile(cleanShotPath, png)
  const { imagePaths } = await import("./images.mjs")
  const escapedPath = cleanShotPath.replaceAll(" ", "\\ ")
  assert.equal(imagePaths(escapedPath)[0].path, cleanShotPath)
  assert.equal(imagePaths(`"${cleanShotPath}"`)[0].path, cleanShotPath)
  assert.equal(imagePaths(pathToFileURL(cleanShotPath).href)[0].path, cleanShotPath)
  const nativeCode = `
    import {runTuiClient} from ${JSON.stringify(pathToFileURL(join(source, "tui-client.mjs")).href)};
    import {imageAttachment} from ${JSON.stringify(pathToFileURL(join(source, "client.mjs")).href)};
    Object.defineProperty(process.stdin,'isTTY',{value:true});
    Object.defineProperty(process.stdout,'isTTY',{value:true});
    process.stdout.columns=100;process.stdout.rows=30;
    await runTuiClient({baseUrl:process.env.PROOF_URL,token:process.env.D3K_EVE_TOKEN,sessionId:process.env.PROOF_SESSION,
      signal:process.env.PROOF_EXPIRE_MS ? AbortSignal.timeout(Number(process.env.PROOF_EXPIRE_MS)) : undefined,
      readClipboard:async()=>{await new Promise(resolve=>setTimeout(resolve,100));return imageAttachment(process.env.PROOF_IMAGE);}});
    console.log('NATIVE_CLIENT_CLOSED');
  `
  async function nativeTerminal(sessionId, expireMs) {
    const child = spawn(process.execPath, ["--input-type=module", "-e", nativeCode], {
      cwd: root,
      env: {
        ...env,
        TERM: "xterm-256color",
        D3K_EVE_PACKAGE_ROOT: process.env.D3K_EVE_PACKAGE_ROOT,
        PROOF_URL: baseUrl,
        PROOF_SESSION: sessionId,
        ...(expireMs ? { PROOF_EXPIRE_MS: String(expireMs) } : {}),
        PROOF_IMAGE: imagePath
      },
      stdio: ["pipe", "pipe", "pipe"]
    })
    let output = ""
    child.stdout.on("data", (chunk) => {
      output += chunk
    })
    child.stderr.on("data", (chunk) => {
      output += chunk
    })
    const exited = new Promise((resolve) => child.once("exit", resolve))
    async function shows(text) {
      for (let attempt = 0; attempt < 300; attempt++) {
        if (output.includes(text)) return
        if (child.exitCode !== null) break
        await delay(50)
      }
      throw new Error(`Native Eve UI did not show ${text}: ${output.slice(-5000)}`)
    }
    return { child, shows, exited }
  }
  for (const mode of ["composer", "model picker"]) {
    const { session } = await client.sessions.create()
    const ui = await nativeTerminal(session.id, 2500)
    try {
      await ui.shows("Paste an image")
      if (mode === "model picker") {
        await delay(150)
        ui.child.stdin.write("/model\r")
        await ui.shows("Choose model")
      }
      assert.equal(await Promise.race([ui.exited, delay(5000).then(() => "timeout")]), 0)
      await ui.shows("NATIVE_CLIENT_CLOSED")
      const history = await session.snapshot()
      assert.equal(history.events.filter((event) => event.type === "delivery.admitted").length, 0)
    } finally {
      if (ui.child.exitCode === null) ui.child.kill("SIGKILL")
    }
    console.log(`PASS: expiry closed native Eve's ${mode} without admitting any prompt`)
  }
  for (const paste of ["path", "clipboard", "unframed"]) {
    const { session } = await client.sessions.create()
    const ui = await nativeTerminal(session.id)
    try {
      await ui.shows("Paste an image")
      await delay(150)
      ui.child.stdin.write("/model current\r")
      await ui.shows(`Configured model: ${EVE_MODEL}`)
      await delay(50)
      if (paste === "path") {
        ui.child.stdin.write("Inspect this \x1b[20")
        await delay(5)
        ui.child.stdin.write(`0~${escapedPath}\x1b[201~`)
        await ui.shows("[Image #1]")
        ui.child.stdin.write("\r")
      } else if (paste === "clipboard") {
        ui.child.stdin.write("Inspect this \x16keyboard image\r")
      } else {
        ui.child.stdin.write(`Inspect this ${escapedPath}\r`)
      }
      await ui.shows("IMAGE_RECEIVED")
      ui.child.stdin.write("/detach\r")
      assert.equal(await Promise.race([ui.exited, delay(5000).then(() => "timeout")]), 0)
      const replay = new SessionStore({ client, initialSession: { sessionId: session.id, streamIndex: 0 } })
      const releaseReplay = replay.observe()
      try {
        await replay.resume()
        assert.equal(replay.snapshot.events.filter((event) => event.type === "delivery.admitted").length, 1)
        const message = replay.snapshot.messages.find((message) => message.role === "user")
        const prompt = message.parts.find((part) => part.type === "text").text
        assert.ok(prompt.includes("[Image #1]"))
        assert.ok(!prompt.includes(root), "Laptop path must not reach the remote agent")
      } finally {
        releaseReplay()
      }
      // Reattach the native UI to the same conversation and see its prior result.
      const reconnect = await nativeTerminal(session.id)
      try {
        await reconnect.shows("IMAGE_RECEIVED")
        await delay(150)
        reconnect.child.stdin.write("/detach\r")
        assert.equal(await Promise.race([reconnect.exited, delay(5000).then(() => "timeout")]), 0)
      } finally {
        if (reconnect.child.exitCode === null) reconnect.child.kill("SIGKILL")
      }
    } finally {
      if (ui.child.exitCode === null) ui.child.kill("SIGKILL")
    }
    console.log(
      `PASS: native Eve UI ${paste} paste delivered image bytes, hid the laptop path, and replayed the same session`
    )
  }
  // Switching is authenticated request metadata, never model-interpreted text.
  const switched = await client.sessions.create()
  const switchUi = await nativeTerminal(switched.session.id)
  try {
    await switchUi.shows("Paste an image")
    await delay(150)
    switchUi.child.stdin.write("/model\r")
    await switchUi.shows("Choose model")
    switchUi.child.stdin.write("\x1b[B\x1b[B\r") // Mini, the third picker entry.
    await switchUi.shows("Configured model: openai/gpt-5.4-mini")
    await delay(50)
    switchUi.child.stdin.write("model-case\r")
    await switchUi.shows("MODEL_USED:openai/gpt-5.4-mini")
    switchUi.child.stdin.write("/model haiku\r")
    await switchUi.shows("Configured model: anthropic/claude-haiku-5.5")
    await delay(50)
    switchUi.child.stdin.write("model-case again\r")
    await switchUi.shows("MODEL_USED:anthropic/claude-haiku-5.5")
    switchUi.child.stdin.write("/detach\r")
    assert.equal(await Promise.race([switchUi.exited, delay(5000).then(() => "timeout")]), 0)
    const history = await switched.session.snapshot()
    assert.equal(history.events.filter((event) => event.type === "delivery.admitted").length, 2)
    const invalid = new Client({ baseUrl, auth: { bearer: token }, headers: { [MODEL_HEADER]: "unlisted/model" } })
    await assert.rejects(() => invalid.sessions.create())
  } finally {
    if (switchUi.child.exitCode === null) switchUi.child.kill("SIGKILL")
  }
  console.log(
    "PASS: native picker and /model alias changed the remote model in the same conversation; unlisted models rejected"
  )

  const nativeApproval = await client.sessions.create({ message: "approval-case" })
  assert.equal((await nativeApproval.delivery.result({ signal: AbortSignal.timeout(20000) })).status, "awaiting-input")
  const approvalUi = await nativeTerminal(nativeApproval.session.id)
  try {
    await approvalUi.shows("y yes")
    approvalUi.child.stdin.write("y")
    await approvalUi.shows("The remote task finished.")
    await delay(150)
    approvalUi.child.stdin.write("/detach\r")
    assert.equal(await Promise.race([approvalUi.exited, delay(5000).then(() => "timeout")]), 0)
    assert.equal(await readFile(join(workspace, "approval.txt"), "utf8"), "approvedapproved")
  } finally {
    if (approvalUi.child.exitCode === null) approvalUi.child.kill("SIGKILL")
  }
  console.log("PASS: Eve's native approval panel authorized the pending tool exactly once")

  // Exercise the byte-level provider's process cancellation, including a child that ignores TERM.
  const connection = connect(workspace)
  const controller = new AbortController()
  const processHandle = await connection.spawn({
    command: "trap '' TERM; printf ready; sleep 60",
    env: {},
    workingDirectory: workspace,
    signal: controller.signal
  })
  const reader = processHandle.stdout.getReader()
  await reader.read()
  controller.abort()
  await assert.rejects(async () => await processHandle.wait(), /terminated/)
  console.log("PASS: cancellation terminates the command process group")
  console.log(
    "Verified Eve's transport, provider, client reconnect, approval and image paths. No model credentials, browser, or Vercel resources used."
  )
} catch (error) {
  console.error(output.join("").slice(-6000))
  throw error
} finally {
  await stopServer()
  if (process.env.D3K_EVE_KEEP_FIXTURE === "1") console.log(`Fixture retained: ${root}`)
  else await rm(root, { recursive: true, force: true })
}
