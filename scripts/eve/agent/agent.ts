import { defineAgent } from "eve"
import { defineDynamic } from "eve/models"
import { resolveModel } from "../settings.mjs"

export default defineAgent({
  // The authenticated client selects the model; ordinary tools have no extra approval gate.
  model: defineDynamic((ctx) => {
    const requested = ctx.session.auth.current?.attributes.d3kModel
    const selected = resolveModel(typeof requested === "string" ? requested : undefined)
    return { model: selected.id, reasoning: selected.reasoning, modelContextWindowTokens: selected.context }
  })
})
