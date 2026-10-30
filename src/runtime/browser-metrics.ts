import { randomUUID } from "node:crypto"
import { WebSocket } from "ws"
import { safeNetworkUrl } from "./network-evidence.js"

type Invoke = (args: string[]) => Promise<string>
type Data = Record<string, unknown>

/** Navigation-scoped observers keep aggregates only, not page contents or event histories. */
export function metricsObserverScript(key: string): string {
  return `(() => {
    const state = { startedAt: performance.now(), supported: {}, lcp: null, cls: 0, longTasks: { count: 0, totalMs: 0, maxMs: 0 } };
    globalThis[${JSON.stringify(key)}] = state;
    const observers = [];
    state.dispose = () => { for (const observer of observers) observer.disconnect(); delete globalThis[${JSON.stringify(key)}]; };
    let sessionStart = 0, previousShift = 0, sessionScore = 0;
    for (const type of ['largest-contentful-paint', 'layout-shift', 'longtask']) {
      state.supported[type] = PerformanceObserver.supportedEntryTypes.includes(type);
      if (!state.supported[type]) continue;
      const observer = new PerformanceObserver(list => {
        for (const entry of list.getEntries()) {
          if (type === 'largest-contentful-paint') state.lcp = { valueMs: entry.startTime, element: entry.element?.tagName || null, url: entry.url || null };
          else if (type === 'layout-shift' && !entry.hadRecentInput) {
            if (!sessionScore || entry.startTime - previousShift >= 1000 || entry.startTime - sessionStart >= 5000) {
              sessionStart = entry.startTime; sessionScore = 0;
            }
            sessionScore += entry.value; previousShift = entry.startTime;
            state.cls = Math.max(state.cls, sessionScore);
          } else if (type === 'longtask') {
            state.longTasks.count++; state.longTasks.totalMs += entry.duration;
            state.longTasks.maxMs = Math.max(state.longTasks.maxMs, entry.duration);
          }
        }
      });
      observer.observe({ type, buffered: true });
      observers.push(observer);
    }
  })()`
}

function snapshotScript(key: string): string {
  return `JSON.stringify({url:location.href,capturedAt:new Date().toISOString(),observedUntilMs:performance.now(),navigation:performance.getEntriesByType('navigation')[0]?.toJSON()||null,paint:performance.getEntriesByType('paint').map(e=>({name:e.name,startTime:e.startTime})),resourceCount:performance.getEntriesByType('resource').length,resources:performance.getEntriesByType('resource').slice(0,500).map(e=>({name:e.name,initiatorType:e.initiatorType,duration:e.duration,transferSize:e.transferSize,encodedBodySize:e.encodedBodySize,decodedBodySize:e.decodedBodySize})),observation:globalThis[${JSON.stringify(key)}]||null})`
}

function data(output: string): Data {
  const result = JSON.parse(output) as { success?: boolean; data?: Data; error?: string }
  if (!result.success || !result.data) throw new Error(result.error || "Browser metrics command failed")
  return result.data
}

function milliseconds(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value * 1000) / 1000 : null
}

function duration(navigation: Data, start: string, end: string): number | null {
  const a = navigation[start]
  const b = navigation[end]
  return typeof a === "number" && typeof b === "number" && b >= a ? milliseconds(b - a) : null
}

