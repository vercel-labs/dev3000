import { readFile, writeFile } from "node:fs/promises"
import { dirname, isAbsolute, join, relative } from "node:path"

interface Run {
  video: string
  triggerOffsetMs: number
  viewport: { width: number; height: number; dpr: number }
  metrics: {
    url: string
    webVitals: { lcp: { valueMs: number } | null; cls: number | null }
    paint: { fcpMs: number | null }
    navigation: { ttfbMs: number | null }
    longTasks: { totalMs: number } | null
  }
  jank: {
    maxFrameGapMs: number
    maxInteractionMs: number | null
    longAnimationFrames: { totalBlockingMs: number } | null
  }
}
interface Capture {
  version: number
  browser: string
  scenario: unknown
  runs: Run[]
}
const measures: Array<[string, (run: Run) => number | null | undefined]> = [
  ["LCP (ms)", (run) => run.metrics.webVitals.lcp?.valueMs],
  ["CLS", (run) => run.metrics.webVitals.cls],
  ["FCP (ms)", (run) => run.metrics.paint.fcpMs],
  ["TTFB (ms)", (run) => run.metrics.navigation.ttfbMs],
  ["Long tasks total (ms)", (run) => run.metrics.longTasks?.totalMs],
  ["Long animation frame blocking (ms)", (run) => run.jank.longAnimationFrames?.totalBlockingMs],
  ["Max animation gap (ms)", (run) => run.jank.maxFrameGapMs],
  ["Max observed interaction (ms)", (run) => run.jank.maxInteractionMs]
]

export function distribution(values: Array<number | null | undefined>) {
  const available = values
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
    .sort((a, b) => a - b)
  const middle = Math.floor(available.length / 2)
  return {
    observed: available.length,
    median: available.length
      ? available.length % 2
        ? available[middle]
        : (available[middle - 1] + available[middle]) / 2
      : null,
    min: available[0] ?? null,
    max: available.at(-1) ?? null
  }
}

export function compareCaptures(before: Capture, after: Capture) {
  for (const capture of [before, after]) {
    if (capture.version !== 1 || !capture.runs?.length || capture.runs.length > 5)
      throw new Error("Expected a d3k capture.json with 1–5 complete runs")
    for (const run of capture.runs) {
      if (
        !/^run-[1-5]\.mp4$/.test(run.video) ||
        !Number.isFinite(run.triggerOffsetMs) ||
        run.triggerOffsetMs < 0 ||
        !run.viewport ||
        !run.metrics ||
        !run.jank
      )
        throw new Error("Invalid capture run")
    }
  }
  const warnings: string[] = []
  if (before.browser !== after.browser) warnings.push("Chrome versions differ")
  if (JSON.stringify(before.scenario) !== JSON.stringify(after.scenario)) warnings.push("Scenario settings differ")
  const viewports = [...before.runs, ...after.runs].map((run) => JSON.stringify(run.viewport))
  if (new Set(viewports).size !== 1) warnings.push("Viewport or device scale changed")
  if (new Set([...before.runs, ...after.runs].map((run) => run.metrics.url)).size !== 1)
    warnings.push("Final page URLs differ; check redirects and authentication")
  if (before.runs.length !== after.runs.length) warnings.push("Run counts differ")
  if (Math.min(before.runs.length, after.runs.length) < 3)
    warnings.push("Fewer than three runs; repeat before drawing performance conclusions")
  return {
    comparable: warnings.length === 0,
    warnings,
    metrics: measures.map(([name, extract]) => {
      const a = distribution(before.runs.map(extract))
      const b = distribution(after.runs.map(extract))
      return {
        name,
        before: a,
        after: b,
        medianDelta: a.median === null || b.median === null ? null : b.median - a.median
      }
    }),
    notes: [
      "Positive deltas indicate an increase; no automatic pass/fail is inferred from a few local runs.",
      "Matching settings do not establish matching CPU load, caches or network conditions. Compare production builds for performance decisions.",
      "Interaction maxima are not INP. Main-thread animation gaps are not compositor dropped-frame counts. Missing values are unavailable, not zero."
    ]
  }
}

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;")
}
function json(value: unknown) {
  return JSON.stringify(value).replaceAll("<", "\\u003c")
}

