import { createHash, randomUUID } from "node:crypto"
import { mkdir, open, writeFile } from "node:fs/promises"
import { isAbsolute, join } from "node:path"
import { metricsObserverScript, snapshotScript, summarizeBrowserMetrics } from "./browser-metrics.js"
import { type BrowserInvoke, connectManagedCdp, type ManagedCdp } from "./managed-cdp.js"
import { safeNetworkUrl } from "./network-evidence.js"

type Action = { click: string } | { scroll: number } | { waitFor: string }
export interface CaptureOptions {
  url: string
  output: string
  runs: number
  settleMs: number
  ready?: string
  actions: Action[]
}
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export function parseCaptureOptions(args: string[]): CaptureOptions {
  const url = args[0]
  const options: Record<string, string> = {}
  for (let index = 1; index < args.length; index += 2) {
    const name = args[index]
    const value = args[index + 1]
    if (
      !["--output", "--runs", "--settle-ms", "--ready", "--actions"].includes(name) ||
      value === undefined ||
      options[name] !== undefined
    )
      throw new Error(
        "Use browser capture URL --output ABSOLUTE_DIRECTORY [--runs 3] [--ready CSS] [--settle-ms 1000] [--actions JSON]"
      )
    options[name] = value
  }
  const parsed = new URL(url)
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password)
    throw new Error("Capture URL must use HTTP(S) without embedded credentials")
  if (!options["--output"] || !isAbsolute(options["--output"]))
    throw new Error("Capture requires an absolute output directory")
  const runs = Number(options["--runs"] ?? 3)
  const settleMs = Number(options["--settle-ms"] ?? 1000)
  if (!Number.isInteger(runs) || runs < 1 || runs > 5) throw new Error("Capture runs must be 1–5")
  if (!Number.isInteger(settleMs) || settleMs < 250 || settleMs > 5000)
    throw new Error("Capture settle-ms must be 250–5000")
  const actions = JSON.parse(options["--actions"] || "[]") as Action[]
  if (!Array.isArray(actions) || actions.length > 10) throw new Error("Capture supports up to ten actions")
  for (const action of actions) {
    if (!action || typeof action !== "object" || Object.keys(action).length !== 1)
      throw new Error("Invalid capture action")
    if ("scroll" in action) {
      if (!Number.isInteger(action.scroll) || Math.abs(action.scroll) > 5000 || !action.scroll)
        throw new Error("Scroll must be a nonzero pixel distance within ±5000")
    } else if ("click" in action || "waitFor" in action) {
      const selector = "click" in action ? action.click : action.waitFor
      if (typeof selector !== "string" || !selector.trim() || selector.length > 2000)
        throw new Error("Actions require a CSS selector")
    } else throw new Error("Actions support click, scroll and waitFor")
  }
  return { url: parsed.href, output: options["--output"], runs, settleMs, ready: options["--ready"], actions }
}

async function evaluate(cdp: ManagedCdp, expression: string) {
  const result = await cdp.send("Runtime.evaluate", { expression, returnByValue: true })
  if (result.exceptionDetails) throw new Error("Page evaluation failed during capture")
  return (result.result as { value: unknown })?.value
}

/** Bounded aggregate probes; animation gaps measure main-thread scheduling, not compositor frame loss. */
export function jankObserverScript(key: string): string {
  return `(() => {
    const state = { visibility: document.visibilityState, frames: 0, maxFrameGapMs: 0, gapsOver50Ms: 0, maxInteractionMs: null, longAnimationFrames: null };
    globalThis[${JSON.stringify(key)}] = state;
    let previous, frame; const observers = [];
    function tick(now) { if (previous !== undefined) { const gap = now - previous; state.maxFrameGapMs = Math.max(state.maxFrameGapMs, gap); if (gap > 50) state.gapsOver50Ms++; } previous = now; state.frames++; frame = requestAnimationFrame(tick); }
    frame = requestAnimationFrame(tick);
    if (PerformanceObserver.supportedEntryTypes.includes('long-animation-frame')) {
      state.longAnimationFrames = { count: 0, totalBlockingMs: 0, maxDurationMs: 0, slowestScripts: [] };
      const observer = new PerformanceObserver(list => { for (const entry of list.getEntries()) {
        state.longAnimationFrames.count++; state.longAnimationFrames.totalBlockingMs += entry.blockingDuration; state.longAnimationFrames.maxDurationMs = Math.max(state.longAnimationFrames.maxDurationMs, entry.duration);
        for (const script of entry.scripts || []) state.longAnimationFrames.slowestScripts.push({durationMs:script.duration, sourceUrl:(script.sourceURL || '').slice(0,4000), functionName:(script.sourceFunctionName || '').slice(0,200), sourceCharPosition:script.sourceCharPosition});
        state.longAnimationFrames.slowestScripts.sort((a,b)=>b.durationMs-a.durationMs); state.longAnimationFrames.slowestScripts.length = Math.min(5,state.longAnimationFrames.slowestScripts.length);
      } });
      observer.observe({type: 'long-animation-frame', buffered: true}); observers.push(observer);
    }
    if (PerformanceObserver.supportedEntryTypes.includes('event')) {
      const observer = new PerformanceObserver(list => { for (const entry of list.getEntries()) if (entry.interactionId) state.maxInteractionMs = Math.max(state.maxInteractionMs || 0, entry.duration); });
      observer.observe({type: 'event', buffered: true, durationThreshold: 16}); observers.push(observer);
    }
    document.addEventListener('visibilitychange', visibility);
    function visibility() { if (document.visibilityState !== 'visible') state.visibility = 'hidden-during-capture'; }
    state.dispose = () => { cancelAnimationFrame(frame); for (const observer of observers) observer.disconnect(); document.removeEventListener('visibilitychange', visibility); delete globalThis[${JSON.stringify(key)}]; };
  })()`
}

