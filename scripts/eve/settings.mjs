export const EVE_VERSION = "1.0.0-rc.6"
// The launcher intentionally pins the requested current RC. Keep the host's
// package-age policy for all other dependencies; do not modify global config.
export const EVE_INSTALL_CONFIG = '[install]\nminimumReleaseAgeExcludes = ["eve"]\n'

// Validated against AI Gateway's public model catalogue: image input and tool use.
export const EVE_MODELS = [
  {
    id: "anthropic/claude-haiku-5.5",
    label: "Claude Haiku 5.5",
    aliases: ["haiku"],
    reasoning: "none",
    context: 1000000
  },
  { id: "google/gemini-3.8-flash", label: "Gemini 3.8 Flash", aliases: ["flash"], reasoning: "low", context: 1000000 },
  { id: "openai/gpt-5.4-mini", label: "GPT 5.4 Mini", aliases: ["mini"], reasoning: "none", context: 400000 },
  {
    id: "anthropic/claude-sonnet-4.6",
    label: "Claude Sonnet 4.6",
    aliases: ["sonnet"],
    reasoning: "none",
    context: 1000000
  }
]
export const EVE_MODEL = "anthropic/claude-haiku-5.5"
export const MODEL_HEADER = "x-d3k-eve-model"

export function resolveModel(value = EVE_MODEL) {
  const selected = value === "fast" ? EVE_MODEL : value.toLowerCase()
  const model = EVE_MODELS.find((model) => model.id === selected || model.aliases.includes(selected))
  if (!model) throw new Error(`Unknown model: ${value}. Use /model to see available models.`)
  return model
}
