import { randomBytes } from "node:crypto"
import { verifyOAuthQueryParams } from "@better-auth/oauth-provider"
import { hostedAuth } from "./auth"

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

export async function authPage(request: Request, consent: boolean): Promise<Response> {
  const { auth, config } = hostedAuth()
  const url = new URL(request.url)
  if (url.origin !== config.origin || !(await verifyOAuthQueryParams(url.search.slice(1), config.secret)))
    return new Response("Invalid or expired authorization request. Reconnect d3k from your client.", { status: 400 })
  if (consent) {
    const session = await auth.api.getSession({ headers: request.headers })
    if (!session) return new Response("Please restart sign-in from your MCP client.", { status: 401 })
  }
  const nonce = randomBytes(20).toString("base64")
  const content = consent
    ? `<p>Allow client <code>${escapeHtml(url.searchParams.get("client_id") || "")}</code> to use your d3k workspaces?</p><p>This includes running commands, reading and editing code, and testing with the sandbox browser.</p><p>Requested scopes: ${escapeHtml(url.searchParams.get("scope") || "")}</p><button id="continue">Allow</button> <button id="deny">Deny</button>`
    : '<p>Connect your Vercel account to the private d3k hosted pilot.</p><button id="continue">Sign in with Vercel</button>'
  const endpoint = consent ? "oauth2/consent" : "sign-in/social"
  const body = consent
    ? "{accept, oauth_query:location.search.slice(1)}"
    : "{provider:'vercel', callbackURL:'/mcp/connected', oauth_query:location.search.slice(1)}"
  return new Response(
    `<!doctype html><meta name="viewport" content="width=device-width"><title>Connect d3k</title><style nonce="${nonce}">body{background:#111;color:#eee;font:16px system-ui;max-width:640px;margin:10vh auto;padding:24px}button{font:inherit;padding:10px 16px;cursor:pointer}code{overflow-wrap:anywhere}p{line-height:1.5}</style><h1>Connect d3k</h1>${content}<p id="status" role="status"></p><script nonce="${nonce}">
async function proceed(accept) {
  document.querySelectorAll('button').forEach(b=>b.disabled=true);
  try {
    const r=await fetch('/api/mcp-auth/${endpoint}',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(${body})});
    const data=await r.json();
    if(!r.ok || !data.url) throw Error();
    location.assign(data.url);
  } catch { document.getElementById('status').textContent='Could not connect. Restart authorization from your MCP client.'; }
}
document.getElementById('continue').onclick=()=>proceed(true);
const deny=document.getElementById('deny');if(deny)deny.onclick=()=>proceed(false);
</script>`,
    {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`
      }
    }
  )
}
