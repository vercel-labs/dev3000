import { getValidAccessToken } from "@/lib/auth"
import { DEV3000_API_URL } from "@/lib/constants"

function isLocalWorkflowHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase()
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1"
}

export function getWorkflowApiBaseUrl(): string {
  return process.env.DEV3000_API_URL || DEV3000_API_URL
}

export function shouldProxyWorkflowRequest(request: Request): boolean {
  if (process.env.DEV3000_FORCE_LOCAL_WORKFLOW_RUNTIME === "1") {
    return false
  }

  return isLocalWorkflowHost(new URL(request.url).hostname)
}

export async function proxyWorkflowRequest(request: Request): Promise<Response> {
  const requestUrl = new URL(request.url)
  const targetUrl = new URL(requestUrl.pathname + requestUrl.search, getWorkflowApiBaseUrl())
  const headers = new Headers(request.headers)

  headers.delete("host")
  headers.delete("content-length")

  if (!headers.has("authorization")) {
    const accessToken = await getValidAccessToken()
    if (accessToken) {
      headers.set("authorization", `Bearer ${accessToken}`)
    }
  }

  headers.set("x-dev3000-local-proxy", "1")

  const upstreamResponse = await fetch(targetUrl, {
    method: request.method,
    headers,
    body: request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer(),
    redirect: "manual"
  })

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers: upstreamResponse.headers
  })
}
