import { execFile } from "node:child_process"
import { readFile, stat } from "node:fs/promises"
import { basename, extname, join } from "node:path"
import { createInterface } from "node:readline"
import { pathToFileURL } from "node:url"
import { parseArgs, promisify, stripVTControlCharacters } from "node:util"
import { ModelSelection } from "./model-command.mjs"

export async function eveClient() {
  const root = process.env.D3K_EVE_PACKAGE_ROOT
  return import(root ? pathToFileURL(join(root, "dist/src/client/index.js")).href : "eve/client")
}

export function pendingInteractions(snapshot) {
  const result = new Map()
  for (const message of snapshot.messages) {
    for (const part of message.parts) {
      const interaction = part.type === "interaction" ? part : part.interaction
      if (interaction?.status === "open" && !interaction.answer) result.set(interaction.interactionId, interaction)
    }
  }
  return [...result.values()]
}

export async function imageAttachment(path) {
  const types = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" }
  const mediaType = types[extname(path).toLowerCase()]
  if (!mediaType) throw new Error("Attach a PNG, JPEG, or WebP image")
  if ((await stat(path)).size > 3 * 1024 * 1024) throw new Error("Image must be at most 3 MiB")
  return { type: "file", mediaType, filename: basename(path), data: await readFile(path) }
}

export async function clipboardImage() {
  if (process.platform !== "darwin") throw new Error("Use /attach <path> on this platform")
  // Read only on an explicit image paste (Ctrl+V or /paste). Never take a screenshot.
  const { stdout } = await promisify(execFile)("osascript", ["-e", "get the clipboard as «class PNGf»"], {
    maxBuffer: 7 * 1024 * 1024,
    timeout: 5000
  })
  const hex = /^«data PNGf([a-f\d]+)»\s*$/i.exec(stdout)?.[1]
  if (!hex || hex.length % 2 || hex.length > 6 * 1024 * 1024)
    throw new Error("Clipboard must contain a PNG image of at most 3 MiB")
  return { type: "file", mediaType: "image/png", filename: "clipboard.png", data: Buffer.from(hex, "hex") }
}

