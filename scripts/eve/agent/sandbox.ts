import { stat } from "node:fs/promises"
import { defineSandbox } from "eve/sandbox"
import { defineSandboxProvider } from "eve/sandbox/provider"
import { connect } from "../connection.mjs"

const ExistingCheckout = defineSandboxProvider({
  name: "d3k-existing-checkout",
  environment() {
    const root = process.env.D3K_EVE_WORKDIR
    if (!root) throw new Error("Set D3K_EVE_WORKDIR to the existing sandbox checkout")
    if (process.env.D3K_EVE_ISOLATED_HOST !== "1")
      throw new Error("This provider must run inside an already isolated host")
    return {
      async prepare(ctx) {
        // This provider intentionally has no template. Do not populate over the user's checkout.
        if (!ctx.isEmpty) throw new Error("Use the existing checkout; authored sandbox seed files are unsupported")
        return { version: 1 }
      },
      async start() {
        if (!(await stat(root)).isDirectory()) throw new Error("The checkout is missing")
        return { connection: connect(root), state: { root } }
      },
      async resume(_ctx, _artifact, state) {
        if (state.root !== root) throw new Error("Refusing to move a conversation to another checkout")
        if (!(await stat(root)).isDirectory()) throw new Error("The original checkout is missing")
        return connect(root)
      },
      async onSessionEnd() {}
    }
  }
})

export const environment = ExistingCheckout.environment()
export default defineSandbox(() => environment.open())
