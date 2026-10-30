import { timingSafeEqual } from "node:crypto"
import type { IncomingMessage, ServerResponse } from "node:http"

const PATH = "/.d3k/preview"
const COOKIE = "__Host-d3k-preview"

export interface SandboxPreview {
  origin: string
  token: string
  expiresAt: number
}

export function sandboxPreviewLink(preview: SandboxPreview): string {
  const origin = new URL(preview.origin)
  if (
    origin.protocol !== "https:" ||
    origin.origin !== preview.origin ||
    !/^[a-f0-9]{64}$/.test(preview.token) ||
    !Number.isSafeInteger(preview.expiresAt)
  )
    throw new Error("Invalid sandbox preview configuration")
  return `${origin.origin}${PATH}#${preview.token}`
}

function equal(value: string | undefined, token: string): boolean {
  return !!value && /^[a-f0-9]{64}$/.test(value) && timingSafeEqual(Buffer.from(value), Buffer.from(token))
}

/** A separate capability grants app access only; never reuse the CDP or companion credential. */
export function sandboxPreview(preview: SandboxPreview) {
  sandboxPreviewLink(preview)
  const host = new URL(preview.origin).host
  const active = () => Date.now() < preview.expiresAt
  const validHost = (request: IncomingMessage) => request.headers.host === host
  return {
    authorized(request: IncomingMessage): boolean {
      if (!active() || !validHost(request)) return false
      const cookies = (request.headers.cookie || "").split(";").map((part) => part.trim())
      const matches = cookies.filter((cookie) => cookie.startsWith(`${COOKIE}=`))
      if (matches.length !== 1 || !equal(matches[0].slice(COOKIE.length + 1), preview.token)) return false
      // Cookie-authenticated WebSockets and mutations must come from this preview origin.
      if (request.headers.upgrade || !["GET", "HEAD", "OPTIONS"].includes(request.method || ""))
        return request.headers.origin === preview.origin
      return !request.headers.origin || request.headers.origin === preview.origin
    },
    stripCookie(cookie: string | undefined): string | undefined {
      return (
        cookie
          ?.split(";")
          .filter((part) => !part.trim().startsWith(`${COOKIE}=`))
          .join(";") || undefined
      )
    },
    handle(request: IncomingMessage, response: ServerResponse): boolean {
      const path = request.url?.split("?")[0]
      if (path !== PATH && path !== `${PATH}/authorize`) return false
      response.setHeader("cache-control", "no-store")
      response.setHeader("referrer-policy", "no-referrer")
      response.setHeader("x-content-type-options", "nosniff")
      if (!active() || !validHost(request)) {
        response.writeHead(403).end("Preview expired or unavailable")
        return true
      }
      if (path === PATH && request.method === "GET") {
        response.setHeader("content-type", "text/html; charset=utf-8")
        response.setHeader(
          "content-security-policy",
          "default-src 'none'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"
        )
        // Fragments never reach HTTP servers or Referer headers. Remove before any other request.
        response.end(`<!doctype html><meta name="viewport" content="width=device-width"><title>d3k preview</title><p id="status">Opening preview…</p><script>
const token = location.hash.slice(1);
history.replaceState(null, '', location.pathname);
fetch('${PATH}/authorize', {method:'POST', headers:{'Content-Type':'text/plain'}, body:token})
  .then(response => { if (!response.ok) throw Error(); location.replace('/'); })
  .catch(() => { document.getElementById('status').textContent = 'Preview link expired or invalid. Ask d3k for a new session link.'; });
</script>`)
        return true
      }
      if (path !== `${PATH}/authorize` || request.method !== "POST" || request.headers.origin !== preview.origin) {
        response.writeHead(403).end("Forbidden")
        return true
      }
      let body = ""
      let oversized = false
      request.on("data", (chunk) => {
        if (oversized) return
        body += chunk.toString()
        if (Buffer.byteLength(body) > 64) {
          oversized = true
          body = ""
          response.writeHead(413).end("Invalid preview credential")
        }
      })
      request.on("end", () => {
        if (oversized) return
        if (!active() || !equal(body, preview.token)) {
          response.writeHead(403).end("Invalid or expired preview link")
          return
        }
        const seconds = Math.max(0, Math.floor((preview.expiresAt - Date.now()) / 1000))
        response.setHeader(
          "set-cookie",
          `${COOKIE}=${preview.token}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${seconds}`
        )
        response.writeHead(204).end()
      })
      return true
    }
  }
}