export async function runClient({
  baseUrl,
  token,
  sessionId,
  signal,
  readClipboard = clipboardImage,
  models = new ModelSelection()
}) {
  if (signal?.aborted) return
  const url = new URL(baseUrl)
  if (url.protocol !== "https:" && !(url.protocol === "http:" && url.hostname === "127.0.0.1"))
    throw new Error("Use HTTPS, or loopback HTTP for the local fixture")
  if (!token) throw new Error("Set D3K_EVE_TOKEN; do not put credentials in command arguments")
  if (process.stdin.isTTY && process.stdout.isTTY && process.env.D3K_EVE_PLAIN_CLIENT !== "1") {
    const { runTuiClient } = await import("./tui-client.mjs")
    return runTuiClient({ baseUrl, token, sessionId, readClipboard, models, signal })
  }
  const { Client, SessionStore } = await eveClient()
  const client = new Client({ baseUrl, auth: { bearer: token }, headers: () => models.headers() })
  // Get a fixed identity before accepting input. Reconnection never resends a prompt.
  const session = sessionId ? client.sessions.attach(sessionId) : (await client.sessions.create()).session
  const store = new SessionStore({ client, session })
  const input = createInterface({ input: process.stdin, output: process.stdout })
  input.pause()
  const seen = new Set()
  let attachments = []
  let lastError
  let onKeypress
  let acceptingInput = true
  const clean = (text) =>
    [...stripVTControlCharacters(text)]
      .filter((character) => {
        const code = character.codePointAt(0)
        return (code >= 32 && code !== 127) || character === "\n" || character === "\t"
      })
      .join("")
  const print = (text) => {
    process.stdout.write(`\n${clean(text)}\n`)
    input.prompt(true)
  }
  const render = () => {
    const snapshot = store.snapshot
    if (snapshot.error && snapshot.error !== lastError) {
      lastError = snapshot.error
      print(`Connection/session error: ${snapshot.error.message}. No prompt was automatically retried.`)
    }
    for (const message of snapshot.messages) {
      for (const [index, part] of message.parts.entries()) {
        const key = `${message.id}:${index}`
        if (part.type === "text" && part.state !== "streaming" && !seen.has(key)) {
          seen.add(key)
          print(`${message.role}: ${part.text}`)
        }
        if (part.type === "tool" && !seen.has(`${key}:${part.state}`)) {
          seen.add(`${key}:${part.state}`)
          print(`${part.label || part.name} (${part.state})`)
        }
      }
    }
    for (const interaction of pendingInteractions(snapshot)) {
      const key = `interaction:${interaction.interactionId}`
      if (seen.has(key)) continue
      seen.add(key)
      print(
        `${interaction.request.prompt}\nID: ${interaction.interactionId}\n` +
          (interaction.call ? `${interaction.call.name}: ${JSON.stringify(interaction.call.input)}\n` : "") +
          (interaction.request.options || []).map((option) => `${option.id}: ${option.label}`).join("\n") +
          `\nReply: /answer ${interaction.interactionId} <option ID or text>`
      )
    }
  }
  const unsubscribe = store.subscribe(render)
  const release = store.observe()
  const stop = () => {
    acceptingInput = false
    release()
    input.close()
  }
  const closed = new Promise((resolve) => input.once("close", resolve))
  process.on("SIGTERM", stop)
  input.on("SIGINT", stop)
  signal?.addEventListener("abort", stop, { once: true })
  if (signal?.aborted) stop()
  try {
    if (!acceptingInput) return
    print(
      `Eve session: ${session.id}\nReconnect: --session ${session.id}\n/detach leaves the agent running; /cancel stops its turn.\nCtrl+V attaches a clipboard image; /attach <path> also works. Send a message to upload it.`
    )
    await store.resume()
    if (!acceptingInput) return
    input.setPrompt("eve> ")
    print(`${models.current.label} · /model to change`)
    input.prompt()
    const queueImage = (image) => {
      if (!acceptingInput) return
      if (attachments.length >= 4) throw new Error("Send the queued images before attaching more")
      attachments.push(image)
      print(`Attached ${image.filename}; send a message to upload it.`)
    }
    // readline owns local editing. HTTP traffic starts only on submitted input.
    const handleLine = async (line) => {
      if (signal?.aborted) return
      try {
        if (line === "/detach" || line === "/exit") return stop()
        if (line === "/model" || line.startsWith("/model ")) {
          const argument = line.slice(6).trim()
          print(
            !argument || argument === "list"
              ? models.list()
              : argument === "current"
                ? models.describe()
                : models.select(argument)
          )
        } else if (line === "/cancel") await store.cancel()
        else if (line.startsWith("/attach ") || line === "/paste") {
          queueImage(line === "/paste" ? await readClipboard() : await imageAttachment(line.slice(8).trim()))
        } else if (line.startsWith("/answer ")) {
          const [, id, value] = /^\/answer\s+(\S+)\s+([\s\S]+)$/.exec(line) || []
          const interaction = pendingInteractions(store.snapshot).find((entry) => entry.interactionId === id)
          if (!interaction) throw new Error("That request is no longer pending")
          const option = interaction.request.options?.find((entry) => entry.id === value)
          if (!option && !interaction.request.allowFreeform && interaction.request.display !== "text")
            throw new Error("Choose one of the displayed option IDs")
          await store.send({
            signal,
            answers: [{ interactionId: id, ...(option ? { optionId: option.id } : { text: value }) }]
          })
        } else if (line.trim()) {
          const message = attachments.length ? [{ type: "text", text: line }, ...attachments] : line
          // Do not replay an uncertain POST. Preserve attachments so the user can inspect/retry deliberately.
          await store.send({ message, signal })
          attachments = []
        }
      } catch (error) {
        if (acceptingInput) print(error.message)
      }
      input.prompt()
    }
    let commands = Promise.resolve()
    input.on("line", (line) => {
      commands = commands.then(() => acceptingInput && handleLine(line))
    })
    // readline emits keypresses locally in a terminal. Queue clipboard reads with
    // submitted lines so pressing Enter immediately after Ctrl+V includes the image.
    // Preserve the draft/cursor; no extra Enter or slash command is needed.
    onKeypress = (_text, key) => {
      if (!key?.ctrl || key.name !== "v" || key.meta || key.shift || !acceptingInput) return
      // readline's default handler may insert the control byte before emitting
      // to this listener. Remove only that byte, preserving the surrounding draft.
      if (input.line[input.cursor - 1] === "\u0016") {
        input.line = input.line.slice(0, input.cursor - 1) + input.line.slice(input.cursor)
        input.cursor--
        input.prompt(true)
      }
      commands = commands.then(async () => {
        if (!acceptingInput) return
        try {
          queueImage(await readClipboard())
        } catch (error) {
          if (acceptingInput) print(error.message)
        }
      })
    }
    if (process.stdin.isTTY) process.stdin.on("keypress", onKeypress)
    input.resume()
    await closed
  } catch (error) {
    if (!signal?.aborted) throw error
  } finally {
    acceptingInput = false
    if (onKeypress) process.stdin.off("keypress", onKeypress)
    release()
    unsubscribe()
    process.off("SIGTERM", stop)
    signal?.removeEventListener("abort", stop)
    input.close()
    if (!signal?.aborted) console.log(`Detached from ${session.id}. Remote execution was not cancelled.`)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values } = parseArgs({ options: { session: { type: "string" } } })
  await runClient({ baseUrl: process.env.D3K_EVE_URL, token: process.env.D3K_EVE_TOKEN, sessionId: values.session })
}