async function waitFor(cdp: ManagedCdp, expression: string) {
  const deadline = performance.now() + 15000
  while (!(await evaluate(cdp, expression))) {
    if (performance.now() >= deadline) throw new Error("Capture readiness timed out after 15000ms")
    await delay(100)
  }
}

async function navigate(cdp: ManagedCdp, options: CaptureOptions) {
  const previousOrigin = await evaluate(cdp, "performance.timeOrigin")
  const result = await cdp.send("Page.navigate", { url: options.url })
  if (result.errorText) throw new Error(`Capture navigation failed: ${result.errorText}`)
  await waitFor(
    cdp,
    `location.href !== 'about:blank' && document.readyState === 'complete' && performance.timeOrigin !== ${JSON.stringify(previousOrigin)}`
  )
  if (options.ready) await waitFor(cdp, `!!document.querySelector(${JSON.stringify(options.ready)})`)
}

async function performActions(cdp: ManagedCdp, actions: Action[]) {
  for (const action of actions) {
    if ("waitFor" in action) {
      await waitFor(cdp, `!!document.querySelector(${JSON.stringify(action.waitFor)})`)
    } else if ("scroll" in action) {
      const point = (await evaluate(cdp, `({x:innerWidth/2,y:innerHeight/2})`)) as { x: number; y: number }
      await cdp.send("Input.dispatchMouseEvent", { type: "mouseWheel", ...point, deltaX: 0, deltaY: action.scroll })
    } else {
      const point = (await evaluate(
        cdp,
        `(() => { const elements = document.querySelectorAll(${JSON.stringify(action.click)}); if (elements.length !== 1) return null; const element = elements[0]; element.scrollIntoView({block:'center',behavior:'instant'}); const r = element.getBoundingClientRect(); const x = r.x+r.width/2, y = r.y+r.height/2; const hit = document.elementFromPoint(x,y); return r.width && r.height && hit && (hit === element || element.contains(hit)) ? {x,y} : null; })()`
      )) as { x: number; y: number } | null
      if (!point) throw new Error(`Capture click needs one visible, unobstructed match: ${action.click}`)
      await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", clickCount: 1 })
      await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "left", clickCount: 1 })
    }
    await delay(250)
  }
}

/** Stream to a new file with a hard size cap; the browser needs no output-path access. */
export async function saveRecording(cdp: ManagedCdp, path: string): Promise<number> {
  const { stream } = await cdp.send("Page.stopScreenRecording")
  if (typeof stream !== "string" || !stream) throw new Error("Chrome returned no recording stream")
  let file: Awaited<ReturnType<typeof open>> | undefined
  let bytes = 0
  try {
    file = await open(path, "wx", 0o600)
    while (true) {
      const result = await cdp.send("IO.read", { handle: stream, size: 1024 * 1024 })
      if (typeof result.data !== "string") throw new Error("Invalid Chrome recording chunk")
      const chunk = Buffer.from(result.data, result.base64Encoded ? "base64" : "utf8")
      bytes += chunk.length
      if (bytes > 128 * 1024 * 1024) throw new Error("Recording exceeded 128MiB; reduce the scenario duration")
      await file.writeFile(chunk)
      if (result.eof) break
    }
    if (!bytes) throw new Error("Chrome returned an empty recording")
    return bytes
  } finally {
    await file?.close()
    await cdp.send("IO.close", { handle: stream }).catch(() => {})
  }
}

