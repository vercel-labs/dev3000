import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { clipboardImage, eveClient, imageAttachment, pendingInteractions } from "./client.mjs"
import { Images } from "./images.mjs"
import { ModelSelection } from "./model-command.mjs"
import { EVE_MODELS } from "./settings.mjs"
import { ImageInput } from "./tui-input.mjs"

// These are pinned Eve internals. Use Eve's actual renderer, not a recreation of
// its look. Keep the fixed-session transport adapter small and verify on upgrades.
export async function nativeTui() {
  const root = process.env.D3K_EVE_PACKAGE_ROOT
  if (!root) throw new Error("The Eve launcher must provide its pinned package directory")
  const load = (file) => import(pathToFileURL(join(root, "dist/src/cli/dev/tui", file)).href)
  const [{ TerminalRenderer }, views, { PROMPT_COMMANDS }] = await Promise.all([
    load("terminal-renderer.js"),
    load("conversation-view.js"),
    load("prompt-commands.js")
  ])
  return { TerminalRenderer, ...views, PROMPT_COMMANDS }
}

export async function runTuiClient({
  baseUrl,
  token,
  sessionId,
  signal,
  readClipboard = clipboardImage,
  rendererFactory,
  models = new ModelSelection()
}) {
  if (signal?.aborted) return
  const { Client, SessionStore } = await eveClient()
  const { TerminalRenderer, conversationView, tuiSessionData, PROMPT_COMMANDS } = await nativeTui()
  const client = new Client({ baseUrl, auth: { bearer: token }, headers: () => models.headers() })
  const session = sessionId ? client.sessions.attach(sessionId) : (await client.sessions.create()).session
  const store = new SessionStore({ client, session, followAgents: true })
  const images = new Images(imageAttachment)
  let renderer
  let closed = false
  let reading
  let failure
  const answered = new Set()
  const pending = () => pendingInteractions(store.snapshot).filter((entry) => !answered.has(entry.interactionId))
  const input = new ImageInput(process.stdin, images, readClipboard, (error) =>
    renderer?.renderError("Image paste", error.message)
  )
  const close = () => {
    closed = true
    reading?.abort()
    renderer?.requestInterrupt()
  }
  const commands = PROMPT_COMMANDS.filter((command) =>
    ["cancel", "compact", "help", "exit", "model"].includes(command.name)
  )
  commands.push({
    name: "detach",
    aliases: [],
    description: "Leave the agent running and return to reconnect",
    takesArgument: false,
    history: "omit",
    build: () => ({ type: "exit" })
  })
  renderer = rendererFactory
    ? rendererFactory({ input, close })
    : new TerminalRenderer({
        input,
        output: process.stdout,
        captureForeignOutput: false,
        tools: "auto-collapsed",
        reasoning: "auto-collapsed",
        availablePromptCommands: commands,
        onExitRequest: close
      })
  renderer.setSessionId(session.id)
  const render = () => {
    if (closed) return
    const snapshot = store.snapshot
    renderer.renderConversation(conversationView(snapshot, tuiSessionData(snapshot)))
    if (snapshot.error && snapshot.error !== failure) {
      failure = snapshot.error
      renderer.renderError("Connection", `${failure.message}. No message was automatically retried.`)
    }
    if (input.mode === "composer" && pending().length) reading?.abort()
  }
  const unsubscribe = store.subscribe(render)
  const release = store.observe()
  const stop = () => {
    close()
    release()
  }
  process.on("SIGTERM", close)
  signal?.addEventListener("abort", stop, { once: true })
  if (signal?.aborted) stop()
  try {
    if (closed) return
    const info = await client
      .info({ signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(5000)]) : AbortSignal.timeout(5000) })
      .catch(() => undefined)
    if (closed) return
    renderer.renderAgentHeader({ name: "eve · d3k", serverUrl: baseUrl, ...(info ? { info } : {}) })
    renderer.renderNotice(`${models.current.label} · /model to change`)
    renderer.renderNotice(
      "Paste an image or image path into the composer. Ctrl+V reads the clipboard. /detach reconnects later in this launch."
    )
    await store.resume()
    render()
    while (!closed && !renderer.exitRequested()) {
      const interaction = pending()[0]
      reading = new AbortController()
      try {
        if (interaction) {
          input.mode = "approval"
          let answer
          if (interaction.request.kind === "approval") {
            const response = await renderer.readToolApproval(
              {
                approvalId: interaction.interactionId,
                toolCallId: interaction.call?.callId || interaction.interactionId,
                toolName: interaction.call?.name || "tool",
                prompt: interaction.request.prompt,
                input: interaction.call?.input
              },
              { signal: reading.signal }
            )
            answer = { interactionId: interaction.interactionId, optionId: response.approved ? "approve" : "deny" }
          } else {
            const response = await renderer.readInputQuestion(
              {
                requestId: interaction.interactionId,
                prompt: interaction.request.prompt,
                display: interaction.request.display === "text" ? "text" : "select",
                options: interaction.request.options,
                allowFreeform: interaction.request.allowFreeform
              },
              { signal: reading.signal }
            )
            if (response) answer = { interactionId: interaction.interactionId, ...response }
          }
          if (answer && !closed) {
            answered.add(interaction.interactionId)
            try {
              await store.send({ answers: [answer], signal })
            } catch (error) {
              answered.delete(interaction.interactionId)
              throw error
            }
          } else if (!closed) answered.add(interaction.interactionId)
          continue
        }
        input.mode = "composer"
        const action = await renderer.readInput({ title: "eve · d3k", signal: reading.signal })
        if (!action || closed) continue
        if (action.type === "cancel") {
          await store.cancel()
          continue
        }
        if (action.type === "interrupt") break
        const text = action.text.trim()
        if (["/detach", "/exit", "/quit"].includes(text)) break
        if (text === "/cancel") {
          await store.cancel()
          continue
        }
        if (text === "/compact") {
          await store.compact()
          continue
        }
        if (text === "/model" || text.startsWith("/model ")) {
          const argument = text.slice(6).trim()
          if (!argument) {
            input.mode = "approval"
            const response = await renderer.readInputQuestion(
              {
                requestId: "d3k-model",
                prompt: `Choose model (current: ${models.current.label})`,
                display: "select",
                options: EVE_MODELS.map((model) => ({ id: model.id, label: model.label })),
                allowFreeform: false
              },
              { signal: reading.signal }
            )
            if (response?.optionId && !closed) renderer.renderNotice(models.select(response.optionId))
          } else
            renderer.renderNotice(
              argument === "current" ? models.describe() : argument === "list" ? models.list() : models.select(argument)
            )
          continue
        }
        if (text === "/help") {
          renderer.renderNotice(
            "Paste image paths normally or press Ctrl+V for a clipboard image. /model, /detach, /cancel, /compact. Approve tools with the keyboard panel."
          )
          continue
        }
        if (text === "/paste") {
          renderer.restoreDraft(images.add(await readClipboard()))
          continue
        }
        if (text.startsWith("/attach ")) {
          renderer.restoreDraft(images.add(await imageAttachment(text.slice(8).trim())))
          continue
        }
        if (!text) continue
        // Fallback for terminals that split an unframed file-path paste across reads.
        const prompt = await images.replacePaths(text)
        if (closed) break
        try {
          await store.send({ message: images.message(prompt), signal })
          images.clear()
        } catch (error) {
          renderer.restoreDraft(prompt)
          throw error
        }
      } catch (error) {
        if (error.name === "InterruptedError") break
        if (!closed && error.name !== "AbortError" && !reading.signal.aborted)
          renderer.renderError("Eve", error.message)
      } finally {
        reading = undefined
      }
    }
  } catch (error) {
    if (!signal?.aborted) throw error
  } finally {
    closed = true
    input.close()
    release()
    unsubscribe()
    process.off("SIGTERM", close)
    signal?.removeEventListener("abort", stop)
    renderer.shutdown()
  }
}
