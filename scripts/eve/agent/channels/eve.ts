import { timingSafeEqual } from "node:crypto"
import { eveChannel } from "eve/channels/eve"
import { EVE_MODEL, EVE_MODELS, MODEL_HEADER } from "../../settings.mjs"

export default eveChannel({
  auth(request) {
    const token = process.env.D3K_EVE_TOKEN
    if (!token || token.length < 32) throw new Error("Configure a random per-sandbox D3K_EVE_TOKEN")
    const expiresAt = Number(process.env.D3K_EVE_EXPIRES_AT)
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null
    const expected = Buffer.from(`Bearer ${token}`)
    const supplied = Buffer.from(request.headers.get("authorization") || "")
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null
    const model = request.headers.get(MODEL_HEADER) || EVE_MODEL
    if (!EVE_MODELS.some((candidate) => candidate.id === model)) return null
    return {
      authenticator: "d3k-sandbox",
      principalId: "owner",
      principalType: "user",
      attributes: { d3kModel: model }
    }
  }
})