export async function captureBrowserLoading(args: string[], invoke: BrowserInvoke, connect = connectManagedCdp) {
  const options = parseCaptureOptions(args)
  // A new directory prevents overwriting baseline evidence or mixing old and new runs.
  await mkdir(options.output, { mode: 0o700 })
  const connection = await connect(invoke)
  let runDeadline = Number.POSITIVE_INFINITY
  const cdp: ManagedCdp = {
    close: connection.close,
    send: async (method, params) => {
      if (performance.now() > runDeadline) throw new Error("Capture exceeded the 60000ms run limit")
      return connection.send(method, params)
    }
  }
  const key = `__d3kCapture_${randomUUID().replaceAll("-", "")}`
  const jankKey = `${key}_jank`
  let installed: string | undefined
  let recording = false
  try {
    const browser = await cdp.send("Browser.getVersion")
    await cdp.send("Page.enable")
    await cdp.send("Page.bringToFront")
    installed = String(
      (
        await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
          source: `${metricsObserverScript(key)};${jankObserverScript(jankKey)}`
        })
      ).identifier
    )
    // Warm the dev server and HTTP cache equally before each capture set; cookies are untouched.
    await navigate(cdp, options)
    await delay(options.settleMs)
    const runs = []
    for (let run = 1; run <= options.runs; run++) {
      await cdp.send("Page.navigate", { url: "about:blank" })
      await waitFor(cdp, `location.href === 'about:blank'`)
      const recordingRequestedAt = performance.now()
      runDeadline = recordingRequestedAt + 60000
      try {
        await cdp.send("Page.startScreenRecording", {
          frameRate: 60,
          maxWidth: 1920,
          maxHeight: 1080,
          captureArea: "target",
          audio: false
        })
      } catch (error) {
        throw new Error(
          `Native recording unavailable in ${String(browser.product)}; Chrome 153+ with Page.startScreenRecording is required. ${String(error)}`
        )
      }
      recording = true
      await delay(150)
      const triggerOffsetMs = performance.now() - recordingRequestedAt
      await navigate(cdp, options)
      await delay(options.settleMs)
      const documentOrigin = await evaluate(cdp, "performance.timeOrigin")
      await performActions(cdp, options.actions)
      await delay(options.settleMs)
      if ((await evaluate(cdp, "performance.timeOrigin")) !== documentOrigin)
        throw new Error("An action navigated to a new document; capture that page as a separate scenario")
      const snapshot = JSON.parse(String(await evaluate(cdp, snapshotScript(key))))
      const details = await evaluate(
        cdp,
        `JSON.stringify({jank:globalThis[${JSON.stringify(jankKey)}],viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio},url:location.href})`
      )
      const context = JSON.parse(String(details))
      for (const script of context.jank?.longAnimationFrames?.slowestScripts || []) {
        script.sourceUrl = safeNetworkUrl(script.sourceUrl)
      }
      if (!snapshot.observation || !context.jank) throw new Error("Capture observers were lost; retry the scenario")
      if (context.jank.visibility !== "visible") throw new Error("Capture tab was hidden; keep it visible and retry")
      const video = `run-${run}.mp4`
      const bytes = await saveRecording(cdp, join(options.output, video))
      recording = false
      runs.push({
        video,
        bytes,
        triggerOffsetMs,
        viewport: context.viewport,
        metrics: summarizeBrowserMetrics(snapshot, {}),
        jank: context.jank
      })
      runDeadline = Number.POSITIVE_INFINITY
    }
    const manifest = {
      version: 1,
      capturedAt: new Date().toISOString(),
      scenario: {
        url: safeNetworkUrl(options.url),
        identity: createHash("sha256").update(options.url).digest("hex"),
        ready: options.ready ?? null,
        actions: options.actions,
        settleMs: options.settleMs,
        warmups: 1,
        cache: "existing-profile-warmed",
        throttling: "unchanged",
        frameRate: 60
      },
      browser: browser.product,
      runs,
      notes: [
        "Local lab measurements, not field Core Web Vitals or a performance guarantee.",
        "Video trigger offsets are estimates from CDP request timing, not frame-exact synchronization.",
        "Animation gaps measure main-thread scheduling, not dropped compositor frames. maxInteractionMs is an observed Event Timing maximum, not INP; null can mean no qualifying event.",
        "Use matching production builds for performance conclusions; dev compilation, HMR, machine load, cache and network state can change results.",
        "Videos contain visible page data. Capture is explicit; delete the output directory when it is no longer needed."
      ]
    }
    await writeFile(join(options.output, "capture.json"), JSON.stringify(manifest, null, 2), {
      flag: "wx",
      mode: 0o600
    })
    return { output: options.output, ...manifest }
  } finally {
    runDeadline = Number.POSITIVE_INFINITY
    if (recording)
      await cdp
        .send("Page.stopScreenRecording")
        .then(async ({ stream }) => {
          if (stream) await cdp.send("IO.close", { handle: stream })
        })
        .catch(() => {})
    if (installed) await cdp.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: installed }).catch(() => {})
    await evaluate(
      cdp,
      `globalThis[${JSON.stringify(key)}]?.dispose();globalThis[${JSON.stringify(jankKey)}]?.dispose()`
    ).catch(() => {})
    cdp.close()
  }
}
