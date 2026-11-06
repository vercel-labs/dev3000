// Deterministic model for transport verification. Never used by the real scaffold.
import { MockLanguageModelV4, simulateReadableStream } from "ai/test"
import { defineAgent } from "eve"
import { defineDynamic } from "eve/models"
import { resolveModel } from "../settings.mjs"

export default defineAgent({
  approval: ({ toolInput }) => (String(toolInput?.command).includes("approval.txt") ? "user-approval" : undefined),
  model: defineDynamic((ctx) => {
    const requested = ctx.session.auth.current?.attributes.d3kModel
    const selected = resolveModel(typeof requested === "string" ? requested : undefined)
    return {
      model: new MockLanguageModelV4({
        // Eve needs known context-window metadata even for a test model.
        provider: "openai",
        modelId: "gpt-5.4",
        doStream: async ({ prompt, tools }) => {
          const image = prompt.some(
            (message) =>
              Array.isArray(message.content) &&
              message.content.some(
                (part) => part.type === "file" && part.mediaType === "image/png" && part.data.type === "data"
              )
          )
          const historyCase = /remember-case|recall-case/.test(JSON.stringify(prompt))
          const remembered = JSON.stringify(prompt).includes("remember-case")
          const modelCase = JSON.stringify(prompt).includes("model-case")
          const contextCase = JSON.stringify(prompt).includes("context-case")
          if (contextCase) {
            const system = prompt
              .filter((message) => message.role === "system")
              .map((message) => message.content)
              .join("\n")
            for (const required of [
              process.env.D3K_EVE_WORKDIR,
              "https://fixture.d3k.localhost",
              "/tmp/d3k-tools/node_modules/.bin/d3k-runtime browser snapshot -i",
              "After a user-visible UI change",
              "## Pull requests",
              "without another confirmation",
              "untracked artifacts",
              "already running"
            ])
              if (!system.includes(required)) throw new Error(`Connected-session context missing: ${required}`)
          }
          const finished = prompt.some((message) => message.role === "tool")
          const approval = JSON.stringify(prompt).includes("approval-case")
          const bash = tools?.find((tool) => tool.name === "bash")
          const reply = contextCase
            ? "CONTEXT_READY"
            : historyCase
              ? remembered
                ? "HISTORY_PRESENT"
                : "HISTORY_MISSING"
              : modelCase
                ? `MODEL_USED:${selected.id}`
                : image
                  ? "IMAGE_RECEIVED"
                  : "The remote task finished."
          const command = approval ? "printf approved >> approval.txt" : "sleep 2; printf completed >> proof.txt"
          const chunks =
            finished || image || modelCase || contextCase || historyCase || !bash
              ? [
                  { type: "text-start", id: "reply" },
                  { type: "text-delta", id: "reply", delta: reply },
                  { type: "text-end", id: "reply" }
                ]
              : [
                  {
                    type: "tool-call",
                    toolCallId: "fixture-command",
                    toolName: bash.name,
                    input: JSON.stringify({ command })
                  }
                ]
          return {
            stream: simulateReadableStream({
              chunks: [
                ...chunks,
                {
                  type: "finish",
                  finishReason: {
                    unified: finished || image || modelCase || contextCase || historyCase ? "stop" : "tool-calls",
                    raw: finished || image || modelCase || contextCase || historyCase ? "stop" : "tool_calls"
                  },
                  usage: {
                    inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
                    outputTokens: { total: 1, text: 1, reasoning: 0 }
                  }
                }
              ],
              chunkDelayInMs: 10
            })
          }
        }
      }),
      modelContextWindowTokens: selected.context,
      reasoning: selected.reasoning
    }
  })
})