export async function compareBrowserCaptures(args: string[]) {
  if (args.length !== 4 || args[2] !== "--output" || !args.every((value, index) => index === 2 || isAbsolute(value)))
    throw new Error("Use browser compare ABSOLUTE_BEFORE_DIR ABSOLUTE_AFTER_DIR --output ABSOLUTE_REPORT.html")
  const [beforeDir, afterDir, , output] = args
  const before = JSON.parse(await readFile(join(beforeDir, "capture.json"), "utf8")) as Capture
  const after = JSON.parse(await readFile(join(afterDir, "capture.json"), "utf8")) as Capture
  const comparison = compareCaptures(before, after)
  const captures = [before, after].map((capture, index) =>
    capture.runs.map((run) => ({
      src: relative(dirname(output), join(index ? afterDir : beforeDir, run.video))
        .split("/")
        .map(encodeURIComponent)
        .join("/"),
      trigger: run.triggerOffsetMs / 1000
    }))
  )
  const format = (value: number | null) => (value === null ? "unavailable" : Number(value.toFixed(3)).toString())
  const range = (value: ReturnType<typeof distribution>) =>
    `${format(value.median)} (${format(value.min)}–${format(value.max)}; n=${value.observed})`
  const html = `<!doctype html><meta charset="utf-8"><title>d3k loading comparison</title>
<style>body{margin:32px;background:#111;color:#eee;font:15px system-ui}h1{font-size:24px}p{color:#aaa;max-width:1000px}.videos{display:grid;grid-template-columns:1fr 1fr;gap:16px}video{width:100%;background:#222}button,select{background:#222;color:#eee;border:1px solid #666;padding:8px;margin-right:12px}input{width:45%;vertical-align:middle}table{border-collapse:collapse;width:100%;margin-top:24px}td,th{text-align:left;padding:10px;border-bottom:1px solid #333}#error{color:#ddd}@media(max-width:700px){.videos{grid-template-columns:1fr}}</style>
<h1>Loading comparison</h1><p>Same elapsed time from navigation (estimated CDP alignment). Completed videos hold their final frame. Medians below summarize every run; parentheses show min–max and observed count. These are local lab measurements.</p>
${comparison.warnings.length ? `<p>Check comparability: ${comparison.warnings.map(escapeHtml).join("; ")}.</p>` : ""}
<div class="videos"><section><h2>Before <select id="beforeRun"></select></h2><video muted playsinline preload="auto"></video></section><section><h2>After <select id="afterRun"></select></h2><video muted playsinline preload="auto"></video></section></div>
<p><button id="play" disabled>Play</button><select id="speed"><option value="1">1×</option><option value="0.5">0.5×</option><option value="0.25">0.25×</option></select><input id="seek" aria-label="Elapsed time" type="range" min="0" max="10" step="0.016"><span id="time">0 ms</span></p><p id="error"></p>
<table><thead><tr><th>Metric</th><th>Before: median (range)</th><th>After: median (range)</th><th>Median change</th></tr></thead><tbody>${comparison.metrics.map((row) => `<tr><td>${escapeHtml(row.name)}</td><td>${range(row.before)}</td><td>${range(row.after)}</td><td>${format(row.medianDelta)}</td></tr>`).join("")}</tbody></table>
${comparison.notes.map((note) => `<p>${escapeHtml(note)}</p>`).join("")}
<script>
const captures=${json(captures)}, videos=[...document.querySelectorAll('video')], picks=[document.querySelector('#beforeRun'),document.querySelector('#afterRun')], seek=document.querySelector('#seek'), play=document.querySelector('#play'), speed=document.querySelector('#speed');
let elapsed=0,playing=false,previous=0,generation=0,loading;const blobs=[];
const selected=i=>captures[i][Number(picks[i].value)];
function render(force=false){videos.forEach((v,i)=>{const at=Math.max(0,Math.min((v.duration||0)-0.001,selected(i).trigger+elapsed));if(force||Math.abs(v.currentTime-at)>0.12)v.currentTime=at;v.playbackRate=Number(speed.value);if(playing&&at<(v.duration||0)-0.002){if(v.paused)v.play().catch(()=>{document.querySelector('#error').textContent='Playback failed. This browser may not support AV1 MP4; open the report in Chrome.'});}else v.pause();});seek.value=elapsed;document.querySelector('#time').textContent=Math.round(elapsed*1000)+' ms';play.textContent=playing?'Pause':'Play';}
function limit(){return Math.max(0,...videos.map((v,i)=>(v.duration||0)-selected(i).trigger));}
async function choose(){
 const current=++generation;playing=false;elapsed=0;play.disabled=true;seek.disabled=true;document.querySelector('#error').textContent='Loading videos…';loading?.abort();loading=new AbortController();
 videos.forEach(v=>{v.pause();v.removeAttribute('src');v.load();});blobs.splice(0).forEach(url=>URL.revokeObjectURL(url));
 try{await Promise.all(videos.map(async(v,i)=>{let src=selected(i).src;
  if(location.protocol!=='file:'){const response=await fetch(src,{signal:loading.signal});if(!response.ok)throw Error('Video fetch failed');const blob=await response.blob();if(current!==generation)return;src=URL.createObjectURL(blob);blobs.push(src);}
  if(current===generation)v.src=src;
 }));}catch(error){if(current===generation&&error.name!=='AbortError')document.querySelector('#error').textContent='Unable to load videos. Keep the report beside its capture directories.';}
}
picks.forEach((pick,i)=>{captures[i].forEach((_,n)=>pick.add(new Option('Run '+(n+1),String(n))));pick.onchange=choose;});
videos.forEach(v=>{v.onloadedmetadata=()=>{if(videos.every(video=>Number.isFinite(video.duration)&&video.duration>0)){seek.max=limit();play.disabled=false;seek.disabled=false;document.querySelector('#error').textContent='';render(true);}};v.onerror=()=>document.querySelector('#error').textContent='Unable to load AV1 video. Keep the report beside its capture directories and open it in Chrome.';});
play.onclick=()=>{if(elapsed>=limit())elapsed=0;playing=!playing;previous=performance.now();render(true);};seek.oninput=()=>{elapsed=Number(seek.value);render(true);};speed.onchange=()=>render();
function tick(now){if(playing){elapsed=Math.min(limit(),elapsed+(now-previous)/1000*Number(speed.value));if(elapsed>=limit())playing=false;render();}previous=now;requestAnimationFrame(tick);}choose();requestAnimationFrame(tick);
</script>`
  await writeFile(output, html, { flag: "wx", mode: 0o600 })
  return { output, ...comparison }
}
