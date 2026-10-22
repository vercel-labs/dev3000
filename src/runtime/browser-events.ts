import type { CDPEvent } from "../cdp-monitor.js"
import type { Timeline } from "./timeline.js"

/** Keep useful CDP fields, never request headers, cookies, or request/response bodies. */
export function recordBrowserEvent(timeline: Timeline, event: CDPEvent): void {
  const p = event.params
  const base = { source: "browser" as const, data: { method: event.method, target: event.sessionId } }
  if (event.method === "Runtime.consoleAPICalled") {
    const args = (p.args || []) as { value?: unknown; description?: string; preview?: unknown }[]
    const level =
      p.type === "error" || p.type === "assert" ? "error" : p.type === "warning" || p.type === "warn" ? "warn" : "info"
    timeline.append({
      ...base,
      level,
      kind: "console",
      message: args.map((a) => String(a.value ?? a.description ?? "[object]")).join(" "),
      data: { ...base.data, stack: p.stackTrace }
    })
  } else if (event.method === "Runtime.exceptionThrown") {
    const details = p.exceptionDetails as {
      text?: string
      exception?: { description?: string }
      url?: string
      stackTrace?: unknown
    }
    timeline.append({
      ...base,
      level: "error",
      kind: "exception",
      message: details.exception?.description || details.text || "Browser exception",
      data: { ...base.data, url: details.url, stack: details.stackTrace }
    })
  } else if (event.method === "Network.requestWillBeSent") {
    const request = p.request as { url: string; method: string }
    timeline.append({
      ...base,
      level: "info",
      kind: "request",
      message: `${request.method} ${safeUrl(request.url)}`,
      data: { ...base.data, requestId: p.requestId, url: safeUrl(request.url), httpMethod: request.method }
    })
  } else if (event.method === "Network.responseReceived") {
    const response = p.response as { url: string; status: number; mimeType?: string }
    timeline.append({
      ...base,
      level: response.status >= 400 ? "error" : "info",
      kind: "response",
      message: `${response.status} ${safeUrl(response.url)}`,
      data: {
        ...base.data,
        requestId: p.requestId,
        url: safeUrl(response.url),
        status: response.status,
        mimeType: response.mimeType
      }
    })
  } else if (event.method === "Network.loadingFailed") {
    timeline.append({
      ...base,
      level: p.canceled ? "info" : "error",
      kind: "network-failure",
      message: String(p.errorText || "Request failed"),
      data: { ...base.data, requestId: p.requestId, canceled: p.canceled }
    })
  } else if (event.method === "Page.frameNavigated") {
    const frame = p.frame as { url: string; id?: string }
    timeline.append({
      ...base,
      level: "info",
      kind: "navigation",
      message: safeUrl(frame.url),
      data: { ...base.data, frameId: frame.id }
    })
  }
}

function safeUrl(value: string): string {
  try {
    const url = new URL(value)
    url.username = ""
    url.password = ""
    // URLs can contain access tokens; query values aren't needed for correlation.
    if (url.search) url.search = "?redacted"
    url.hash = ""
    return url.toString()
  } catch {
    return value.slice(0, 1024)
  }
}
