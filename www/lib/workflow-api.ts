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

async function fetchProxiedWorkflowRequest(request: Request): Promise<Response> {
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

  return fetch(targetUrl, {
    method: request.method,
    headers,
    body: request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer(),
    redirect: "manual"
  })
}

function getProxyResponseHeaders(upstreamHeaders: Headers, bodyByteLength?: number): Headers {
  const headers = new Headers(upstreamHeaders)

  // The fetch runtime may transparently decode compressed upstream bodies.
  // If we forward the original encoding/length headers, browsers will try to
  // decode an already-decoded payload and fail with ERR_CONTENT_DECODING_FAILED.
  headers.delete("content-encoding")
  if (typeof bodyByteLength === "number") {
    headers.set("content-length", String(bodyByteLength))
  } else {
    headers.delete("content-length")
  }
  headers.delete("transfer-encoding")

  return headers
}

function getForwardedJsonHeaders(upstreamHeaders: Headers): Headers {
  const headers = new Headers(upstreamHeaders)

  headers.delete("content-encoding")
  headers.delete("content-length")
  headers.delete("content-type")
  headers.delete("transfer-encoding")

  return headers
}

export async function proxyWorkflowRequest(request: Request): Promise<Response> {
  const upstreamResponse = await fetchProxiedWorkflowRequest(request)

  const hasBody = request.method !== "HEAD" && upstreamResponse.status !== 204 && upstreamResponse.status !== 205
  const contentType = upstreamResponse.headers.get("content-type")?.toLowerCase() || ""
  const shouldReturnText =
    contentType.includes("application/json") ||
    contentType.startsWith("text/") ||
    contentType.includes("application/javascript") ||
    contentType.includes("application/xml")

  let responseBody: ArrayBuffer | string | null = null
  let bodyByteLength: number | undefined

  if (hasBody) {
    if (shouldReturnText) {
      responseBody = await upstreamResponse.text()
      bodyByteLength = new TextEncoder().encode(responseBody).byteLength
    } else {
      responseBody = await upstreamResponse.arrayBuffer()
      bodyByteLength = responseBody.byteLength
    }
  }

  return new Response(responseBody, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers: getProxyResponseHeaders(upstreamResponse.headers, bodyByteLength)
  })
}

export async function proxyWorkflowJsonRequest(request: Request): Promise<Response> {
  const upstreamResponse = await fetchProxiedWorkflowRequest(request)
  const responseHeaders = getForwardedJsonHeaders(upstreamResponse.headers)

  if (request.method === "HEAD" || upstreamResponse.status === 204 || upstreamResponse.status === 205) {
    return new Response(null, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers: responseHeaders
    })
  }

  const text = await upstreamResponse.text()
  const body = text.length > 0 ? JSON.parse(text) : null

  return Response.json(body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers: responseHeaders
  })
}
