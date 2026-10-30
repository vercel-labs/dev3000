import type { CDPEvent } from "../cdp-monitor.js"
import type { Timeline } from "./timeline.js"

export const NETWORK_BODY_LIMIT = 8192
export const NETWORK_RESOURCE_LIMIT = 64 * 1024
const REDACTED = "[redacted]"
const sensitive =
  /authorization|authentication|(^|[-_])auth($|[-_])|cookie|password|passwd|secret|token|api[-_]?key|session|credential|csrf|xsrf|signature|private[-_]?key|access[-_]?key|bypass|^key$/i

export function safeNetworkUrl(value: string): string {
  try {
    const url = new URL(value)
    if (!["http:", "https:"].includes(url.protocol)) return "[non-HTTP URL]"
    url.username = ""
    url.password = ""
    if (url.search) url.search = "?redacted"
    url.hash = ""
    return url.toString()
  } catch {
    return "[invalid URL]"
  }
}

function redactText(value: string): string {
  if (value.startsWith("/") && value.includes("?")) return headerUrl(value)
  return value
    .replace(/\b(Bearer|Basic)\s+[^\s"'<>]+/gi, `$1 ${REDACTED}`)
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, REDACTED)
    .replace(/https?:\/\/[^\s"'<>]+/gi, (url) => safeNetworkUrl(url))
}

function bounded(value: string, limit: number): string {
  return new TextDecoder().decode(Buffer.from(value).subarray(0, limit), { stream: true })
}

function headerUrl(value: string): string {
  const base = "https://relative.invalid"
  try {
    const clean = safeNetworkUrl(new URL(value, base).href)
    return clean.startsWith(`${base}/`) ? clean.slice(base.length) : clean
  } catch {
    return "[invalid URL]"
  }
}

function headers(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") return {}
  const result: Record<string, string> = Object.create(null)
  let remaining = 4096
  for (const [name, raw] of Object.entries(value)) {
    if (remaining <= 0 || Object.keys(result).length >= 48) break
    const key = bounded(name.toLowerCase(), 128)
    const text = String(raw)
    const clean = sensitive.test(name)
      ? REDACTED
      : /(^|[-_])(url|uri|location|referer|referrer)($|[-_])|^:path$/i.test(key)
        ? headerUrl(text)
        : redactText(text)
    result[key] = bounded(clean, Math.min(1024, remaining))
    remaining -= Buffer.byteLength(key) + Buffer.byteLength(result[key])
  }
  return result
}

function contentType(value: unknown): string {
  if (!value || typeof value !== "object") return ""
  const match = Object.entries(value).find(([key]) => key.toLowerCase() === "content-type")
  return String(match?.[1] || "")
    .split(";")[0]
    .trim()
    .toLowerCase()
}

function supportedBody(type: string): boolean {
  return type === "application/json" || type.endsWith("+json") || type === "application/x-www-form-urlencoded"
}

/** Parse before truncating: a partial JSON/string could expose part of a credential. */
function bodyPreview(body: string, type: string): Record<string, unknown> {
  const bytes = Buffer.byteLength(body)
  if (bytes > NETWORK_RESOURCE_LIMIT) return { omitted: "too-large", bytes }
  try {
    let clean: string
    if (type === "application/x-www-form-urlencoded") {
      const params = new URLSearchParams()
      for (const [key, value] of new URLSearchParams(body))
        params.append(key, sensitive.test(key) ? REDACTED : redactText(value))
      clean = params.toString()
    } else if (supportedBody(type)) {
      clean = JSON.stringify(JSON.parse(body), (key, value: unknown) => {
        if (sensitive.test(key)) return REDACTED
        return typeof value === "string" ? redactText(value) : value
      })
    } else return { omitted: "unsupported-content-type", bytes }
    return { text: bounded(clean, NETWORK_BODY_LIMIT), bytes, truncated: Buffer.byteLength(clean) > NETWORK_BODY_LIMIT }
  } catch {
    return { omitted: "unparseable", bytes }
  }
}

interface Response {
  url: string
  status: number
  headers?: Record<string, unknown>
  mimeType?: string
  protocol?: string
  fromDiskCache?: boolean
  fromServiceWorker?: boolean
  timing?: Record<string, number>
}

interface RequestState {
  url: string
  httpMethod: string
  start: number
  type: string
  response?: Response
}

export interface NetworkEvidenceOptions {
  appUrl: string
  readResponseBody: (requestId: string) => Promise<{ body: string; base64Encoded: boolean }>
}

function timing(response?: Response, state?: RequestState, end?: number): Record<string, number> {
  const raw = response?.timing
  const result: Record<string, number> = {}
  const duration = (name: string, start?: number, finish?: number, scale = 1) => {
    if (
      start !== undefined &&
      finish !== undefined &&
      Number.isFinite(start) &&
      Number.isFinite(finish) &&
      start >= 0 &&
      finish >= start
    )
      result[name] = Math.round((finish - start) * scale * 1000) / 1000
  }
  if (raw) {
    duration("dnsMs", raw.dnsStart, raw.dnsEnd)
    duration("connectMs", raw.connectStart, raw.connectEnd)
    duration("tlsMs", raw.sslStart, raw.sslEnd)
    duration("sendMs", raw.sendStart, raw.sendEnd)
    if (raw.receiveHeadersEnd >= 0) {
      const headersAt = raw.requestTime + raw.receiveHeadersEnd / 1000
      const firstByteAt =
        raw.requestTime + (raw.receiveHeadersStart >= 0 ? raw.receiveHeadersStart : raw.receiveHeadersEnd) / 1000
      duration("ttfbMs", state?.start, firstByteAt, 1000)
      duration("downloadMs", headersAt, end, 1000)
    }
  }
  duration("totalMs", state?.start, end, 1000)
  return result
}

/** Correlate only a bounded number of requests; body reads never delay CDP event handling. */
export class NetworkEvidence {
  private requests = new Map<string, RequestState>()
  private pendingBodies = 0
  private origin: string

  constructor(
    private timeline: Timeline,
    private options: NetworkEvidenceOptions
  ) {
    this.origin = new URL(options.appUrl).origin
  }

  private key(event: CDPEvent): string {
    return `${event.sessionId || ""}:${event.params.requestId}`
  }

  private bodyOmission(state: RequestState, type: string): string | undefined {
    try {
      if (new URL(state.url).origin !== this.origin) return "cross-origin"
    } catch {
      return "invalid-url"
    }
    if (!["Fetch", "XHR"].includes(state.type)) return "resource-type"
    if (!supportedBody(type)) return "unsupported-content-type"
    return undefined
  }

  private append(event: CDPEvent, kind: string, message: string, data: Record<string, unknown>, error = false): void {
    this.timeline.append({
      source: "browser",
      level: error ? "error" : "info",
      kind,
      message,
      data: { method: event.method, target: event.sessionId, requestId: event.params.requestId, ...data }
    })
  }

  private response(event: CDPEvent, response: Response, state?: RequestState, redirect = false): void {
    const rawTiming = Object.fromEntries(
      Object.entries(response.timing || {}).filter(([, value]) => typeof value === "number" && Number.isFinite(value))
    )
    this.append(
      event,
      "response",
      `${response.status} ${safeNetworkUrl(response.url)}`,
      {
        url: safeNetworkUrl(response.url),
        status: response.status,
        mimeType: response.mimeType,
        headers: headers(response.headers),
        protocol: response.protocol,
        fromDiskCache: response.fromDiskCache,
        fromServiceWorker: response.fromServiceWorker,
        timing: timing(response, state),
        cdpTiming: rawTiming,
        redirect
      },
      response.status >= 400
    )
  }

  record(event: CDPEvent): boolean {
    const p = event.params
    const key = this.key(event)
    if (event.method === "Network.requestWillBeSent") {
      const request = p.request as {
        url: string
        method: string
        headers?: Record<string, unknown>
        postData?: string
        hasPostData?: boolean
      }
      const previous = this.requests.get(key)
      if (p.redirectResponse) this.response(event, p.redirectResponse as Response, previous, true)
      // Reinsert redirects so the cap evicts the oldest request, not the latest redirect hop.
      this.requests.delete(key)
      const state: RequestState = {
        url: request.url,
        httpMethod: request.method,
        start: p.timestamp as number,
        type: String(p.type)
      }
      this.requests.set(key, state)
      if (this.requests.size > 512) this.requests.delete(this.requests.keys().next().value as string)
      const type = contentType(request.headers)
      const omitted = this.bodyOmission(state, type)
      this.append(event, "request", `${request.method} ${safeNetworkUrl(request.url)}`, {
        url: safeNetworkUrl(request.url),
        httpMethod: request.method,
        headers: headers(request.headers),
        body:
          request.postData !== undefined
            ? omitted
              ? { omitted }
              : bodyPreview(request.postData, type)
            : request.hasPostData
              ? { omitted: "unavailable" }
              : undefined
      })
    } else if (event.method === "Network.responseReceived") {
      const response = p.response as unknown as Response
      const state = this.requests.get(key)
      if (state) state.response = response
      this.response(event, response, state)
    } else if (
      event.method === "Network.requestWillBeSentExtraInfo" ||
      event.method === "Network.responseReceivedExtraInfo"
    ) {
      const request = event.method === "Network.requestWillBeSentExtraInfo"
      // ExtraInfo may arrive out of order, and redirects reuse request IDs. Do not guess a hop URL.
      this.append(
        event,
        request ? "request-headers" : "response-headers",
        request ? "Request wire headers" : "Response wire headers",
        {
          headers: headers(p.headers),
          status: p.statusCode
        }
      )
    } else if (event.method === "Network.loadingFinished" || event.method === "Network.loadingFailed") {
      const state = this.requests.get(key)
      this.requests.delete(key)
      const failed = event.method === "Network.loadingFailed"
      this.append(
        event,
        failed ? "network-failure" : "network-complete",
        failed
          ? String(p.errorText || "Request failed")
          : `Completed ${state ? safeNetworkUrl(state.url) : p.requestId}`,
        {
          url: state ? safeNetworkUrl(state.url) : undefined,
          canceled: p.canceled,
          encodedDataLength: p.encodedDataLength,
          timing: timing(state?.response, state, p.timestamp as number),
          body: failed ? { omitted: "loading-failed" } : undefined
        },
        failed && !p.canceled
      )
      if (!failed && state) void this.captureBody(event, state)
    } else return false
    return true
  }

  private async captureBody(event: CDPEvent, state: RequestState): Promise<void> {
    const response = state.response
    const type = contentType(response?.headers) || response?.mimeType || ""
    const declaredSize = Number(
      Object.entries(response?.headers || {}).find(([key]) => key.toLowerCase() === "content-length")?.[1]
    )
    let omitted = this.bodyOmission(state, type)
    if (!omitted && (!response || state.httpMethod === "HEAD" || [204, 205, 304].includes(response.status)))
      omitted = "no-body"
    if (
      !omitted &&
      (Number(event.params.encodedDataLength) > NETWORK_RESOURCE_LIMIT || declaredSize > NETWORK_RESOURCE_LIMIT)
    )
      omitted = "too-large"
    if (!omitted && this.pendingBodies >= 8) omitted = "capture-busy"
    // Non-API resources still have headers and timing; avoid a second event for every asset.
    if (!["Fetch", "XHR"].includes(state.type)) return
    let body: Record<string, unknown> = { omitted }
    if (!omitted) {
      this.pendingBodies++
      try {
        const result = await this.options.readResponseBody(String(event.params.requestId))
        const maxEncodedLength = Math.ceil(NETWORK_RESOURCE_LIMIT / 3) * 4
        body =
          result.body.length > (result.base64Encoded ? maxEncodedLength : NETWORK_RESOURCE_LIMIT)
            ? { omitted: "too-large" }
            : bodyPreview(
                result.base64Encoded ? Buffer.from(result.body, "base64").toString("utf8") : result.body,
                type
              )
      } catch {
        body = { omitted: "unavailable" }
      } finally {
        this.pendingBodies--
      }
    }
    this.append(event, "response-body", `Response body ${safeNetworkUrl(state.url)}`, {
      url: safeNetworkUrl(state.url),
      body
    })
  }
}
