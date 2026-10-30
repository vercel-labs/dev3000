import type { CDPEvent } from "../cdp-monitor.js"
import { NetworkEvidence, type NetworkEvidenceOptions, safeNetworkUrl } from "./network-evidence.js"
import type { Timeline } from "./timeline.js"

/** Collect browser context and bounded, redacted network evidence in the same timeline. */
export function createBrowserEventRecorder(
  timeline: Timeline,
  options: NetworkEvidenceOptions
): (event: CDPEvent) => void {
  const network = new NetworkEvidence(timeline, options)
  return (event) => {
    if (!network.record(event)) recordBrowserEvent(timeline, event)
  }
}

function recordBrowserEvent(timeline: Timeline, event: CDPEvent): void {
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
  } else if (event.method === "Page.frameNavigated") {
    const frame = p.frame as { url: string; id?: string }
    timeline.append({
      ...base,
      level: "info",
      kind: "navigation",
      message: safeNetworkUrl(frame.url),
      data: { ...base.data, frameId: frame.id }
    })
  }
}