export function summarizeBrowserMetrics(snapshot: Data, vitals: Data) {
  const navigation = (snapshot.navigation || {}) as Data
  const observation = snapshot.observation as {
    startedAt: number
    supported: Record<string, boolean>
    lcp: { valueMs: number; element: string | null; url: string | null } | null
    cls: number
    longTasks: { count: number; totalMs: number; maxMs: number }
  } | null
  const resources = (snapshot.resources || []) as Array<{
    name: string
    initiatorType: string
    duration: number
    transferSize: number
    encodedBodySize: number
    decodedBodySize: number
  }>
  const byInitiator: Record<string, number> = Object.create(null)
  for (const resource of resources) byInitiator[resource.initiatorType] = (byInitiator[resource.initiatorType] || 0) + 1
  const fallbackLcp = vitals.lcp as { startTime?: number; element?: string; url?: string } | null
  const lcp = observation?.supported["largest-contentful-paint"]
    ? observation.lcp
    : fallbackLcp
      ? { valueMs: milliseconds(fallbackLcp.startTime), element: fallbackLcp.element, url: fallbackLcp.url }
      : null
  const paints = (snapshot.paint || []) as Array<{ name: string; startTime: number }>
  return {
    url: safeNetworkUrl(String(snapshot.url)),
    capturedAt: snapshot.capturedAt,
    measurement: {
      type: "single-browser-load",
      cache: "existing-profile-not-cleared",
      throttling: "unchanged",
      observation: observation ? "from-navigation" : "snapshot-only",
      observerStartedAtMs: observation ? milliseconds(observation.startedAt) : null,
      observedUntilMs: milliseconds(snapshot.observedUntilMs),
      provisional: true
    },
    navigation: {
      type: navigation.type ?? null,
      dnsMs: duration(navigation, "domainLookupStart", "domainLookupEnd"),
      connectMs: duration(navigation, "connectStart", "connectEnd"),
      tlsMs:
        typeof navigation.secureConnectionStart === "number" && navigation.secureConnectionStart > 0
          ? duration(navigation, "secureConnectionStart", "connectEnd")
          : null,
      ttfbMs: duration(navigation, "startTime", "responseStart"),
      serverWaitMs: duration(navigation, "requestStart", "responseStart"),
      downloadMs: duration(navigation, "responseStart", "responseEnd"),
      domInteractiveMs: milliseconds(navigation.domInteractive),
      domContentLoadedMs: navigation.domContentLoadedEventEnd
        ? milliseconds(navigation.domContentLoadedEventEnd)
        : null,
      loadMs: navigation.loadEventEnd ? milliseconds(navigation.loadEventEnd) : null,
      redirectMs: duration(navigation, "redirectStart", "redirectEnd"),
      visibleRedirectCount: navigation.redirectCount ?? null,
      transferBytes: navigation.transferSize ?? null,
      encodedBodyBytes: navigation.encodedBodySize ?? null,
      decodedBodyBytes: navigation.decodedBodySize ?? null,
      protocol: navigation.nextHopProtocol || null
    },
    paint: {
      firstPaintMs: milliseconds(paints.find((paint) => paint.name === "first-paint")?.startTime),
      fcpMs: milliseconds(paints.find((paint) => paint.name === "first-contentful-paint")?.startTime)
    },
    webVitals: {
      lcp: lcp ? { ...lcp, url: lcp.url ? safeNetworkUrl(lcp.url) : null } : null,
      cls: observation?.supported["layout-shift"] ? observation.cls : null,
      inp: vitals.inp ?? null
    },
    longTasks: observation?.supported.longtask ? observation.longTasks : null,
    resources: {
      retainedEntries: snapshot.resourceCount,
      summarizedEntries: resources.length,
      truncated: Number(snapshot.resourceCount) > resources.length,
      byInitiator,
      transferBytes: resources.reduce((sum, resource) => sum + resource.transferSize, 0),
      slowest: [...resources]
        .sort((a, b) => b.duration - a.duration)
        .slice(0, 10)
        .map((resource) => ({
          ...resource,
          name: safeNetworkUrl(resource.name),
          duration: milliseconds(resource.duration)
        }))
    },
    notes: [
      "A browser snapshot, not Lighthouse or real-user field data. LCP, CLS and INP remain provisional while the page is open.",
      "null means unavailable or not observed; it does not mean zero. CLS and long tasks require observers installed before navigation.",
      "Zero transfer bytes do not prove a warm cache: cross-origin Timing-Allow-Origin restrictions can also hide sizes. Resource Timing may omit entries evicted from its buffer.",
      "Cross-origin redirect timing may be hidden. This snapshot does not establish why a paint was delayed."
    ]
  }
}

