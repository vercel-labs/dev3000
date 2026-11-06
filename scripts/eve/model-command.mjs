import { EVE_MODEL, EVE_MODELS, MODEL_HEADER, resolveModel } from "./settings.mjs"

/** Kept by the launcher across local UI detaches; transmitted with the next request. */
export class ModelSelection {
  constructor(initial = process.env.D3K_EVE_MODEL_ID || EVE_MODEL) {
    this.current = resolveModel(initial)
  }
  headers() {
    return { [MODEL_HEADER]: this.current.id }
  }
  select(value) {
    this.current = resolveModel(value)
    return `${this.describe()}\nSelected for subsequent model calls; conversation history is retained.`
  }
  describe() {
    return `Configured model: ${this.current.id}\nReasoning: ${this.current.reasoning}`
  }
  list() {
    return `${this.describe()}\n${EVE_MODELS.map((model) => `/model ${model.aliases[0]} — ${model.label}`).join("\n")}`
  }
}