/** Attach an auxiliary observer to the selected target in the runtime-owned browser. */
export async function installMetricsObserver(invoke: Invoke, key: string): Promise<() => Promise<void>> {
  const connection = data(await invoke(["get", "cdp-url", "--json"]))
  const tabs = data(await invoke(["tab", "list", "--json"]))
  const active = (tabs.tabs as Array<{ active: boolean; targetId: string }>).find((tab) => tab.active)
  if (!active?.targetId || typeof connection.cdpUrl !== "string") throw new Error("No active managed browser target")
  const ws = new WebSocket(connection.cdpUrl)
  let nextId = 0
  const pending = new Map<number, { resolve: (value: Data) => void; reject: (error: Error) => void }>()
  const fail = () => {
    for (const request of pending.values()) request.reject(new Error("Metrics browser connection closed"))
    pending.clear()
  }
  ws.on("error", fail)
  ws.on("close", fail)
  ws.on("message", (raw) => {
    const message = JSON.parse(raw.toString()) as { id?: number; result?: Data; error?: { message: string } }
    if (!message.id) return
    const request = pending.get(message.id)
    if (!request) return
    pending.delete(message.id)
    if (message.error) request.reject(new Error(message.error.message))
    else request.resolve(message.result || {})
  })
  async function send(method: string, params: Data = {}, sessionId?: string): Promise<Data> {
    const id = ++nextId
    const response = new Promise<Data>((resolve, reject) => pending.set(id, { resolve, reject }))
    const timer = setTimeout(() => {
      pending.get(id)?.reject(new Error(`Metrics CDP timeout: ${method}`))
      pending.delete(id)
    }, 10000)
    try {
      ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
      return await response
    } finally {
      clearTimeout(timer)
      pending.delete(id)
    }
  }
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        ws.terminate()
        reject(new Error("Metrics CDP connection timed out"))
      }, 10000)
      ws.once("open", () => {
        clearTimeout(timer)
        resolve()
      })
      ws.once("error", () => {
        clearTimeout(timer)
        reject(new Error("Metrics CDP connection failed"))
      })
    })
    const attached = await send("Target.attachToTarget", { targetId: active.targetId, flatten: true })
    const sessionId = String(attached.sessionId)
    await send("Page.enable", {}, sessionId)
    const installed = await send(
      "Page.addScriptToEvaluateOnNewDocument",
      { source: metricsObserverScript(key) },
      sessionId
    )
    return async () => {
      try {
        await send("Page.removeScriptToEvaluateOnNewDocument", { identifier: installed.identifier }, sessionId)
        await send("Runtime.evaluate", { expression: `globalThis[${JSON.stringify(key)}]?.dispose()` }, sessionId)
      } finally {
        ws.terminate()
      }
    }
  } catch (error) {
    ws.terminate()
    throw error
  }
}

/** Use the same managed agent-browser session; no browser launch/profile/CDP overrides. */
export async function captureBrowserMetrics(args: string[], invoke: Invoke, install = installMetricsObserver) {
  const unknown = args.find((arg) => arg.startsWith("-") && !["--new-tab", "--json"].includes(arg))
  const urls = args.filter((arg) => !arg.startsWith("-"))
  if (unknown || urls.length > 1 || (args.includes("--new-tab") && !urls.length))
    throw new Error("Use browser metrics [http(s) URL] [--new-tab] [--json]")
  const url = urls[0]
  if (url) {
    const parsed = new URL(url)
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password)
      throw new Error("Metrics URL must use HTTP(S) without embedded credentials")
  }
  if (args.includes("--new-tab")) data(await invoke(["tab", "new", "--json"]))
  const key = `__d3kMetrics_${randomUUID().replaceAll("-", "")}`
  const cleanup = url ? await install(invoke, key) : undefined
  try {
    const vitals = data(await invoke(["vitals", ...(url ? [url] : []), "--json"]))
    const evaluated = data(await invoke(["eval", snapshotScript(key), "--json"]))
    const snapshot = (typeof evaluated.result === "string" ? JSON.parse(evaluated.result) : evaluated.result) as Data
    if (!snapshot || snapshot.url !== vitals.url) throw new Error("Active tab changed during metrics capture; retry")
    if (url && !snapshot.observation)
      throw new Error("Metrics observers did not initialize in the navigated tab; retry")
    return summarizeBrowserMetrics(snapshot, vitals)
  } finally {
    await cleanup?.().catch(() => {})
  }
}
