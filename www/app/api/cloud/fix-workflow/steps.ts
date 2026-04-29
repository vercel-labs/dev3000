/**
 * Steps for Cloud Fix Workflow - Simplified "Local-style" Architecture
 *
 * The agent has a `diagnose` tool that gives real-time CLS feedback,
 * just like the local `fix_my_app` experience. This lets the agent
 * iterate internally instead of external workflow orchestration.
 */

import { Sandbox } from "@vercel/sandbox"
import { generateText } from "ai"
import { createVercelGateway, getAiGatewayAuthSource, requireAiGatewayAuthToken } from "@/lib/ai-gateway"
import { putBlobAndBuildUrl, readBlobJson } from "@/lib/blob-store"
import { getOrCreateD3kSandbox, type SandboxTimingData, StepTimer } from "@/lib/cloud/d3k-sandbox"
import { SandboxAgentBrowser } from "@/lib/cloud/sandbox-agent-browser"
import {
  type DevAgentEarlyExitRule,
  type DevAgentSkillRef,
  getDevAgentModelLabel,
  isVercelPluginSkillRef
} from "@/lib/dev-agents"
import {
  listWorkflowRuns,
  persistWorkflowRun,
  type WorkflowRun,
  type WorkflowRunMirrorTarget,
  type WorkflowType
} from "@/lib/workflow-storage"
import type { TurbopackBundleComparison, TurbopackBundleMetricsSnapshot, WorkflowReport } from "@/types"

const workflowLog = console.log
const TURBOPACK_MIN_NEXT_VERSION = "16.1.0"
const SUCCESS_EVAL_MODEL = "openai/gpt-5.4"
const CLAUDE_CODE_PACKAGE = "@anthropic-ai/claude-code"
const ASH_RUNTIME_PORT = 3100
const ASH_RUNTIME_USERNAME = "dev3000"
const ASH_RUNTIME_ROOT = "/home/vercel-sandbox/.dev3000/ash-apps"
const ASH_RUNTIME_LOG_DIR = "/home/vercel-sandbox/.d3k/logs"
const ASH_TASK_ROUTE_PATH = "/.well-known/ash/v1/task"
const D3K_SKILL_INSTALL_ARG = "vercel-labs/dev3000@d3k"
const VERCEL_PLUGIN_INSTALL_ARG = "vercel/vercel-plugin"
const ANALYZE_TO_NDJSON_SCRIPT = `#!/usr/bin/env node
// Converts Next.js bundle analyzer .data files to NDJSON for offline analysis.
// Usage: node analyze-to-ndjson.mjs [--input <dir>] [--output <dir>]

import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync } from "fs";
import { join } from "path";

const args = process.argv.slice(2);
function arg(name, fallback) {
  const i = args.indexOf(name);
  return i !== -1 && i + 1 < args.length ? args[i + 1] : fallback;
}

const inputDir = arg("--input", ".next/diagnostics/analyze/data");
const outputDir = arg("--output", "./analyze-ndjson");

function parseDataFile(filePath) {
  const buf = readFileSync(filePath);
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const jsonLength = view.getUint32(0, false);
  const jsonStr = new TextDecoder("utf-8").decode(buf.subarray(4, 4 + jsonLength));
  const header = JSON.parse(jsonStr);
  const binaryOffset = 4 + jsonLength;
  const binaryView = new DataView(buf.buffer, buf.byteOffset + binaryOffset, buf.byteLength - binaryOffset);
  return { header, binaryView };
}

function readEdgesAtIndex(binaryView, ref, index) {
  if (!ref || ref.length === 0) return [];
  const { offset } = ref;
  const numOffsets = binaryView.getUint32(offset, false);
  if (index < 0 || index >= numOffsets) return [];

  const offsetsStart = offset + 4;
  const prevOffset = index === 0 ? 0 : binaryView.getUint32(offsetsStart + (index - 1) * 4, false);
  const edgeCount = binaryView.getUint32(offsetsStart + index * 4, false) - prevOffset;
  if (edgeCount === 0) return [];

  const dataStart = offset + 4 + 4 * numOffsets;
  const edges = [];
  for (let j = 0; j < edgeCount; j++) {
    edges.push(binaryView.getUint32(dataStart + (prevOffset + j) * 4, false));
  }
  return edges;
}

function discoverRoutes(dataDir) {
  const routes = [];
  function walk(dir, routePrefix) {
    const analyzeFile = join(dir, "analyze.data");
    if (existsSync(analyzeFile)) {
      routes.push({ route: routePrefix || "/", filePath: analyzeFile });
    }
    for (const entry of readdirSync(dir)) {
      if (entry === "analyze.data" || entry === "modules.data" || entry === "routes.json") continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full, (routePrefix || "") + "/" + entry);
      }
    }
  }
  walk(dataDir, "");
  return routes;
}

function buildFullPaths(sources) {
  const cache = new Map();
  function getFullPath(index) {
    if (cache.has(index)) return cache.get(index);
    const s = sources[index];
    if (!s) {
      cache.set(index, "");
      return "";
    }
    const p = s.parent_source_index == null ? s.path : getFullPath(s.parent_source_index) + s.path;
    cache.set(index, p);
    return p;
  }
  return sources.map((_, i) => getFullPath(i));
}

function getSourceFlags(sourceIndex, sourceChunkPartsMap, chunkParts, outputFiles) {
  let client = false,
    server = false,
    traced = false;
  let js = false,
    css = false,
    json = false,
    asset = false;

  const partIndices = sourceChunkPartsMap.get(sourceIndex) || [];
  for (const cpIdx of partIndices) {
    const cp = chunkParts[cpIdx];
    if (!cp) continue;
    const of = outputFiles[cp.output_file_index];
    if (!of) continue;
    const fn = of.filename;

    if (fn.startsWith("[client-fs]/")) client = true;
    else if (fn.startsWith("[project]/")) traced = true;
    else server = true;

    if (fn.endsWith(".js")) js = true;
    else if (fn.endsWith(".css")) css = true;
    else if (fn.endsWith(".json")) json = true;
    else asset = true;
  }

  return { client, server, traced, js, css, json, asset };
}

function ndjsonWriter(filePath) {
  let buf = "";
  let count = 0;
  return {
    write(obj) {
      buf += JSON.stringify(obj) + "\\n";
      count++;
    },
    flush() {
      writeFileSync(filePath, buf);
      return count;
    }
  };
}

function main() {
  if (!existsSync(inputDir)) {
    console.error("Input directory not found: " + inputDir);
    process.exit(1);
  }

  mkdirSync(outputDir, { recursive: true });

  const modulesFile = join(inputDir, "modules.data");
  if (!existsSync(modulesFile)) {
    console.error("modules.data not found in " + inputDir);
    process.exit(1);
  }

  const { header: modHeader, binaryView: modBinary } = parseDataFile(modulesFile);
  const modules = modHeader.modules;

  const modulesWriter = ndjsonWriter(join(outputDir, "modules.ndjson"));
  for (let i = 0; i < modules.length; i++) {
    modulesWriter.write({ id: i, ident: modules[i].ident, path: modules[i].path });
  }
  modulesWriter.flush();

  const edgesWriter = ndjsonWriter(join(outputDir, "module_edges.ndjson"));
  for (const [refName, kind] of [
    ["module_dependencies", "sync"],
    ["async_module_dependencies", "async"]
  ]) {
    const ref = modHeader[refName];
    if (!ref) continue;
    for (let i = 0; i < modules.length; i++) {
      for (const target of readEdgesAtIndex(modBinary, ref, i)) {
        edgesWriter.write({ from: i, to: target, kind });
      }
    }
  }
  edgesWriter.flush();

  const routes = discoverRoutes(inputDir);
  const sourcesWriter = ndjsonWriter(join(outputDir, "sources.ndjson"));
  const chunkPartsWriter = ndjsonWriter(join(outputDir, "chunk_parts.ndjson"));
  const outputFilesWriter = ndjsonWriter(join(outputDir, "output_files.ndjson"));
  const routesWriter = ndjsonWriter(join(outputDir, "routes.ndjson"));

  for (const { route, filePath } of routes) {
    const { header, binaryView } = parseDataFile(filePath);
    const { sources, chunk_parts, output_files, source_chunk_parts, source_children, source_roots } = header;

    const fullPaths = buildFullPaths(sources);
    const sourceChunkPartsMap = new Map();

    if (source_chunk_parts && source_chunk_parts.length > 0) {
      for (let i = 0; i < sources.length; i++) {
        const parts = readEdgesAtIndex(binaryView, source_chunk_parts, i);
        if (parts.length > 0) sourceChunkPartsMap.set(i, parts);
      }
    }

    const sourceSizes = new Map();
    for (const [srcIdx, partIndices] of sourceChunkPartsMap) {
      let size = 0;
      let compressedSize = 0;
      for (const cpIdx of partIndices) {
        const cp = chunk_parts[cpIdx];
        if (cp) {
          size += cp.size;
          compressedSize += cp.compressed_size;
        }
      }
      sourceSizes.set(srcIdx, { size, compressed_size: compressedSize });
    }

    const isDirSet = new Set();
    if (source_children && source_children.length > 0) {
      for (let i = 0; i < sources.length; i++) {
        const children = readEdgesAtIndex(binaryView, source_children, i);
        if (children.length > 0) isDirSet.add(i);
      }
    }
    if (source_roots) {
      for (const rootIdx of source_roots) {
        if (isDirSet.has(rootIdx)) continue;
        const children =
          source_children && source_children.length > 0 ? readEdgesAtIndex(binaryView, source_children, rootIdx) : [];
        if (children.length > 0) isDirSet.add(rootIdx);
      }
    }

    let routeTotalSize = 0;
    let routeTotalCompressed = 0;
    for (let i = 0; i < sources.length; i++) {
      const s = sources[i];
      const isDir = isDirSet.has(i);
      const sizes = sourceSizes.get(i);
      const flags = getSourceFlags(i, sourceChunkPartsMap, chunk_parts, output_files);

      const obj = {
        route,
        id: i,
        path: s.path,
        full_path: fullPaths[i],
        parent_id: s.parent_source_index ?? null,
        is_dir: isDir
      };
      if (sizes) {
        obj.size = sizes.size;
        obj.compressed_size = sizes.compressed_size;
        routeTotalSize += sizes.size;
        routeTotalCompressed += sizes.compressed_size;
      }
      if (sourceChunkPartsMap.has(i)) {
        Object.assign(obj, flags);
      }
      sourcesWriter.write(obj);
    }

    for (const cp of chunk_parts) {
      chunkPartsWriter.write({
        route,
        source_id: cp.source_index,
        output_file: output_files[cp.output_file_index]?.filename ?? "<unknown>",
        size: cp.size,
        compressed_size: cp.compressed_size
      });
    }

    const { output_file_chunk_parts } = header;
    for (let i = 0; i < output_files.length; i++) {
      let totalSize = 0;
      let totalCompressed = 0;
      let numParts = 0;
      if (output_file_chunk_parts && output_file_chunk_parts.length > 0) {
        const parts = readEdgesAtIndex(binaryView, output_file_chunk_parts, i);
        for (const cpIdx of parts) {
          const cp = chunk_parts[cpIdx];
          if (cp) {
            totalSize += cp.size;
            totalCompressed += cp.compressed_size;
            numParts++;
          }
        }
      }
      outputFilesWriter.write({
        route,
        id: i,
        filename: output_files[i].filename,
        total_size: totalSize,
        total_compressed_size: totalCompressed,
        num_parts: numParts
      });
    }

    routesWriter.write({
      route,
      total_size: routeTotalSize,
      total_compressed_size: routeTotalCompressed,
      num_sources: sources.length,
      num_output_files: output_files.length
    });
  }

  sourcesWriter.flush();
  chunkPartsWriter.flush();
  outputFilesWriter.flush();
  routesWriter.flush();

  console.log("Output written to " + outputDir + "/");
}

main();
`

type ParsedSemver = { major: number; minor: number; patch: number }

function parseSemverLoose(input: string): ParsedSemver | null {
  const match = input.match(/(\d+)\.(\d+)\.(\d+)/)
  if (!match) return null
  return {
    major: Number.parseInt(match[1] || "0", 10),
    minor: Number.parseInt(match[2] || "0", 10),
    patch: Number.parseInt(match[3] || "0", 10)
  }
}

function isSemverAtLeast(found: ParsedSemver, minimum: ParsedSemver): boolean {
  if (found.major !== minimum.major) return found.major > minimum.major
  if (found.minor !== minimum.minor) return found.minor > minimum.minor
  return found.patch >= minimum.patch
}

type CloudBrowserMode = "agent-browser"

// Cache for agent-browser instance per sandbox
const agentBrowserCache = new Map<string, SandboxAgentBrowser>()
const agentBrowserProfileVersion = new Map<string, number>()
const WORKFLOW_BROWSER_COMMAND_TIMEOUT_MS = 90000

function resolveCloudBrowserMode(devAgentSandboxBrowser: "none" | "agent-browser" | undefined): CloudBrowserMode {
  void devAgentSandboxBrowser
  return "agent-browser"
}

function isRecoverableBrowserError(error: string | undefined): boolean {
  if (!error) return false
  return /Target page, context or browser has been closed|browserType\.launchPersistentContext|browser not open|daemon failed to start|ECONNREFUSED|EPIPE|socket hang up/i.test(
    error
  )
}

/**
 * Get or create an agent-browser instance for the sandbox
 * Uses agent-browser CLI for browser automation (preferred over CDP in cloud)
 */
async function getAgentBrowser(sandbox: Sandbox, debug = false): Promise<SandboxAgentBrowser> {
  const cacheKey = sandbox.sandboxId
  let browser = agentBrowserCache.get(cacheKey)
  if (!browser) {
    const nextVersion = (agentBrowserProfileVersion.get(cacheKey) || 0) + 1
    agentBrowserProfileVersion.set(cacheKey, nextVersion)
    const profilePath = `/tmp/agent-browser-profile-${cacheKey}-${nextVersion}`
    browser = await SandboxAgentBrowser.create(sandbox, {
      profile: profilePath,
      debug,
      timeout: WORKFLOW_BROWSER_COMMAND_TIMEOUT_MS
    })
    workflowLog(`[Browser] Created agent-browser profile ${profilePath}`)
    agentBrowserCache.set(cacheKey, browser)
  }
  return browser
}

/**
 * Navigate browser to URL using the configured browser CLI.
 */
async function navigateBrowser(
  sandbox: Sandbox,
  url: string,
  browserMode: CloudBrowserMode = "agent-browser",
  debug = false,
  timeoutMs?: number
): Promise<{ success: boolean; error?: string }> {
  try {
    const browser = await getAgentBrowser(sandbox, debug)
    const result = await browser.open(url, timeoutMs ? { timeout: timeoutMs } : undefined)
    if (result.success) {
      workflowLog(`[Browser] Navigated to ${url} via ${browserMode}`)
      return { success: true }
    }
    workflowLog(`[Browser] ${browserMode} navigation failed: ${result.error}`)
    if (isRecoverableBrowserError(result.error)) {
      workflowLog(`[Browser] Resetting cached ${browserMode} instance after recoverable navigation failure`)
      agentBrowserCache.delete(sandbox.sandboxId)
      const retryBrowser = await getAgentBrowser(sandbox, debug)
      const retryResult = await retryBrowser.open(url, timeoutMs ? { timeout: timeoutMs } : undefined)
      if (retryResult.success) {
        workflowLog(`[Browser] Navigated to ${url} via ${browserMode} (retry)`)
        return { success: true }
      }
      workflowLog(`[Browser] ${browserMode} navigation retry failed: ${retryResult.error}`)
    }
  } catch (error) {
    workflowLog(`[Browser] ${browserMode} error: ${error instanceof Error ? error.message : String(error)}`)
    if (isRecoverableBrowserError(error instanceof Error ? error.message : String(error))) {
      agentBrowserCache.delete(sandbox.sandboxId)
    }
  }

  return { success: false, error: `${browserMode} navigation failed` }
}

/**
 * Reload browser page using the configured browser CLI.
 */
async function reloadBrowser(
  sandbox: Sandbox,
  browserMode: CloudBrowserMode = "agent-browser",
  debug = false,
  timeoutMs?: number
): Promise<{ success: boolean; error?: string }> {
  try {
    const browser = await getAgentBrowser(sandbox, debug)
    const result = await browser.reload(timeoutMs ? { timeout: timeoutMs } : undefined)
    if (result.success) {
      workflowLog(`[Browser] Page reloaded via ${browserMode}`)
      return { success: true }
    }
    workflowLog(`[Browser] ${browserMode} reload failed: ${result.error}`)
    if (isRecoverableBrowserError(result.error)) {
      workflowLog(`[Browser] Resetting cached ${browserMode} instance after recoverable reload failure`)
      agentBrowserCache.delete(sandbox.sandboxId)
      const retryBrowser = await getAgentBrowser(sandbox, debug)
      const retryResult = await retryBrowser.reload(timeoutMs ? { timeout: timeoutMs } : undefined)
      if (retryResult.success) {
        workflowLog(`[Browser] Page reloaded via ${browserMode} (retry)`)
        return { success: true }
      }
      workflowLog(`[Browser] ${browserMode} reload retry failed: ${retryResult.error}`)
    }
  } catch (error) {
    workflowLog(`[Browser] ${browserMode} error: ${error instanceof Error ? error.message : String(error)}`)
    if (isRecoverableBrowserError(error instanceof Error ? error.message : String(error))) {
      agentBrowserCache.delete(sandbox.sandboxId)
    }
  }

  return { success: false, error: `${browserMode} reload failed` }
}

/**
 * Evaluate JavaScript in browser using the configured browser CLI.
 */
async function evaluateInBrowser(
  sandbox: Sandbox,
  expression: string,
  browserMode: CloudBrowserMode = "agent-browser",
  debug = false,
  timeoutMs?: number
): Promise<{ success: boolean; result?: unknown; error?: string }> {
  try {
    const browser = await getAgentBrowser(sandbox, debug)
    const result = await browser.evaluate(expression, timeoutMs ? { timeout: timeoutMs } : undefined)
    if (result.success) {
      return { success: true, result: result.data }
    }
    if (isRecoverableBrowserError(result.error)) {
      workflowLog(`[Browser] Resetting cached ${browserMode} instance after recoverable evaluate failure`)
      agentBrowserCache.delete(sandbox.sandboxId)
      const retryBrowser = await getAgentBrowser(sandbox, debug)
      const retryResult = await retryBrowser.evaluate(expression, timeoutMs ? { timeout: timeoutMs } : undefined)
      if (retryResult.success) {
        return { success: true, result: retryResult.data }
      }
      return { success: false, error: retryResult.error }
    }
    return { success: false, error: result.error }
  } catch (error) {
    if (isRecoverableBrowserError(error instanceof Error ? error.message : String(error))) {
      agentBrowserCache.delete(sandbox.sandboxId)
    }
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

function buildWebVitalsInitScript(): string {
  return `(function() {
    const supported = (PerformanceObserver && PerformanceObserver.supportedEntryTypes) || []
    const store = (window.__d3kVitals = window.__d3kVitals || {
      lcp: [],
      cls: [],
      event: [],
      paint: [],
      nav: null
    })

    const addEntries = (target, entries) => {
      if (!entries) return
      for (const entry of entries) target.push(entry)
    }

    try {
      addEntries(store.lcp, performance.getEntriesByType('largest-contentful-paint'))
      addEntries(store.cls, performance.getEntriesByType('layout-shift'))
      addEntries(store.event, performance.getEntriesByType('event'))
      addEntries(store.paint, performance.getEntriesByType('paint'))
      store.nav = performance.getEntriesByType('navigation')[0] || performance.timing || null
    } catch {}

    try {
      if (supported.includes('largest-contentful-paint')) {
        const observer = new PerformanceObserver((list) => addEntries(store.lcp, list.getEntries()))
        observer.observe({ type: 'largest-contentful-paint', buffered: true })
      }
      if (supported.includes('layout-shift')) {
        const observer = new PerformanceObserver((list) => addEntries(store.cls, list.getEntries()))
        observer.observe({ type: 'layout-shift', buffered: true })
      }
      if (supported.includes('event')) {
        const observer = new PerformanceObserver((list) => addEntries(store.event, list.getEntries()))
        observer.observe({ type: 'event', buffered: true, durationThreshold: 0 })
      }
      if (supported.includes('paint')) {
        const observer = new PerformanceObserver((list) => addEntries(store.paint, list.getEntries()))
        observer.observe({ type: 'paint', buffered: true })
      }
    } catch {}

    return 'ok'
  })()`
}

function buildWebVitalsReadScript(): string {
  return `(function() {
    const result = { lcp: null, fcp: null, ttfb: null, cls: 0, fid: null, inp: null }
    const store = window.__d3kVitals || {}
    const navTiming = store.nav || performance.getEntriesByType('navigation')[0] || performance.timing
    result.ttfb = navTiming?.responseStart
      ? (navTiming.responseStart - (navTiming.startTime || navTiming.navigationStart || 0))
      : null

    const lcpEntries = (store.lcp || []).concat(performance.getEntriesByType('largest-contentful-paint') || [])
    const paintEntries = (store.paint || []).concat(performance.getEntriesByType('paint') || [])
    const fcpEntries = paintEntries.filter((entry) => entry.name === 'first-contentful-paint')
    const clsEntries = (store.cls || []).concat(performance.getEntriesByType('layout-shift') || [])
    const fidEntries = performance.getEntriesByType('first-input')
    const eventEntries = (store.event || []).concat(performance.getEntriesByType('event') || [])

    if (lcpEntries.length > 0) {
      result.lcp = lcpEntries[lcpEntries.length - 1].startTime
    }
    if (fcpEntries.length > 0) {
      result.fcp = fcpEntries[0].startTime
    }
    result.cls = clsEntries.reduce((sum, e) => sum + (e.hadRecentInput ? 0 : e.value), 0)
    if (fidEntries.length > 0) {
      result.fid = fidEntries[0].processingStart - fidEntries[0].startTime
    }

    if (eventEntries.length > 0) {
      const byInteraction = new Map()
      for (const entry of eventEntries) {
        if (!('interactionId' in entry) || entry.interactionId === 0) continue
        const existing = byInteraction.get(entry.interactionId)
        if (!existing || entry.duration > existing.duration) {
          byInteraction.set(entry.interactionId, entry)
        }
      }
      let maxDuration = 0
      for (const entry of byInteraction.values()) {
        if (entry.duration > maxDuration) maxDuration = entry.duration
      }
      if (maxDuration > 0) {
        result.inp = maxDuration
      }
    }

    return JSON.stringify(result)
  })()`
}

function extractWebVitalsResultString(evalResult: { success: boolean; result?: unknown }): string | null {
  if (!evalResult.success || !evalResult.result) return null

  if (typeof evalResult.result === "string") return evalResult.result

  if (typeof evalResult.result === "object" && evalResult.result !== null) {
    const result = evalResult.result as {
      result?: string
      value?: string
      data?: { result?: string; value?: string }
    }
    if (typeof result.result === "string") return result.result
    if (typeof result.value === "string") return result.value
    if (typeof result.data?.result === "string") return result.data.result
    if (typeof result.data?.value === "string") return result.data.value
  }

  return null
}

type RawWebVitalsSample = {
  lcp: number | null
  fcp: number | null
  ttfb: number | null
  cls: number | null
  inp: number | null
}

function gradeWebVitalValue(
  metric: keyof import("@/types").WebVitals,
  value: number
): "good" | "needs-improvement" | "poor" {
  if (metric === "cls") {
    if (value <= 0.1) return "good"
    if (value <= 0.25) return "needs-improvement"
    return "poor"
  }

  if (metric === "fcp") {
    if (value <= 1800) return "good"
    if (value <= 3000) return "needs-improvement"
    return "poor"
  }

  if (metric === "ttfb") {
    if (value <= 800) return "good"
    if (value <= 1800) return "needs-improvement"
    return "poor"
  }

  if (metric === "inp") {
    if (value <= 200) return "good"
    if (value <= 500) return "needs-improvement"
    return "poor"
  }

  if (value <= 2500) return "good"
  if (value <= 4000) return "needs-improvement"
  return "poor"
}

function rawWebVitalsToVitals(raw: RawWebVitalsSample | null | undefined): import("@/types").WebVitals {
  if (!raw) return {}

  const vitals: import("@/types").WebVitals = {}
  const metrics: Array<keyof import("@/types").WebVitals> = ["lcp", "fcp", "ttfb", "cls", "inp"]
  for (const metric of metrics) {
    const value = raw[metric]
    if (typeof value !== "number") continue
    vitals[metric] = {
      value,
      grade: gradeWebVitalValue(metric, value)
    }
  }

  return vitals
}

function aggregateWebVitalSamples(samples: import("@/types").WebVitals[]): import("@/types").WebVitals {
  const keys: Array<keyof import("@/types").WebVitals> = ["lcp", "fcp", "ttfb", "cls", "inp"]
  const aggregated: import("@/types").WebVitals = {}

  for (const key of keys) {
    const values = samples
      .map((sample) => sample[key]?.value)
      .filter((value): value is number => typeof value === "number")
    if (values.length === 0) continue

    const mean = values.reduce((sum, value) => sum + value, 0) / values.length
    aggregated[key] = {
      value: key === "cls" ? Number(mean.toFixed(4)) : Number(mean.toFixed(0)),
      grade: gradeWebVitalValue(key, mean)
    }
  }

  return aggregated
}

/**
 * Take a screenshot using the configured browser CLI.
 */
async function _screenshotBrowser(
  sandbox: Sandbox,
  outputPath: string,
  options: { fullPage?: boolean; timeoutMs?: number } = {},
  browserMode: CloudBrowserMode = "agent-browser",
  debug = false
): Promise<{ success: boolean; error?: string }> {
  try {
    const result = await (await getAgentBrowser(sandbox, debug)).screenshot(outputPath, {
      fullPage: options.fullPage,
      timeout: options.timeoutMs
    })
    if (result.success) {
      workflowLog(`[Browser] Screenshot saved to ${outputPath} via ${browserMode}`)
      return { success: true }
    }
    workflowLog(`[Browser] ${browserMode} screenshot failed: ${result.error}`)
    return { success: false, error: result.error }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

function sanitizeScreenshotPathSegment(value: string): string {
  return (
    value
      .replace(/^\//, "")
      .replace(/\//g, "-")
      .replace(/[^a-zA-Z0-9-_]/g, "")
      .slice(0, 60) || "root"
  )
}

async function uploadSandboxScreenshot(
  sandbox: Sandbox,
  screenshotPath: string,
  projectName: string,
  kind: string,
  route: string
): Promise<string | null> {
  try {
    const base64Result = await runSandboxCommandWithOptions(
      sandbox,
      {
        cmd: "base64",
        args: ["-w", "0", screenshotPath]
      },
      {
        timeoutMs: 10000
      }
    )

    if (base64Result.exitCode !== 0 || !base64Result.stdout.trim()) {
      return null
    }

    const imageBuffer = Buffer.from(base64Result.stdout, "base64")
    if (imageBuffer.length === 0) {
      return null
    }

    const blob = await putBlobAndBuildUrl(
      `workflow-${sanitizeScreenshotPathSegment(projectName)}-${kind}-${sanitizeScreenshotPathSegment(route)}-${Date.now()}.png`,
      imageBuffer,
      {
        contentType: "image/png",
        absoluteUrl: true
      }
    )

    return blob.appUrl
  } catch (error) {
    workflowLog(
      `[Browser] Failed to upload sandbox screenshot ${screenshotPath}: ${error instanceof Error ? error.message : String(error)}`
    )
    return null
  }
}

async function capturePhaseScreenshot(
  sandbox: Sandbox,
  route: string,
  browserMode: CloudBrowserMode,
  projectName: string,
  kind: string,
  label: string,
  targetUrl?: string,
  waitMs = 8000
): Promise<Array<{ timestamp: number; blobUrl: string; label?: string }>> {
  const screenshotPath = `/tmp/${kind}-${Date.now()}.png`
  const screenshotResult = await Promise.race([
    captureSandboxScreenshot(sandbox, screenshotPath, browserMode, targetUrl, waitMs),
    new Promise<{ success: false; error: string }>((resolve) =>
      setTimeout(() => resolve({ success: false, error: "Screenshot capture exceeded outer timeout" }), 20000)
    )
  ])
  if (!screenshotResult.success) {
    workflowLog(
      `[Browser] ${browserMode} screenshot capture failed${targetUrl ? ` for ${targetUrl}` : ""}: ${screenshotResult.error || "unknown error"}`
    )
    return []
  }

  const blobUrl = await uploadSandboxScreenshot(sandbox, screenshotPath, projectName, kind, route)
  if (!blobUrl) {
    return []
  }

  return [
    {
      timestamp: Date.now(),
      blobUrl,
      label
    }
  ]
}

async function capturePhaseEvidenceViaCDP(
  sandbox: Sandbox,
  route: string,
  projectName: string,
  kind: string,
  label: string,
  targetUrl: string,
  options?: {
    sampleCount?: number
    navigationTimeoutMs?: number
    settleMs?: number
    overallTimeoutMs?: number
  }
): Promise<{
  vitals: import("@/types").WebVitals
  screenshots: Array<{ timestamp: number; blobUrl: string; label?: string }>
  diagnosticLogs: string[]
}> {
  const diagnosticLogs: string[] = []
  const diagLog = (message: string) => {
    workflowLog(message)
    diagnosticLogs.push(message)
  }

  const { sessionPath, session } = await readLatestSandboxSession(sandbox)
  const cdpUrl = extractSandboxCdpUrl(session)
  if (!cdpUrl) {
    diagLog(`[Evidence] No sandbox CDP URL available${sessionPath ? ` in ${sessionPath}` : ""}`)
    return { vitals: {}, screenshots: [], diagnosticLogs }
  }

  const screenshotPath = `/tmp/${kind}-${Date.now()}.png`
  const initScript = JSON.stringify(buildWebVitalsInitScript())
  const readScript = JSON.stringify(buildWebVitalsReadScript())
  const sampleCount = Math.max(1, options?.sampleCount ?? 3)
  const navigationTimeoutMs = Math.max(1500, options?.navigationTimeoutMs ?? 4000)
  const settleMs = Math.max(250, options?.settleMs ?? 750)
  const overallTimeoutMs = Math.max(5000, options?.overallTimeoutMs ?? 18000)

  const captureScript = `
import fs from "node:fs"

const cdpUrl = process.env.D3K_CDP_URL
const targetUrl = process.env.D3K_TARGET_URL
const outputPath = process.env.D3K_SCREENSHOT_PATH
const sampleCount = Number.parseInt(process.env.D3K_SAMPLE_COUNT || "3", 10)
const navigationTimeoutMs = Number.parseInt(process.env.D3K_NAV_TIMEOUT_MS || "4000", 10)
const settleMs = Number.parseInt(process.env.D3K_SETTLE_MS || "750", 10)

if (!cdpUrl) throw new Error("Missing D3K_CDP_URL")
if (!targetUrl) throw new Error("Missing D3K_TARGET_URL")
if (!outputPath) throw new Error("Missing D3K_SCREENSHOT_PATH")

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const browser = new WebSocket(cdpUrl)
let nextId = 0
const pending = new Map()
let pageLoadResolver = null

const send = (method, params = {}, sessionId) =>
  new Promise((resolve, reject) => {
    const id = ++nextId
    pending.set(id, { resolve, reject })
    browser.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }))
  })

browser.onmessage = (event) => {
  const message = JSON.parse(event.data)
  if (message.method === "Page.loadEventFired" && message.sessionId && pageLoadResolver) {
    const resolve = pageLoadResolver
    pageLoadResolver = null
    resolve()
    return
  }

  if (!message.id || !pending.has(message.id)) return
  const { resolve, reject } = pending.get(message.id)
  pending.delete(message.id)
  if (message.error) reject(new Error(JSON.stringify(message.error)))
  else resolve(message.result)
}

await new Promise((resolve, reject) => {
  browser.onopen = resolve
  browser.onerror = () => reject(new Error("Failed to connect to sandbox CDP"))
})

let targetId = null
let sessionId = null
let createdTarget = false

const cleanup = async () => {
  try {
    if (sessionId) await send("Target.detachFromTarget", { sessionId })
  } catch {}
  try {
    if (createdTarget && targetId) await send("Target.closeTarget", { targetId })
  } catch {}
  browser.close()
}

const normalizedTargetUrl = targetUrl.replace(/\\/$/, "")
const matchesTargetUrl = (info) => {
  if (!info || info.type !== "page" || typeof info.url !== "string") return false
  const normalizedInfoUrl = info.url.replace(/\\/$/, "")
  return (
    normalizedInfoUrl === normalizedTargetUrl ||
    normalizedInfoUrl.startsWith(normalizedTargetUrl) ||
    normalizedTargetUrl.startsWith(normalizedInfoUrl) ||
    normalizedInfoUrl.startsWith("http://localhost:3000")
  )
}

const waitForLoad = async () => {
  const loadPromise = new Promise((resolve) => {
    pageLoadResolver = resolve
  })
  await Promise.race([loadPromise, delay(navigationTimeoutMs)])
  pageLoadResolver = null
}

const parseEvalString = (value) => {
  if (typeof value !== "string") return null
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

const getPageDiagnostics = async () => {
  const diagnosticsResult = await send(
    "Runtime.evaluate",
    {
      expression: \`
        JSON.stringify({
          href: location.href,
          title: document.title,
          readyState: document.readyState,
          bodyTextLength: document.body?.innerText?.trim().length ?? 0,
          bodyHtmlLength: document.body?.innerHTML?.length ?? 0,
          bodyScrollHeight: document.body?.scrollHeight ?? 0
        })
      \`,
      returnByValue: true,
      awaitPromise: true
    },
    sessionId
  ).catch(() => null)

  return parseEvalString(diagnosticsResult?.result?.value)
}

try {
  const targetList = await send("Target.getTargets")
  const targetInfos = Array.isArray(targetList.targetInfos) ? targetList.targetInfos : []
  const existingTarget = targetInfos.find(matchesTargetUrl) || null

  if (existingTarget?.targetId) {
    targetId = existingTarget.targetId
    await send("Target.activateTarget", { targetId })
  } else {
    const created = await send("Target.createTarget", { url: "about:blank" })
    targetId = created.targetId
    createdTarget = true
  }

  const attached = await send("Target.attachToTarget", { targetId, flatten: true })
  sessionId = attached.sessionId

  await send("Page.enable", {}, sessionId)
  await send("Runtime.enable", {}, sessionId)
  await send("Page.bringToFront", {}, sessionId)
  await send("Page.addScriptToEvaluateOnNewDocument", { source: ${initScript} }, sessionId)

  const rawSamples = []

  for (let attempt = 0; attempt < sampleCount; attempt++) {
    if (attempt === 0) {
      await send("Page.navigate", { url: targetUrl }, sessionId)
    } else {
      await send("Page.reload", { ignoreCache: true }, sessionId)
    }

    await waitForLoad()
    await delay(settleMs)
    await send(
      "Runtime.evaluate",
      {
        expression: ${initScript},
        returnByValue: true,
        awaitPromise: true
      },
      sessionId
    ).catch(() => null)
    await send(
      "Runtime.evaluate",
      {
        expression: "document.body?.dispatchEvent(new MouseEvent('click', { bubbles: true })); document.dispatchEvent(new MouseEvent('click', { bubbles: true })); 'lcp-finalized'",
        returnByValue: true,
        awaitPromise: true
      },
      sessionId
    ).catch(() => null)
    await delay(200)

    const evalResult = await send(
      "Runtime.evaluate",
      {
        expression: ${readScript},
        returnByValue: true,
        awaitPromise: true
      },
      sessionId
    )

    const parsed = parseEvalString(evalResult?.result?.value)
    if (parsed) {
      rawSamples.push(parsed)
    }
  }

  const screenshot = await send(
    "Page.captureScreenshot",
    {
      format: "png",
      fromSurface: true
    },
    sessionId
  )

  let screenshotByteLength = 0
  if (screenshot?.data) {
    const buffer = Buffer.from(screenshot.data, "base64")
    screenshotByteLength = buffer.byteLength
    fs.writeFileSync(outputPath, buffer)
  }

  console.log(
    JSON.stringify({
      rawSamples,
      screenshotCaptured: Boolean(screenshot?.data),
      screenshotByteLength,
      pageDiagnostics: await getPageDiagnostics()
    })
  )
  await cleanup()
} catch (error) {
  await cleanup()
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
`

  const result = await Promise.race([
    runSandboxCommandWithOptions(
      sandbox,
      {
        cmd: "node",
        args: ["--input-type=module", "-e", captureScript],
        env: {
          D3K_CDP_URL: cdpUrl,
          D3K_TARGET_URL: targetUrl,
          D3K_SCREENSHOT_PATH: screenshotPath,
          D3K_SAMPLE_COUNT: String(sampleCount),
          D3K_NAV_TIMEOUT_MS: String(navigationTimeoutMs),
          D3K_SETTLE_MS: String(settleMs)
        }
      },
      {
        timeoutMs: overallTimeoutMs
      }
    ),
    new Promise<{ exitCode: number; stdout: string; stderr: string }>((resolve) =>
      setTimeout(
        () =>
          resolve({
            exitCode: 124,
            stdout: "",
            stderr: "CDP evidence capture exceeded outer timeout"
          }),
        overallTimeoutMs + 1000
      )
    )
  ])

  if (result.exitCode !== 0 || !result.stdout.trim()) {
    diagLog(`[Evidence] CDP capture failed: ${result.stderr.trim() || result.stdout.trim() || "no output"}`)
    return { vitals: {}, screenshots: [], diagnosticLogs }
  }

  try {
    const parsed = JSON.parse(result.stdout.trim()) as {
      rawSamples?: RawWebVitalsSample[]
      screenshotCaptured?: boolean
      screenshotByteLength?: number
      pageDiagnostics?: Record<string, unknown> | null
    }
    const samples = (parsed.rawSamples || [])
      .map((raw) => rawWebVitalsToVitals(raw))
      .filter((sample) => Object.keys(sample).length > 0)
    const vitals = samples.length > 0 ? aggregateWebVitalSamples(samples) : {}
    diagLog(
      `[Evidence] Captured ${samples.length} CDP sample${samples.length === 1 ? "" : "s"} for ${targetUrl}: ${JSON.stringify(vitals)}`
    )
    if (parsed.pageDiagnostics) {
      diagLog(`[Evidence] Page diagnostics for ${targetUrl}: ${JSON.stringify(parsed.pageDiagnostics)}`)
    }

    let screenshots: Array<{ timestamp: number; blobUrl: string; label?: string }> = []
    if (parsed.screenshotCaptured) {
      const screenshotHealth = await isLikelyBlankScreenshot(sandbox, screenshotPath)
      if (screenshotHealth.blank) {
        diagLog(
          `[Evidence] CDP screenshot was blank for ${targetUrl} (${screenshotHealth.fileSize ?? parsed.screenshotByteLength ?? 0} bytes)`
        )
      }

      const blobUrl = screenshotHealth.blank
        ? null
        : await uploadSandboxScreenshot(sandbox, screenshotPath, projectName, kind, route)
      if (blobUrl) {
        screenshots = [
          {
            timestamp: Date.now(),
            blobUrl,
            label
          }
        ]
      } else {
        diagLog(
          `[Evidence] Screenshot upload failed for ${targetUrl} (${parsed.screenshotByteLength ?? screenshotHealth.fileSize ?? 0} bytes)`
        )
      }
    } else {
      diagLog(`[Evidence] CDP screenshot returned no image data for ${targetUrl}`)
    }

    return { vitals, screenshots, diagnosticLogs }
  } catch (error) {
    diagLog(`[Evidence] Failed to parse CDP evidence JSON: ${error instanceof Error ? error.message : String(error)}`)
    return { vitals: {}, screenshots: [], diagnosticLogs }
  }
}

const MIN_NON_BLANK_SCREENSHOT_BYTES = 4500

function extractLatestD3kScreenshotPath(logs: string): string | null {
  const preferredMatches = [
    ...logs.matchAll(/\[BROWSER\]\s+\[SCREENSHOT\]\s+(\S+(?:page-loaded|navigation-settled)\.png)/g)
  ]
  if (preferredMatches.length > 0) {
    return preferredMatches[preferredMatches.length - 1][1]
  }

  const cdpMatches = [...logs.matchAll(/\[BROWSER\]\s+\[CDP\]\s+(?:Before|After):\s+(\S+\.png)/g)]
  if (cdpMatches.length > 0) {
    return cdpMatches[cdpMatches.length - 1][1]
  }

  const genericMatches = [...logs.matchAll(/\[BROWSER\]\s+\[SCREENSHOT\]\s+(\S+\.png)/g)]
    .map((match) => match[1])
    .filter((path) => !path.endsWith("-error.png"))
  if (genericMatches.length > 0) {
    return genericMatches[genericMatches.length - 1]
  }

  return null
}

async function captureD3kScreenshotFromLogs(
  sandbox: Sandbox,
  logs: string,
  projectName: string,
  kind: string,
  label: string,
  route: string
): Promise<Array<{ timestamp: number; blobUrl: string; label?: string }>> {
  const screenshotPath = extractLatestD3kScreenshotPath(logs)
  if (!screenshotPath) {
    return []
  }

  const blobUrl = await uploadSandboxScreenshot(sandbox, screenshotPath, projectName, kind, route)
  if (!blobUrl) {
    return []
  }

  return [
    {
      timestamp: Date.now(),
      blobUrl,
      label
    }
  ]
}

async function getSandboxFileSize(sandbox: Sandbox, filePath: string): Promise<number | null> {
  const result = await runSandboxCommandWithOptions(
    sandbox,
    {
      cmd: "sh",
      args: ["-c", `wc -c < ${JSON.stringify(filePath)}`]
    },
    {
      timeoutMs: 5000
    }
  )

  if (result.exitCode !== 0) {
    return null
  }

  const parsed = Number.parseInt(result.stdout.trim(), 10)
  return Number.isFinite(parsed) ? parsed : null
}

async function isLikelyBlankScreenshot(
  sandbox: Sandbox,
  screenshotPath: string
): Promise<{ blank: boolean; fileSize: number | null }> {
  const fileSize = await getSandboxFileSize(sandbox, screenshotPath)
  if (fileSize === null) {
    return { blank: false, fileSize: null }
  }

  return {
    blank: fileSize > 0 && fileSize < MIN_NON_BLANK_SCREENSHOT_BYTES,
    fileSize
  }
}

async function captureScreenshotViaBrowserCli(
  sandbox: Sandbox,
  screenshotPath: string,
  browserMode: CloudBrowserMode,
  targetUrl: string,
  waitMs: number
): Promise<{ success: boolean; error?: string }> {
  const screenshotCommandTimeoutMs = 5000
  let lastError = `${browserMode} screenshot failed`

  for (const [attemptIndex, attemptWaitMs] of [waitMs, Math.max(waitMs * 2, 10000)].entries()) {
    const navResult = await navigateBrowser(sandbox, targetUrl, browserMode, false, screenshotCommandTimeoutMs)
    if (!navResult.success) {
      lastError = navResult.error || `${browserMode} navigation failed`
      continue
    }

    await new Promise((resolve) => setTimeout(resolve, Math.max(2000, Math.min(attemptWaitMs, 10000))))

    const pageDiagnostics = await evaluateInBrowser(
      sandbox,
      `JSON.stringify({
        href: location.href,
        readyState: document.readyState,
        title: document.title,
        bodyTextLength: document.body?.innerText?.trim().length ?? 0,
        bodyHtmlLength: document.body?.innerHTML?.length ?? 0,
        bodyScrollHeight: document.body?.scrollHeight ?? 0
      })`,
      browserMode,
      false,
      screenshotCommandTimeoutMs
    )

    const diagnosticsValue = extractWebVitalsResultString(pageDiagnostics)
    if (diagnosticsValue) {
      workflowLog(
        `[Browser] ${browserMode} screenshot page diagnostics (attempt ${attemptIndex + 1}): ${diagnosticsValue}`
      )
    }

    const screenshotResult = await _screenshotBrowser(
      sandbox,
      screenshotPath,
      { fullPage: false, timeoutMs: screenshotCommandTimeoutMs },
      browserMode
    )
    if (!screenshotResult.success) {
      lastError = screenshotResult.error || `${browserMode} screenshot failed`
      continue
    }

    const screenshotHealth = await isLikelyBlankScreenshot(sandbox, screenshotPath)
    if (!screenshotHealth.blank) {
      return { success: true }
    }

    lastError = `blank screenshot detected (${screenshotHealth.fileSize} bytes)`
    workflowLog(
      `[Browser] ${browserMode} screenshot attempt ${attemptIndex + 1} was blank for ${targetUrl} (${screenshotHealth.fileSize} bytes)`
    )
  }

  return {
    success: false,
    error: lastError
  }
}

async function captureSandboxScreenshot(
  sandbox: Sandbox,
  screenshotPath: string,
  browserMode: CloudBrowserMode,
  targetUrl?: string,
  waitMs = 8000
): Promise<{ success: boolean; error?: string }> {
  if (targetUrl) {
    const browserCliResult = await captureScreenshotViaBrowserCli(
      sandbox,
      screenshotPath,
      browserMode,
      targetUrl,
      waitMs
    )
    if (browserCliResult.success) {
      return { success: true }
    }

    workflowLog(
      `[Browser] ${browserMode} navigation-aware screenshot failed for ${targetUrl}: ${browserCliResult.error || "unknown error"}`
    )
  }

  const cdpResult = await captureScreenshotViaCDP(sandbox, screenshotPath, targetUrl)
  if (cdpResult.success) {
    const screenshotHealth = await isLikelyBlankScreenshot(sandbox, screenshotPath)
    if (!screenshotHealth.blank) {
      return { success: true }
    }

    workflowLog(
      `[Browser] CDP screenshot was blank${targetUrl ? ` for ${targetUrl}` : ""} (${screenshotHealth.fileSize} bytes)`
    )
  }

  workflowLog(
    `[Browser] CDP screenshot failed${targetUrl ? ` for ${targetUrl}` : ""}: ${cdpResult.error || "unknown error"}`
  )

  const screenshotResult = await _screenshotBrowser(
    sandbox,
    screenshotPath,
    { fullPage: false, timeoutMs: 8000 },
    browserMode
  )
  if (!screenshotResult.success) {
    if (targetUrl) {
      const chromiumResult = await captureScreenshotWithSandboxChromium(sandbox, screenshotPath, targetUrl, waitMs)
      if (chromiumResult.success) {
        return { success: true }
      }

      workflowLog(
        `[Browser] Chromium URL screenshot failed for ${targetUrl}: ${chromiumResult.error || "unknown error"}`
      )

      return {
        success: false,
        error: chromiumResult.error || screenshotResult.error || cdpResult.error || "screenshot capture failed"
      }
    }

    return {
      success: false,
      error: screenshotResult.error || cdpResult.error || "screenshot capture failed"
    }
  }

  const screenshotHealth = await isLikelyBlankScreenshot(sandbox, screenshotPath)
  if (screenshotHealth.blank) {
    workflowLog(
      `[Browser] ${browserMode} screenshot was blank${targetUrl ? ` for ${targetUrl}` : ""} (${screenshotHealth.fileSize} bytes)`
    )
    if (targetUrl) {
      const chromiumResult = await captureScreenshotWithSandboxChromium(sandbox, screenshotPath, targetUrl, waitMs)
      if (chromiumResult.success) {
        const chromiumHealth = await isLikelyBlankScreenshot(sandbox, screenshotPath)
        if (!chromiumHealth.blank) {
          return { success: true }
        }

        workflowLog(`[Browser] Chromium screenshot was blank for ${targetUrl} (${chromiumHealth.fileSize} bytes)`)
      }

      return {
        success: false,
        error: chromiumResult.error || "screenshot capture failed"
      }
    }

    return {
      success: false,
      error: `blank screenshot detected (${screenshotHealth.fileSize} bytes)`
    }
  }

  return { success: true }
}

// Progress context for updating workflow status
interface ProgressContext {
  userId: string
  timestamp: string
  runId: string
  projectName: string
  workflowType?: string
  runnerKind?: "dev-agent" | "skill-runner"
  devAgentId?: string
  devAgentName?: string
  devAgentDescription?: string
  devAgentRevision?: number
  devAgentSpecHash?: string
  skillRunnerCanonicalPath?: string
  skillRunnerValidationWarning?: string
  devAgentExecutionMode?: "dev-server" | "preview-pr"
  devAgentSandboxBrowser?: "none" | "agent-browser"
  isMarketplaceAgent?: boolean
  controlPlaneMirrorTarget?: WorkflowRunMirrorTarget
  activeStepNumber?: number
  activeCurrentStep?: string
  sandboxUrl?: string
  progressLogs?: string[]
  runSnapshot?: WorkflowRun
}

const WORKFLOW_SANDBOX_TIMEOUT = "60m" as const
const PROGRESS_LOG_DELIMITER = "||"

function buildProgressLogLine(message: string, timestamp = new Date().toISOString()): string {
  return `${timestamp}${PROGRESS_LOG_DELIMITER}${message}`
}

function mergeProgressLogs(primary: string[] | undefined, secondary: string[] | undefined, limit: number): string[] {
  const merged: string[] = []
  const seen = new Set<string>()
  for (const line of [...(secondary ?? []), ...(primary ?? [])]) {
    if (!line || seen.has(line)) continue
    seen.add(line)
    merged.push(line)
  }
  return merged.slice(-limit)
}

function sanitizeEarlyExitReason(reason: string, observation: ObserveResult): string {
  const normalized = reason.trim()
  if (!normalized) {
    return observation.skillsInstalled.length > 0
      ? "The required skills were installed, but the baseline evidence was insufficient to justify a concrete, non-speculative change."
      : "Baseline evidence was insufficient to justify a concrete, non-speculative change."
  }

  if (observation.skillsInstalled.length > 0 && /no skills are installed/i.test(normalized)) {
    return "The required skills were installed, but the baseline evidence was insufficient to justify a concrete, non-speculative change."
  }

  return normalized
}

async function getProgressRunSnapshot(ctx: ProgressContext): Promise<WorkflowRun | undefined> {
  if (ctx.runSnapshot) {
    return ctx.runSnapshot
  }

  const existingRun = (await listWorkflowRuns(ctx.userId)).find((run) => run.id === ctx.runId)
  if (existingRun) {
    ctx.runSnapshot = existingRun
  }
  return existingRun
}

// Helper to update workflow progress
async function updateProgress(
  ctx: ProgressContext | null | undefined,
  stepNumber: number,
  currentStep: string,
  sandboxUrl?: string
) {
  if (!ctx) return
  try {
    const existingRun = await getProgressRunSnapshot(ctx)
    ctx.activeStepNumber = stepNumber
    ctx.activeCurrentStep = currentStep
    ctx.sandboxUrl = sandboxUrl ?? ctx.sandboxUrl ?? existingRun?.sandboxUrl
    const nextLogLine = buildProgressLogLine(currentStep)
    const existingLogs = mergeProgressLogs(
      Array.isArray(ctx.progressLogs) ? ctx.progressLogs : undefined,
      Array.isArray(existingRun?.progressLogs) ? existingRun.progressLogs : undefined,
      80
    )
    const progressLogs =
      existingLogs[existingLogs.length - 1] === nextLogLine
        ? existingLogs.slice(-40)
        : [...existingLogs, nextLogLine].slice(-40)

    const nextRun = {
      ...existingRun,
      id: ctx.runId,
      userId: ctx.userId,
      projectName: ctx.projectName,
      timestamp: ctx.timestamp,
      status: "running",
      type: (ctx.workflowType as WorkflowType) || existingRun?.type || "cls-fix",
      runnerKind: ctx.runnerKind ?? existingRun?.runnerKind,
      devAgentId: ctx.devAgentId,
      devAgentName: ctx.devAgentName,
      devAgentDescription: ctx.devAgentDescription,
      devAgentRevision: ctx.devAgentRevision,
      devAgentSpecHash: ctx.devAgentSpecHash,
      skillRunnerCanonicalPath: ctx.skillRunnerCanonicalPath ?? existingRun?.skillRunnerCanonicalPath,
      skillRunnerValidationWarning: ctx.skillRunnerValidationWarning ?? existingRun?.skillRunnerValidationWarning,
      devAgentExecutionMode: ctx.devAgentExecutionMode,
      devAgentSandboxBrowser: ctx.devAgentSandboxBrowser,
      stepNumber,
      currentStep,
      sandboxUrl: ctx.sandboxUrl,
      progressLogs
    } satisfies WorkflowRun
    await persistWorkflowRun(nextRun, { mirrorTarget: ctx.controlPlaneMirrorTarget })
    ctx.runSnapshot = nextRun
    ctx.progressLogs = progressLogs
    workflowLog(`[Progress] Updated: Step ${stepNumber} - ${currentStep}`)
  } catch (err) {
    workflowLog(`[Progress] Failed to update: ${err instanceof Error ? err.message : String(err)}`)
  }
}

async function appendProgressLog(ctx: ProgressContext | null | undefined, message: string) {
  if (!ctx) return
  try {
    const existingRun = await getProgressRunSnapshot(ctx)
    const nextLogLine = buildProgressLogLine(message)
    const existingLogs = mergeProgressLogs(
      Array.isArray(ctx.progressLogs) ? ctx.progressLogs : undefined,
      Array.isArray(existingRun?.progressLogs) ? existingRun.progressLogs : undefined,
      120
    )
    const progressLogs =
      existingLogs[existingLogs.length - 1] === nextLogLine
        ? existingLogs.slice(-80)
        : [...existingLogs, nextLogLine].slice(-80)
    const stepNumber = Math.max(existingRun?.stepNumber ?? 0, ctx.activeStepNumber ?? 0, 1)
    const currentStep = ctx.activeCurrentStep ?? existingRun?.currentStep ?? "Running workflow..."
    const sandboxUrl = ctx.sandboxUrl ?? existingRun?.sandboxUrl
    if (!ctx.sandboxUrl && sandboxUrl) {
      ctx.sandboxUrl = sandboxUrl
    }

    const nextRun = {
      ...existingRun,
      id: ctx.runId,
      userId: ctx.userId,
      projectName: ctx.projectName,
      timestamp: ctx.timestamp,
      status: "running",
      type: (ctx.workflowType as WorkflowType) || existingRun?.type || "cls-fix",
      runnerKind: ctx.runnerKind ?? existingRun?.runnerKind,
      devAgentId: ctx.devAgentId,
      devAgentName: ctx.devAgentName,
      devAgentDescription: ctx.devAgentDescription,
      devAgentRevision: ctx.devAgentRevision,
      devAgentSpecHash: ctx.devAgentSpecHash,
      skillRunnerCanonicalPath: ctx.skillRunnerCanonicalPath ?? existingRun?.skillRunnerCanonicalPath,
      skillRunnerValidationWarning: ctx.skillRunnerValidationWarning ?? existingRun?.skillRunnerValidationWarning,
      devAgentExecutionMode: ctx.devAgentExecutionMode,
      devAgentSandboxBrowser: ctx.devAgentSandboxBrowser,
      stepNumber,
      currentStep,
      sandboxUrl,
      progressLogs
    } satisfies WorkflowRun
    await persistWorkflowRun(nextRun, { mirrorTarget: ctx.controlPlaneMirrorTarget })
    ctx.runSnapshot = nextRun
    ctx.progressLogs = progressLogs
  } catch (err) {
    workflowLog(`[Progress] Failed to append log: ${err instanceof Error ? err.message : String(err)}`)
  }
}

async function persistRunArtifacts(
  ctx: ProgressContext | null | undefined,
  updates: {
    beforeScreenshots?: Array<{ timestamp: number; blobUrl: string; label?: string }>
    afterScreenshots?: Array<{ timestamp: number; blobUrl: string; label?: string }>
    beforeWebVitals?: import("@/types").WebVitals
    afterWebVitals?: import("@/types").WebVitals
  }
) {
  if (!ctx) return
  try {
    const existingRun = await getProgressRunSnapshot(ctx)
    if (!existingRun) return

    const nextRun = {
      ...existingRun,
      id: ctx.runId,
      userId: ctx.userId,
      projectName: ctx.projectName,
      timestamp: ctx.timestamp,
      status: existingRun.status === "done" || existingRun.status === "failure" ? existingRun.status : "running",
      type: (ctx.workflowType as WorkflowType) || existingRun.type || "cls-fix",
      runnerKind: ctx.runnerKind ?? existingRun.runnerKind,
      devAgentId: ctx.devAgentId,
      devAgentName: ctx.devAgentName,
      devAgentDescription: ctx.devAgentDescription,
      devAgentRevision: ctx.devAgentRevision,
      devAgentSpecHash: ctx.devAgentSpecHash,
      skillRunnerCanonicalPath: ctx.skillRunnerCanonicalPath ?? existingRun.skillRunnerCanonicalPath,
      skillRunnerValidationWarning: ctx.skillRunnerValidationWarning ?? existingRun.skillRunnerValidationWarning,
      devAgentExecutionMode: ctx.devAgentExecutionMode,
      devAgentSandboxBrowser: ctx.devAgentSandboxBrowser,
      stepNumber: Math.max(existingRun.stepNumber ?? 0, ctx.activeStepNumber ?? 0, 1),
      currentStep: ctx.activeCurrentStep ?? existingRun.currentStep ?? "Running workflow...",
      sandboxUrl: ctx.sandboxUrl ?? existingRun.sandboxUrl,
      beforeScreenshots: updates.beforeScreenshots ?? existingRun.beforeScreenshots,
      afterScreenshots: updates.afterScreenshots ?? existingRun.afterScreenshots,
      beforeWebVitals: updates.beforeWebVitals ?? existingRun.beforeWebVitals,
      afterWebVitals: updates.afterWebVitals ?? existingRun.afterWebVitals
    } satisfies WorkflowRun
    await persistWorkflowRun(nextRun, { mirrorTarget: ctx.controlPlaneMirrorTarget })
    ctx.runSnapshot = nextRun
  } catch (error) {
    workflowLog(`[Progress] Failed to persist run artifacts: ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function getRunningSandboxWithRetry(
  sandboxId: string,
  progressContext?: ProgressContext | null,
  phase?: "observe" | "agent",
  attempts = 3,
  retryDelayMs = 2000,
  credentials?: {
    teamId?: string
    projectId?: string
    tokens?: string[]
  }
): Promise<Sandbox> {
  let lastError: unknown
  const phaseLabel = phase === "observe" ? "Observe" : phase === "agent" ? "Agent" : "Sandbox"
  const tokenCandidates =
    credentials?.tokens && credentials.tokens.length > 0 ? credentials.tokens : [undefined as string | undefined]
  const credentialVariants =
    credentials?.projectId && credentials.teamId
      ? [
          { projectId: credentials.projectId, teamId: credentials.teamId, label: "project-scoped" },
          { projectId: undefined, teamId: undefined, label: "unscoped" }
        ]
      : [{ projectId: credentials?.projectId, teamId: credentials?.teamId, label: "default" }]

  for (let attempt = 1; attempt <= attempts; attempt++) {
    for (const variant of credentialVariants) {
      let sawProjectBindingFailure = false
      for (const token of tokenCandidates) {
        try {
          const sandbox = await Sandbox.get({
            sandboxId,
            teamId: variant.teamId,
            projectId: variant.projectId,
            token
          })
          if (sandbox.status !== "running") {
            throw new Error(`Sandbox not running: ${sandbox.status}`)
          }
          return sandbox
        } catch (error) {
          lastError = error
          if (isSandboxProjectBindingFailure(error) && variant.label === "project-scoped") {
            sawProjectBindingFailure = true
          }
        }
      }

      if (sawProjectBindingFailure && variant.label === "project-scoped") {
        await appendProgressLog(
          progressContext,
          `[${phaseLabel}] Project-scoped sandbox reattach failed across available credentials; retrying without project binding...`
        )
      }
    }

    const apiError = lastError as {
      message?: string
      response?: { status?: number; statusText?: string }
      sandboxId?: string
      json?: unknown
    }
    const responsePayload =
      apiError?.json && typeof apiError.json === "object" && "error" in apiError.json
        ? (apiError.json as { error?: { code?: string; message?: string; sandboxId?: string } }).error
        : undefined
    const detail = [
      responsePayload?.message || apiError?.message || String(lastError),
      apiError?.response?.status ? `status=${apiError.response.status}` : null,
      responsePayload?.code ? `code=${responsePayload.code}` : null,
      responsePayload?.sandboxId || apiError?.sandboxId
        ? `sandboxId=${responsePayload?.sandboxId || apiError?.sandboxId}`
        : null
    ]
      .filter(Boolean)
      .join(" ")
    workflowLog(`[${phaseLabel}] Sandbox reattach attempt ${attempt}/${attempts} failed: ${detail}`)
    if (attempt >= attempts) {
      break
    }

    await appendProgressLog(
      progressContext,
      `[${phaseLabel}] Sandbox unavailable, retrying reattach (${attempt}/${attempts - 1})... ${detail}`.slice(0, 280)
    )
    await new Promise((resolve) => setTimeout(resolve, retryDelayMs))
  }

  workflowLog(
    `[${phaseLabel}] Sandbox reattach exhausted after ${attempts} attempt(s): ${lastError instanceof Error ? lastError.message : String(lastError)}`
  )
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

function getVercelApiTokenCandidates(explicitToken?: string): string[] {
  return Array.from(
    new Set([explicitToken, process.env.VERCEL_TOKEN, process.env.VERCEL_OIDC_TOKEN].filter(Boolean) as string[])
  )
}

function isVercelAuthFailure(error: unknown): boolean {
  const apiError = error as {
    message?: string
    response?: { status?: number }
    json?: unknown
  }
  const responsePayload =
    apiError?.json && typeof apiError.json === "object" && "error" in apiError.json
      ? (apiError.json as { error?: { code?: string; message?: string } }).error
      : undefined
  const detail =
    `${responsePayload?.message || ""} ${responsePayload?.code || ""} ${apiError?.message || ""}`.toLowerCase()
  return (
    apiError?.response?.status === 401 ||
    apiError?.response?.status === 403 ||
    detail.includes("status=401") ||
    detail.includes("status=403") ||
    detail.includes("forbidden") ||
    detail.includes("invalidtoken") ||
    detail.includes("not authorized")
  )
}

function isSandboxProjectBindingFailure(error: unknown): boolean {
  const apiError = error as {
    message?: string
    response?: { status?: number }
    json?: unknown
  }
  const responsePayload =
    apiError?.json && typeof apiError.json === "object" && "error" in apiError.json
      ? (apiError.json as { error?: { code?: string; message?: string } }).error
      : undefined
  const detail =
    `${responsePayload?.message || ""} ${responsePayload?.code || ""} ${apiError?.message || ""}`.toLowerCase()
  return (
    (apiError?.response?.status === 404 ||
      detail.includes("status=404") ||
      detail.includes("not_found") ||
      detail.includes("could not find project")) &&
    detail.includes("project")
  )
}

async function createSandboxWithTokenFallback(
  config: Parameters<typeof getOrCreateD3kSandbox>[0],
  vercelApiTokens: string[],
  progressContext?: ProgressContext | null,
  phase?: "init" | "observe" | "agent"
): Promise<Awaited<ReturnType<typeof getOrCreateD3kSandbox>>> {
  const phaseLabel = phase === "observe" ? "Observe" : phase === "agent" ? "Agent" : "Sandbox"
  const tokenCandidates = vercelApiTokens.length > 0 ? vercelApiTokens : [undefined as string | undefined]
  const configVariants =
    config.projectId && config.teamId
      ? [
          { projectId: config.projectId, teamId: config.teamId, label: "project-scoped" },
          { projectId: undefined, teamId: undefined, label: "unscoped" }
        ]
      : [{ projectId: config.projectId, teamId: config.teamId, label: "default" }]
  let lastError: unknown

  for (const variant of configVariants) {
    let sawProjectBindingFailure = false
    for (let index = 0; index < tokenCandidates.length; index++) {
      const token = tokenCandidates[index]
      try {
        return await getOrCreateD3kSandbox({
          ...config,
          projectId: variant.projectId,
          teamId: variant.teamId,
          vercelToken: token
        })
      } catch (error) {
        lastError = error
        if (isSandboxProjectBindingFailure(error) && variant.label === "project-scoped") {
          sawProjectBindingFailure = true
          continue
        }
        if (!isVercelAuthFailure(error) || index === tokenCandidates.length - 1) {
          throw error
        }
        await appendProgressLog(
          progressContext,
          `[${phaseLabel}] Sandbox auth failed with token candidate ${index + 1}/${tokenCandidates.length}; retrying with fallback credential...`
        )
      }
    }

    if (sawProjectBindingFailure && variant.label === "project-scoped") {
      await appendProgressLog(
        progressContext,
        `[${phaseLabel}] Project-scoped sandbox binding failed across available credentials; retrying without project binding...`
      )
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

// ============================================================
// STEP 1: Init Sandbox
// ============================================================

/** Timing data for init step */
export interface InitStepTiming {
  totalMs: number
  sandboxCreation: SandboxTimingData
  steps: { name: string; durationMs: number; startedAt: string }[]
}

function buildTurbopackBundleComparison(
  before: TurbopackBundleMetricsSnapshot,
  after: TurbopackBundleMetricsSnapshot
): TurbopackBundleComparison {
  const compressedBytes = after.totalCompressedBytes - before.totalCompressedBytes
  const rawBytes = after.totalRawBytes - before.totalRawBytes
  return {
    before,
    after,
    delta: {
      compressedBytes,
      rawBytes,
      compressedPercent: before.totalCompressedBytes > 0 ? (compressedBytes / before.totalCompressedBytes) * 100 : null,
      rawPercent: before.totalRawBytes > 0 ? (rawBytes / before.totalRawBytes) * 100 : null
    }
  }
}

async function collectTurbopackBundleMetrics(
  sandbox: Sandbox,
  projectDir?: string,
  progressContext?: ProgressContext | null,
  label?: string
): Promise<TurbopackBundleMetricsSnapshot | null> {
  const projectCwd = projectDir ? `/vercel/sandbox/${projectDir.replace(/^\/+|\/+$/g, "")}` : "/vercel/sandbox"
  const metricsResult = await runSandboxCommand(sandbox, "sh", [
    "-c",
    `cd ${projectCwd} && node <<'NODE'
const fs = require("fs")
const path = require("path")

function readNdjsonRows(filePath) {
  if (!fs.existsSync(filePath)) return []
  const text = fs.readFileSync(filePath, "utf8")
  if (!text.trim()) return []
  const rows = []
  for (const line of text.split("\\n")) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      rows.push(JSON.parse(trimmed))
    } catch {}
  }
  return rows
}

const ndjsonDir = path.resolve(".next/diagnostics/analyze/ndjson")
const routes = readNdjsonRows(path.join(ndjsonDir, "routes.ndjson"))
const outputFiles = readNdjsonRows(path.join(ndjsonDir, "output_files.ndjson"))
const sources = readNdjsonRows(path.join(ndjsonDir, "sources.ndjson"))

if (routes.length === 0 && outputFiles.length === 0) {
  console.log("null")
  process.exit(0)
}

const routeMetrics = routes
  .map((row) => ({
    route: typeof row.route === "string" ? row.route : "*",
    compressedBytes: Number(row.total_compressed_size || 0),
    rawBytes: Number(row.total_size || 0)
  }))
  .filter((route) => Number.isFinite(route.compressedBytes) && Number.isFinite(route.rawBytes))

const totalCompressedFromRoutes = routeMetrics.reduce((sum, route) => sum + route.compressedBytes, 0)
const totalRawFromRoutes = routeMetrics.reduce((sum, route) => sum + route.rawBytes, 0)

const totalCompressedFromOutput = outputFiles.reduce((sum, row) => sum + Number(row.total_compressed_size || 0), 0)
const totalRawFromOutput = outputFiles.reduce((sum, row) => sum + Number(row.total_size || 0), 0)

const topRoutes = routeMetrics
  .slice()
  .sort((a, b) => b.compressedBytes - a.compressedBytes)
  .slice(0, 10)

const topSourceMap = new Map()
for (const row of sources) {
  const fullPath =
    typeof row.full_path === "string" && row.full_path.trim()
      ? row.full_path.trim()
      : typeof row.path === "string" && row.path.trim()
        ? row.path.trim()
        : null
  if (!fullPath || row.is_dir) continue
  if (!row.client || !row.js) continue

  const compressedBytes = Number(row.compressed_size || 0)
  const rawBytes = Number(row.size || 0)
  if (!Number.isFinite(compressedBytes) || compressedBytes <= 0 || !Number.isFinite(rawBytes) || rawBytes < 0) {
    continue
  }

  const existing = topSourceMap.get(fullPath) || {
    fullPath,
    compressedBytes: 0,
    rawBytes: 0,
    routes: new Set()
  }
  existing.compressedBytes += compressedBytes
  existing.rawBytes += rawBytes
  if (typeof row.route === "string" && row.route) {
    existing.routes.add(row.route)
  }
  topSourceMap.set(fullPath, existing)
}

const topSources = Array.from(topSourceMap.values())
  .map((row) => ({
    fullPath: row.fullPath,
    compressedBytes: row.compressedBytes,
    rawBytes: row.rawBytes,
    routes: Array.from(row.routes)
  }))
  .sort((a, b) => b.compressedBytes - a.compressedBytes)
  .slice(0, 10)

console.log(
  JSON.stringify({
    generatedAt: new Date().toISOString(),
    totalCompressedBytes: totalCompressedFromRoutes > 0 ? totalCompressedFromRoutes : totalCompressedFromOutput,
    totalRawBytes: totalRawFromRoutes > 0 ? totalRawFromRoutes : totalRawFromOutput,
    routeCount: routeMetrics.length,
    outputFileCount: outputFiles.length,
    topRoutes,
    topSources
  })
)
NODE`
  ])

  if (metricsResult.exitCode !== 0) {
    const detail = (metricsResult.stderr || metricsResult.stdout || "unknown error").trim()
    await appendProgressLog(progressContext, `[Turbopack] Failed to collect ${label || "bundle"} metrics: ${detail}`)
    return null
  }

  const lastLine = (metricsResult.stdout || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1)

  if (!lastLine || lastLine === "null") {
    await appendProgressLog(progressContext, `[Turbopack] No ${label || "bundle"} NDJSON metrics available`)
    return null
  }

  try {
    const parsed = JSON.parse(lastLine) as TurbopackBundleMetricsSnapshot
    const topSourcesSummary =
      parsed.topSources && parsed.topSources.length > 0
        ? parsed.topSources
            .slice(0, 3)
            .map((source) => `${source.fullPath} (${Math.round(source.compressedBytes / 1024)}KB)`)
            .join(", ")
        : null
    await appendProgressLog(
      progressContext,
      `[Turbopack] ${label || "bundle"} metrics: ${Math.round(parsed.totalCompressedBytes / 1024)}KB compressed, ${parsed.routeCount} routes${topSourcesSummary ? `, top sources: ${topSourcesSummary}` : ""}`
    )
    return parsed
  } catch {
    await appendProgressLog(progressContext, `[Turbopack] Failed to parse ${label || "bundle"} metrics output`)
    return null
  }
}

function formatTurbopackBundleBaselineSummary(snapshot: TurbopackBundleMetricsSnapshot | null): string | undefined {
  if (!snapshot) return undefined

  const lines = [
    `- Total compressed JS: ${Math.round(snapshot.totalCompressedBytes / 1024)} KB`,
    `- Route count: ${snapshot.routeCount}`
  ]

  const topRoute = snapshot.topRoutes?.[0]
  if (topRoute) {
    lines.push(`- Heaviest route: ${topRoute.route} (${Math.round(topRoute.compressedBytes / 1024)} KB compressed)`)
  }

  const topSources = snapshot.topSources?.slice(0, 3) || []
  if (topSources.length > 0) {
    lines.push("- Top shipped client sources:")
    for (const source of topSources) {
      lines.push(
        `  - ${source.fullPath} (${Math.round(source.compressedBytes / 1024)} KB compressed${source.routes.length > 0 ? ` across ${source.routes.join(", ")}` : ""})`
      )
    }
  }

  return lines.join("\n")
}

const TURBOPACK_NDJSON_REQUIRED_FILES = [
  "routes.ndjson",
  "sources.ndjson",
  "output_files.ndjson",
  "module_edges.ndjson",
  "modules.ndjson"
] as const

interface TurbopackNdjsonStatus {
  ok: boolean
  projectCwd: string
  missingFiles: string[]
  routeRows: number
  outputFileRows: number
}

async function checkTurbopackNdjsonArtifacts(sandbox: Sandbox, projectDir?: string): Promise<TurbopackNdjsonStatus> {
  const normalizedProjectDir = projectDir ? projectDir.replace(/^\/+|\/+$/g, "") : ""
  const projectCwd = normalizedProjectDir ? `/vercel/sandbox/${normalizedProjectDir}` : "/vercel/sandbox"

  const checkResult = await runSandboxCommand(sandbox, "sh", [
    "-c",
    `cd ${projectCwd} && node <<'NODE'
const fs = require("fs")
const path = require("path")

const required = ${JSON.stringify(TURBOPACK_NDJSON_REQUIRED_FILES)}
const ndjsonDir = path.resolve(".next/diagnostics/analyze/ndjson")
const missingFiles = []

for (const file of required) {
  if (!fs.existsSync(path.join(ndjsonDir, file))) {
    missingFiles.push(file)
  }
}

function countRows(file) {
  try {
    const fullPath = path.join(ndjsonDir, file)
    if (!fs.existsSync(fullPath)) return 0
    const raw = fs.readFileSync(fullPath, "utf8")
    if (!raw.trim()) return 0
    return raw.split("\\n").map((line) => line.trim()).filter(Boolean).length
  } catch {
    return 0
  }
}

const routeRows = countRows("routes.ndjson")
const outputFileRows = countRows("output_files.ndjson")
const ok = missingFiles.length === 0 && routeRows > 0 && outputFileRows > 0

console.log(JSON.stringify({ ok, missingFiles, routeRows, outputFileRows, ndjsonDir }))
NODE`
  ])

  if (checkResult.exitCode !== 0) {
    return {
      ok: false,
      projectCwd,
      missingFiles: [...TURBOPACK_NDJSON_REQUIRED_FILES],
      routeRows: 0,
      outputFileRows: 0
    }
  }

  const lastLine = (checkResult.stdout || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1)
  if (!lastLine) {
    return {
      ok: false,
      projectCwd,
      missingFiles: [...TURBOPACK_NDJSON_REQUIRED_FILES],
      routeRows: 0,
      outputFileRows: 0
    }
  }

  try {
    const parsed = JSON.parse(lastLine) as {
      ok?: boolean
      missingFiles?: string[]
      routeRows?: number
      outputFileRows?: number
    }
    return {
      ok: Boolean(parsed.ok),
      projectCwd,
      missingFiles: Array.isArray(parsed.missingFiles) ? parsed.missingFiles : [...TURBOPACK_NDJSON_REQUIRED_FILES],
      routeRows: typeof parsed.routeRows === "number" ? parsed.routeRows : 0,
      outputFileRows: typeof parsed.outputFileRows === "number" ? parsed.outputFileRows : 0
    }
  } catch {
    return {
      ok: false,
      projectCwd,
      missingFiles: [...TURBOPACK_NDJSON_REQUIRED_FILES],
      routeRows: 0,
      outputFileRows: 0
    }
  }
}

async function prepareTurbopackNdjsonArtifacts(
  sandbox: Sandbox,
  projectDir?: string,
  progressContext?: ProgressContext | null
): Promise<{ outputDir: string; summary: string }> {
  const normalizedProjectDir = projectDir ? projectDir.replace(/^\/+|\/+$/g, "") : ""
  const projectCwd = normalizedProjectDir ? `/vercel/sandbox/${normalizedProjectDir}` : "/vercel/sandbox"
  const pnpmProjectExec = `corepack pnpm -C ${projectCwd} exec next`
  const outputDir = ".next/diagnostics/analyze/ndjson"
  const scriptPath = "/tmp/analyze-to-ndjson.mjs"
  const startedAt = Date.now()
  const nextCliBootstrap = `export PATH=$HOME/.bun/bin:/usr/local/bin:$PATH; cd ${projectCwd} && \
FNM_BIN="" && \
if [ -x "$HOME/.fnm/fnm" ]; then FNM_BIN="$HOME/.fnm/fnm"; \
elif [ -x "$HOME/.local/share/fnm/fnm" ]; then FNM_BIN="$HOME/.local/share/fnm/fnm"; fi && \
if [ -n "$FNM_BIN" ]; then \
  export PATH="$(dirname "$FNM_BIN"):$PATH"; \
  eval "$("$FNM_BIN" env --shell bash)"; \
  REQUIRED_NODE="" && \
  if [ -f .nvmrc ]; then REQUIRED_NODE="$(tr -d '[:space:]' < .nvmrc)"; fi && \
  if [ -z "$REQUIRED_NODE" ] && [ -f package.json ]; then \
    REQUIRED_NODE="$(node -e "try{const p=require('./package.json');process.stdout.write(p?.engines?.node||'')}catch{}" 2>/dev/null || true)"; \
  fi && \
  REQUIRED_MAJOR="$(printf '%s' "$REQUIRED_NODE" | sed -n 's/[^0-9]*\\([0-9][0-9]*\\).*/\\1/p' | head -1)" && \
  if [ -n "$REQUIRED_MAJOR" ]; then \
    "$FNM_BIN" use "$REQUIRED_MAJOR" >/dev/null 2>&1 || "$FNM_BIN" install "$REQUIRED_MAJOR" >/dev/null 2>&1 || true; \
  fi; \
fi && \
NEXT_BIN="" && \
SEARCH_DIR="$PWD" && \
while [ "$SEARCH_DIR" != "/" ]; do \
  if [ -x "$SEARCH_DIR/node_modules/.bin/next" ]; then NEXT_BIN="$SEARCH_DIR/node_modules/.bin/next"; break; fi; \
  if [ -f "$SEARCH_DIR/node_modules/next/dist/bin/next" ]; then NEXT_BIN="node $SEARCH_DIR/node_modules/next/dist/bin/next"; break; fi; \
  SEARCH_DIR="$(dirname "$SEARCH_DIR")"; \
done && \
if [ -z "$NEXT_BIN" ] && command -v corepack >/dev/null 2>&1; then NEXT_BIN="${pnpmProjectExec}"; fi && \
if [ -z "$NEXT_BIN" ] && command -v npx >/dev/null 2>&1; then NEXT_BIN="npx --yes next"; fi && \
if [ -z "$NEXT_BIN" ] && command -v bun >/dev/null 2>&1; then NEXT_BIN="bun x next"; fi && \
if [ -z "$NEXT_BIN" ]; then echo "[Turbopack] Could not find a runnable Next.js CLI" >&2; exit 127; fi`

  workflowLog(`[Turbopack] Preparing analyzer artifacts in ${projectCwd}`)
  await appendProgressLog(progressContext, `[Turbopack] Preparing analyzer artifacts in ${projectCwd}`)

  const appendAnalyzerTrace = async (label: string, result: { stdout: string; stderr: string }) => {
    const combined = `${result.stdout || ""}\n${result.stderr || ""}`
    const nextCommandLine = combined.split("\n").find((line) => line.includes("[Turbopack] Next command:"))
    if (nextCommandLine) {
      await appendProgressLog(progressContext, `${label} ${nextCommandLine.trim()}`)
    }
  }

  const runNextCli = async (command: string) =>
    runSandboxCommand(sandbox, "sh", [
      "-c",
      `${nextCliBootstrap} && \
echo "[Turbopack] Running: ${command}" && \
echo "[Turbopack] Next command: $NEXT_BIN ${command}" && \
eval "$NEXT_BIN ${command}"`
    ])

  const nextVersionResult = await runSandboxCommand(sandbox, "sh", [
    "-c",
    `${nextCliBootstrap} && echo "[Turbopack] Next command: $NEXT_BIN --version" && eval "$NEXT_BIN --version"`
  ])
  await appendAnalyzerTrace("[Turbopack]", nextVersionResult)
  if (nextVersionResult.exitCode !== 0) {
    throw new Error(
      `Unable to determine Next.js version for Turbopack workflow: ${nextVersionResult.stderr || nextVersionResult.stdout}`
    )
  }

  const nextVersionOutput = `${nextVersionResult.stdout}\n${nextVersionResult.stderr}`.trim()
  const detectedVersion = parseSemverLoose(nextVersionOutput)
  const minimumVersion = parseSemverLoose(TURBOPACK_MIN_NEXT_VERSION)
  if (!detectedVersion || !minimumVersion) {
    throw new Error(
      `Unable to parse Next.js version for Turbopack workflow. Output: ${nextVersionOutput || "(empty output)"}`
    )
  }
  await appendProgressLog(
    progressContext,
    `[Turbopack] Detected Next.js ${detectedVersion.major}.${detectedVersion.minor}.${detectedVersion.patch}`
  )
  if (!isSemverAtLeast(detectedVersion, minimumVersion)) {
    throw new Error(
      `Turbopack Bundle Analyzer workflow requires Next.js ${TURBOPACK_MIN_NEXT_VERSION} or newer. Detected ${detectedVersion.major}.${detectedVersion.minor}.${detectedVersion.patch}.`
    )
  }

  // Next.js can expose analyzer either as build flags or legacy subcommand depending on version.
  await appendProgressLog(
    progressContext,
    "[Turbopack] Running next build --experimental-analyze --experimental-build-mode compile --turbopack"
  )
  let analyzeResult = await runNextCli("build --experimental-analyze --experimental-build-mode compile --turbopack")
  await appendAnalyzerTrace("[Turbopack]", analyzeResult)
  if (analyzeResult.exitCode !== 0) {
    const combined = `${analyzeResult.stderr}\n${analyzeResult.stdout}`
    const buildModeUnsupported =
      /unknown option.*experimental-build-mode|unrecognized option.*experimental-build-mode|did you mean.*experimental-build-mode/i.test(
        combined
      )
    if (buildModeUnsupported) {
      await appendProgressLog(
        progressContext,
        "[Turbopack] Compile build mode unsupported; retrying build analyze without build-mode flag"
      )
      analyzeResult = await runNextCli("build --experimental-analyze --turbopack")
      await appendAnalyzerTrace("[Turbopack]", analyzeResult)
    }
  }
  if (analyzeResult.exitCode !== 0) {
    const combined = `${analyzeResult.stderr}\n${analyzeResult.stdout}`
    const buildFlagUnsupported =
      /unknown option.*experimental-analyze|unrecognized option.*experimental-analyze|did you mean.*experimental-analyze/i.test(
        combined
      )
    if (buildFlagUnsupported) {
      const unsupportedLine =
        combined
          .split("\n")
          .find((line) => /unknown option|unrecognized option|did you mean/i.test(line))
          ?.trim() || combined.slice(-220).replace(/\s+/g, " ").trim()
      await appendProgressLog(progressContext, `[Turbopack] Build flag unsupported detail: ${unsupportedLine}`)
      await appendProgressLog(
        progressContext,
        "[Turbopack] Retrying without --experimental-analyze (compile-only turbopack build)"
      )
      analyzeResult = await runNextCli("build --experimental-build-mode compile --turbopack")
      await appendAnalyzerTrace("[Turbopack]", analyzeResult)

      if (analyzeResult.exitCode !== 0) {
        const compileCombined = `${analyzeResult.stderr}\n${analyzeResult.stdout}`
        const compileBuildModeUnsupported =
          /unknown option.*experimental-build-mode|unrecognized option.*experimental-build-mode|did you mean.*experimental-build-mode/i.test(
            compileCombined
          )
        if (compileBuildModeUnsupported) {
          await appendProgressLog(
            progressContext,
            "[Turbopack] Compile build mode unsupported on fallback; retrying plain `next build --turbopack`"
          )
          analyzeResult = await runNextCli("build --turbopack")
          await appendAnalyzerTrace("[Turbopack]", analyzeResult)
        }
      }
    }
  }
  if (analyzeResult.exitCode !== 0) {
    const errTail = (analyzeResult.stderr || analyzeResult.stdout || "").slice(-2000)
    await appendProgressLog(progressContext, `[Turbopack] Analyze failed: ${errTail.substring(0, 300)}`)
    throw new Error(`next analyzer command failed: ${errTail || "(no output)"}`)
  }
  workflowLog(`[Turbopack] Analyzer completed in ${Math.round((Date.now() - startedAt) / 1000)}s`)
  await appendProgressLog(progressContext, "[Turbopack] Analyze command completed")

  const analyzeDataDirResult = await runSandboxCommand(sandbox, "sh", [
    "-c",
    `cd ${projectCwd} && \
if [ -d .next/diagnostics/analyze/data ]; then \
  echo ".next/diagnostics/analyze/data"; \
elif [ -d .next/analyze/data ]; then \
  echo ".next/analyze/data"; \
elif [ -d .next/analyze ]; then \
  echo ".next/analyze"; \
else \
  MOD_DIR="$(find .next -type f -name modules.data 2>/dev/null | head -n1 | xargs -I{} dirname {} 2>/dev/null)"; \
  if [ -n "$MOD_DIR" ] && [ -d "$MOD_DIR" ]; then \
    echo "$MOD_DIR"; \
  fi; \
fi`
  ])
  const analyzeInputDir = (analyzeDataDirResult.stdout || "").trim().split("\n").find(Boolean)
  if (analyzeInputDir) {
    await appendProgressLog(progressContext, `[Turbopack] Analyze data folder detected at ${analyzeInputDir}`)
  } else {
    await appendProgressLog(
      progressContext,
      "[Turbopack] No analyzer .data files detected; generating manifest-based NDJSON fallback"
    )
  }

  if (analyzeInputDir) {
    const writeScriptResult = await runSandboxCommand(sandbox, "sh", [
      "-c",
      `cat > ${scriptPath} << 'NDJSONEOF'
${ANALYZE_TO_NDJSON_SCRIPT}
NDJSONEOF`
    ])
    if (writeScriptResult.exitCode !== 0) {
      throw new Error(
        `Failed to write NDJSON converter script: ${writeScriptResult.stderr || writeScriptResult.stdout}`
      )
    }
    await appendProgressLog(progressContext, "[Turbopack] NDJSON converter script written")

    const convertResult = await runSandboxCommand(sandbox, "sh", [
      "-c",
      `cd ${projectCwd} && node ${scriptPath} --input "${analyzeInputDir}" --output "${outputDir}"`
    ])
    if (convertResult.exitCode !== 0) {
      throw new Error(`NDJSON conversion failed: ${convertResult.stderr || convertResult.stdout}`)
    }
    await appendProgressLog(progressContext, "[Turbopack] NDJSON conversion completed")
  } else {
    const manifestFallbackResult = await runSandboxCommand(sandbox, "sh", [
      "-c",
      `cd ${projectCwd} && node -e '
const fs = require("fs");
const path = require("path");
const outDir = path.resolve("${outputDir}");
fs.mkdirSync(outDir, { recursive: true });
const writeNdjson = (name, rows) => fs.writeFileSync(path.join(outDir, name), rows.map((r) => JSON.stringify(r)).join("\\n") + (rows.length ? "\\n" : ""));
let manifest = {};
try { manifest = JSON.parse(fs.readFileSync(".next/build-manifest.json", "utf8")); } catch {}
const pages = manifest.pages || {};
const files = new Set();
for (const arr of Object.values(pages)) {
  if (Array.isArray(arr)) for (const f of arr) files.add(f);
}
const outputFiles = [];
let total = 0;
for (const file of files) {
  const rel = String(file).replace(/^\\//, "");
  const abs = path.join(".next", rel);
  let size = 0;
  try { size = fs.statSync(abs).size; } catch {}
  total += size;
  outputFiles.push({
    route: "*",
    id: outputFiles.length,
    filename: file,
    total_size: size,
    total_compressed_size: size,
    num_parts: size > 0 ? 1 : 0
  });
}
const routes = [{
  route: "*",
  total_size: total,
  total_compressed_size: total,
  num_sources: 0,
  num_output_files: outputFiles.length
}];
writeNdjson("routes.ndjson", routes);
writeNdjson("output_files.ndjson", outputFiles);
writeNdjson("sources.ndjson", []);
writeNdjson("chunk_parts.ndjson", []);
writeNdjson("module_edges.ndjson", []);
writeNdjson("modules.ndjson", []);
console.log("fallback_ndjson_routes=" + routes.length + " output_files=" + outputFiles.length);
'`
    ])
    if (manifestFallbackResult.exitCode !== 0) {
      throw new Error(
        `NDJSON fallback generation failed: ${manifestFallbackResult.stderr || manifestFallbackResult.stdout}`
      )
    }
    await appendProgressLog(progressContext, "[Turbopack] Manifest-based NDJSON fallback generated")
  }

  const summaryResult = await runSandboxCommand(sandbox, "sh", [
    "-c",
    `cd ${projectCwd} && \
echo "files:" && ls -1 ${outputDir}/*.ndjson 2>/dev/null | sed "s#^#- #" && \
echo "" && \
echo "top routes by compressed size:" && \
head -n 300 ${outputDir}/routes.ndjson 2>/dev/null | sort -t: -k2,2nr | head -10`
  ])

  return {
    outputDir,
    summary: (summaryResult.stdout || "").trim()
  }
}

async function pullDevelopmentEnvViaCliInSandbox(
  _sandbox: Sandbox,
  projectDir: string | undefined,
  projectId: string | undefined,
  teamId: string | undefined,
  vercelToken: string | undefined,
  progressContext?: ProgressContext | null
): Promise<void> {
  if (!projectId || !vercelToken) {
    return
  }

  const normalizedProjectDir = projectDir ? projectDir.replace(/^\/+|\/+$/g, "") : ""
  const projectCwd = normalizedProjectDir ? `/vercel/sandbox/${normalizedProjectDir}` : "/vercel/sandbox"

  await appendProgressLog(
    progressContext,
    "[Sandbox] Skipping vercel env pull fallback (.env.local) until env permissions are configured"
  )
  workflowLog(`[Sandbox] Skipping vercel env pull fallback for ${projectCwd}${teamId ? ` (scope ${teamId})` : ""}`)
  // Temporarily disabled: workflow should proceed without attempting CLI env pull.
  // If env vars are required, downstream steps may fail until project env permissions are fixed.
  return

  /*
  const tokenBase64 = Buffer.from(vercelToken, "utf8").toString("base64")
  const scopeArg = teamId ? ` --scope "${teamId}"` : ""

  await appendProgressLog(progressContext, "[Sandbox] Falling back to vercel env pull (.env.local)...")
  workflowLog("[Sandbox] Falling back to vercel env pull (.env.local)...")

  const pullResult = await runSandboxCommand(sandbox, "sh", [
    "-c",
    `cd ${projectCwd} && \
TOKEN="$(printf '%s' '${tokenBase64}' | base64 -d 2>/dev/null)" && \
if [ -z "$TOKEN" ]; then echo "missing token"; exit 1; fi && \
export VERCEL_TOKEN="$TOKEN" && \
export VERCEL_PROJECT_ID="${projectId}" && \
if [ -n "${teamId || ""}" ]; then export VERCEL_ORG_ID="${teamId}"; fi && \
VERCEL_CMD="" && \
if command -v vc >/dev/null 2>&1; then VERCEL_CMD="vc"; \
elif command -v vercel >/dev/null 2>&1; then VERCEL_CMD="vercel"; \
elif [ -x node_modules/.bin/vercel ]; then VERCEL_CMD="./node_modules/.bin/vercel"; \
elif [ -x ../../node_modules/.bin/vercel ]; then VERCEL_CMD="../../node_modules/.bin/vercel"; \
elif command -v corepack >/dev/null 2>&1; then VERCEL_CMD="corepack pnpm -C ${projectCwd} exec vercel"; fi && \
if [ -z "$VERCEL_CMD" ]; then echo "vercel CLI not found"; exit 127; fi && \
echo "[Sandbox] Pulling development env vars via: $VERCEL_CMD env pull .env.local --environment development --yes --token [REDACTED]${scopeArg}" && \
eval "$VERCEL_CMD env pull .env.local --environment development --yes --token "$TOKEN"${scopeArg}" && \
test -f .env.local && echo "[Sandbox] .env.local created"`
  ])

  const stdoutPreview = (pullResult.stdout || "").trim().slice(-500)
  const stderrPreview = (pullResult.stderr || "").trim().slice(-500)
  workflowLog(
    `[Sandbox] vercel env pull exit=${pullResult.exitCode} stdout=${stdoutPreview || "(empty)"} stderr=${stderrPreview || "(empty)"}`
  )

  if (pullResult.exitCode === 0) {
    await appendProgressLog(progressContext, "[Sandbox] vercel env pull succeeded (.env.local)")
    await appendProgressLog(
      progressContext,
      `[Sandbox] vercel env pull output: ${(stdoutPreview || "ok").replace(/\s+/g, " ").slice(0, 180)}`
    )
    return
  }

  const detail = (pullResult.stderr || pullResult.stdout || "unknown error").slice(0, 500).trim()
  await appendProgressLog(progressContext, `[Sandbox] vercel env pull failed: ${detail}`)
  */
}

function parseGitHubRepo(url: string): { owner: string; repo: string } | null {
  const normalized = url.replace(/\.git$/i, "")
  const match = normalized.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)$/i)
  if (!match) return null
  return { owner: match[1], repo: match[2] }
}

export async function preflightGitHubPatRepoAccessStep(repoUrl: string, githubPat: string): Promise<void> {
  const repo = parseGitHubRepo(repoUrl)
  if (!repo) return

  const response = await fetch(`https://api.github.com/repos/${repo.owner}/${repo.repo}`, {
    headers: {
      Authorization: `Bearer ${githubPat}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "dev3000-workflow"
    }
  })

  if (response.status === 200) return
  if (response.status === 401) {
    throw new Error(
      `GitHub PAT authentication failed for ${repo.owner}/${repo.repo}. Verify the token is valid and not expired/revoked.`
    )
  }
  if (response.status === 403 || response.status === 404) {
    throw new Error(
      `GitHub PAT does not have access to ${repo.owner}/${repo.repo} (HTTP ${response.status}). Grant repository read access to this token.`
    )
  }
}

export async function evaluateTurbopackPrGateStep(
  workflowType: string | undefined,
  analysisTargetType: "vercel-project" | "url",
  reportBlobUrl: string,
  gitDiff: string | null,
  minCompressedImprovementBytes: number,
  minCompressedImprovementPercent: number
): Promise<{ allowPr: boolean; reason?: string }> {
  if (analysisTargetType === "url" || workflowType !== "turbopack-bundle-analyzer" || !gitDiff) {
    return { allowPr: true }
  }

  try {
    const report = await readBlobJson<{
      turbopackBundleComparison?: { delta?: { compressedBytes?: number; compressedPercent?: number | null } }
    }>(reportBlobUrl)
    if (!report) {
      return { allowPr: true }
    }
    const delta = report.turbopackBundleComparison?.delta
    const compressedBytes = typeof delta?.compressedBytes === "number" ? delta.compressedBytes : null
    const compressedPercent = typeof delta?.compressedPercent === "number" ? delta.compressedPercent : null

    if (compressedBytes === null) {
      return { allowPr: false, reason: "Skipped PR: Missing Turbopack bundle delta metrics" }
    }
    if (compressedBytes >= 0) {
      return { allowPr: false, reason: "Skipped PR: Turbopack compressed bundle did not improve" }
    }

    const meaningfulByBytes = Math.abs(compressedBytes) >= minCompressedImprovementBytes
    const meaningfulByPercent =
      compressedPercent !== null && Math.abs(compressedPercent) >= minCompressedImprovementPercent
    if (!meaningfulByBytes && !meaningfulByPercent) {
      return { allowPr: false, reason: "Skipped PR: Turbopack bundle improvement was not meaningful" }
    }

    return { allowPr: true }
  } catch (error) {
    workflowLog(
      `[Workflow] Failed to evaluate Turbopack PR gate: ${error instanceof Error ? error.message : String(error)}`
    )
    return { allowPr: true }
  }
}

export async function initSandboxStep(
  repoUrl: string,
  branch: string,
  projectDir: string | undefined,
  projectId: string | undefined,
  teamId: string | undefined,
  sandboxProjectId: string | undefined,
  sandboxTeamId: string | undefined,
  projectName: string,
  reportId: string,
  _startPath: string,
  githubPat?: string,
  npmToken?: string,
  projectEnvInput?: Record<string, string>,
  vercelOidcToken?: string,
  devAgentDevServerCommand?: string,
  progressContext?: ProgressContext | null,
  sourceTarballUrl?: string,
  sourceLabel?: string
): Promise<{
  sandboxId: string
  devUrl: string
  reportId: string
  beforeCls: number | null
  beforeGrade: "good" | "needs-improvement" | "poor" | null
  beforeScreenshots: Array<{ timestamp: number; blobUrl: string; label?: string }>
  initD3kLogs: string
  timing: InitStepTiming
  fromSnapshot: boolean
  snapshotId?: string
}> {
  const timer = new StepTimer()
  const isTurbopackBundleAnalyzer = progressContext?.workflowType === "turbopack-bundle-analyzer"

  workflowLog(`[Init] Creating sandbox for ${projectName}...`)
  await updateProgress(progressContext, 1, "Creating sandbox environment...")
  if (isTurbopackBundleAnalyzer) {
    await updateProgress(progressContext, 1, "Preparing Turbopack analyzer data...")
  }

  const developmentEnv: Record<string, string> = {}
  let developmentEnvLoadFailed = false
  const envFetchTokens = getVercelApiTokenCandidates(vercelOidcToken)

  if (projectId && envFetchTokens.length > 0) {
    try {
      await appendProgressLog(progressContext, "[Sandbox] Loading development environment variables...")
      const params = new URLSearchParams({ target: "development", decrypt: "true", limit: "100" })
      const envFetchTimeoutMs = 15000
      if (teamId) {
        params.set("teamId", teamId)
      }
      let envLoaded = false
      let lastStatus: number | null = null
      let lastErrorText = ""

      for (const token of envFetchTokens) {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), envFetchTimeoutMs)
        let response: Response
        try {
          response = await fetch(`https://api.vercel.com/v10/projects/${projectId}/env?${params.toString()}`, {
            headers: { Authorization: `Bearer ${token}` },
            signal: controller.signal
          })
        } catch (error) {
          lastStatus = null
          lastErrorText =
            error instanceof Error && error.name === "AbortError"
              ? `Timed out after ${envFetchTimeoutMs}ms`
              : error instanceof Error
                ? error.message
                : String(error)
          continue
        } finally {
          clearTimeout(timeoutId)
        }

        if (response.ok) {
          const data = (await response.json()) as {
            envs?: Array<{ key?: string; value?: string }>
          }
          for (const envVar of data.envs || []) {
            if (envVar.key && typeof envVar.value === "string") {
              developmentEnv[envVar.key] = envVar.value
            }
          }
          await appendProgressLog(
            progressContext,
            `[Sandbox] Loaded ${Object.keys(developmentEnv).length} development env var(s)`
          )
          envLoaded = true
          break
        }

        lastStatus = response.status
        lastErrorText = await response.text()
      }

      if (!envLoaded) {
        if (lastStatus === 403) {
          await appendProgressLog(
            progressContext,
            `[Sandbox] Env var API access denied (HTTP 403); continuing without development env vars: ${lastErrorText.slice(0, 180)}`
          )
        } else {
          await appendProgressLog(
            progressContext,
            `[Sandbox] Could not load development env vars (HTTP ${lastStatus ?? "unknown"}); continuing without env vars: ${lastErrorText.slice(0, 180)}`
          )
        }
        developmentEnvLoadFailed = true
      }
    } catch (error) {
      await appendProgressLog(
        progressContext,
        `[Sandbox] Could not load development env vars: ${error instanceof Error ? error.message : String(error)}`
      )
      developmentEnvLoadFailed = true
    }
  } else {
    await appendProgressLog(
      progressContext,
      "[Sandbox] Skipping development env load (missing projectId or Vercel auth token)"
    )
  }

  const effectiveNpmToken =
    npmToken ||
    projectEnvInput?.NPM_TOKEN ||
    projectEnvInput?.NODE_AUTH_TOKEN ||
    developmentEnv.NPM_TOKEN ||
    developmentEnv.NODE_AUTH_TOKEN ||
    process.env.NPM_TOKEN ||
    process.env.NODE_AUTH_TOKEN
  const mergedProjectEnv = {
    ...developmentEnv,
    ...(projectEnvInput || {})
  }
  await appendProgressLog(
    progressContext,
    `[Sandbox] npm auth token ${effectiveNpmToken ? "detected" : "not detected"} for dependency install`
  )

  // Create sandbox using base snapshot (Chrome + d3k pre-installed)
  // The base snapshot is shared across ALL projects for fast startup
  timer.start("Create sandbox (getOrCreateD3kSandbox)")
  let sandboxResult: Awaited<ReturnType<typeof getOrCreateD3kSandbox>>
  try {
    sandboxResult = await createSandboxWithTokenFallback(
      {
        repoUrl,
        branch,
        githubPat,
        projectId: sandboxProjectId,
        teamId: sandboxTeamId,
        npmToken: effectiveNpmToken,
        sourceTarballUrl,
        sourceLabel,
        // Turbopack workflows now require CWV verification, so browser/d3k setup cannot be skipped.
        skipD3kSetup: false,
        onProgress: (message) => appendProgressLog(progressContext, `[Sandbox] ${message}`),
        projectDir: projectDir || "",
        devCommand: devAgentDevServerCommand,
        projectEnv: mergedProjectEnv,
        timeout: WORKFLOW_SANDBOX_TIMEOUT,
        debug: true
      },
      envFetchTokens,
      progressContext,
      "init"
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes("Sandbox git source clone failed")) {
      throw error
    }
    if (message.includes("Status code 400 is not ok") && repoUrl.includes("github.com") && !githubPat) {
      throw new Error(
        "Sandbox initialization failed while accessing the repository through Vercel Sandbox source. Verify repository access/integration for the workflow environment."
      )
    }
    throw error
  }

  workflowLog(`[Init] Sandbox: ${sandboxResult.sandbox.sandboxId}`)
  workflowLog(`[Init] Dev URL: ${sandboxResult.devUrl}`)
  workflowLog(`[Init] From base snapshot: ${sandboxResult.fromSnapshot}`)
  await updateProgress(
    progressContext,
    1,
    sandboxResult.fromSnapshot ? "Sandbox restored from base snapshot!" : "Sandbox created from scratch",
    sandboxResult.devUrl
  )

  if (isTurbopackBundleAnalyzer) {
    const effectiveProjectDir = await resolveSandboxProjectDir(
      sandboxResult.sandbox,
      projectDir,
      projectName,
      progressContext
    )

    if (developmentEnvLoadFailed || Object.keys(developmentEnv).length === 0) {
      await pullDevelopmentEnvViaCliInSandbox(
        sandboxResult.sandbox,
        effectiveProjectDir,
        projectId,
        teamId,
        vercelOidcToken,
        progressContext
      )
    }

    timer.start("Generate Turbopack NDJSON artifacts")
    await updateProgress(progressContext, 1, "Running Next.js analyzer build...")
    const ndjsonResult = await prepareTurbopackNdjsonArtifacts(
      sandboxResult.sandbox,
      effectiveProjectDir,
      progressContext
    )
    const initNdjsonStatus = await checkTurbopackNdjsonArtifacts(sandboxResult.sandbox, effectiveProjectDir)
    if (!initNdjsonStatus.ok) {
      const missingDetail =
        initNdjsonStatus.missingFiles.length > 0
          ? `missing files: ${initNdjsonStatus.missingFiles.join(", ")}`
          : "required files are empty"
      throw new Error(
        `Turbopack NDJSON artifacts were not generated in ${initNdjsonStatus.projectCwd} (${missingDetail}; routes=${initNdjsonStatus.routeRows}, output_files=${initNdjsonStatus.outputFileRows}).`
      )
    }
    workflowLog(`[Init] Turbopack NDJSON artifacts ready at ${ndjsonResult.outputDir}`)
    if (ndjsonResult.summary) {
      workflowLog(`[Init] Turbopack NDJSON summary:\n${ndjsonResult.summary}`)
    }
    await updateProgress(
      progressContext,
      1,
      `Analyzer NDJSON ready at ${ndjsonResult.outputDir} (use readFile/runProjectCommand instead of localhost:4000)`,
      sandboxResult.devUrl
    )

    // Turbopack workflow is analyzer-only; no d3k browser/CLS bootstrap required.
    timer.end()
    const timingData = timer.getData()
    workflowLog(`[Init] ⏱️ TIMING BREAKDOWN (total: ${(timingData.totalMs / 1000).toFixed(1)}s)`)
    for (const step of timingData.steps) {
      const secs = (step.durationMs / 1000).toFixed(1)
      const pct = ((step.durationMs / timingData.totalMs) * 100).toFixed(0)
      workflowLog(`[Init]   ${step.name}: ${secs}s (${pct}%)`)
    }

    return {
      sandboxId: sandboxResult.sandbox.sandboxId,
      devUrl: sandboxResult.devUrl,
      reportId,
      beforeCls: null,
      beforeGrade: null,
      beforeScreenshots: [],
      initD3kLogs: "",
      timing: {
        totalMs: timingData.totalMs,
        sandboxCreation: sandboxResult.timing,
        steps: timingData.steps
      },
      fromSnapshot: sandboxResult.fromSnapshot,
      snapshotId: sandboxResult.snapshotId
    }
  }

  // Wait for d3k to capture initial CLS — retry until CLS observer is installed or timeout
  timer.start("Wait for CLS capture")
  workflowLog(`[Init] Waiting for d3k CLS capture...`)
  await updateProgress(progressContext, 1, "Dev server running, capturing initial CLS...")

  const CLS_POLL_INTERVAL_MS = 3000
  const CLS_POLL_MAX_MS = 30000
  let clsData = {
    clsScore: null as number | null,
    clsGrade: null as "good" | "needs-improvement" | "poor" | null,
    screenshots: [] as Array<{ timestamp: number; blobUrl: string; label?: string }>,
    d3kLogs: ""
  }
  const clsPollStart = Date.now()

  // Initial wait for d3k and Chrome to boot
  await new Promise((resolve) => setTimeout(resolve, 5000))

  while (Date.now() - clsPollStart < CLS_POLL_MAX_MS) {
    clsData = await fetchClsData(sandboxResult.sandbox)
    if (clsData.clsScore !== null) {
      workflowLog(`[Init] CLS captured after ${((Date.now() - clsPollStart) / 1000).toFixed(1)}s: ${clsData.clsScore}`)
      break
    }
    workflowLog(
      `[Init] CLS not yet available (${((Date.now() - clsPollStart) / 1000).toFixed(0)}s elapsed), retrying...`
    )
    await new Promise((resolve) => setTimeout(resolve, CLS_POLL_INTERVAL_MS))
  }

  if (clsData.clsScore === null) {
    workflowLog("[Init] CLS capture timed out — will rely on agent step to measure")
  }

  workflowLog(`[Init] Before CLS: ${clsData.clsScore} (${clsData.clsGrade})`)
  workflowLog(`[Init] Captured ${clsData.d3kLogs.length} chars of d3k logs`)
  await updateProgress(
    progressContext,
    1,
    `Initial CLS: ${clsData.clsScore?.toFixed(3) || "unknown"} (${clsData.clsGrade || "measuring..."})`,
    sandboxResult.devUrl
  )

  timer.end()

  // Log timing breakdown
  const timingData = timer.getData()
  workflowLog(`[Init] ⏱️ TIMING BREAKDOWN (total: ${(timingData.totalMs / 1000).toFixed(1)}s)`)
  for (const step of timingData.steps) {
    const secs = (step.durationMs / 1000).toFixed(1)
    const pct = ((step.durationMs / timingData.totalMs) * 100).toFixed(0)
    workflowLog(`[Init]   ${step.name}: ${secs}s (${pct}%)`)
  }

  return {
    sandboxId: sandboxResult.sandbox.sandboxId,
    devUrl: sandboxResult.devUrl,
    reportId,
    beforeCls: clsData.clsScore,
    beforeGrade: clsData.clsGrade,
    beforeScreenshots: clsData.screenshots,
    initD3kLogs: clsData.d3kLogs,
    timing: {
      totalMs: timingData.totalMs,
      sandboxCreation: sandboxResult.timing,
      steps: timingData.steps
    },
    fromSnapshot: sandboxResult.fromSnapshot,
    snapshotId: sandboxResult.snapshotId
  }
}

export async function prepareV0DevAgentSourceStep({
  projectName,
  reportId,
  projectId,
  teamId,
  repoUrl,
  repoBranch,
  vercelApiToken,
  progressContext
}: {
  projectName: string
  reportId: string
  projectId?: string
  teamId?: string
  repoUrl?: string
  repoBranch: string
  vercelApiToken?: string
  progressContext?: ProgressContext | null
}): Promise<{
  tarballUrl?: string
  sourceLabel?: string
  fallbackReason?: string
}> {
  if (!projectId) {
    return { fallbackReason: "V0_FALLBACK: Missing Vercel projectId for V0 project-entry" }
  }

  if (!repoUrl) {
    return { fallbackReason: "V0_FALLBACK: Missing repoUrl for V0 project-entry" }
  }

  await updateProgress(progressContext, 1, "Preparing project source via V0 project-entry...")
  await appendProgressLog(
    progressContext,
    `[V0] Initializing project source from ${repoUrl}@${repoBranch} for project ${projectId}`
  )

  let sourceEntry: {
    tarballUrl: string
    sourceLabel: string
    projectId: string
    chatId: string
    versionId: string
  }
  try {
    const { prepareV0SourceEntry } = await import("@/lib/cloud/v0-source-entry")
    sourceEntry = await prepareV0SourceEntry({
      reportId,
      projectName,
      vercelProjectId: projectId,
      repoUrl,
      repoBranch,
      apiToken: vercelApiToken,
      teamId
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes("V0_FALLBACK:")) {
      await appendProgressLog(progressContext, `[V0] Falling back to legacy sandbox flow: ${message}`)
      return { fallbackReason: message }
    }
    throw error
  }

  await appendProgressLog(
    progressContext,
    `[V0] Prepared source tarball from V0 project ${sourceEntry.projectId}, chat ${sourceEntry.chatId}, version ${sourceEntry.versionId}`
  )
  await appendProgressLog(progressContext, `[V0] Source tarball: ${sourceEntry.tarballUrl}`)

  return {
    tarballUrl: sourceEntry.tarballUrl,
    sourceLabel: sourceEntry.sourceLabel
  }
}

// ============================================================
// STEP 2: Agent Fix Loop (with internal iteration)
// ============================================================

/** Timing data for agent fix loop step */
export interface AgentStepTiming {
  totalMs: number
  steps: { name: string; durationMs: number; startedAt: string }[]
}

/**
 * Observation result from the observeBaseline step.
 * Contains everything needed to evaluate early exit and to skip
 * redundant boot/measure work in the agent step.
 */
export interface ObserveResult {
  sandboxId: string
  devUrl: string
  beforeWebVitals: import("@/types").WebVitals
  beforeCls: number | null
  beforeGrade: "good" | "needs-improvement" | "poor" | null
  beforeScreenshots: Array<{ timestamp: number; blobUrl: string; label?: string }>
  d3kLogs: string
  cloudBrowserMode: "agent-browser"
  skillsInstalled: string[]
  timing: { totalMs: number; steps: Array<{ name: string; durationMs: number; startedAt: string }> }
}

type EarlyExitMetricValue = number | boolean | string

function normalizeMetricKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
}

function buildObservationMetricMap(observation: ObserveResult): Record<string, EarlyExitMetricValue> {
  const metrics: Record<string, EarlyExitMetricValue> = {}

  const setMetric = (key: string, value: EarlyExitMetricValue | null | undefined) => {
    if (value === null || typeof value === "undefined") return
    metrics[normalizeMetricKey(key)] = value
  }

  const clsValue = observation.beforeWebVitals.cls?.value ?? observation.beforeCls
  const clsGrade = observation.beforeWebVitals.cls?.grade ?? observation.beforeGrade
  setMetric("cls", clsValue)
  setMetric("cls_grade", clsGrade)

  for (const key of ["lcp", "fcp", "ttfb", "inp"] as const) {
    const metric = observation.beforeWebVitals[key]
    setMetric(key, metric?.value)
    setMetric(`${key}_grade`, metric?.grade)
  }

  setMetric("skills_installed_count", observation.skillsInstalled.length)
  setMetric("has_skills_installed", observation.skillsInstalled.length > 0)
  setMetric("cloud_browser_mode", observation.cloudBrowserMode)

  return metrics
}

function countNonClsWebVitalMetrics(vitals: import("@/types").WebVitals | undefined): number {
  if (!vitals) return 0

  let count = 0
  for (const key of ["lcp", "fcp", "ttfb", "inp"] as const) {
    if (vitals[key]) count += 1
  }

  return count
}

function countPostLoadWebVitalMetrics(vitals: import("@/types").WebVitals | undefined): number {
  if (!vitals) return 0

  let count = 0
  for (const key of ["lcp", "fcp", "ttfb"] as const) {
    if (vitals[key]) count += 1
  }

  return count
}

function mergeWebVitalsSnapshots(
  baseline: import("@/types").WebVitals,
  supplement: import("@/types").WebVitals
): import("@/types").WebVitals {
  const merged: import("@/types").WebVitals = {
    ...baseline,
    ...supplement
  }

  const reconciledCls = pickMoreCredibleCls(
    {
      value: supplement.cls?.value ?? null,
      grade: supplement.cls?.grade ?? null
    },
    {
      value: baseline.cls?.value ?? null,
      grade: baseline.cls?.grade ?? null
    }
  )

  if (reconciledCls.value !== null && reconciledCls.grade) {
    merged.cls = {
      value: reconciledCls.value,
      grade: reconciledCls.grade
    }
  }

  return merged
}

function metricGradeRank(grade: "good" | "needs-improvement" | "poor" | undefined): number {
  switch (grade) {
    case "good":
      return 0
    case "needs-improvement":
      return 1
    case "poor":
      return 2
    default:
      return -1
  }
}

function isMeaningfulWebVitalRegression(
  before: import("@/types").WebVitals | undefined,
  after: import("@/types").WebVitals | undefined
): boolean {
  if (!before || !after) {
    return false
  }

  for (const key of ["lcp", "fcp", "ttfb", "cls", "inp"] as const) {
    const beforeMetric = before[key]
    const afterMetric = after[key]
    if (!beforeMetric || !afterMetric) {
      continue
    }

    if (metricGradeRank(afterMetric.grade) > metricGradeRank(beforeMetric.grade)) {
      return true
    }

    const regressionDelta = afterMetric.value - beforeMetric.value
    if (regressionDelta <= 0) {
      continue
    }

    const threshold = key === "cls" ? 0.02 : key === "inp" ? 75 : 100

    if (regressionDelta >= threshold) {
      return true
    }
  }

  return false
}

function formatMetricValue(value: EarlyExitMetricValue): string {
  return typeof value === "string" ? `"${value}"` : String(value)
}

function evaluateStructuredEarlyExitRule(
  rule: DevAgentEarlyExitRule | undefined,
  observation: ObserveResult
): { shouldExit: boolean; reason: string } | null {
  if (!rule) return null

  const metricMap = buildObservationMetricMap(observation)
  const metricKey = normalizeMetricKey(rule.metricKey)
  const metricValue = metricMap[metricKey]
  const metricLabel = rule.label?.trim() || rule.metricKey

  if (typeof metricValue === "undefined") {
    return {
      shouldExit: false,
      reason: `Metric "${metricLabel}" was unavailable`
    }
  }

  if (rule.valueType === "number") {
    if (typeof metricValue !== "number") {
      return {
        shouldExit: false,
        reason: `Metric "${metricLabel}" was not numeric`
      }
    }

    const target = rule.valueNumber
    const secondaryTarget = rule.secondaryValueNumber
    if (typeof target !== "number" || !Number.isFinite(target)) {
      return {
        shouldExit: false,
        reason: `Metric "${metricLabel}" had an invalid numeric threshold`
      }
    }

    const comparisons: Record<string, boolean> = {
      "<": metricValue < target,
      "<=": metricValue <= target,
      ">": metricValue > target,
      ">=": metricValue >= target,
      "===": metricValue === target,
      "!==": metricValue !== target,
      between:
        typeof secondaryTarget === "number" && Number.isFinite(secondaryTarget)
          ? metricValue >= Math.min(target, secondaryTarget) && metricValue <= Math.max(target, secondaryTarget)
          : false
    }
    const shouldExit = comparisons[rule.operator]
    const thresholdText =
      rule.operator === "between" && typeof secondaryTarget === "number"
        ? `${Math.min(target, secondaryTarget)} and ${Math.max(target, secondaryTarget)}`
        : String(target)
    return {
      shouldExit,
      reason: `${metricLabel} was ${metricValue}, which ${shouldExit ? "matched" : "did not match"} ${rule.operator} ${thresholdText}`
    }
  }

  if (rule.valueType === "boolean") {
    if (typeof metricValue !== "boolean") {
      return {
        shouldExit: false,
        reason: `Metric "${metricLabel}" was not boolean`
      }
    }

    const target = rule.valueBoolean
    if (typeof target !== "boolean") {
      return {
        shouldExit: false,
        reason: `Metric "${metricLabel}" had an invalid boolean threshold`
      }
    }
    const shouldExit = rule.operator === "!==" ? metricValue !== target : metricValue === target
    return {
      shouldExit,
      reason: `${metricLabel} was ${metricValue}, which ${shouldExit ? "matched" : "did not match"} ${rule.operator} ${target}`
    }
  }

  if (typeof metricValue !== "string") {
    return {
      shouldExit: false,
      reason: `Metric "${metricLabel}" was not a string`
    }
  }

  const target = rule.valueString ?? ""
  const shouldExit = rule.operator === "!==" ? metricValue !== target : metricValue === target
  return {
    shouldExit,
    reason: `${metricLabel} was ${formatMetricValue(metricValue)}, which ${shouldExit ? "matched" : "did not match"} ${rule.operator} ${formatMetricValue(target)}`
  }
}

/**
 * Observe baseline step: reconnect to sandbox, install skills,
 * capture before Web Vitals and CLS data. Extracted from the
 * beginning of agentFixLoopStep so early exit can be evaluated
 * before running the expensive agent.
 */
export async function observeBaselineStep(
  sandboxId: string,
  devUrl: string,
  beforeCls: number | null,
  beforeGrade: "good" | "needs-improvement" | "poor" | null,
  beforeScreenshots: Array<{ timestamp: number; blobUrl: string; label?: string }>,
  initD3kLogs: string,
  startPath: string,
  repoUrl: string,
  repoBranch: string,
  _projectId: string | undefined,
  _teamId: string | undefined,
  sandboxProjectId: string | undefined,
  sandboxTeamId: string | undefined,
  githubPat?: string,
  npmToken?: string,
  sourceTarballUrl?: string,
  sourceLabel?: string,
  vercelOidcToken?: string,
  devAgentAshTarballUrl?: string,
  projectDir?: string,
  devAgentSandboxBrowser?: "none" | "agent-browser",
  devAgentDevServerCommand?: string,
  devAgentSkillRefs?: DevAgentSkillRef[],
  progressContext?: ProgressContext | null
): Promise<ObserveResult> {
  const timer = new StepTimer()
  const isTurbopackBundleAnalyzer = progressContext?.workflowType === "turbopack-bundle-analyzer"

  const vercelApiTokens = getVercelApiTokenCandidates(vercelOidcToken)

  timer.start("Reconnect to sandbox")
  workflowLog(`[Observe] Reconnecting to sandbox: ${sandboxId}`)
  await updateProgress(progressContext, 2, "Observing baseline metrics...", devUrl)

  let sandbox: Sandbox
  try {
    sandbox = await getRunningSandboxWithRetry(sandboxId, progressContext, "observe", 3, 2000, {
      teamId: sandboxTeamId,
      projectId: sandboxProjectId,
      tokens: vercelApiTokens
    })
  } catch (sandboxError) {
    const canFallbackToInitObservation =
      beforeCls !== null || beforeScreenshots.length > 0 || Boolean(initD3kLogs.trim())
    if (canFallbackToInitObservation) {
      const timingData = timer.getData()
      const fallbackBeforeWebVitals: import("@/types").WebVitals = {}
      if (beforeCls !== null) {
        fallbackBeforeWebVitals.cls = {
          value: beforeCls,
          grade: beforeGrade || gradeClsValue(beforeCls) || "good"
        }
      }

      await appendProgressLog(
        progressContext,
        "[Observe] Reusing init-step CLS evidence because the initial sandbox could not be reattached"
      )
      workflowLog(
        `[Observe] Sandbox ${sandboxId} unavailable (${sandboxError instanceof Error ? sandboxError.message : String(sandboxError)}); falling back to init-step evidence instead of recreating baseline sandbox`
      )

      return {
        sandboxId,
        devUrl,
        beforeWebVitals: fallbackBeforeWebVitals,
        beforeCls,
        beforeGrade,
        beforeScreenshots,
        d3kLogs: initD3kLogs,
        cloudBrowserMode: resolveCloudBrowserMode(devAgentSandboxBrowser),
        skillsInstalled: [],
        timing: {
          totalMs: timingData.totalMs,
          steps: timingData.steps.map((s) => ({ name: s.name, durationMs: s.durationMs, startedAt: s.startedAt }))
        }
      }
    }

    workflowLog(
      `[Observe] Sandbox ${sandboxId} unavailable (${sandboxError instanceof Error ? sandboxError.message : String(sandboxError)}), creating a new one...`
    )
    await appendProgressLog(progressContext, "[Observe] Previous sandbox unavailable, creating a fresh one...")
    let freshResult: Awaited<ReturnType<typeof getOrCreateD3kSandbox>>
    try {
      freshResult = await createSandboxWithTokenFallback(
        {
          repoUrl,
          branch: repoBranch,
          githubPat,
          projectId: sandboxProjectId,
          teamId: sandboxTeamId,
          npmToken,
          sourceTarballUrl,
          sourceLabel,
          projectDir: projectDir || "",
          devCommand: devAgentDevServerCommand,
          timeout: WORKFLOW_SANDBOX_TIMEOUT,
          debug: true,
          onProgress: (message) => appendProgressLog(progressContext, `[Sandbox] ${message}`)
        },
        vercelApiTokens,
        progressContext,
        "observe"
      )
    } catch (freshSandboxError) {
      await appendProgressLog(
        progressContext,
        `[Observe] Fresh sandbox creation failed: ${freshSandboxError instanceof Error ? freshSandboxError.message : String(freshSandboxError)}`
      )
      throw freshSandboxError
    }
    sandbox = freshResult.sandbox
    sandboxId = sandbox.sandboxId
    await appendProgressLog(progressContext, `[Observe] Fresh sandbox ready: ${sandbox.sandboxId}`)
    workflowLog(`[Observe] Fresh sandbox created: ${sandbox.sandboxId}`)
  }

  const installedSkillNames = await installDevAgentSkillsInSandbox(
    sandbox,
    projectDir,
    devAgentSkillRefs,
    progressContext,
    {
      devAgentAshTarballUrl,
      includeD3k: !isTurbopackBundleAnalyzer
    }
  )

  const localTargetUrl = `http://localhost:3000${startPath}`
  const cloudBrowserMode = resolveCloudBrowserMode(devAgentSandboxBrowser)
  let effectiveBeforeScreenshots = beforeScreenshots
  let effectiveObservationLogs = initD3kLogs

  timer.start("Capture baseline evidence")
  workflowLog("[Observe] Capturing baseline evidence via persistent CDP...")
  await appendProgressLog(progressContext, "[Observe] Capturing baseline evidence...")
  const baselineEvidence = await capturePhaseEvidenceViaCDP(
    sandbox,
    startPath,
    progressContext?.projectName || "workflow",
    "baseline",
    "Before",
    localTargetUrl,
    {
      sampleCount: 3,
      navigationTimeoutMs: 3500,
      settleMs: 750,
      overallTimeoutMs: 18000
    }
  )
  const capturedBeforeWebVitals = baselineEvidence.vitals
  if (effectiveBeforeScreenshots.length === 0 && baselineEvidence.screenshots.length > 0) {
    effectiveBeforeScreenshots = baselineEvidence.screenshots
  }
  if (effectiveBeforeScreenshots.length === 0) {
    const quickBaselineScreenshots = await capturePhaseScreenshot(
      sandbox,
      startPath,
      cloudBrowserMode,
      progressContext?.projectName || "workflow",
      "baseline-quick-fallback",
      "Before",
      localTargetUrl,
      3000
    )
    if (quickBaselineScreenshots.length > 0) {
      effectiveBeforeScreenshots = quickBaselineScreenshots
    }
  }
  workflowLog(`[Observe] Before Web Vitals captured: ${JSON.stringify(capturedBeforeWebVitals)}`)
  await appendProgressLog(
    progressContext,
    `[Observe] Baseline Web Vitals captured: ${JSON.stringify(capturedBeforeWebVitals)}`
  )
  await persistRunArtifacts(progressContext, {
    beforeWebVitals: capturedBeforeWebVitals
  })
  timer.end()

  workflowLog(`[Observe] Captured ${effectiveBeforeScreenshots.length} baseline screenshot(s)`)
  await appendProgressLog(
    progressContext,
    `[Observe] Baseline screenshot ${effectiveBeforeScreenshots.length > 0 ? "captured" : "failed"}`
  )
  if (effectiveBeforeScreenshots.length > 0) {
    await persistRunArtifacts(progressContext, {
      beforeScreenshots: effectiveBeforeScreenshots
    })
  }

  // CLS fallback via d3k logs if CDP didn't capture it
  let effectiveBeforeCls = capturedBeforeWebVitals.cls?.value ?? beforeCls ?? null
  let effectiveBeforeGrade = capturedBeforeWebVitals.cls?.grade ?? beforeGrade ?? null

  let baselineClsEvidence = await fetchClsData(sandbox)
  const reconciledBeforeCls = pickMoreCredibleCls(
    { value: effectiveBeforeCls, grade: effectiveBeforeGrade },
    { value: baselineClsEvidence.clsScore, grade: baselineClsEvidence.clsGrade }
  )
  if (reconciledBeforeCls.source === "fallback") {
    effectiveBeforeCls = reconciledBeforeCls.value
    effectiveBeforeGrade = reconciledBeforeCls.grade
    effectiveObservationLogs = baselineClsEvidence.d3kLogs || effectiveObservationLogs
    if (effectiveBeforeCls !== null && effectiveBeforeGrade) {
      capturedBeforeWebVitals.cls = {
        value: effectiveBeforeCls,
        grade: effectiveBeforeGrade
      }
    }
    workflowLog(`[Observe] Adopted d3k CLS fallback: ${effectiveBeforeCls?.toFixed(4)} (${effectiveBeforeGrade})`)
  }

  if (effectiveBeforeScreenshots.length === 0) {
    const d3kFallbackScreenshots = await captureD3kScreenshotFromLogs(
      sandbox,
      baselineClsEvidence.d3kLogs || effectiveObservationLogs,
      progressContext?.projectName || "workflow",
      "baseline-d3k",
      "Before",
      startPath
    )
    if (d3kFallbackScreenshots.length > 0) {
      effectiveBeforeScreenshots = d3kFallbackScreenshots
      await persistRunArtifacts(progressContext, {
        beforeScreenshots: effectiveBeforeScreenshots
      })
      await appendProgressLog(progressContext, "[Observe] Baseline screenshot recovered from d3k logs")
    }
  }

  const needsActiveClsFallback = effectiveBeforeCls === null || effectiveBeforeCls <= 0.02
  if (needsActiveClsFallback) {
    const activeFallbackBrowserTimeoutMs = 8000
    timer.start("Capture before CLS fallback")
    workflowLog("[Observe] Capturing active fallback before-CLS via d3k logs...")
    await appendProgressLog(progressContext, "[Observe] Re-measuring baseline CLS via active browser fallback")
    const activeBeforeNavResult = await navigateBrowser(
      sandbox,
      localTargetUrl,
      cloudBrowserMode,
      false,
      activeFallbackBrowserTimeoutMs
    )
    workflowLog(
      `[Observe] Before CLS fallback navigation: success=${activeBeforeNavResult.success}${activeBeforeNavResult.error ? `, error=${activeBeforeNavResult.error}` : ""}`
    )
    await new Promise((resolve) => setTimeout(resolve, 750))
    const activeBeforeReloadResult = await reloadBrowser(
      sandbox,
      cloudBrowserMode,
      false,
      activeFallbackBrowserTimeoutMs
    )
    workflowLog(
      `[Observe] Before CLS fallback reload: success=${activeBeforeReloadResult.success}${activeBeforeReloadResult.error ? `, error=${activeBeforeReloadResult.error}` : ""}`
    )
    await new Promise((resolve) => setTimeout(resolve, 3000))
    baselineClsEvidence = await fetchClsData(sandbox)
    effectiveObservationLogs = baselineClsEvidence.d3kLogs || effectiveObservationLogs
    if (baselineClsEvidence.clsScore !== null) {
      effectiveBeforeCls = baselineClsEvidence.clsScore
      effectiveBeforeGrade = baselineClsEvidence.clsGrade
      if (effectiveBeforeCls !== null && effectiveBeforeGrade) {
        capturedBeforeWebVitals.cls = {
          value: effectiveBeforeCls,
          grade: effectiveBeforeGrade
        }
      }
      workflowLog(`[Observe] Fallback before CLS: ${effectiveBeforeCls?.toFixed(4)} (${effectiveBeforeGrade})`)
    }
    if (effectiveBeforeScreenshots.length === 0 && baselineClsEvidence.screenshots.length > 0) {
      effectiveBeforeScreenshots = baselineClsEvidence.screenshots
    }
    if (effectiveBeforeScreenshots.length === 0) {
      const d3kFallbackScreenshots = await captureD3kScreenshotFromLogs(
        sandbox,
        baselineClsEvidence.d3kLogs || effectiveObservationLogs,
        progressContext?.projectName || "workflow",
        "baseline-fallback-d3k",
        "Before",
        startPath
      )
      if (d3kFallbackScreenshots.length > 0) {
        effectiveBeforeScreenshots = d3kFallbackScreenshots
        await persistRunArtifacts(progressContext, {
          beforeScreenshots: effectiveBeforeScreenshots
        })
        await appendProgressLog(progressContext, "[Observe] Baseline screenshot recovered from d3k logs")
      }
    }
    if (effectiveBeforeScreenshots.length === 0) {
      await appendProgressLog(progressContext, "[Observe] Retrying baseline screenshot after active fallback")
      const fallbackBeforeScreenshots = await capturePhaseScreenshot(
        sandbox,
        startPath,
        cloudBrowserMode,
        progressContext?.projectName || "workflow",
        "baseline-fallback",
        "Before",
        localTargetUrl,
        6000
      )
      if (fallbackBeforeScreenshots.length > 0) {
        effectiveBeforeScreenshots = fallbackBeforeScreenshots
        await persistRunArtifacts(progressContext, {
          beforeScreenshots: effectiveBeforeScreenshots
        })
        await appendProgressLog(progressContext, "[Observe] Baseline screenshot captured after active fallback")
      } else {
        await appendProgressLog(
          progressContext,
          "[Observe] Baseline screenshot still unavailable after active fallback"
        )
      }
    }
    timer.end()
  }

  const { skillsInstalled: sessionInstalledSkills } = await readSandboxSkillsInfo(sandbox)
  const skillsInstalled =
    sessionInstalledSkills.length > 0 ? sessionInstalledSkills : installedSkillNames.filter(Boolean)

  timer.end()
  const timingData = timer.getData()

  return {
    sandboxId,
    devUrl,
    beforeWebVitals: capturedBeforeWebVitals,
    beforeCls: effectiveBeforeCls,
    beforeGrade: effectiveBeforeGrade,
    beforeScreenshots: effectiveBeforeScreenshots,
    d3kLogs: effectiveObservationLogs,
    cloudBrowserMode,
    skillsInstalled,
    timing: {
      totalMs: timingData.totalMs,
      steps: timingData.steps.map((s) => ({ name: s.name, durationMs: s.durationMs, startedAt: s.startedAt }))
    }
  }
}

/**
 * Evaluate whether the early exit condition is met based on observation data.
 * Uses a fast/cheap LLM to judge whether the baseline metrics match the condition.
 * Returns { shouldExit: false } if earlyExitEval is empty or on any error.
 */
export async function evaluateEarlyExitStep(
  earlyExitEval: string | undefined,
  earlyExitRule: DevAgentEarlyExitRule | undefined,
  observation: ObserveResult,
  gatewayAuthToken?: string,
  _gatewayAuthSource?: string,
  progressContext?: ProgressContext | null
): Promise<{ shouldExit: boolean; reason: string }> {
  if (!earlyExitRule && !earlyExitEval?.trim()) {
    return { shouldExit: false, reason: "" }
  }

  try {
    const structuredResult = evaluateStructuredEarlyExitRule(earlyExitRule, observation)
    if (structuredResult) {
      workflowLog(
        `[EarlyExit] Structured rule result: shouldExit=${structuredResult.shouldExit}, reason=${structuredResult.reason}`
      )
      await appendProgressLog(
        progressContext,
        `[EarlyExit] Structured rule: shouldExit=${structuredResult.shouldExit} — ${structuredResult.reason}`
      )
      return structuredResult
    }

    if (!earlyExitEval?.trim()) {
      return { shouldExit: false, reason: "" }
    }

    workflowLog(`[EarlyExit] Evaluating condition: "${earlyExitEval}"`)
    await appendProgressLog(progressContext, `[EarlyExit] Evaluating: "${earlyExitEval}"`)

    const gateway = createVercelGateway(gatewayAuthToken)

    const metricsContext = [
      `CLS score: ${observation.beforeCls !== null ? observation.beforeCls.toFixed(4) : "unavailable"}`,
      `CLS grade: ${observation.beforeGrade || "unavailable"}`,
      observation.beforeWebVitals.lcp
        ? `LCP: ${observation.beforeWebVitals.lcp.value.toFixed(0)}ms (${observation.beforeWebVitals.lcp.grade})`
        : null,
      observation.beforeWebVitals.fcp
        ? `FCP: ${observation.beforeWebVitals.fcp.value.toFixed(0)}ms (${observation.beforeWebVitals.fcp.grade})`
        : null,
      observation.beforeWebVitals.inp
        ? `INP: ${observation.beforeWebVitals.inp.value.toFixed(0)}ms (${observation.beforeWebVitals.inp.grade})`
        : null,
      observation.beforeWebVitals.ttfb
        ? `TTFB: ${observation.beforeWebVitals.ttfb.value.toFixed(0)}ms (${observation.beforeWebVitals.ttfb.grade})`
        : null,
      `Skills installed: ${observation.skillsInstalled.length > 0 ? observation.skillsInstalled.join(", ") : "none"}`
    ]
      .filter(Boolean)
      .join("\n")

    const evalResult = await generateText({
      model: gateway(SUCCESS_EVAL_MODEL),
      system:
        'You are a metrics evaluator. Given baseline metrics and a condition, determine if the condition is met. Respond ONLY with a JSON object: {"shouldExit": true, "reason": "..."} or {"shouldExit": false, "reason": "..."}. The reason should be a brief explanation.',
      prompt: `Condition to evaluate: "${earlyExitEval.trim()}"

Baseline metrics:
${metricsContext}

Does the condition hold based on these metrics? Respond with JSON only.`
    })

    const evalText = evalResult.text.trim()
    const jsonMatch = evalText.match(/\{[^}]*"shouldExit"\s*:\s*(true|false)[^}]*\}/)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0])
      const shouldExit = parsed.shouldExit === true
      const reason = sanitizeEarlyExitReason(typeof parsed.reason === "string" ? parsed.reason : "", observation)
      workflowLog(`[EarlyExit] Result: shouldExit=${shouldExit}, reason=${reason}`)
      await appendProgressLog(progressContext, `[EarlyExit] Result: shouldExit=${shouldExit} — ${reason}`)
      return { shouldExit, reason }
    }

    workflowLog(`[EarlyExit] Failed to parse LLM response: ${evalText}`)
    return { shouldExit: false, reason: "Failed to parse evaluation response" }
  } catch (error) {
    workflowLog(`[EarlyExit] Error: ${error instanceof Error ? error.message : String(error)}`)
    return { shouldExit: false, reason: `Evaluation error: ${error instanceof Error ? error.message : String(error)}` }
  }
}

/**
 * Generalized early exit report step.
 * Accepts ObserveResult + a reason string and generates a report
 * showing the baseline metrics. Used by both the hardcoded CLS check
 * and the LLM-based earlyExitEval.
 */
export async function earlyExitReportStep(
  observation: ObserveResult,
  reason: string,
  projectName: string,
  reportId: string,
  startPath: string,
  repoUrl: string,
  repoBranch: string,
  projectDir?: string,
  repoOwner?: string,
  repoName?: string,
  devAgentName?: string,
  devAgentSkillRefs?: DevAgentSkillRef[],
  progressContext?: ProgressContext | null,
  initTiming?: InitStepTiming,
  fromSnapshot?: boolean,
  snapshotId?: string,
  devAgentSuccessEval?: string,
  devAgentEarlyExitEval?: string,
  devAgentEarlyExitRule?: DevAgentEarlyExitRule
): Promise<{
  sandboxId: string
  reportBlobUrl: string
  reportId: string
  beforeCls: number | null
  afterCls: number | null
  status: "improved" | "unchanged" | "degraded" | "no-changes"
  agentSummary: string
  gitDiff: string | null
}> {
  const effectiveBeforeCls = observation.beforeWebVitals.cls?.value ?? observation.beforeCls
  const effectiveBeforeGrade = observation.beforeWebVitals.cls?.grade ?? observation.beforeGrade
  const clsDisplay =
    effectiveBeforeCls !== null && typeof effectiveBeforeCls !== "undefined" ? effectiveBeforeCls.toFixed(4) : "n/a"

  workflowLog(`[Early Exit] ${reason} (CLS: ${clsDisplay}, grade: ${effectiveBeforeGrade || "n/a"})`)
  await updateProgress(progressContext, 4, `Early exit — ${reason}`)

  const report: WorkflowReport = {
    id: reportId,
    projectName,
    timestamp: new Date().toISOString(),
    devAgentId: progressContext?.devAgentId,
    devAgentName: devAgentName || progressContext?.devAgentName,
    devAgentDescription: progressContext?.devAgentDescription,
    devAgentRevision: progressContext?.devAgentRevision,
    devAgentSpecHash: progressContext?.devAgentSpecHash,
    devAgentExecutionMode: progressContext?.devAgentExecutionMode,
    devAgentSandboxBrowser: progressContext?.devAgentSandboxBrowser,
    workflowType: (progressContext?.workflowType as WorkflowReport["workflowType"]) || "cls-fix",
    analysisTargetType: "vercel-project",
    sandboxDevUrl: observation.devUrl,
    startPath,
    repoUrl,
    repoBranch,
    projectDir: projectDir || undefined,
    repoOwner: repoOwner || undefined,
    repoName: repoName || undefined,
    clsScore: effectiveBeforeCls ?? undefined,
    clsGrade: effectiveBeforeGrade || undefined,
    beforeWebVitals: Object.keys(observation.beforeWebVitals).length > 0 ? observation.beforeWebVitals : undefined,
    beforeScreenshots: observation.beforeScreenshots,
    afterClsScore: effectiveBeforeCls ?? undefined,
    afterClsGrade: effectiveBeforeGrade || undefined,
    afterWebVitals: Object.keys(observation.beforeWebVitals).length > 0 ? observation.beforeWebVitals : undefined,
    afterScreenshots: undefined,
    verificationStatus: "unchanged",
    costUsd: 0,
    agentAnalysis: `## Early Exit\n\n${reason}\n\nBaseline CLS: **${clsDisplay}** (${effectiveBeforeGrade || "n/a"})\nMeasured on \`${startPath}\`.\n\nNo agent changes were made.`,
    agentAnalysisModel: "n/a",
    devAgentSkills: devAgentSkillRefs?.length ? devAgentSkillRefs : undefined,
    skillsInstalled: observation.skillsInstalled.length > 0 ? observation.skillsInstalled : undefined,
    d3kLogs: observation.d3kLogs,
    initD3kLogs: observation.d3kLogs,
    gatewayUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    isMarketplaceAgent: progressContext?.isMarketplaceAgent || undefined,
    successEval: devAgentSuccessEval || undefined,
    successEvalResult: progressContext?.runnerKind !== "skill-runner",
    earlyExitEval: devAgentEarlyExitEval || undefined,
    earlyExitRule: devAgentEarlyExitRule,
    earlyExitResult: { shouldExit: true, reason },
    fromSnapshot: fromSnapshot ?? false,
    snapshotId,
    timing: initTiming
      ? {
          total: { initMs: initTiming.totalMs, agentMs: 0, totalMs: initTiming.totalMs },
          init: {
            sandboxCreationMs: initTiming.sandboxCreation.totalMs,
            fromSnapshot: fromSnapshot ?? false,
            steps: initTiming.steps.map((s) => ({ name: s.name, durationMs: s.durationMs }))
          }
        }
      : undefined
  }

  const blob = await putBlobAndBuildUrl(`report-${reportId}.json`, JSON.stringify(report, null, 2), {
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
    absoluteUrl: true
  })

  workflowLog(`[Early Exit] Report saved: ${blob.appUrl}`)

  return {
    sandboxId: observation.sandboxId,
    reportBlobUrl: blob.appUrl,
    reportId,
    beforeCls: observation.beforeCls,
    afterCls: observation.beforeCls,
    status: "no-changes",
    agentSummary: reason,
    gitDiff: null
  }
}

function getAgentProgressLabels({ workflowType, devAgentName }: { workflowType?: string; devAgentName?: string }): {
  analysis: string
  verification: string
  report: (details: {
    beforeCls: number | null
    afterCls: number | null
    bundleDeltaCompressedBytes?: number
  }) => string
} {
  if (workflowType === "turbopack-bundle-analyzer") {
    return {
      analysis: "AI agent analyzing bundle issues...",
      verification: "Agent finished, verifying bundle improvements...",
      report: ({ bundleDeltaCompressedBytes }) =>
        `Generating report... (bundle delta: ${typeof bundleDeltaCompressedBytes === "number" ? `${Math.round(bundleDeltaCompressedBytes / 1024)}KB` : "n/a"})`
    }
  }

  if (workflowType === "cls-fix") {
    return {
      analysis: "AI agent analyzing CLS issues...",
      verification: "Agent finished, verifying CLS improvements...",
      report: ({ beforeCls, afterCls }) =>
        `Generating report... (CLS: ${beforeCls?.toFixed(3) || "?"} → ${afterCls?.toFixed(3) || "?"})`
    }
  }

  const agentLabel = devAgentName?.trim() || "dev agent"
  return {
    analysis: `AI agent running ${agentLabel}...`,
    verification: "Agent finished, running post-fix verification...",
    report: () => "Generating report..."
  }
}

export async function agentFixLoopStep(
  sandboxId: string,
  devUrl: string,
  beforeCls: number | null,
  beforeGrade: "good" | "needs-improvement" | "poor" | null,
  beforeScreenshots: Array<{ timestamp: number; blobUrl: string; label?: string }>,
  initD3kLogs: string,
  projectName: string,
  reportId: string,
  startPath: string,
  repoUrl: string,
  repoBranch: string,
  _projectId: string | undefined,
  _teamId: string | undefined,
  sandboxProjectId: string | undefined,
  sandboxTeamId: string | undefined,
  githubPat?: string,
  npmToken?: string,
  sourceTarballUrl?: string,
  sourceLabel?: string,
  vercelOidcToken?: string,
  _vercelAuthSource?: string,
  gatewayAuthToken?: string,
  gatewayAuthSource?: string,
  projectDir?: string,
  repoOwner?: string,
  repoName?: string,
  customPrompt?: string,
  crawlDepth?: number | "all",
  devAgentName?: string,
  devAgentInstructions?: string,
  devAgentAshTarballUrl?: string,
  devAgentExecutionMode?: "dev-server" | "preview-pr",
  devAgentSandboxBrowser?: "none" | "agent-browser",
  devAgentAiAgent?: import("@/lib/dev-agents").DevAgentAiAgent,
  devAgentDevServerCommand?: string,
  devAgentActionSteps?: Array<{ kind: string; config: Record<string, string> }>,
  devAgentSkillRefs?: DevAgentSkillRef[],
  progressContext?: ProgressContext | null,
  initTiming?: InitStepTiming,
  fromSnapshot?: boolean,
  snapshotId?: string,
  devAgentSuccessEval?: string,
  observation?: ObserveResult
): Promise<{
  sandboxId: string
  reportBlobUrl: string
  reportId: string
  beforeCls: number | null
  afterCls: number | null
  status: "improved" | "unchanged" | "degraded" | "no-changes"
  agentSummary: string
  gitDiff: string | null
  timing: AgentStepTiming
  successEvalResult?: boolean | null
}> {
  const timer = new StepTimer()
  const isTurbopackBundleAnalyzer = progressContext?.workflowType === "turbopack-bundle-analyzer"
  const progressLabels = getAgentProgressLabels({
    workflowType: progressContext?.workflowType,
    devAgentName
  })

  const vercelApiTokens = getVercelApiTokenCandidates(vercelOidcToken)

  timer.start("Reconnect to sandbox")
  workflowLog(`[Agent] Reconnecting to sandbox: ${sandboxId}`)
  await updateProgress(progressContext, 3, progressLabels.analysis, devUrl)

  let sandbox: Sandbox
  let recreatedSandbox = false
  try {
    sandbox = await getRunningSandboxWithRetry(sandboxId, progressContext, "agent", 3, 2000, {
      teamId: sandboxTeamId,
      projectId: sandboxProjectId,
      tokens: vercelApiTokens
    })
  } catch (sandboxError) {
    workflowLog(
      `[Agent] Sandbox ${sandboxId} unavailable (${sandboxError instanceof Error ? sandboxError.message : String(sandboxError)}), creating a new one...`
    )
    await appendProgressLog(progressContext, "[Agent] Previous sandbox unavailable, creating a fresh one...")
    let freshResult: Awaited<ReturnType<typeof getOrCreateD3kSandbox>>
    try {
      freshResult = await createSandboxWithTokenFallback(
        {
          repoUrl,
          branch: repoBranch,
          githubPat,
          projectId: sandboxProjectId,
          teamId: sandboxTeamId,
          npmToken,
          sourceTarballUrl,
          sourceLabel,
          projectDir: projectDir || "",
          devCommand: devAgentDevServerCommand,
          timeout: WORKFLOW_SANDBOX_TIMEOUT,
          debug: true,
          onProgress: (message) => appendProgressLog(progressContext, `[Sandbox] ${message}`)
        },
        vercelApiTokens,
        progressContext,
        "agent"
      )
    } catch (freshSandboxError) {
      await appendProgressLog(
        progressContext,
        `[Agent] Fresh sandbox creation failed: ${freshSandboxError instanceof Error ? freshSandboxError.message : String(freshSandboxError)}`
      )
      throw freshSandboxError
    }
    sandbox = freshResult.sandbox
    recreatedSandbox = true
    await appendProgressLog(progressContext, `[Agent] Fresh sandbox ready: ${sandbox.sandboxId}`)
    workflowLog(`[Agent] Fresh sandbox created: ${sandbox.sandboxId}`)
  }

  const effectiveProjectDir = isTurbopackBundleAnalyzer
    ? await resolveSandboxProjectDir(sandbox, projectDir, projectName, progressContext)
    : projectDir

  // Observation step only guarantees skills were installed in the previous sandbox.
  // If we had to recreate the sandbox for the agent step, reinstall them.
  if (!observation || recreatedSandbox) {
    await appendProgressLog(
      progressContext,
      `[Agent] Reinstalling skills in ${recreatedSandbox ? "recreated" : "initial"} agent sandbox...`
    )
    try {
      await installDevAgentSkillsInSandbox(sandbox, effectiveProjectDir, devAgentSkillRefs, progressContext, {
        devAgentAshTarballUrl,
        includeD3k: !isTurbopackBundleAnalyzer
      })
    } catch (skillInstallError) {
      await appendProgressLog(
        progressContext,
        `[Agent] Skill reinstall failed: ${skillInstallError instanceof Error ? skillInstallError.message : String(skillInstallError)}`
      )
      throw skillInstallError
    }
  }

  let turbopackBundleComparison: TurbopackBundleComparison | undefined
  let beforeBundleMetrics: TurbopackBundleMetricsSnapshot | null = null
  if (isTurbopackBundleAnalyzer) {
    await appendProgressLog(progressContext, "[Turbopack] Verifying analyzer NDJSON artifacts before AI step")
    let ndjsonStatus = await checkTurbopackNdjsonArtifacts(sandbox, effectiveProjectDir)
    if (!ndjsonStatus.ok) {
      const missingDetail =
        ndjsonStatus.missingFiles.length > 0
          ? `missing files: ${ndjsonStatus.missingFiles.join(", ")}`
          : "required files are empty"
      await appendProgressLog(
        progressContext,
        `[Turbopack] NDJSON artifacts missing before AI step (${missingDetail}; routes=${ndjsonStatus.routeRows}, output_files=${ndjsonStatus.outputFileRows}). Regenerating once...`
      )
      await prepareTurbopackNdjsonArtifacts(sandbox, effectiveProjectDir, progressContext)
      ndjsonStatus = await checkTurbopackNdjsonArtifacts(sandbox, effectiveProjectDir)
      if (!ndjsonStatus.ok) {
        const postRetryDetail =
          ndjsonStatus.missingFiles.length > 0
            ? `missing files: ${ndjsonStatus.missingFiles.join(", ")}`
            : "required files are empty"
        throw new Error(
          `Turbopack analyzer NDJSON artifacts unavailable in ${ndjsonStatus.projectCwd} after retry (${postRetryDetail}; routes=${ndjsonStatus.routeRows}, output_files=${ndjsonStatus.outputFileRows}). Aborting before AI step.`
        )
      }
    }
    await appendProgressLog(progressContext, "[Turbopack] Capturing baseline NDJSON bundle metrics")
    beforeBundleMetrics = await collectTurbopackBundleMetrics(sandbox, effectiveProjectDir, progressContext, "baseline")
  }
  const bundleBaselineSummary = isTurbopackBundleAnalyzer
    ? formatTurbopackBundleBaselineSummary(beforeBundleMetrics)
    : undefined

  const localTargetUrl = `http://localhost:3000${startPath}`
  const cloudBrowserMode = observation?.cloudBrowserMode ?? resolveCloudBrowserMode(devAgentSandboxBrowser)

  // Use observation data if available (observe step already captured these),
  // otherwise capture fresh web vitals
  let capturedBeforeWebVitals: import("@/types").WebVitals
  let beforeWebVitalsDiagnostics: string[] | undefined
  let beforeClsForVerification: number | null
  let beforeGradeForVerification: "good" | "needs-improvement" | "poor" | null

  if (isTurbopackBundleAnalyzer) {
    capturedBeforeWebVitals = {}
    beforeWebVitalsDiagnostics = undefined
    beforeClsForVerification = null
    beforeGradeForVerification = null
  } else if (observation) {
    workflowLog("[Agent] Using observation data from observe step (skipping redundant capture)")
    capturedBeforeWebVitals = observation.beforeWebVitals
    beforeWebVitalsDiagnostics = undefined
    beforeClsForVerification = observation.beforeCls
    beforeGradeForVerification = observation.beforeGrade
    if (countNonClsWebVitalMetrics(capturedBeforeWebVitals) === 0) {
      timer.start("Supplement before Web Vitals")
      workflowLog("[Agent] Observation baseline vitals incomplete; recapturing before Web Vitals via CDP...")
      const supplementedBeforeVitals = await fetchWebVitalsViaCDP(sandbox, localTargetUrl, cloudBrowserMode, {
        desiredSuccessfulSamples: 2,
        overallTimeoutMs: 10000,
        browserStepTimeoutMs: 3000
      })
      beforeWebVitalsDiagnostics = supplementedBeforeVitals.diagnosticLogs
      const mergedBeforeWebVitals = mergeWebVitalsSnapshots(capturedBeforeWebVitals, supplementedBeforeVitals.vitals)
      if (countNonClsWebVitalMetrics(mergedBeforeWebVitals) > countNonClsWebVitalMetrics(capturedBeforeWebVitals)) {
        capturedBeforeWebVitals = mergedBeforeWebVitals
        await persistRunArtifacts(progressContext, {
          beforeWebVitals: capturedBeforeWebVitals
        })
        workflowLog(`[Agent] Supplemented before Web Vitals: ${JSON.stringify(capturedBeforeWebVitals)}`)
      } else {
        workflowLog("[Agent] Before Web Vitals supplement did not add additional metrics")
      }
      timer.end()
    }
  } else {
    // Capture "before" Web Vitals via CDP before the agent makes any changes
    timer.start("Capture before Web Vitals")
    workflowLog("[Agent] Capturing before Web Vitals via CDP...")
    const webVitalsResult = await fetchWebVitalsViaCDP(sandbox, localTargetUrl, cloudBrowserMode)
    capturedBeforeWebVitals = webVitalsResult.vitals
    beforeWebVitalsDiagnostics = webVitalsResult.diagnosticLogs
    workflowLog(`[Agent] Before Web Vitals captured: ${JSON.stringify(capturedBeforeWebVitals)}`)

    beforeClsForVerification = capturedBeforeWebVitals.cls?.value ?? beforeCls ?? null
    beforeGradeForVerification = capturedBeforeWebVitals.cls?.grade ?? beforeGrade ?? null
  }

  // Run the real Claude Code agent inside the sandbox
  timer.start("Run Claude Code agent")
  const agentResult = await runAgentWithDiagnoseTool(
    sandbox,
    devUrl,
    beforeCls,
    beforeGrade,
    startPath,
    effectiveProjectDir,
    customPrompt,
    progressContext?.workflowType,
    crawlDepth,
    devAgentName,
    devAgentInstructions,
    devAgentExecutionMode,
    devAgentSandboxBrowser,
    devAgentAiAgent,
    devAgentActionSteps,
    devAgentSkillRefs,
    devAgentAshTarballUrl,
    bundleBaselineSummary,
    gatewayAuthToken,
    gatewayAuthSource,
    progressContext
  )
  await updateProgress(progressContext, 3, progressLabels.verification, devUrl)

  let finalCls: {
    clsScore: number | null
    clsGrade: "good" | "needs-improvement" | "poor" | null
    screenshots: Array<{ timestamp: number; blobUrl: string; label?: string }>
    d3kLogs: string
  } = {
    clsScore: null,
    clsGrade: null,
    screenshots: [],
    d3kLogs: ""
  }
  let afterWebVitalsResult: import("@/types").WebVitals = {}
  let afterWebVitalsDiagnostics: string[] | undefined

  if (!isTurbopackBundleAnalyzer) {
    // Force a fresh page reload to capture new CLS measurement
    // The agent might not have called diagnose after its last change
    //
    // IMPORTANT: We use Page.reload instead of navigating to about:blank and back.
    // Reason: d3k's screencast manager checks window.location.href when navigation starts.
    // When navigating FROM about:blank TO localhost, the URL check still sees about:blank
    // (because the navigation just started), so it SKIPS capture. Page.reload avoids this.
    timer.start("Reload page for final CLS")
    workflowLog("[Agent] Forcing page reload to capture final CLS...")

    const navResult = await navigateBrowser(sandbox, localTargetUrl, cloudBrowserMode)
    workflowLog(
      `[Agent] Navigate to devUrl result: success=${navResult.success}${navResult.error ? `, error=${navResult.error}` : ""}`
    )
    await new Promise((resolve) => setTimeout(resolve, 1000))

    const reloadResult = await reloadBrowser(sandbox, cloudBrowserMode)
    workflowLog(
      `[Agent] Page reload result: success=${reloadResult.success}${reloadResult.error ? `, error=${reloadResult.error}` : ""}`
    )
    workflowLog("[Agent] Waiting for CLS to be captured...")
    await new Promise((resolve) => setTimeout(resolve, 5000))
    timer.end()

    timer.start("Capture after evidence")
    workflowLog("[Agent] Capturing after Web Vitals + screenshot via persistent CDP...")
    const afterEvidence = await capturePhaseEvidenceViaCDP(
      sandbox,
      startPath,
      projectName,
      "after",
      "After",
      localTargetUrl,
      {
        sampleCount: 3,
        navigationTimeoutMs: 3500,
        settleMs: 750,
        overallTimeoutMs: 18000
      }
    )
    afterWebVitalsResult = afterEvidence.vitals
    afterWebVitalsDiagnostics = afterEvidence.diagnosticLogs
    if (countPostLoadWebVitalMetrics(afterWebVitalsResult) < 3) {
      timer.start("Supplement after Web Vitals")
      workflowLog("[Agent] After Web Vitals incomplete; recapturing non-CLS vitals via CDP...")
      const supplementedAfterVitals = await fetchWebVitalsViaCDP(sandbox, localTargetUrl, cloudBrowserMode, {
        desiredSuccessfulSamples: 2,
        overallTimeoutMs: 10000,
        browserStepTimeoutMs: 3000
      })
      afterWebVitalsDiagnostics = [...afterEvidence.diagnosticLogs, ...supplementedAfterVitals.diagnosticLogs]
      const mergedAfterWebVitals = mergeWebVitalsSnapshots(afterWebVitalsResult, supplementedAfterVitals.vitals)
      if (countPostLoadWebVitalMetrics(mergedAfterWebVitals) > countPostLoadWebVitalMetrics(afterWebVitalsResult)) {
        afterWebVitalsResult = mergedAfterWebVitals
        workflowLog(`[Agent] Supplemented after Web Vitals: ${JSON.stringify(afterWebVitalsResult)}`)
      } else {
        workflowLog("[Agent] After Web Vitals supplement did not add additional post-load metrics")
      }
      timer.end()
    }
    if (finalCls.screenshots.length === 0 && afterEvidence.screenshots.length > 0) {
      finalCls.screenshots = afterEvidence.screenshots
      await persistRunArtifacts(progressContext, {
        afterScreenshots: finalCls.screenshots
      })
    }
    if (finalCls.screenshots.length === 0) {
      const quickAfterScreenshots = await capturePhaseScreenshot(
        sandbox,
        startPath,
        cloudBrowserMode,
        projectName,
        "after-quick-fallback",
        "After",
        localTargetUrl,
        3000
      )
      if (quickAfterScreenshots.length > 0) {
        finalCls.screenshots = quickAfterScreenshots
        await persistRunArtifacts(progressContext, {
          afterScreenshots: finalCls.screenshots
        })
      }
    }
    timer.end()

    timer.start("Fetch final CLS data")
    finalCls = await fetchClsData(sandbox)
    if (finalCls.screenshots.length === 0) {
      const afterScreenshots = await capturePhaseScreenshot(
        sandbox,
        startPath,
        cloudBrowserMode,
        projectName,
        "after-fallback",
        "After",
        localTargetUrl,
        6000
      )
      if (afterScreenshots.length > 0) {
        finalCls.screenshots = afterScreenshots
        await persistRunArtifacts(progressContext, {
          afterScreenshots
        })
      }
      workflowLog(`[Agent] Captured ${finalCls.screenshots.length} after screenshot(s)`)
    }
    timer.end()
  }

  // Get git diff (exclude package.json which gets modified by sandbox initialization)
  timer.start("Get git diff")
  const diffResult = await runSandboxCommand(sandbox, "sh", [
    "-c",
    "cd /vercel/sandbox && git diff --no-color -- . ':!package.json' ':!package-lock.json' ':!pnpm-lock.yaml' 2>/dev/null || echo ''"
  ])
  const gitDiff = diffResult.stdout.trim() || null
  const hasChanges = !!gitDiff && gitDiff.length > 0
  const transcriptClsEvidence = extractClsEvidence(agentResult.summary, agentResult.transcript)
  if (transcriptClsEvidence.beforeCls !== null || transcriptClsEvidence.afterCls !== null) {
    workflowLog(
      `[Agent] Transcript CLS fallback (${transcriptClsEvidence.source || "unknown"}): before=${transcriptClsEvidence.beforeCls}, after=${transcriptClsEvidence.afterCls}`
    )
  }

  if (isTurbopackBundleAnalyzer) {
    await appendProgressLog(progressContext, "[Turbopack] Re-running analyzer for after-fix bundle metrics")
    try {
      await prepareTurbopackNdjsonArtifacts(sandbox, effectiveProjectDir, progressContext)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await appendProgressLog(progressContext, `[Turbopack] Failed to regenerate NDJSON after changes: ${message}`)
    }
    const afterBundleMetrics = await collectTurbopackBundleMetrics(
      sandbox,
      effectiveProjectDir,
      progressContext,
      "after-fix"
    )
    if (beforeBundleMetrics && afterBundleMetrics) {
      turbopackBundleComparison = buildTurbopackBundleComparison(beforeBundleMetrics, afterBundleMetrics)
      await appendProgressLog(
        progressContext,
        `[Turbopack] Bundle delta: ${Math.round(turbopackBundleComparison.delta.compressedBytes / 1024)}KB compressed`
      )
    }
  }

  const afterD3kLogs = isTurbopackBundleAnalyzer
    ? "(bundle analyzer workflow does not use d3k browser verification)"
    : finalCls.d3kLogs.replace(initD3kLogs, "").trim() || "(no new logs)"
  const combinedD3kLogs = `=== Step 1: Init (before agent) ===\n${initD3kLogs}\n\n=== Step 2: After agent fix ===\n${afterD3kLogs}`

  // Determine workflow type from progress context
  const workflowType =
    (progressContext?.workflowType as
      | "cls-fix"
      | "prompt"
      | "design-guidelines"
      | "react-performance"
      | "url-audit"
      | "turbopack-bundle-analyzer") || "cls-fix"

  const effectiveBeforeClsScore = beforeClsForVerification ?? transcriptClsEvidence.beforeCls ?? null
  const effectiveBeforeClsGrade = beforeGradeForVerification ?? gradeClsValue(effectiveBeforeClsScore)
  const effectiveAfterClsScore =
    finalCls.clsScore ?? afterWebVitalsResult.cls?.value ?? transcriptClsEvidence.afterCls ?? null
  const effectiveAfterClsGrade =
    finalCls.clsGrade || afterWebVitalsResult.cls?.grade || gradeClsValue(effectiveAfterClsScore)
  const status = isTurbopackBundleAnalyzer
    ? determineTurbopackStatus({
        hasChanges,
        bundleComparison: turbopackBundleComparison
      })
    : determineClsStatus({
        hasChanges,
        beforeCls: effectiveBeforeClsScore,
        afterCls: effectiveAfterClsScore
      })

  workflowLog(
    isTurbopackBundleAnalyzer
      ? `[Agent] Status: ${status}, Bundle delta: ${turbopackBundleComparison?.delta.compressedBytes ?? "n/a"} bytes`
      : `[Agent] Status: ${status}, Before: ${effectiveBeforeClsScore}, After: ${effectiveAfterClsScore}`
  )
  await updateProgress(
    progressContext,
    4,
    progressLabels.report({
      beforeCls: effectiveBeforeClsScore,
      afterCls: effectiveAfterClsScore,
      bundleDeltaCompressedBytes: turbopackBundleComparison?.delta.compressedBytes
    }),
    devUrl
  )

  // Use the capturedBeforeWebVitals we got at the start of this function
  // Merge with the beforeCls we got from init step if CDP didn't capture it
  const beforeWebVitals: import("@/types").WebVitals = { ...capturedBeforeWebVitals }
  const afterWebVitals: import("@/types").WebVitals = { ...afterWebVitalsResult }
  if (!isTurbopackBundleAnalyzer && !beforeWebVitals.cls && effectiveBeforeClsScore !== null) {
    beforeWebVitals.cls = {
      value: effectiveBeforeClsScore,
      grade: effectiveBeforeClsGrade || "good"
    }
  }
  if (!isTurbopackBundleAnalyzer && !afterWebVitals.cls && effectiveAfterClsScore !== null) {
    afterWebVitals.cls = {
      value: effectiveAfterClsScore,
      grade: effectiveAfterClsGrade || "good"
    }
  }

  workflowLog(`[Agent] Before Web Vitals: ${JSON.stringify(beforeWebVitals)}`)
  workflowLog(`[Agent] After Web Vitals: ${JSON.stringify(afterWebVitals)}`)

  // Generate report inline
  timer.start("Build report payload")

  const { skillsInstalled } = await readSandboxSkillsInfo(sandbox)

  // ── Token usage tracking ────────────────────────────────────────────
  let totalPromptTokens = agentResult.usage.promptTokens
  let totalCompletionTokens = agentResult.usage.completionTokens
  const totalCacheReadTokens = agentResult.usage.cacheReadTokens
  const totalCacheCreationTokens = agentResult.usage.cacheCreationTokens
  const totalCostUsd = agentResult.costUsd

  // ── Success Eval ──────────────────────────────────────────────────────
  let successEvalResult: boolean | null = null
  if (devAgentSuccessEval?.trim()) {
    try {
      timer.start("Success eval")
      workflowLog(`[Agent] Running success eval with ${SUCCESS_EVAL_MODEL}`)
      const evalGateway = createVercelGateway(gatewayAuthToken)
      const evalResult = await generateText({
        model: evalGateway(SUCCESS_EVAL_MODEL),
        system:
          'You are an evaluation judge. Given the agent\'s work summary and the success criteria, respond ONLY with a JSON object: {"success": true} or {"success": false}. No explanation.',
        prompt: `Success criteria: "${devAgentSuccessEval.trim()}"

Agent work summary:
${agentResult.summary}

Git diff summary:
${gitDiff ? gitDiff.slice(0, 4000) : "No changes made."}

Did the agent meet the success criteria? Respond with JSON only.`
      })
      totalPromptTokens += evalResult.usage.inputTokens ?? 0
      totalCompletionTokens += evalResult.usage.outputTokens ?? 0
      const evalText = evalResult.text.trim()
      const jsonMatch = evalText.match(/\{[^}]*"success"\s*:\s*(true|false)[^}]*\}/)
      if (jsonMatch) {
        successEvalResult = JSON.parse(jsonMatch[0]).success === true
      }
      workflowLog(`[Agent] Success eval result: ${successEvalResult}`)
      timer.end()
    } catch (evalError) {
      workflowLog(`[Agent] Success eval failed: ${evalError instanceof Error ? evalError.message : String(evalError)}`)
      successEvalResult = null
    }
  }

  let verificationStatus: WorkflowReport["verificationStatus"] = status === "no-changes" ? "unchanged" : status
  if (
    verificationStatus !== "improved" &&
    hasChanges &&
    successEvalResult === true &&
    effectiveBeforeClsScore !== null &&
    effectiveAfterClsScore !== null &&
    effectiveAfterClsScore < effectiveBeforeClsScore
  ) {
    verificationStatus = "improved"
  }

  if (
    workflowType === "cls-fix" &&
    hasChanges &&
    effectiveBeforeClsScore !== null &&
    effectiveAfterClsScore !== null &&
    effectiveAfterClsScore < effectiveBeforeClsScore &&
    (successEvalResult === null || successEvalResult === false)
  ) {
    successEvalResult = true
  }

  if (
    progressContext?.runnerKind === "skill-runner" &&
    hasChanges &&
    verificationStatus !== "degraded" &&
    !isMeaningfulWebVitalRegression(beforeWebVitals, afterWebVitals)
  ) {
    successEvalResult = true
  }

  const reportBase: Omit<WorkflowReport, "timing"> = {
    id: reportId,
    projectName,
    timestamp: new Date().toISOString(),
    devAgentId: progressContext?.devAgentId,
    devAgentName: devAgentName || progressContext?.devAgentName,
    devAgentDescription: progressContext?.devAgentDescription,
    devAgentRevision: progressContext?.devAgentRevision,
    devAgentSpecHash: progressContext?.devAgentSpecHash,
    devAgentExecutionMode: devAgentExecutionMode || progressContext?.devAgentExecutionMode,
    devAgentSandboxBrowser: devAgentSandboxBrowser || progressContext?.devAgentSandboxBrowser,
    workflowType,
    devAgentPrompt: devAgentInstructions || undefined,
    devAgentInstructions: devAgentInstructions || undefined,
    devAgentSkills: devAgentSkillRefs?.length ? devAgentSkillRefs : undefined,
    analysisTargetType: "vercel-project",
    customPrompt: customPrompt ?? undefined,
    systemPrompt: agentResult.systemPrompt,
    sandboxDevUrl: devUrl,
    startPath,
    repoUrl,
    repoBranch,
    projectDir: projectDir || undefined,
    repoOwner: repoOwner || undefined,
    repoName: repoName || undefined,
    clsScore: effectiveBeforeClsScore ?? undefined,
    clsGrade: effectiveBeforeClsGrade ?? undefined,
    beforeScreenshots,
    beforeWebVitals: Object.keys(beforeWebVitals).length > 0 ? beforeWebVitals : undefined,
    afterClsScore: effectiveAfterClsScore ?? undefined,
    afterClsGrade: effectiveAfterClsGrade ?? undefined,
    afterScreenshots: finalCls.screenshots,
    afterWebVitals: Object.keys(afterWebVitals).length > 0 ? afterWebVitals : undefined,
    verificationStatus,
    costUsd: totalCostUsd,
    agentAnalysis: agentResult.transcript,
    agentAnalysisModel: agentResult.modelId,
    skillsInstalled: skillsInstalled.length > 0 ? skillsInstalled : undefined,
    skillsLoaded: agentResult.skillsLoaded.length > 0 ? agentResult.skillsLoaded : undefined,
    turbopackBundleComparison,
    gitDiff: gitDiff ?? undefined,
    d3kLogs: combinedD3kLogs,
    initD3kLogs: initD3kLogs,
    afterD3kLogs: afterD3kLogs,
    webVitalsDiagnostics: {
      before: beforeWebVitalsDiagnostics,
      after: afterWebVitalsDiagnostics
    },
    // AI Gateway usage
    gatewayUsage: {
      promptTokens: totalPromptTokens,
      completionTokens: totalCompletionTokens,
      cacheReadTokens: totalCacheReadTokens,
      cacheCreationTokens: totalCacheCreationTokens,
      totalTokens: totalPromptTokens + totalCompletionTokens + totalCacheReadTokens + totalCacheCreationTokens
    },
    // Marketplace agent flag
    isMarketplaceAgent: progressContext?.isMarketplaceAgent || undefined,
    // Success eval
    successEval: devAgentSuccessEval || undefined,
    successEvalResult,
    // Sandbox and timing info
    fromSnapshot: fromSnapshot ?? false,
    snapshotId
  }

  const agentTimingData = timer.getData()
  const initMs = initTiming?.totalMs ?? 0
  const agentMs = agentTimingData.totalMs
  const reportTiming: WorkflowReport["timing"] = {
    total: {
      initMs,
      agentMs,
      totalMs: initMs + agentMs
    },
    init: initTiming
      ? {
          sandboxCreationMs: initTiming.sandboxCreation.totalMs,
          fromSnapshot: fromSnapshot ?? false,
          steps: initTiming.steps.map((s) => ({ name: s.name, durationMs: s.durationMs }))
        }
      : undefined,
    agent: {
      steps: agentTimingData.steps.map((s) => ({ name: s.name, durationMs: s.durationMs }))
    }
  }

  const report: WorkflowReport = {
    ...reportBase,
    timing: reportTiming
  }

  const blob = await putBlobAndBuildUrl(`report-${reportId}.json`, JSON.stringify(report, null, 2), {
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
    absoluteUrl: true
  })

  workflowLog(`[Agent] Report saved: ${blob.appUrl}`)

  timer.end()

  // Log timing breakdown
  const timingData = timer.getData()
  workflowLog(`[Agent] ⏱️ TIMING BREAKDOWN (total: ${(timingData.totalMs / 1000).toFixed(1)}s)`)
  for (const step of timingData.steps) {
    const secs = (step.durationMs / 1000).toFixed(1)
    const pct = ((step.durationMs / timingData.totalMs) * 100).toFixed(0)
    workflowLog(`[Agent]   ${step.name}: ${secs}s (${pct}%)`)
  }

  return {
    sandboxId: sandbox.sandboxId,
    reportBlobUrl: blob.appUrl,
    reportId,
    beforeCls: effectiveBeforeClsScore,
    afterCls: effectiveAfterClsScore,
    status,
    agentSummary: agentResult.summary,
    gitDiff,
    timing: timingData,
    successEvalResult
  }
}

export async function urlAuditStep(
  sandboxId: string,
  sandboxDevUrl: string,
  targetUrl: string,
  workflowType: string | undefined,
  customPrompt: string | undefined,
  projectName: string,
  reportId: string,
  gatewayAuthToken?: string,
  _gatewayAuthSource?: string,
  progressContext?: ProgressContext | null,
  initTiming?: InitStepTiming,
  fromSnapshot?: boolean,
  snapshotId?: string
): Promise<{
  sandboxId: string
  reportBlobUrl: string
  reportId: string
  beforeCls: number | null
  afterCls: number | null
  status: "improved" | "unchanged" | "degraded" | "no-changes"
  agentSummary: string
  gitDiff: string | null
}> {
  const timer = new StepTimer()
  timer.start("Reconnect to sandbox")
  await updateProgress(progressContext, 2, "Launching external URL audit...", targetUrl)

  const sandbox = await Sandbox.get({ sandboxId })
  if (sandbox.status !== "running") {
    throw new Error(`Sandbox not running: ${sandbox.status}`)
  }

  timer.start("Navigate to target URL")
  const navResult = await navigateBrowser(sandbox, targetUrl, "agent-browser")
  if (!navResult.success) {
    throw new Error(`Failed to open target URL: ${navResult.error || "unknown error"}`)
  }
  await new Promise((resolve) => setTimeout(resolve, 3000))

  timer.start("Capture Web Vitals")
  const { vitals, diagnosticLogs } = await fetchWebVitalsViaCDP(sandbox, targetUrl, "agent-browser")

  timer.start("Collect page diagnostics")
  const diagnosticsResult = await evaluateInBrowser(
    sandbox,
    `(() => {
      const scripts = Array.from(document.querySelectorAll("script[src]")).map((el) => el.getAttribute("src") || "")
      const stylesheets = Array.from(document.querySelectorAll('link[rel="stylesheet"]')).map((el) => el.getAttribute("href") || "")
      const images = Array.from(document.images || [])
      const imagesWithoutAlt = images.filter((img) => !img.getAttribute("alt")).length
      const imagesWithoutSize = images.filter((img) => !img.getAttribute("width") && !img.getAttribute("height")).length
      const sourceMapCandidates = scripts
        .filter(Boolean)
        .map((src) => src.startsWith("http") ? src : new URL(src, window.location.href).href)
        .map((src) => src + ".map")
        .slice(0, 20)
      const resources = performance
        .getEntriesByType("resource")
        .filter((entry) => typeof entry.transferSize === "number")
        .sort((a, b) => (b.transferSize || 0) - (a.transferSize || 0))
        .slice(0, 10)
        .map((entry) => ({
          name: entry.name,
          initiatorType: entry.initiatorType,
          transferSize: entry.transferSize || 0,
          duration: entry.duration || 0
        }))

      return JSON.stringify({
        url: window.location.href,
        title: document.title || null,
        htmlLang: document.documentElement.lang || null,
        scriptsCount: scripts.length,
        stylesheetsCount: stylesheets.length,
        imagesCount: images.length,
        imagesWithoutAlt,
        imagesWithoutSize,
        sourceMapCandidates,
        topResources: resources
      })
    })()`,
    "agent-browser"
  )

  const diagnosticsRaw = extractWebVitalsResultString(diagnosticsResult)
  let pageDiagnostics: Record<string, unknown> = {}
  if (diagnosticsRaw) {
    try {
      pageDiagnostics = JSON.parse(diagnosticsRaw) as Record<string, unknown>
    } catch {
      pageDiagnostics = {}
    }
  }

  timer.start("Generate audit analysis")
  const gateway = createVercelGateway(gatewayAuthToken)

  const analysisResponse = await generateText({
    model: gateway("openai/gpt-5.4"),
    prompt:
      workflowType === "prompt" && customPrompt
        ? `You are a senior web analyst operating in read-only mode on a public URL.
Follow the user's instructions exactly while being explicit about uncertainty.

Context:
- Target URL: ${targetUrl}
- Custom Instructions: ${customPrompt}
- Web Vitals: ${JSON.stringify(vitals)}
- Page diagnostics: ${JSON.stringify(pageDiagnostics)}
- Diagnostic logs: ${JSON.stringify(diagnosticLogs.slice(-20))}

Output format:
1) Executive Summary (2-4 bullets)
2) Findings (ordered by impact, each with confidence High/Med/Low)
3) Recommendations (specific, prioritized, practical)
4) Limitations (what could not be verified from external-only access)

Constraints:
- This is read-only external analysis (no code access).
- Do not claim certainty where evidence is weak.
- Keep recommendations practical and specific.
`
        : `You are a senior web performance and UX auditor.
Generate a concise, actionable report for an external URL audit.

Context:
- Target URL: ${targetUrl}
- Workflow Type: ${workflowType || "design-guidelines"}
- Web Vitals: ${JSON.stringify(vitals)}
- Page diagnostics: ${JSON.stringify(pageDiagnostics)}
- Diagnostic logs: ${JSON.stringify(diagnosticLogs.slice(-20))}

Output format:
1) Executive Summary (2-4 bullets)
2) Highest-Impact Issues (ordered by impact, include confidence High/Med/Low)${
            workflowType === "react-performance"
              ? " with emphasis on React render patterns, hydration, bundle loading, and runtime interactivity."
              : workflowType === "design-guidelines"
                ? " with emphasis on usability, information hierarchy, accessibility, and visual consistency."
                : ""
          }
3) Suggested Fixes (prioritized, implementation-ready guidance)${
            workflowType === "react-performance"
              ? " with likely React/Next.js implementation patterns where inferable."
              : workflowType === "design-guidelines"
                ? " tied to concrete UX and design guideline outcomes."
                : ""
          }
4) Sourcemap Guidance (what was inferred externally, limitations)
5) What Cannot Be Confirmed Without Repo Access

Constraints:
- This is read-only external analysis (no code access).
- Do not claim certainty where evidence is weak.
- Keep recommendations practical and specific.
`
  })

  const initMs = initTiming?.totalMs ?? 0
  const agentMs = timer.getData().totalMs
  const reportStartPath = (() => {
    try {
      const url = new URL(targetUrl)
      return `${url.pathname || "/"}${url.search}`
    } catch {
      return "/"
    }
  })()
  const reportTiming: WorkflowReport["timing"] = {
    total: {
      initMs,
      agentMs,
      totalMs: initMs + agentMs
    },
    init: initTiming
      ? {
          sandboxCreationMs: initTiming.sandboxCreation.totalMs,
          fromSnapshot: fromSnapshot ?? false,
          steps: initTiming.steps.map((s) => ({ name: s.name, durationMs: s.durationMs }))
        }
      : undefined,
    agent: {
      steps: timer.getData().steps.map((s) => ({ name: s.name, durationMs: s.durationMs }))
    }
  }

  const report: WorkflowReport = {
    id: reportId,
    projectName,
    timestamp: new Date().toISOString(),
    devAgentRevision: progressContext?.devAgentRevision,
    devAgentSpecHash: progressContext?.devAgentSpecHash,
    workflowType: (workflowType as WorkflowType) || "design-guidelines",
    customPrompt: workflowType === "prompt" ? customPrompt : undefined,
    analysisTargetType: "url",
    targetUrl,
    sandboxDevUrl,
    startPath: reportStartPath,
    beforeWebVitals: Object.keys(vitals).length > 0 ? vitals : undefined,
    afterWebVitals: Object.keys(vitals).length > 0 ? vitals : undefined,
    agentAnalysis: analysisResponse.text,
    agentAnalysisModel: "openai/gpt-5.4",
    d3kLogs: diagnosticLogs.join("\n"),
    initD3kLogs: diagnosticLogs.join("\n"),
    webVitalsDiagnostics: {
      before: diagnosticLogs,
      after: diagnosticLogs
    },
    timing: reportTiming,
    fromSnapshot: fromSnapshot ?? false,
    snapshotId
  }

  const blob = await putBlobAndBuildUrl(`report-${reportId}.json`, JSON.stringify(report, null, 2), {
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
    absoluteUrl: true
  })

  await updateProgress(progressContext, 4, "URL audit complete. Preparing report...", targetUrl)

  return {
    sandboxId,
    reportBlobUrl: blob.appUrl,
    reportId,
    beforeCls: null,
    afterCls: null,
    status: "unchanged",
    agentSummary:
      workflowType === "react-performance"
        ? "URL React performance audit completed"
        : workflowType === "prompt"
          ? "URL custom prompt analysis completed"
          : "URL design audit completed",
    gitDiff: null
  }
}

// ============================================================
// Agent with Diagnose Tool
// ============================================================

function shellEscape(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

function getInstalledSkillNames(
  devAgentSkillRefs: DevAgentSkillRef[] | undefined,
  options?: { includeD3k?: boolean; includeAshRunbook?: boolean }
): string[] {
  const names = new Set<string>()
  if (options?.includeD3k !== false) {
    names.add("d3k")
  }
  for (const skill of devAgentSkillRefs || []) {
    const label = skill.displayName?.trim() || skill.skillName?.trim()
    if (!label) continue
    names.add(label)
  }
  return Array.from(names)
}

function buildSkillsInstallShellCommand(installArg: string): string {
  const normalizedInstallArg = installArg.trim()
  const isHttpSource = /^https?:\/\//i.test(normalizedInstallArg)
  const agentSlug = "claude-code"

  if (normalizedInstallArg === VERCEL_PLUGIN_INSTALL_ARG) {
    return `npx --yes skills@latest add ${shellEscape(normalizedInstallArg)} --agent ${agentSlug} --skill '*' -y`
  }

  if (!isHttpSource && normalizedInstallArg.includes("@")) {
    const packageAndSkill = normalizedInstallArg.split("@")
    const packageName = packageAndSkill.slice(0, -1).join("@").trim()
    const skillName = packageAndSkill[packageAndSkill.length - 1]?.trim()

    if (packageName && skillName) {
      return [
        "npx --yes skills@latest add",
        shellEscape(packageName),
        "--skill",
        shellEscape(skillName),
        `--agent ${agentSlug} -y`
      ].join(" ")
    }
  }

  return `npx --yes skills@latest add ${shellEscape(normalizedInstallArg)} --agent ${agentSlug} -y`
}

async function installPackagedAshSkillsInSandbox(
  sandbox: Sandbox,
  tarballUrl: string,
  progressContext?: ProgressContext | null
): Promise<{ installed: boolean; skillNames: string[] }> {
  const result = await runSandboxCommand(sandbox, "sh", [
    "-c",
    [
      "set -e",
      'TMP_DIR="$(mktemp -d)"',
      `curl -fsSL ${shellEscape(tarballUrl)} -o "$TMP_DIR/ash.tgz"`,
      'ROOT_DIR="$(tar -tzf "$TMP_DIR/ash.tgz" | head -1 | cut -d/ -f1)"',
      'mkdir -p "$TMP_DIR/unpack" "$HOME/.claude/skills"',
      'tar -xzf "$TMP_DIR/ash.tgz" -C "$TMP_DIR/unpack"',
      'SKILLS_DIR="$TMP_DIR/unpack/$ROOT_DIR/agent/skills"',
      'if [ ! -d "$SKILLS_DIR" ]; then echo "__NO_PACKAGED_SKILLS__"; exit 0; fi',
      'cp -R "$SKILLS_DIR"/. "$HOME/.claude/skills/"',
      'find "$HOME/.claude/skills" -mindepth 1 -maxdepth 1 -type d -exec basename {} \\; | sort'
    ].join(" && ")
  ])

  const output = `${result.stdout}\n${result.stderr}`.trim()
  if (result.exitCode !== 0) {
    throw new Error(`Failed to install packaged ASH skills: ${output || "unknown error"}`)
  }

  if (output.includes("__NO_PACKAGED_SKILLS__")) {
    await appendProgressLog(progressContext, "[Skills] No packaged ASH skills were found in the agent artifact")
    return { installed: false, skillNames: [] }
  }

  const skillNames = output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith("__"))

  if (skillNames.length > 0) {
    await appendProgressLog(progressContext, `[Skills] Installed packaged ASH skills: ${skillNames.join(", ")}`)
  }

  return { installed: skillNames.length > 0, skillNames }
}

function buildAshRuntimePassword(runId: string, specHash?: string): string {
  return Buffer.from(`${runId}:${specHash || "no-spec"}:dev3000-ash-runtime`, "utf8").toString("base64url")
}

function buildAshRuntimeAppRoot(specHash?: string): string {
  const safeKey = (specHash || "default").replace(/[^a-zA-Z0-9_-]/g, "-")
  return `${ASH_RUNTIME_ROOT}/${safeKey}`
}

function buildAshRuntimeAuthorizationHeader(password: string): string {
  return `Basic ${Buffer.from(`${ASH_RUNTIME_USERNAME}:${password}`, "utf8").toString("base64")}`
}

async function installPackagedAshAppInSandbox(
  sandbox: Sandbox,
  tarballUrl: string,
  specHash: string | undefined,
  progressContext?: ProgressContext | null
): Promise<{ appRoot: string }> {
  const appRoot = buildAshRuntimeAppRoot(specHash)
  const result = await runSandboxCommand(
    sandbox,
    "sh",
    [
      "-c",
      [
        "set -e",
        `APP_ROOT=${shellEscape(appRoot)}`,
        'if [ -d "$APP_ROOT/node_modules" ] && [ -f "$APP_ROOT/agent/agent.ts" ] && [ -f "$APP_ROOT/.output/server/index.mjs" ]; then printf "%s" "$APP_ROOT"; exit 0; fi',
        'TMP_DIR="$(mktemp -d)"',
        `curl -fsSL ${shellEscape(tarballUrl)} -o "$TMP_DIR/ash.tgz"`,
        'ROOT_DIR="$(tar -tzf "$TMP_DIR/ash.tgz" | head -1 | cut -d/ -f1)"',
        `mkdir -p ${shellEscape(ASH_RUNTIME_ROOT)}`,
        'rm -rf "$TMP_DIR/unpack" "$APP_ROOT.tmp"',
        'mkdir -p "$TMP_DIR/unpack"',
        'tar -xzf "$TMP_DIR/ash.tgz" -C "$TMP_DIR/unpack"',
        'mv "$TMP_DIR/unpack/$ROOT_DIR" "$APP_ROOT.tmp"',
        'rm -rf "$APP_ROOT"',
        'mv "$APP_ROOT.tmp" "$APP_ROOT"',
        "export PATH=$HOME/.bun/bin:/usr/local/bin:$PATH",
        "export DEV3000_ASH_RUNTIME_PASSWORD=build-only",
        'cd "$APP_ROOT"',
        "bun install --silent",
        "./node_modules/.bin/ash build",
        'printf "%s" "$APP_ROOT"'
      ].join(" && ")
    ],
    { timeoutMs: 180000 }
  )

  const output = `${result.stdout}\n${result.stderr}`.trim()
  if (result.exitCode !== 0) {
    throw new Error(`Failed to install packaged ASH app: ${output || "unknown error"}`)
  }

  await appendProgressLog(progressContext, `[ASH] Installed packaged app at ${appRoot}`)
  return { appRoot }
}

async function waitForAshRuntimeReady(
  sandbox: Sandbox,
  port: number,
  authorization: string,
  progressContext?: ProgressContext | null,
  logPath?: string
): Promise<string> {
  const deadline = Date.now() + 120000
  let lastRouteError: string | null = null

  while (Date.now() < deadline) {
    try {
      const baseUrl = sandbox.domain(port)
      const response = await fetch(`${baseUrl}/.well-known/ash/v1/health`, {
        headers: { authorization, "cache-control": "no-store" }
      })
      if (response.ok) {
        await appendProgressLog(progressContext, `[ASH] Runtime healthy at ${baseUrl}`)
        return baseUrl
      }
    } catch (error) {
      lastRouteError = error instanceof Error ? error.message : String(error)
    }
    await new Promise((resolve) => setTimeout(resolve, 2000))
  }

  let runtimeLogPreview = ""
  if (logPath) {
    try {
      const logResult = await runSandboxCommandWithOptions(sandbox, {
        cmd: "sh",
        args: ["-lc", `[ -f "${logPath}" ] && tail -n 80 "${logPath}" || true`]
      })
      runtimeLogPreview = formatClaudeOutputPreview(logResult.stdout || logResult.stderr, 1200)
      if (runtimeLogPreview && runtimeLogPreview !== "<empty>") {
        await appendProgressLog(progressContext, `[ASH] Runtime log before timeout: ${runtimeLogPreview}`)
      }
    } catch (error) {
      runtimeLogPreview = `failed to read log: ${error instanceof Error ? error.message : String(error)}`
    }
  }

  throw new Error(
    `Timed out waiting for packaged ASH runtime on port ${port}${lastRouteError ? ` (${lastRouteError})` : ""}${runtimeLogPreview ? ` log=${runtimeLogPreview}` : ""}`
  )
}

async function ensurePackagedAshRuntimeInSandbox(
  sandbox: Sandbox,
  tarballUrl: string,
  specHash: string | undefined,
  projectRoot: string,
  gatewayAuthToken: string | undefined,
  progressContext?: ProgressContext | null
): Promise<{ authorization: string; baseUrl: string }> {
  const { appRoot } = await installPackagedAshAppInSandbox(sandbox, tarballUrl, specHash, progressContext)
  const runtimePassword = buildAshRuntimePassword(progressContext?.runId || crypto.randomUUID(), specHash)
  const authorization = buildAshRuntimeAuthorizationHeader(runtimePassword)
  const logPath = `${ASH_RUNTIME_LOG_DIR}/ash-runtime.log`

  await appendProgressLog(progressContext, `[ASH] Starting built runtime on port ${ASH_RUNTIME_PORT}...`)
  await sandbox.runCommand({
    cmd: "sh",
    args: [
      "-c",
      [
        `mkdir -p ${ASH_RUNTIME_LOG_DIR}`,
        "export PATH=$HOME/.bun/bin:/usr/local/bin:$PATH",
        'mkdir -p "$HOME/.local/bin"',
        'if ! command -v node >/dev/null 2>&1 && command -v nodejs >/dev/null 2>&1; then ln -sf "$(command -v nodejs)" "$HOME/.local/bin/node"; fi',
        "export PATH=$HOME/.local/bin:$PATH",
        'NODE_RUNTIME="$(command -v nodejs || command -v node || command -v bun || true)"',
        'if [ -z "$NODE_RUNTIME" ]; then echo "No Node.js runtime available for ASH." >&2; exit 1; fi',
        `export DEV3000_ASH_RUNTIME_USERNAME=${shellEscape(ASH_RUNTIME_USERNAME)}`,
        `export DEV3000_ASH_RUNTIME_PASSWORD=${shellEscape(runtimePassword)}`,
        `export DEV3000_PROJECT_ROOT=${shellEscape(projectRoot)}`,
        gatewayAuthToken ? `export VERCEL_OIDC_TOKEN=${shellEscape(gatewayAuthToken)}` : null,
        `export PORT=${ASH_RUNTIME_PORT}`,
        "export HOST=0.0.0.0",
        "export HOSTNAME=0.0.0.0",
        `export NITRO_PORT=${ASH_RUNTIME_PORT}`,
        "export NITRO_HOST=0.0.0.0",
        `: > ${logPath}`,
        `printf 'launching packaged ASH runtime\\n' >> ${logPath}`,
        `cd ${shellEscape(appRoot)}`,
        `printf 'runtime=%s\\npwd=%s\\nport=%s\\n' "$NODE_RUNTIME" "$(pwd)" "${ASH_RUNTIME_PORT}" >> ${logPath}`,
        `ls -l ./.output/server/index.mjs >> ${logPath} 2>&1 || true`,
        `exec "$NODE_RUNTIME" ./.output/server/index.mjs >> ${logPath} 2>&1`
      ]
        .filter(Boolean)
        .join(" && ")
    ],
    detached: true
  })

  const baseUrl = await waitForAshRuntimeReady(sandbox, ASH_RUNTIME_PORT, authorization, progressContext, logPath)
  return { authorization, baseUrl }
}

function buildAshRuntimePromptPrefix({
  devUrl,
  devAgentSandboxBrowser,
  skillLoadInstructions
}: {
  devUrl: string
  devAgentSandboxBrowser?: "none" | "agent-browser"
  skillLoadInstructions: string
}): string {
  return `ASH runtime notes:
- Load the \`dev3000-agent-runbook\` skill first.
- If other packaged skills are relevant, load them too.
- The real project checkout is available at \`/workspace/repo\`. Make code edits there.
- The live app is available at ${devUrl || "http://localhost:3000"}.
- Preferred browser mode: ${devAgentSandboxBrowser || "none"}.
- Installed skills are available via the ASH artifact and session runtime: ${skillLoadInstructions}.
- When browser validation helps, you may use the installed \`agent-browser\` CLI against localhost URLs.
- Prefer direct code changes and targeted validation over broad exploration.`
}

async function readAshRuntimeSessionStream(
  baseUrl: string,
  authorization: string,
  sessionId: string,
  streamPath?: string,
  progressContext?: ProgressContext | null
): Promise<{
  rawEvents: string[]
  resultText: string
  terminalState: "waiting" | "completed"
  usage: {
    promptTokens: number
    completionTokens: number
    cacheReadTokens: number
    cacheCreationTokens: number
    totalTokens: number
  }
}> {
  const resolvedStreamPath =
    typeof streamPath === "string" && streamPath.trim().length > 0
      ? streamPath.trim()
      : `/.well-known/ash/v1/sessions/${encodeURIComponent(sessionId)}/stream`
  const streamResponse = await fetch(`${baseUrl}${resolvedStreamPath}`, {
    headers: { authorization, "cache-control": "no-store" }
  })
  if (!streamResponse.ok || !streamResponse.body) {
    const bodyText = await streamResponse.text()
    throw new Error(`ASH runtime stream failed (${streamResponse.status}): ${bodyText}`)
  }

  const decoder = new TextDecoder()
  const reader = streamResponse.body.getReader()
  let buffer = ""
  let resultText = ""
  let lastCompletedMessage = ""
  let finalCompletedMessage = ""
  let promptTokens = 0
  let completionTokens = 0
  let cacheReadTokens = 0
  let cacheCreationTokens = 0
  const rawEvents: string[] = []
  let terminalError: string | null = null
  let terminalState: "waiting" | "completed" = "completed"
  let reachedTurnBoundary = false

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }

      buffer += decoder.decode(value, { stream: true })
      while (true) {
        const newlineIndex = buffer.indexOf("\n")
        if (newlineIndex === -1) break
        const line = buffer.slice(0, newlineIndex).trim()
        buffer = buffer.slice(newlineIndex + 1)
        if (!line) continue
        rawEvents.push(line)

        const event = JSON.parse(line) as {
          type: string
          data?: Record<string, unknown>
        }

        if (event.type === "message.completed") {
          const message = typeof event.data?.message === "string" ? event.data.message.trim() : ""
          if (message) {
            lastCompletedMessage = message
            if (event.data?.finishReason !== "tool-calls") {
              finalCompletedMessage = message
            }
            await appendProgressLog(
              progressContext,
              `[ASH] Assistant message completed (${String(event.data?.finishReason || "unknown")}): ${message.slice(0, 160)}`
            )
          }
        }

        if (event.type === "step.completed") {
          const usage = event.data?.usage as
            | {
                inputTokens?: number
                outputTokens?: number
                cacheReadTokens?: number
                cacheWriteTokens?: number
              }
            | undefined
          promptTokens += usage?.inputTokens ?? 0
          completionTokens += usage?.outputTokens ?? 0
          cacheReadTokens += usage?.cacheReadTokens ?? 0
          cacheCreationTokens += usage?.cacheWriteTokens ?? 0
        }

        if (event.type === "input.requested") {
          terminalError = "ASH runtime requested human input, which the workflow host does not support yet."
          break
        }

        if (event.type === "step.failed" || event.type === "turn.failed" || event.type === "session.failed") {
          terminalError =
            typeof event.data?.message === "string" ? event.data.message : `ASH runtime failed during ${event.type}`
          break
        }

        if (event.type === "session.waiting") {
          terminalState = "waiting"
          reachedTurnBoundary = true
          break
        }

        if (event.type === "session.completed") {
          terminalState = "completed"
          reachedTurnBoundary = true
          break
        }
      }

      if (terminalError || reachedTurnBoundary) {
        break
      }
    }
  } finally {
    await reader.cancel().catch(() => {})
  }

  if (terminalError) {
    throw new Error(terminalError)
  }

  resultText = finalCompletedMessage || lastCompletedMessage

  return {
    rawEvents,
    resultText,
    terminalState,
    usage: {
      promptTokens,
      completionTokens,
      cacheReadTokens,
      cacheCreationTokens,
      totalTokens: promptTokens + completionTokens + cacheReadTokens + cacheCreationTokens
    }
  }
}

async function streamAshRuntimeTask(
  baseUrl: string,
  authorization: string,
  prompt: string,
  progressContext?: ProgressContext | null
): Promise<{
  rawEvents: string[]
  resultText: string
  sessionId: string
  terminalState: "waiting" | "completed"
  usage: {
    promptTokens: number
    completionTokens: number
    cacheReadTokens: number
    cacheCreationTokens: number
    totalTokens: number
  }
}> {
  const taskResponse = await fetch(`${baseUrl}${ASH_TASK_ROUTE_PATH}`, {
    method: "POST",
    headers: {
      authorization,
      "content-type": "application/json"
    },
    body: JSON.stringify({ message: prompt })
  })

  const taskPayloadText = await taskResponse.text()
  if (!taskResponse.ok) {
    throw new Error(`ASH runtime rejected task start (${taskResponse.status}): ${taskPayloadText}`)
  }

  const taskPayload = JSON.parse(taskPayloadText) as {
    ok?: boolean
    sessionId?: string
    streamPath?: string
  }
  const sessionId = taskPayload.sessionId
  if (!sessionId) {
    throw new Error("ASH runtime task route did not return a session id.")
  }
  const streamResult = await readAshRuntimeSessionStream(
    baseUrl,
    authorization,
    sessionId,
    taskPayload.streamPath,
    progressContext
  )

  return {
    rawEvents: streamResult.rawEvents,
    resultText: streamResult.resultText,
    sessionId,
    terminalState: streamResult.terminalState,
    usage: streamResult.usage
  }
}

async function runAshAgentInSandbox(
  sandbox: Sandbox,
  devUrl: string,
  beforeCls: number | null,
  beforeGrade: "good" | "needs-improvement" | "poor" | null,
  startPath: string,
  projectDir?: string,
  customPrompt?: string,
  workflowType?: string,
  crawlDepth?: number | "all",
  devAgentName?: string,
  devAgentInstructions?: string,
  devAgentExecutionMode?: "dev-server" | "preview-pr",
  devAgentSandboxBrowser?: "none" | "agent-browser",
  devAgentAiAgent?: import("@/lib/dev-agents").DevAgentAiAgent,
  devAgentActionSteps?: Array<{ kind: string; config: Record<string, string> }>,
  devAgentSkillRefs?: DevAgentSkillRef[],
  devAgentAshTarballUrl?: string,
  bundleBaselineSummary?: string,
  gatewayAuthToken?: string,
  gatewayAuthSource?: string,
  progressContext?: ProgressContext | null
): Promise<{
  transcript: string
  summary: string
  systemPrompt: string
  modelId: string
  skillsLoaded: string[]
  usage: {
    promptTokens: number
    completionTokens: number
    cacheReadTokens: number
    cacheCreationTokens: number
    totalTokens: number
  }
  costUsd: number
}> {
  if (!devAgentAshTarballUrl) {
    throw new Error("ASH runtime execution requires a packaged ASH tarball.")
  }

  const effectiveProjectRoot = projectDir
    ? `/vercel/sandbox/${projectDir.replace(/^\/+|\/+$/g, "")}`
    : "/vercel/sandbox"
  const { authorization, baseUrl } = await ensurePackagedAshRuntimeInSandbox(
    sandbox,
    devAgentAshTarballUrl,
    progressContext?.devAgentSpecHash,
    effectiveProjectRoot,
    gatewayAuthToken,
    progressContext
  )
  const workflowTypeForPrompt = workflowType || "cls-fix"
  const includeD3kSkill = workflowTypeForPrompt !== "turbopack-bundle-analyzer" && workflowTypeForPrompt !== "cls-fix"
  const skillLoadInstructions = buildDevAgentSkillLoadInstructions(devAgentSkillRefs, {
    includeD3k: includeD3kSkill,
    includeAshRunbook: true
  })
  const clsCodeHints =
    workflowTypeForPrompt === "cls-fix" ? await gatherClsCodeHints(sandbox, effectiveProjectRoot) : null
  const { effectiveInstructions, effectiveActionSteps } = buildEffectiveDevAgentPromptConfig({
    workflowType: workflowTypeForPrompt,
    devAgentInstructions,
    devAgentActionSteps
  })
  const taskPrompt = buildAshTaskPrompt({
    workflowType: workflowTypeForPrompt,
    startPath,
    devUrl,
    customPrompt,
    crawlDepth,
    devAgentName,
    devAgentInstructions: effectiveInstructions,
    devAgentExecutionMode,
    devAgentSandboxBrowser,
    devAgentActionSteps: effectiveActionSteps,
    skillLoadInstructions,
    bundleBaselineSummary,
    beforeCls,
    beforeGrade,
    codeHints: clsCodeHints ?? undefined
  })

  await appendProgressLog(
    progressContext,
    `[ASH] Using packaged runtime for ${devAgentName || "dev agent"} (${gatewayAuthSource || "unknown auth"})`
  )
  const transcript: string[] = []
  transcript.push("## ASH Runtime Session")
  transcript.push("")
  await appendProgressLog(progressContext, `[ASH] Task run: ${taskPrompt.prompt.slice(0, 120)}`)
  const result = await streamAshRuntimeTask(baseUrl, authorization, taskPrompt.prompt, progressContext)

  transcript.push(`### ${taskPrompt.label}`)
  transcript.push("")
  transcript.push("**User:**")
  transcript.push("```")
  transcript.push(taskPrompt.prompt)
  transcript.push("```")
  transcript.push("")
  transcript.push("**ASH Runtime:**")
  transcript.push(result.resultText || "(no textual result)")
  transcript.push("")
  transcript.push(`**Session:** ${result.sessionId}`)
  transcript.push(`**Terminal State:** ${result.terminalState}`)
  transcript.push("")
  transcript.push("**Stream Events:**")
  transcript.push("```ndjson")
  transcript.push(result.rawEvents.join("\n"))
  transcript.push("```")
  transcript.push("")

  return {
    transcript: transcript.join("\n"),
    summary: result.resultText,
    systemPrompt: "[ASH runtime]",
    modelId: devAgentAiAgent || "ash-runtime",
    skillsLoaded: getInstalledSkillNames(devAgentSkillRefs, { includeD3k: includeD3kSkill, includeAshRunbook: true }),
    usage: {
      promptTokens: result.usage.promptTokens,
      completionTokens: result.usage.completionTokens,
      cacheReadTokens: result.usage.cacheReadTokens,
      cacheCreationTokens: result.usage.cacheCreationTokens,
      totalTokens: result.usage.totalTokens
    },
    costUsd: 0
  }
}

async function installDevAgentSkillsInSandbox(
  sandbox: Sandbox,
  projectDir: string | undefined,
  devAgentSkillRefs: DevAgentSkillRef[] | undefined,
  progressContext?: ProgressContext | null,
  options?: { includeD3k?: boolean; devAgentAshTarballUrl?: string }
): Promise<string[]> {
  const normalizeInstalledSkillName = (value?: string): string =>
    (value || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "")

  const installedSkillNames = new Set<string>()
  const packagedSkillNames = new Set<string>()
  if (options?.devAgentAshTarballUrl) {
    const packaged = await installPackagedAshSkillsInSandbox(sandbox, options.devAgentAshTarballUrl, progressContext)
    for (const skillName of packaged.skillNames) {
      const normalized = normalizeInstalledSkillName(skillName)
      if (normalized) {
        packagedSkillNames.add(normalized)
        installedSkillNames.add(skillName)
      }
    }
  }

  const requestedSkills = [...(devAgentSkillRefs || [])]
  const shouldAutoInstallPlatformSkills = !options?.devAgentAshTarballUrl
  const hasVercelPlugin = requestedSkills.some((skill) => {
    const identifier = `${skill.id} ${skill.skillName} ${skill.displayName} ${skill.installArg}`.toLowerCase()
    return identifier.includes("vercel-plugin") || identifier.includes("vercel/vercel-plugin")
  })
  const hasD3kSkill = requestedSkills.some((skill) => {
    const identifier = `${skill.id} ${skill.skillName} ${skill.displayName} ${skill.installArg}`.toLowerCase()
    return identifier.includes("d3k")
  })
  if (shouldAutoInstallPlatformSkills && !hasVercelPlugin) {
    requestedSkills.unshift({
      id: "vercel-plugin",
      installArg: VERCEL_PLUGIN_INSTALL_ARG,
      skillName: "vercel-plugin",
      displayName: "Vercel plugin",
      sourceUrl: "https://github.com/vercel/vercel-plugin"
    })
  }
  if (shouldAutoInstallPlatformSkills && options?.includeD3k !== false && !hasD3kSkill) {
    requestedSkills.unshift({
      id: "d3k",
      installArg: D3K_SKILL_INSTALL_ARG,
      skillName: "d3k",
      displayName: "d3k",
      sourceUrl: D3K_SKILL_INSTALL_ARG
    })
  }
  if (requestedSkills.length === 0) {
    return [...installedSkillNames]
  }

  const SANDBOX_CWD = projectDir ? `/vercel/sandbox/${projectDir.replace(/^\/+|\/+$/g, "")}` : "/vercel/sandbox"

  for (const skill of requestedSkills) {
    if (!skill.installArg) {
      continue
    }

    const normalizedSkillName = normalizeInstalledSkillName(skill.skillName || skill.displayName || skill.id)
    if (normalizedSkillName && packagedSkillNames.has(normalizedSkillName)) {
      await appendProgressLog(
        progressContext,
        `[Skills] ${skill.displayName} already available from packaged ASH skills`
      )
      installedSkillNames.add(skill.displayName || skill.skillName || skill.id)
      continue
    }

    if (skill.installArg !== VERCEL_PLUGIN_INSTALL_ARG && isVercelPluginSkillRef(skill)) {
      await appendProgressLog(progressContext, `[Skills] Using built-in ${skill.displayName} from Vercel plugin`)
      installedSkillNames.add(skill.displayName || skill.skillName || skill.id)
      continue
    }

    await appendProgressLog(progressContext, `[Skills] Installing ${skill.displayName} (${skill.installArg})`)
    const result = await runSandboxCommand(sandbox, "sh", [
      "-c",
      [
        "export PATH=$HOME/.bun/bin:/usr/local/bin:$PATH",
        `cd ${shellEscape(SANDBOX_CWD)}`,
        buildSkillsInstallShellCommand(skill.installArg)
      ].join(" && ")
    ])

    if (result.exitCode !== 0) {
      throw new Error(
        `Failed to install skill ${skill.displayName}: ${(result.stderr || result.stdout || "unknown error").trim()}`
      )
    }

    await appendProgressLog(progressContext, `[Skills] Installed ${skill.displayName}`)
    installedSkillNames.add(skill.displayName || skill.skillName || skill.id)
  }

  return [...installedSkillNames]
}

function buildDevAgentSkillLoadInstructions(
  devAgentSkillRefs: DevAgentSkillRef[] | undefined,
  options?: { includeD3k?: boolean; includeAshRunbook?: boolean }
): string {
  const skillNames = getInstalledSkillNames(devAgentSkillRefs, options)
  if (options?.includeAshRunbook) {
    skillNames.unshift("dev3000-agent-runbook")
  }
  if (skillNames.length === 1) {
    return `the installed ${skillNames[0]} skill`
  }
  return `the installed skills: ${skillNames.join(", ")}`
}

function buildDevAgentSandboxBrowserGuidance(devAgentSandboxBrowser: "none" | "agent-browser" | undefined): string {
  if (devAgentSandboxBrowser === "none") {
    return "Browser mode: none. Stay code-first and use browser tools only if they are necessary for final verification."
  }
  return "Browser mode: agent-browser. Use the sandbox browser tools directly for capture, inspection, and validation."
}

function _buildStructuredWorkflowPrompt(
  actionSteps: Array<{ kind: string; config: Record<string, string> }>,
  skillLoadInstructions: string,
  browserGuidance: string,
  devAgentAiAgent?: import("@/lib/dev-agents").DevAgentAiAgent,
  devAgentDevServerCommand?: string
): { system: string; user: string } {
  const resolvedDevServerCommand = devAgentDevServerCommand?.trim() || "bun run dev"
  const selectedModel = getDevAgentModelLabel(devAgentAiAgent)
  const usesD3kRuntime = /^d3k(?:\s|$)/.test(resolvedDevServerCommand)

  const numberedSteps: string[] = [
    `1. Review Installed Skills — Review ${skillLoadInstructions} before you begin`,
    usesD3kRuntime
      ? `2. Start Dev Server — Start d3k with the standard sandbox flags and wait for localhost:3000 to be healthy`
      : `2. Start Dev Server — Run "${resolvedDevServerCommand}" and wait for localhost:3000 to be healthy`,
    `3. Start Model — Use ${selectedModel} as the reasoning model while executing the remaining steps`
  ]

  for (const step of actionSteps) {
    if (step.kind === "start-dev-server") {
      continue
    }
    const n = numberedSteps.length + 1
    switch (step.kind) {
      case "browse-to-page":
        numberedSteps.push(
          `${n}. Browse to Page — Navigate to ${step.config.url || "http://localhost:3000/"} in the sandbox browser and inspect it`
        )
        break
      case "capture-cwv":
        numberedSteps.push(
          `${n}. Capture Core Web Vitals — Measure LCP, CLS, INP, FCP, and TTFB using d3k/browser tooling`
        )
        break
      case "capture-loading-frames":
        numberedSteps.push(`${n}. Capture Loading Frames — Capture the page loading sequence with screenshots`)
        break
      case "send-prompt":
        numberedSteps.push(`${n}. Send Prompt — ${step.config.prompt || "Execute the provided instructions"}`)
        break
      case "go-back-to-step": {
        const targetStep = step.config.stepNumber
          ? Number.parseInt(step.config.stepNumber, 10) + 1 // +1 because we prepend "Load Skills" as step 1
          : n - 1
        numberedSteps.push(
          `${n}. Go Back to Step ${targetStep} — Repeat from step ${targetStep} to verify improvements`
        )
        break
      }
      default:
        numberedSteps.push(`${n}. ${step.kind}`)
    }
  }

  const workflowBlock = numberedSteps.join("\n")

  const system = `## AGENT WORKFLOW

Execute these steps in order:

${workflowBlock}

After completing all steps, summarize the concrete improvements made.

${browserGuidance}`

  const user = `Run the structured agent workflow above. Follow each numbered step in sequence. Use the installed skills, d3k logs, browser tooling, and runtime signals to validate each meaningful change before moving to the next step.`

  return { system, user }
}

type ClaudeTurnPrompt = {
  label: string
  prompt: string
  maxTurns: number
}

type ClaudeTurnResult = {
  sessionId: string
  resultText: string
  rawJson: string
  costUsd: number
  durationMs: number
  numTurns: number
  needsContinuation?: boolean
  usage: {
    promptTokens: number
    completionTokens: number
    cacheReadTokens: number
    cacheCreationTokens: number
    totalTokens: number
  }
}

function resolveClaudeModelSelection(selectedModel?: import("@/lib/dev-agents").DevAgentAiAgent): {
  modelId: import("@/lib/dev-agents").DevAgentAiAgent
  cliModel: "opus" | "sonnet"
  extraEnv: Record<string, string>
} {
  if (selectedModel === "anthropic/claude-sonnet-4.6") {
    return {
      modelId: "anthropic/claude-sonnet-4.6",
      cliModel: "sonnet",
      extraEnv: {
        ANTHROPIC_DEFAULT_SONNET_MODEL: "anthropic/claude-sonnet-4.6"
      }
    }
  }

  return {
    modelId: "anthropic/claude-opus-4.6",
    cliModel: "opus",
    extraEnv: {
      ANTHROPIC_DEFAULT_OPUS_MODEL: "anthropic/claude-opus-4.6"
    }
  }
}

function buildClaudeSystemPrompt({
  workflowType,
  devUrl,
  startPath,
  projectDir,
  browserGuidance,
  selectedModelLabel,
  skillLoadInstructions
}: {
  workflowType?: string
  devUrl: string
  startPath: string
  projectDir?: string
  browserGuidance: string
  selectedModelLabel: string
  skillLoadInstructions: string
}): string {
  const hasD3kSkill = /\bd3k\b/i.test(skillLoadInstructions)
  const environmentRuntimeLines = hasD3kSkill
    ? `- d3k is running standalone for dev server, browser control, logs, and diagnostics when a dev server is enabled.
- Installed skills: ${skillLoadInstructions}`
    : `- Installed skills: ${skillLoadInstructions}`
  const executionRuntimeLines = hasD3kSkill
    ? `- Use the installed d3k skill for browser control, diagnostics, and runtime inspection whenever it helps.
- ${browserGuidance}`
    : `- ${browserGuidance}`
  const workflowSpecificRules =
    workflowType === "cls-fix"
      ? `- For CLS runs, treat the workflow-provided baseline metrics and screenshots as the primary evidence.
- Stay code-first and avoid repeated browser or diagnose loops unless that evidence looks inconsistent.
- Once you identify the likely shift source, make the fix immediately and keep validation targeted.`
      : ""

  return `You are Claude Code running inside a Vercel Sandbox.

Environment:
- Working directory: ${projectDir ? `/vercel/sandbox/${projectDir.replace(/^\/+|\/+$/g, "")}` : "/vercel/sandbox"}
- Start path: ${startPath}
- Dev URL: ${devUrl || "(dev server intentionally skipped)"}
- Workflow model: ${selectedModelLabel}
${environmentRuntimeLines}

Execution rules:
- Work directly in the sandbox repo using your normal code-editing and shell abilities.
${executionRuntimeLines}
- Prefer targeted, evidence-driven fixes over broad refactors.
- Avoid burning turns on repetitive tool use when the runtime already supplied the key evidence.
- Keep momentum toward concrete code changes.
${workflowSpecificRules}
- Validate meaningful changes before you conclude.
- Summaries should include concrete changes, validation evidence, and remaining risks.`
}

function buildClaudeSetupPrompt(
  devAgentName: string | undefined,
  startPath: string,
  devUrl: string,
  skillLoadInstructions: string,
  customPrompt?: string
): ClaudeTurnPrompt {
  return {
    label: "Agent setup",
    maxTurns: 8,
    prompt: `You are starting the ${devAgentName || "dev agent"} workflow.

Context:
- Start path: ${startPath}
- Dev URL: ${devUrl || "(dev server intentionally skipped)"}
- Installed skills: ${skillLoadInstructions}
${customPrompt?.trim() ? `- Run-specific instructions: ${customPrompt.trim()}` : ""}

Before doing any major work, summarize your plan for this run in 3-5 bullets.

Setup-step rules:
- Do not use tools in this step.
- Do not inspect files yet.
- Do not start implementing or making code changes yet.
- Keep the response short so the later workflow steps can spend their turns on execution.`
  }
}

function buildClsActionStepGuidance(
  actionSteps: Array<{ kind: string; config: Record<string, string> }>
): string | null {
  const lines: string[] = []

  for (const [index, step] of actionSteps.entries()) {
    switch (step.kind) {
      case "browse-to-page":
        lines.push(
          `${index + 1}. Inspect ${step.config.url || "http://localhost:3000/"} only if you need extra visual confirmation while fixing the issue.`
        )
        break
      case "capture-cwv":
        lines.push(
          `${index + 1}. Use the workflow-provided baseline and final Web Vitals as the source of truth; only re-measure manually if the runtime evidence looks inconsistent.`
        )
        break
      case "capture-loading-frames":
        lines.push(
          `${index + 1}. Use the captured before/after visual evidence to reason about the loading sequence and layout shift source.`
        )
        break
      case "go-back-to-step":
        lines.push(`${index + 1}. Re-check the relevant visual/metric evidence after your fix before you conclude.`)
        break
      case "send-prompt":
        break
      default:
        break
    }
  }

  if (lines.length === 0) {
    return null
  }

  return `Workflow editor guidance:\n${lines.join("\n")}`
}

function getWorkflowExecutionMaxTurns(workflowType: string): number {
  if (workflowType === "cls-fix") return 12
  if (workflowType === "turbopack-bundle-analyzer") return 10
  if (workflowType === "react-performance") return 12
  if (workflowType === "design-guidelines") return 12
  if (workflowType === "prompt") return 10
  return 10
}

function buildWorkflowValidationHint(
  executionMode?: "dev-server" | "preview-pr",
  runtime: "claude" | "ash" = "claude"
) {
  if (executionMode === "preview-pr") {
    return runtime === "ash"
      ? "Prepare preview/PR-ready changes and use lightweight validation before you conclude."
      : "Work from the codebase and preview validation, then prepare PR-ready changes."
  }

  return runtime === "ash"
    ? "Validate meaningful changes with runtime evidence before you conclude."
    : "Use d3k logs, browser evidence, and runtime signals to validate each meaningful fix before you finish."
}

function buildAuthoredInstructionBlock({
  devAgentInstructions,
  customPrompt
}: {
  devAgentInstructions?: string
  customPrompt?: string
}): string | null {
  const block = [devAgentInstructions?.trim(), customPrompt?.trim()]
    .filter((value): value is string => Boolean(value))
    .join("\n\n")

  return block || null
}

function buildWorkflowSpecificExecutionGuidance({
  workflowType,
  startPath,
  crawlDepth,
  bundleBaselineSummary,
  beforeCls,
  beforeGrade,
  codeHints
}: {
  workflowType: string
  startPath: string
  crawlDepth?: number | "all"
  bundleBaselineSummary?: string
  beforeCls: number | null
  beforeGrade: "good" | "needs-improvement" | "poor" | null
  codeHints?: string
}): string {
  if (workflowType === "cls-fix") {
    return [
      `Baseline CLS: ${beforeCls?.toFixed(4) || "unknown"}`,
      `Baseline grade: ${beforeGrade || "unknown"}`,
      "The workflow already captured baseline visuals/metrics and will perform final verification after your code changes.",
      "Stay code-first and do not redo baseline measurement or repeated browser inspection unless the runtime evidence looks inconsistent.",
      codeHints?.trim() ? `Suspicious code hints:\n${codeHints.trim()}` : null
    ]
      .filter(Boolean)
      .join("\n")
  }

  if (workflowType === "turbopack-bundle-analyzer") {
    return [
      "Focus only on generated Turbopack NDJSON artifacts and the minimal set of source files needed for the fix.",
      "Do not rerun build or analyzer commands manually; the workflow runtime will handle post-change analyzer verification.",
      bundleBaselineSummary ? `Workflow-provided bundle baseline:\n${bundleBaselineSummary}` : null
    ]
      .filter(Boolean)
      .join("\n")
  }

  if (workflowType === "design-guidelines") {
    return `Prioritize the highest-impact design guideline issues on ${startPath}. ${
      crawlDepth && crawlDepth !== 1
        ? `Audit multiple relevant pages up to depth ${crawlDepth} only when that materially improves the result.`
        : "Focus on the current page and nearby shared UI."
    }`
  }

  if (workflowType === "react-performance") {
    return "Focus on the highest-impact React/Next.js performance issue and verify the concrete improvement with available runtime evidence."
  }

  return "Prefer targeted, evidence-driven fixes over broad refactors."
}

function buildExecutionPlanHint({
  hasPackagedRunbook,
  devAgentActionSteps
}: {
  hasPackagedRunbook?: boolean
  devAgentActionSteps?: Array<{ kind: string; config: Record<string, string> }>
}): string {
  if (hasPackagedRunbook) {
    return devAgentActionSteps && devAgentActionSteps.length > 0
      ? "Follow the numbered action plan from `dev3000-agent-runbook` as the primary source of truth."
      : "Follow the objective and evaluation rules from `dev3000-agent-runbook` as the primary source of truth."
  }

  if (devAgentActionSteps && devAgentActionSteps.length > 0) {
    return "Follow the authored dev-agent instructions and action plan as the primary source of truth."
  }

  return "Follow the authored dev-agent objective and workflow-specific guidance as the primary source of truth."
}

function buildClaudeExecutionRules(): string[] {
  return [
    "Work directly in the sandbox repo using your normal code-editing and shell abilities.",
    "Prefer targeted, evidence-driven fixes over broad refactors.",
    "Avoid burning turns on repetitive tool use when the runtime already supplied the key evidence.",
    "Keep momentum toward concrete code changes.",
    "Finish with a concise summary of what changed, the validation evidence you gathered, and any remaining issues."
  ]
}

function buildClaudeContinuationPrompt(label: string): string {
  return `Continue the same ${label.toLowerCase()} from where you left off.

Rules:
- Do not restart the workflow from scratch.
- Keep the existing session context and continue making forward progress.
- If the task is complete, provide the final concise summary now.
- If more work is needed, continue directly on the highest-impact next step.`
}

function buildClaudeMainTaskPrompt({
  workflowType,
  startPath,
  devUrl,
  customPrompt,
  crawlDepth,
  devAgentName,
  devAgentInstructions,
  devAgentExecutionMode,
  devAgentSandboxBrowser,
  devAgentActionSteps,
  skillLoadInstructions,
  bundleBaselineSummary,
  beforeCls,
  beforeGrade,
  codeHints,
  hasPackagedRunbook
}: {
  workflowType: string
  startPath: string
  devUrl: string
  customPrompt?: string
  crawlDepth?: number | "all"
  devAgentName?: string
  devAgentInstructions?: string
  devAgentExecutionMode?: "dev-server" | "preview-pr"
  devAgentSandboxBrowser?: "none" | "agent-browser"
  devAgentActionSteps?: Array<{ kind: string; config: Record<string, string> }>
  skillLoadInstructions: string
  bundleBaselineSummary?: string
  beforeCls: number | null
  beforeGrade: "good" | "needs-improvement" | "poor" | null
  codeHints?: string
  hasPackagedRunbook?: boolean
}): ClaudeTurnPrompt {
  const validationHint = buildWorkflowValidationHint(devAgentExecutionMode, "claude")
  const workflowSpecificInstructions = buildWorkflowSpecificExecutionGuidance({
    workflowType,
    startPath,
    crawlDepth,
    bundleBaselineSummary,
    beforeCls,
    beforeGrade,
    codeHints
  })
  const authoredInstructionBlock = buildAuthoredInstructionBlock({ devAgentInstructions, customPrompt })
  const executionPlanHint = buildExecutionPlanHint({ hasPackagedRunbook, devAgentActionSteps })

  return {
    label: "Agent main task",
    maxTurns: getWorkflowExecutionMaxTurns(workflowType),
    prompt: `Execute the ${devAgentName || "dev agent"} workflow on ${startPath}.

Primary rule:
- ${executionPlanHint}

Runtime context:
- Start path: ${startPath}
- Dev URL: ${devUrl || "(dev server intentionally skipped)"}
- Preferred browser mode: ${devAgentSandboxBrowser || "none"}
- Installed skills: ${skillLoadInstructions}
- ${validationHint}

Workflow-specific guidance:
${workflowSpecificInstructions}

${authoredInstructionBlock ? `Authored run instructions:\n${authoredInstructionBlock}\n\n` : ""}Execution rules:
${buildClaudeExecutionRules()
  .map((rule) => `- ${rule}`)
  .join("\n")}`
  }
}

async function gatherClsCodeHints(sandbox: Sandbox, cwd: string): Promise<string | null> {
  const result = await runSandboxCommandWithOptions(sandbox, {
    cmd: "sh",
    args: [
      "-lc",
      `if command -v rg >/dev/null 2>&1; then
  rg -n --hidden --glob '!node_modules' --glob '!.next' --glob '!dist' --glob '!coverage' --glob '!tmp' "(setTimeout|useEffect\\(|requestAnimationFrame|layout shift|cls|skeleton|placeholder|banner|hero|min-h-|height:|width:|loading=|Image\\(|img )" .
else
  find . -type f | sed 's#^./##'
fi | head -n 12`
    ],
    cwd
  })

  if (result.exitCode !== 0) {
    return null
  }

  const lines = (result.stdout || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 12)

  if (lines.length === 0) {
    return null
  }

  return lines.map((line) => `- ${line}`).join("\n")
}

function buildClaudeTurnPrompts({
  workflowType,
  startPath,
  devUrl,
  customPrompt,
  crawlDepth,
  devAgentName,
  devAgentInstructions,
  devAgentExecutionMode,
  devAgentActionSteps,
  skillLoadInstructions,
  bundleBaselineSummary,
  beforeCls,
  beforeGrade,
  codeHints,
  devAgentSandboxBrowser,
  hasPackagedRunbook
}: {
  workflowType: string
  startPath: string
  devUrl: string
  customPrompt?: string
  crawlDepth?: number | "all"
  devAgentName?: string
  devAgentInstructions?: string
  devAgentExecutionMode?: "dev-server" | "preview-pr"
  devAgentActionSteps?: Array<{ kind: string; config: Record<string, string> }>
  skillLoadInstructions: string
  bundleBaselineSummary?: string
  beforeCls: number | null
  beforeGrade: "good" | "needs-improvement" | "poor" | null
  codeHints?: string
  devAgentSandboxBrowser?: "none" | "agent-browser"
  hasPackagedRunbook?: boolean
}): ClaudeTurnPrompt[] {
  const prompts: ClaudeTurnPrompt[] = [
    buildClaudeSetupPrompt(devAgentName, startPath, devUrl, skillLoadInstructions, customPrompt),
    buildClaudeMainTaskPrompt({
      workflowType,
      startPath,
      devUrl,
      customPrompt,
      crawlDepth,
      devAgentName,
      devAgentInstructions,
      devAgentExecutionMode,
      devAgentSandboxBrowser,
      devAgentActionSteps,
      skillLoadInstructions,
      bundleBaselineSummary,
      beforeCls,
      beforeGrade,
      codeHints,
      hasPackagedRunbook
    })
  ]

  prompts.push({
    label: "Final summary",
    maxTurns: 4,
    prompt:
      "Provide a concise final summary of the changes you made, the validation evidence you gathered, any remaining issues, and recommended follow-up work."
  })

  return prompts
}

function buildAshTaskPrompt({
  workflowType,
  startPath,
  devUrl,
  customPrompt,
  crawlDepth,
  devAgentName,
  devAgentInstructions,
  devAgentExecutionMode,
  devAgentSandboxBrowser,
  devAgentActionSteps,
  skillLoadInstructions,
  bundleBaselineSummary,
  beforeCls,
  beforeGrade,
  codeHints
}: {
  workflowType: string
  startPath: string
  devUrl: string
  customPrompt?: string
  crawlDepth?: number | "all"
  devAgentName?: string
  devAgentInstructions?: string
  devAgentExecutionMode?: "dev-server" | "preview-pr"
  devAgentSandboxBrowser?: "none" | "agent-browser"
  devAgentActionSteps?: Array<{ kind: string; config: Record<string, string> }>
  skillLoadInstructions: string
  bundleBaselineSummary?: string
  beforeCls: number | null
  beforeGrade: "good" | "needs-improvement" | "poor" | null
  codeHints?: string
}): ClaudeTurnPrompt {
  const runtimePrefix = buildAshRuntimePromptPrefix({
    devUrl,
    devAgentSandboxBrowser,
    skillLoadInstructions
  })
  const sharedPrompt = buildClaudeMainTaskPrompt({
    workflowType,
    startPath,
    devUrl,
    customPrompt,
    crawlDepth,
    devAgentName,
    devAgentInstructions,
    devAgentExecutionMode,
    devAgentSandboxBrowser,
    devAgentActionSteps,
    skillLoadInstructions,
    bundleBaselineSummary,
    beforeCls,
    beforeGrade,
    codeHints,
    hasPackagedRunbook: true
  })

  return {
    ...sharedPrompt,
    label: "ASH task run",
    prompt: `${runtimePrefix}\n\n${sharedPrompt.prompt}`
  }
}

function buildEffectiveDevAgentPromptConfig({
  workflowType,
  devAgentInstructions,
  devAgentActionSteps
}: {
  workflowType: string
  devAgentInstructions?: string
  devAgentActionSteps?: Array<{ kind: string; config: Record<string, string> }>
}): {
  effectiveInstructions?: string
  effectiveActionSteps?: Array<{ kind: string; config: Record<string, string> }>
} {
  const collapsedClsActionStepGuidance =
    workflowType === "cls-fix"
      ? null
      : devAgentActionSteps?.length
        ? buildClsActionStepGuidance(devAgentActionSteps)
        : null

  const effectiveInstructions = [devAgentInstructions?.trim(), collapsedClsActionStepGuidance]
    .filter((value): value is string => Boolean(value))
    .join("\n\n")

  const effectiveActionSteps =
    workflowType === "cls-fix" || workflowType === "turbopack-bundle-analyzer" ? undefined : devAgentActionSteps

  return {
    effectiveInstructions: effectiveInstructions || undefined,
    effectiveActionSteps
  }
}

function parseClsValue(rawValue?: string): number | null {
  if (!rawValue) return null
  const parsed = Number.parseFloat(rawValue)
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 10) {
    return null
  }
  return parsed
}

function gradeClsValue(clsScore: number | null): "good" | "needs-improvement" | "poor" | null {
  if (clsScore === null) return null
  return clsScore <= 0.1 ? "good" : clsScore <= 0.25 ? "needs-improvement" : "poor"
}

function pickMoreCredibleCls(
  primary: { value: number | null; grade?: "good" | "needs-improvement" | "poor" | null },
  fallback: { value: number | null; grade?: "good" | "needs-improvement" | "poor" | null },
  tolerance = 0.005
): {
  value: number | null
  grade: "good" | "needs-improvement" | "poor" | null
  source: "primary" | "fallback" | null
} {
  const primaryValue = primary.value
  const fallbackValue = fallback.value

  if (primaryValue === null && fallbackValue === null) {
    return { value: null, grade: null, source: null }
  }
  if (primaryValue === null) {
    return { value: fallbackValue, grade: fallback.grade ?? gradeClsValue(fallbackValue), source: "fallback" }
  }
  if (fallbackValue === null) {
    return { value: primaryValue, grade: primary.grade ?? gradeClsValue(primaryValue), source: "primary" }
  }
  if (fallbackValue > primaryValue + tolerance) {
    return { value: fallbackValue, grade: fallback.grade ?? gradeClsValue(fallbackValue), source: "fallback" }
  }
  return { value: primaryValue, grade: primary.grade ?? gradeClsValue(primaryValue), source: "primary" }
}

function extractClsEvidenceFromText(text?: string): {
  beforeCls: number | null
  afterCls: number | null
  source: string | null
} {
  if (!text) {
    return {
      beforeCls: null,
      afterCls: null,
      source: null
    }
  }

  const candidates: Array<{
    source: string
    beforeCls: number | null
    afterCls: number | null
  }> = [
    (() => {
      const match = text.match(
        /CLS(?:\s+score)?\s+improved\s+from[^0-9]*([0-9]*\.?[0-9]+)\s*(?:→|->)\s*([0-9]*\.?[0-9]+)/i
      )
      return {
        source: "cls-improved-summary",
        beforeCls: parseClsValue(match?.[1]),
        afterCls: parseClsValue(match?.[2])
      }
    })(),
    (() => {
      const baselineMatch = text.match(/Baseline CLS[^0-9]*([0-9]*\.?[0-9]+)/i)
      const postFixMatch = text.match(/Post-fix CLS[^0-9]*([0-9]*\.?[0-9]+)/i)
      return {
        source: "baseline-post-fix-summary",
        beforeCls: parseClsValue(baselineMatch?.[1]),
        afterCls: parseClsValue(postFixMatch?.[1])
      }
    })(),
    (() => {
      const match = text.match(/Baseline CLS[^0-9]*([0-9]*\.?[0-9]+)[^\n]*?Fixed CLS[^0-9]*([0-9]*\.?[0-9]+)/i)
      return {
        source: "baseline-fixed-summary",
        beforeCls: parseClsValue(match?.[1]),
        afterCls: parseClsValue(match?.[2])
      }
    })(),
    (() => {
      const match = text.match(/\|\s*CLS\s*\|\s*([0-9]*\.?[0-9]+)\s*\|\s*([0-9]*\.?[0-9]+)\s*\|/i)
      return {
        source: "cls-table-row",
        beforeCls: parseClsValue(match?.[1]),
        afterCls: parseClsValue(match?.[2])
      }
    })(),
    (() => {
      const match = text.match(/Before[^0-9]*([0-9]*\.?[0-9]+)[\s\S]{0,200}?After[^0-9]*([0-9]*\.?[0-9]+)/i)
      return {
        source: "before-after-summary",
        beforeCls: parseClsValue(match?.[1]),
        afterCls: parseClsValue(match?.[2])
      }
    })()
  ]

  let bestCandidate: (typeof candidates)[number] | null = null
  let bestScore = 0

  for (const candidate of candidates) {
    const score = (candidate.beforeCls !== null ? 1 : 0) + (candidate.afterCls !== null ? 1 : 0)
    if (score === 0) {
      continue
    }
    if (!bestCandidate || score > bestScore) {
      bestCandidate = candidate
      bestScore = score
    }
  }

  if (bestCandidate) {
    return bestCandidate
  }

  return {
    beforeCls: null,
    afterCls: null,
    source: null
  }
}

function extractClsEvidence(...texts: Array<string | undefined>): {
  beforeCls: number | null
  afterCls: number | null
  source: string | null
} {
  let beforeCls: number | null = null
  let afterCls: number | null = null
  let source: string | null = null

  for (const text of texts) {
    const extracted = extractClsEvidenceFromText(text)
    if (beforeCls === null && extracted.beforeCls !== null) {
      beforeCls = extracted.beforeCls
      source = source || extracted.source
    }
    if (afterCls === null && extracted.afterCls !== null) {
      afterCls = extracted.afterCls
      source = source || extracted.source
    }
    if (beforeCls !== null && afterCls !== null) {
      break
    }
  }

  return { beforeCls, afterCls, source }
}

function determineClsStatus({
  hasChanges,
  beforeCls,
  afterCls
}: {
  hasChanges: boolean
  beforeCls: number | null
  afterCls: number | null
}): "improved" | "unchanged" | "degraded" | "no-changes" {
  if (!hasChanges) {
    return "no-changes"
  }
  if (beforeCls === null || afterCls === null) {
    return "unchanged"
  }
  if (afterCls < beforeCls * 0.9) {
    return "improved"
  }
  if (afterCls > beforeCls * 1.1) {
    return "degraded"
  }
  return "unchanged"
}

function determineTurbopackStatus({
  hasChanges,
  bundleComparison
}: {
  hasChanges: boolean
  bundleComparison?: TurbopackBundleComparison
}): "improved" | "unchanged" | "degraded" | "no-changes" {
  if (!hasChanges) {
    return "no-changes"
  }
  if (!bundleComparison) {
    return "unchanged"
  }

  const compressedDelta = bundleComparison.delta.compressedBytes
  if (compressedDelta < 0) {
    return "improved"
  }
  if (compressedDelta > 0) {
    return "degraded"
  }
  return "unchanged"
}

async function ensureClaudeCodeInstalledInSandbox(
  sandbox: Sandbox,
  progressContext?: ProgressContext | null
): Promise<void> {
  const claudeInstallRoot = "/home/vercel-sandbox/.claude-code"
  const localClaudeExecutable = `${claudeInstallRoot}/node_modules/.bin/claude`
  const localClaudePackageDir = `${claudeInstallRoot}/node_modules/@anthropic-ai/claude-code`
  const localClaudeCliJs = `${localClaudePackageDir}/cli.js`
  const localClaudeInstallScript = `${localClaudePackageDir}/install.cjs`
  const pathEnv = buildClaudeSandboxPathEnv()
  const sharedHomeEnv = {
    PATH: pathEnv,
    HOME: "/home/vercel-sandbox"
  }
  const ensureRealNodeShim = [
    'mkdir -p "/home/vercel-sandbox/.local/bin"',
    "if ! command -v node >/dev/null 2>&1; then",
    "  if command -v nodejs >/dev/null 2>&1; then",
    '    ln -sf "$(command -v nodejs)" /home/vercel-sandbox/.local/bin/node',
    "  fi",
    "fi",
    "command -v node >/dev/null 2>&1"
  ].join("\n")
  const resolveInstalledClaudePath = async (): Promise<string | null> => {
    const result = await runSandboxCommandWithOptions(sandbox, {
      cmd: "sh",
      args: [
        "-lc",
        [
          "if command -v claude >/dev/null 2>&1; then",
          "  command -v claude",
          `elif [ -x "${localClaudeExecutable}" ]; then`,
          `  printf '%s\\n' "${localClaudeExecutable}"`,
          `elif [ -f "${localClaudeCliJs}" ]; then`,
          `  printf '%s\\n' "${localClaudeCliJs}"`,
          `elif [ -e "/home/vercel-sandbox/.local/bin/claude" ]; then`,
          `  printf '%s\\n' "/home/vercel-sandbox/.local/bin/claude"`,
          "fi"
        ].join("\n")
      ],
      env: { PATH: pathEnv, HOME: "/home/vercel-sandbox" }
    })
    return (
      result.stdout
        .split("\n")
        .map((line) => line.trim())
        .find(Boolean) || null
    )
  }
  const existingClaudePath = await resolveInstalledClaudePath()
  if (existingClaudePath) {
    return
  }

  await appendProgressLog(progressContext, "[Claude] Installing Claude Code CLI in sandbox...")
  let installResult: { exitCode: number; stdout: string; stderr: string } | null = null
  const installErrors: string[] = []
  const prepResult = await runSandboxCommandWithOptions(sandbox, {
    cmd: "sh",
    args: [
      "-lc",
      [
        'mkdir -p "/home/vercel-sandbox/.local/bin"',
        `mkdir -p "${claudeInstallRoot}"`,
        `cd "${claudeInstallRoot}"`,
        ensureRealNodeShim,
        `if [ ! -f package.json ]; then printf '%s' '{"name":"claude-code-runtime","private":true}' > package.json; fi`
      ].join(" && ")
    ],
    env: sharedHomeEnv
  })
  if (prepResult.exitCode !== 0) {
    installErrors.push(
      `bun-prep: exit=${prepResult.exitCode} stdout=${formatClaudeOutputPreview(prepResult.stdout)} stderr=${formatClaudeOutputPreview(prepResult.stderr)}`
    )
  } else {
    try {
      const bunInstallResult = await runSandboxCommandWithOptions(sandbox, {
        cmd: "bun",
        args: ["add", CLAUDE_CODE_PACKAGE],
        cwd: claudeInstallRoot,
        env: sharedHomeEnv
      })
      if (bunInstallResult.exitCode === 0) {
        const bunPostinstallResult = await runSandboxCommandWithOptions(sandbox, {
          cmd: "bun",
          args: ["./node_modules/@anthropic-ai/claude-code/install.cjs"],
          cwd: claudeInstallRoot,
          env: sharedHomeEnv
        })
        if (bunPostinstallResult.exitCode === 0) {
          const linkResult = await runSandboxCommandWithOptions(sandbox, {
            cmd: "sh",
            args: [
              "-lc",
              [
                `test -x "${localClaudeExecutable}"`,
                `ln -sf "${localClaudeExecutable}" /home/vercel-sandbox/.local/bin/claude`
              ].join(" && ")
            ],
            env: sharedHomeEnv
          })
          if (linkResult.exitCode === 0) {
            const resolvedPath = await resolveInstalledClaudePath()
            if (resolvedPath) {
              installResult = {
                exitCode: 0,
                stdout: `resolved=${resolvedPath}`,
                stderr: ""
              }
            } else {
              installErrors.push("bun-local-postinstall: install exited 0 but Claude executable was still unresolved")
            }
          } else {
            installErrors.push(
              `bun-local-link: exit=${linkResult.exitCode} stdout=${formatClaudeOutputPreview(linkResult.stdout)} stderr=${formatClaudeOutputPreview(linkResult.stderr)}`
            )
          }
        } else {
          installErrors.push(
            `bun-local-postinstall: exit=${bunPostinstallResult.exitCode} stdout=${formatClaudeOutputPreview(bunPostinstallResult.stdout)} stderr=${formatClaudeOutputPreview(bunPostinstallResult.stderr)}`
          )
        }
      } else {
        installErrors.push(
          `bun-local-add: exit=${bunInstallResult.exitCode} stdout=${formatClaudeOutputPreview(bunInstallResult.stdout)} stderr=${formatClaudeOutputPreview(bunInstallResult.stderr)}`
        )
      }
    } catch (error) {
      installErrors.push(`bun-local-postinstall: threw=${error instanceof Error ? error.message : String(error)}`)
    }
  }

  if (!installResult) {
    try {
      const pnpmInstallResult = await runSandboxCommandWithOptions(sandbox, {
        cmd: "pnpm",
        args: ["add", CLAUDE_CODE_PACKAGE],
        cwd: claudeInstallRoot,
        env: sharedHomeEnv
      })
      if (pnpmInstallResult.exitCode === 0) {
        const pnpmPostinstallResult = await runSandboxCommandWithOptions(sandbox, {
          cmd: "sh",
          args: [
            "-lc",
            `if command -v nodejs >/dev/null 2>&1; then nodejs "${localClaudeInstallScript}"; else node "${localClaudeInstallScript}"; fi`
          ],
          cwd: claudeInstallRoot,
          env: sharedHomeEnv
        })
        if (pnpmPostinstallResult.exitCode === 0) {
          const linkResult = await runSandboxCommandWithOptions(sandbox, {
            cmd: "sh",
            args: [
              "-lc",
              [
                `test -x "${localClaudeExecutable}"`,
                `ln -sf "${localClaudeExecutable}" /home/vercel-sandbox/.local/bin/claude`
              ].join(" && ")
            ],
            env: sharedHomeEnv
          })
          if (linkResult.exitCode === 0) {
            const resolvedPath = await resolveInstalledClaudePath()
            if (resolvedPath) {
              installResult = {
                exitCode: 0,
                stdout: `resolved=${resolvedPath}`,
                stderr: ""
              }
            } else {
              installErrors.push("pnpm-local-postinstall: install exited 0 but Claude executable was still unresolved")
            }
          } else {
            installErrors.push(
              `pnpm-local-link: exit=${linkResult.exitCode} stdout=${formatClaudeOutputPreview(linkResult.stdout)} stderr=${formatClaudeOutputPreview(linkResult.stderr)}`
            )
          }
        } else {
          installErrors.push(
            `pnpm-local-postinstall: exit=${pnpmPostinstallResult.exitCode} stdout=${formatClaudeOutputPreview(pnpmPostinstallResult.stdout)} stderr=${formatClaudeOutputPreview(pnpmPostinstallResult.stderr)}`
          )
        }
      } else {
        installErrors.push(
          `pnpm-local-add: exit=${pnpmInstallResult.exitCode} stdout=${formatClaudeOutputPreview(pnpmInstallResult.stdout)} stderr=${formatClaudeOutputPreview(pnpmInstallResult.stderr)}`
        )
      }
    } catch (error) {
      installErrors.push(`pnpm-local-postinstall: threw=${error instanceof Error ? error.message : String(error)}`)
    }
  }

  if (!installResult) {
    try {
      const globalResult = await runSandboxCommandWithOptions(sandbox, {
        cmd: "bun",
        args: ["add", "-g", CLAUDE_CODE_PACKAGE],
        env: sharedHomeEnv
      })
      if (globalResult.exitCode === 0) {
        const resolvedPath = await resolveInstalledClaudePath()
        if (resolvedPath) {
          installResult = {
            exitCode: 0,
            stdout: `resolved=${resolvedPath}`,
            stderr: ""
          }
        } else {
          installErrors.push("bun-global: install exited 0 but Claude executable was still unresolved")
        }
      } else {
        installErrors.push(
          `bun-global: exit=${globalResult.exitCode} stdout=${formatClaudeOutputPreview(globalResult.stdout)} stderr=${formatClaudeOutputPreview(globalResult.stderr)}`
        )
      }
    } catch (error) {
      installErrors.push(`bun-global: threw=${error instanceof Error ? error.message : String(error)}`)
    }
  }

  if (!installResult) {
    await appendProgressLog(progressContext, `[Claude] Claude Code CLI install failed ${installErrors.join(" | ")}`)
    throw new Error(`Failed to install Claude Code CLI: ${installErrors.join(" | ")}`)
  }

  const resolvedClaudePath = await resolveInstalledClaudePath()
  if (!resolvedClaudePath) {
    const diagnostics = await runSandboxCommandWithOptions(sandbox, {
      cmd: "sh",
      args: [
        "-lc",
        [
          `printf 'cli_exists='; [ -e "${localClaudeExecutable}" ] && printf yes || printf no`,
          `printf ' cli_exec='; [ -x "${localClaudeExecutable}" ] && printf yes || printf no`,
          `printf ' cli_js_exists='; [ -f "${localClaudeCliJs}" ] && printf yes || printf no`,
          `printf ' install_cjs_exists='; [ -f "${localClaudeInstallScript}" ] && printf yes || printf no`,
          `printf ' symlink_exists='; [ -e "/home/vercel-sandbox/.local/bin/claude" ] && printf yes || printf no`,
          `printf ' symlink_target='; if [ -L "/home/vercel-sandbox/.local/bin/claude" ]; then readlink "/home/vercel-sandbox/.local/bin/claude"; else printf '<none>'; fi`
        ].join(" ; ")
      ],
      env: { PATH: pathEnv, HOME: "/home/vercel-sandbox" }
    })
    await appendProgressLog(
      progressContext,
      `[Claude] Claude Code CLI missing after install attempts ${installErrors.join(" | ")} diagnostics=${formatClaudeOutputPreview(diagnostics.stdout || diagnostics.stderr, 220)}`
    )
    throw new Error("Claude Code CLI installed but could not be resolved inside the sandbox.")
  }

  try {
    const invocation = await resolveClaudeSandboxInvocation(sandbox, pathEnv)
    await appendProgressLog(
      progressContext,
      `[Claude] Claude Code CLI ready (${resolvedClaudePath}; cmd=${invocation.cmd})`
    )
  } catch (error) {
    await appendProgressLog(
      progressContext,
      `[Claude] Runtime resolution failed after install: ${error instanceof Error ? error.message : String(error)}`
    )
    throw new Error("Claude Code CLI installed but could not be invoked inside the sandbox.")
  }
}

function formatClaudeOutputPreview(raw: string | undefined, maxLength = 240): string {
  const normalized = (raw || "").replace(/\s+/g, " ").trim().slice(0, maxLength)

  return normalized || "<empty>"
}

function buildClaudeSandboxPathEnv(): string {
  return [
    "/home/vercel-sandbox/.claude-code/node_modules/.bin",
    "/home/vercel-sandbox/.bun/bin",
    "/home/vercel-sandbox/.local/bin",
    "/vercel/runtimes/node24/bin",
    "/vercel/runtimes/node22/bin",
    "/vercel/runtimes/nodejs/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin"
  ].join(":")
}

type ClaudeSandboxInvocation = {
  cmd: string
  argsPrefix: string[]
  description: string
}

async function resolveClaudeSandboxInvocation(sandbox: Sandbox, pathEnv: string): Promise<ClaudeSandboxInvocation> {
  const localClaudeExecutable = "/home/vercel-sandbox/.claude-code/node_modules/.bin/claude"
  const localClaudeCliJs = "/home/vercel-sandbox/.claude-code/node_modules/@anthropic-ai/claude-code/cli.js"
  const localSymlink = "/home/vercel-sandbox/.local/bin/claude"
  const verifyResult = await runSandboxCommandWithOptions(sandbox, {
    cmd: "sh",
    args: [
      "-lc",
      [
        `if [ -x "${localClaudeExecutable}" ]; then`,
        `  printf 'local:%s\\n' "${localClaudeExecutable}"`,
        `elif [ -f "${localClaudeCliJs}" ]; then`,
        `  printf 'cli-js:%s\\n' "${localClaudeCliJs}"`,
        "elif command -v claude >/dev/null 2>&1; then",
        "  printf 'which:%s\\n' \"$(command -v claude)\"",
        `elif [ -e "${localSymlink}" ]; then`,
        `  printf 'which:%s\\n' "${localSymlink}"`,
        "fi"
      ].join("\n")
    ],
    env: { PATH: pathEnv, HOME: "/home/vercel-sandbox" }
  })

  const line = verifyResult.stdout.trim()
  if (line.startsWith("local:")) {
    const cliPath = line.slice("local:".length)
    return {
      cmd: cliPath,
      argsPrefix: [],
      description: cliPath
    }
  }
  if (line.startsWith("which:")) {
    return {
      cmd: "claude",
      argsPrefix: [],
      description: line.slice("which:".length)
    }
  }
  if (line.startsWith("cli-js:")) {
    const cliPath = line.slice("cli-js:".length)
    const runtimeResult = await runSandboxCommandWithOptions(sandbox, {
      cmd: "sh",
      args: [
        "-lc",
        [
          "if command -v nodejs >/dev/null 2>&1; then",
          "  printf 'nodejs:%s\\n' \"$(command -v nodejs)\"",
          "elif command -v node >/dev/null 2>&1; then",
          "  printf 'node:%s\\n' \"$(command -v node)\"",
          "elif command -v bun >/dev/null 2>&1; then",
          "  printf 'bun:%s\\n' \"$(command -v bun)\"",
          "fi"
        ].join("\n")
      ],
      env: { PATH: pathEnv, HOME: "/home/vercel-sandbox" }
    })
    const runtimeLine = runtimeResult.stdout.trim()
    if (runtimeLine.startsWith("nodejs:")) {
      return {
        cmd: "nodejs",
        argsPrefix: [cliPath],
        description: `${runtimeLine.slice("nodejs:".length)} ${cliPath}`
      }
    }
    if (runtimeLine.startsWith("node:")) {
      return {
        cmd: "node",
        argsPrefix: [cliPath],
        description: `${runtimeLine.slice("node:".length)} ${cliPath}`
      }
    }
    if (runtimeLine.startsWith("bun:")) {
      return {
        cmd: "bun",
        argsPrefix: [cliPath],
        description: `${runtimeLine.slice("bun:".length)} ${cliPath}`
      }
    }
  }
  if (verifyResult.exitCode === 0 && line.length === 0) {
    const fallbackResult = await runSandboxCommandWithOptions(sandbox, {
      cmd: "sh",
      args: [
        "-lc",
        `if test -x "${localClaudeExecutable}"; then printf 'local:%s\\n' "${localClaudeExecutable}"; elif test -f "${localClaudeCliJs}"; then printf 'cli-js:%s\\n' "${localClaudeCliJs}"; fi`
      ],
      env: { PATH: pathEnv, HOME: "/home/vercel-sandbox" }
    })
    const fallbackLine = fallbackResult.stdout.trim()
    if (fallbackLine.startsWith("local:")) {
      const cliPath = fallbackLine.slice("local:".length)
      return {
        cmd: cliPath,
        argsPrefix: [],
        description: cliPath
      }
    }
    if (fallbackLine.startsWith("cli-js:")) {
      const cliPath = fallbackLine.slice("cli-js:".length)
      return {
        cmd: "nodejs",
        argsPrefix: [cliPath],
        description: `nodejs ${cliPath}`
      }
    }
  }
  throw new Error("Claude Code CLI is unavailable inside the sandbox after installation.")
}

async function logClaudeCliDiagnostics(
  sandbox: Sandbox,
  pathEnv: string,
  progressContext?: ProgressContext | null
): Promise<void> {
  const localClaudeExecutable = "/home/vercel-sandbox/.claude-code/node_modules/.bin/claude"
  const localSymlink = "/home/vercel-sandbox/.local/bin/claude"
  const [whichResult, versionResult, runtimeWhichResult, runtimeVersionResult, fileResult] = await Promise.all([
    runSandboxCommandWithOptions(sandbox, {
      cmd: "sh",
      args: ["-c", "command -v claude || true"],
      env: { PATH: pathEnv, HOME: "/home/vercel-sandbox" }
    }),
    runSandboxCommandWithOptions(sandbox, {
      cmd: "sh",
      args: [
        "-c",
        `claude --version || [ -x "${localClaudeExecutable}" ] && "${localClaudeExecutable}" --version || true`
      ],
      env: { PATH: pathEnv, HOME: "/home/vercel-sandbox" }
    }),
    runSandboxCommandWithOptions(sandbox, {
      cmd: "sh",
      args: [
        "-lc",
        `PATH="${pathEnv}" command -v nodejs || PATH="${pathEnv}" command -v node || PATH="${pathEnv}" command -v bun || true`
      ],
      env: { HOME: "/home/vercel-sandbox" }
    }),
    runSandboxCommandWithOptions(sandbox, {
      cmd: "sh",
      args: [
        "-lc",
        'RUNTIME=$(PATH="$PATH" command -v nodejs || PATH="$PATH" command -v node || PATH="$PATH" command -v bun || true); [ -n "$RUNTIME" ] && "$RUNTIME" --version || true'
      ],
      env: { PATH: pathEnv, HOME: "/home/vercel-sandbox" }
    }),
    runSandboxCommandWithOptions(sandbox, {
      cmd: "sh",
      args: [
        "-c",
        [
          `printf 'cli=%s exists=' "${localClaudeExecutable}"`,
          `[ -e "${localClaudeExecutable}" ] && printf yes || printf no`,
          `printf ' file='`,
          `[ -f "${localClaudeExecutable}" ] && printf yes || printf no`,
          `printf ' exec='`,
          `[ -x "${localClaudeExecutable}" ] && printf yes || printf no`,
          `printf ' symlink='`,
          `[ -L "${localSymlink}" ] && readlink "${localSymlink}" || printf '<missing>'`
        ].join(" && ")
      ],
      env: { PATH: pathEnv, HOME: "/home/vercel-sandbox" }
    })
  ])

  const claudePath = whichResult.stdout.trim() || "<missing>"
  const claudeVersion = formatClaudeOutputPreview(versionResult.stdout || versionResult.stderr, 120)
  const nodePath = runtimeWhichResult.stdout.trim() || "<missing>"
  const nodeVersion = formatClaudeOutputPreview(runtimeVersionResult.stdout || runtimeVersionResult.stderr, 120)
  const fileStatus = formatClaudeOutputPreview(fileResult.stdout || fileResult.stderr, 160)
  await appendProgressLog(
    progressContext,
    `[Claude] CLI path=${claudePath} version=${claudeVersion} node=${nodePath} nodeVersion=${nodeVersion} files=${fileStatus}`
  )
}

function parseClaudeJsonResult(raw: string): {
  session_id?: string
  result?: string
  total_cost_usd?: number
  duration_ms?: number
  num_turns?: number
  subtype?: string
  terminal_reason?: string
  is_error?: boolean
  errors?: string[]
  usage?: {
    input_tokens?: number
    output_tokens?: number
    cache_read_input_tokens?: number
    cache_creation_input_tokens?: number
  }
} {
  const trimmed = raw.trim()
  if (!trimmed) {
    throw new Error("Claude returned empty output.")
  }

  try {
    return JSON.parse(trimmed) as {
      session_id?: string
      result?: string
      total_cost_usd?: number
      duration_ms?: number
      num_turns?: number
      subtype?: string
      terminal_reason?: string
      is_error?: boolean
      errors?: string[]
      usage?: {
        input_tokens?: number
        output_tokens?: number
        cache_read_input_tokens?: number
        cache_creation_input_tokens?: number
      }
    }
  } catch {
    const lines = trimmed
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
    for (let index = lines.length - 1; index >= 0; index--) {
      try {
        return JSON.parse(lines[index]) as {
          session_id?: string
          result?: string
          total_cost_usd?: number
          duration_ms?: number
          num_turns?: number
          subtype?: string
          terminal_reason?: string
          is_error?: boolean
          errors?: string[]
          usage?: {
            input_tokens?: number
            output_tokens?: number
            cache_read_input_tokens?: number
            cache_creation_input_tokens?: number
          }
        }
      } catch {}
    }
    throw new Error(`Failed to parse Claude JSON output: ${trimmed.slice(0, 400)}`)
  }
}

async function runClaudeTurnInSandbox(
  sandbox: Sandbox,
  cwd: string,
  prompt: ClaudeTurnPrompt,
  options: {
    sessionId?: string
    systemPrompt?: string
    modelId?: import("@/lib/dev-agents").DevAgentAiAgent
    gatewayAuthToken?: string
    gatewayAuthSourceLabel?: string
    progressContext?: ProgressContext | null
  }
): Promise<ClaudeTurnResult> {
  const gatewayAuthToken = requireAiGatewayAuthToken(options.gatewayAuthToken)
  const gatewayAuthSource = options.gatewayAuthSourceLabel || getAiGatewayAuthSource(options.gatewayAuthToken)

  const modelSelection = resolveClaudeModelSelection(options.modelId)
  const pathEnv = buildClaudeSandboxPathEnv()
  const invocation = await resolveClaudeSandboxInvocation(sandbox, pathEnv)
  const args = [
    ...invocation.argsPrefix,
    ...(options.sessionId ? ["--resume", options.sessionId] : []),
    "-p",
    prompt.prompt,
    "--output-format",
    "json",
    "--max-turns",
    String(prompt.maxTurns),
    "--model",
    modelSelection.cliModel,
    "--dangerously-skip-permissions"
  ]
  if (!options.sessionId && options.systemPrompt?.trim()) {
    args.push("--append-system-prompt", options.systemPrompt.trim())
  }

  const claudeEnv = {
    PATH: pathEnv,
    ANTHROPIC_BASE_URL: "https://ai-gateway.vercel.sh",
    ANTHROPIC_AUTH_TOKEN: gatewayAuthToken,
    AI_GATEWAY_API_KEY: gatewayAuthToken,
    ANTHROPIC_API_KEY: "",
    // Claude Code can send experimental beta headers that Anthropic-format
    // gateways backed by Bedrock/Vertex may reject with 400s.
    CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: "1",
    ...modelSelection.extraEnv
  }

  await logClaudeCliDiagnostics(sandbox, pathEnv, options.progressContext)
  await appendProgressLog(
    options.progressContext,
    `[Claude] Running ${prompt.label} (model=${modelSelection.cliModel}, resume=${options.sessionId ? "yes" : "no"}, authToken=present:${gatewayAuthSource}, aiGatewayApiKey=present:${gatewayAuthSource}, baseUrl=${claudeEnv.ANTHROPIC_BASE_URL}, cmd=${invocation.cmd}, cli=${invocation.description}, extraEnv=${Object.keys(modelSelection.extraEnv).join(",") || "none"})`
  )

  const startedAt = Date.now()
  const heartbeat = setInterval(() => {
    const elapsedSeconds = Math.round((Date.now() - startedAt) / 1000)
    void appendProgressLog(
      options.progressContext,
      `[Claude] ${prompt.label} still running (${elapsedSeconds}s elapsed)`
    )
  }, 5000)

  let result: Awaited<ReturnType<typeof runSandboxCommandWithOptions>>
  try {
    result = await runSandboxCommandWithOptions(sandbox, {
      cmd: invocation.cmd,
      args,
      cwd,
      env: claudeEnv
    })
  } finally {
    clearInterval(heartbeat)
  }

  const parsedOutput = result.stdout.trim() ? parseClaudeJsonResult(result.stdout) : null

  if (result.exitCode !== 0) {
    if (
      parsedOutput?.is_error &&
      (parsedOutput.subtype === "error_max_turns" || parsedOutput.terminal_reason === "max_turns") &&
      (parsedOutput.session_id || options.sessionId)
    ) {
      const sessionId = parsedOutput.session_id || options.sessionId
      if (!sessionId) {
        throw new Error(`Claude exceeded max turns during ${prompt.label} but did not return a session id.`)
      }
      await appendProgressLog(
        options.progressContext,
        `[Claude] ${prompt.label} hit max turns after ${parsedOutput.num_turns ?? prompt.maxTurns} turns; resuming the same session`
      )
      return {
        sessionId,
        resultText: typeof parsedOutput.result === "string" ? parsedOutput.result.trim() : "",
        rawJson: result.stdout.trim(),
        costUsd: typeof parsedOutput.total_cost_usd === "number" ? parsedOutput.total_cost_usd : 0,
        durationMs: typeof parsedOutput.duration_ms === "number" ? parsedOutput.duration_ms : 0,
        numTurns: typeof parsedOutput.num_turns === "number" ? parsedOutput.num_turns : prompt.maxTurns,
        needsContinuation: true,
        usage: {
          promptTokens: parsedOutput.usage?.input_tokens ?? 0,
          completionTokens: parsedOutput.usage?.output_tokens ?? 0,
          cacheReadTokens: parsedOutput.usage?.cache_read_input_tokens ?? 0,
          cacheCreationTokens: parsedOutput.usage?.cache_creation_input_tokens ?? 0,
          totalTokens:
            (parsedOutput.usage?.input_tokens ?? 0) +
            (parsedOutput.usage?.output_tokens ?? 0) +
            (parsedOutput.usage?.cache_read_input_tokens ?? 0) +
            (parsedOutput.usage?.cache_creation_input_tokens ?? 0)
        }
      }
    }
    await appendProgressLog(
      options.progressContext,
      `[Claude] ${prompt.label} failed exit=${result.exitCode} stdout=${formatClaudeOutputPreview(result.stdout)} stderr=${formatClaudeOutputPreview(result.stderr)}`
    )
    throw new Error(`Claude turn failed (${prompt.label}): ${result.stderr || result.stdout || "unknown error"}`)
  }

  const parsed = parsedOutput ?? parseClaudeJsonResult(result.stdout)
  if (parsed.is_error) {
    await appendProgressLog(
      options.progressContext,
      `[Claude] ${prompt.label} returned is_error stdout=${formatClaudeOutputPreview(result.stdout)}`
    )
    throw new Error(`Claude reported an error during ${prompt.label}: ${result.stdout}`)
  }

  const sessionId = parsed.session_id || options.sessionId
  if (!sessionId) {
    throw new Error(`Claude did not return a session id for ${prompt.label}.`)
  }

  return {
    sessionId,
    resultText: typeof parsed.result === "string" ? parsed.result.trim() : result.stdout.trim(),
    rawJson: result.stdout.trim(),
    costUsd: typeof parsed.total_cost_usd === "number" ? parsed.total_cost_usd : 0,
    durationMs: typeof parsed.duration_ms === "number" ? parsed.duration_ms : 0,
    numTurns: typeof parsed.num_turns === "number" ? parsed.num_turns : 0,
    usage: {
      promptTokens: parsed.usage?.input_tokens ?? 0,
      completionTokens: parsed.usage?.output_tokens ?? 0,
      cacheReadTokens: parsed.usage?.cache_read_input_tokens ?? 0,
      cacheCreationTokens: parsed.usage?.cache_creation_input_tokens ?? 0,
      totalTokens:
        (parsed.usage?.input_tokens ?? 0) +
        (parsed.usage?.output_tokens ?? 0) +
        (parsed.usage?.cache_read_input_tokens ?? 0) +
        (parsed.usage?.cache_creation_input_tokens ?? 0)
    }
  }
}

async function runAgentWithDiagnoseTool(
  sandbox: Sandbox,
  devUrl: string,
  beforeCls: number | null,
  beforeGrade: "good" | "needs-improvement" | "poor" | null,
  startPath: string,
  projectDir?: string,
  customPrompt?: string,
  workflowType?: string,
  crawlDepth?: number | "all",
  devAgentName?: string,
  devAgentInstructions?: string,
  devAgentExecutionMode?: "dev-server" | "preview-pr",
  devAgentSandboxBrowser?: "none" | "agent-browser",
  devAgentAiAgent?: import("@/lib/dev-agents").DevAgentAiAgent,
  devAgentActionSteps?: Array<{ kind: string; config: Record<string, string> }>,
  devAgentSkillRefs?: DevAgentSkillRef[],
  devAgentAshTarballUrl?: string,
  bundleBaselineSummary?: string,
  gatewayAuthToken?: string,
  gatewayAuthSource?: string,
  progressContext?: ProgressContext | null
): Promise<{
  transcript: string
  summary: string
  systemPrompt: string
  modelId: string
  skillsLoaded: string[]
  usage: {
    promptTokens: number
    completionTokens: number
    cacheReadTokens: number
    cacheCreationTokens: number
    totalTokens: number
  }
  costUsd: number
}> {
  const SANDBOX_CWD = projectDir ? `/vercel/sandbox/${projectDir.replace(/^\/+|\/+$/g, "")}` : "/vercel/sandbox"
  const workflowTypeForPrompt = workflowType || "cls-fix"
  const includeD3kSkill = workflowTypeForPrompt !== "turbopack-bundle-analyzer" && workflowTypeForPrompt !== "cls-fix"
  const skillLoadInstructions = buildDevAgentSkillLoadInstructions(devAgentSkillRefs, {
    includeD3k: includeD3kSkill,
    includeAshRunbook: Boolean(devAgentAshTarballUrl)
  })
  const browserGuidance = buildDevAgentSandboxBrowserGuidance(devAgentSandboxBrowser)
  const modelSelection = resolveClaudeModelSelection(devAgentAiAgent)
  const selectedModelLabel = getDevAgentModelLabel(modelSelection.modelId)
  const clsCodeHints = workflowTypeForPrompt === "cls-fix" ? await gatherClsCodeHints(sandbox, SANDBOX_CWD) : null
  const { effectiveInstructions: effectiveDevAgentInstructions, effectiveActionSteps } =
    buildEffectiveDevAgentPromptConfig({
      workflowType: workflowTypeForPrompt,
      devAgentInstructions,
      devAgentActionSteps
    })

  if (gatewayAuthSource) {
    await appendProgressLog(progressContext, `[Claude] Gateway auth source: ${gatewayAuthSource}`)
  }

  if (devAgentAshTarballUrl) {
    try {
      await appendProgressLog(progressContext, "[ASH] Executing packaged ASH runtime path...")
      return await runAshAgentInSandbox(
        sandbox,
        devUrl,
        beforeCls,
        beforeGrade,
        startPath,
        projectDir,
        customPrompt,
        workflowType,
        crawlDepth,
        devAgentName,
        effectiveDevAgentInstructions,
        devAgentExecutionMode,
        devAgentSandboxBrowser,
        devAgentAiAgent,
        effectiveActionSteps,
        devAgentSkillRefs,
        devAgentAshTarballUrl,
        bundleBaselineSummary,
        gatewayAuthToken,
        gatewayAuthSource,
        progressContext
      )
    } catch (ashRuntimeError) {
      await appendProgressLog(
        progressContext,
        `[ASH] Runtime path failed, falling back to Claude CLI: ${ashRuntimeError instanceof Error ? ashRuntimeError.message : String(ashRuntimeError)}`
      )
    }
  }

  await appendProgressLog(progressContext, "[Claude] Ensuring Claude Code CLI is available...")
  try {
    await ensureClaudeCodeInstalledInSandbox(sandbox, progressContext)
  } catch (claudeInstallError) {
    await appendProgressLog(
      progressContext,
      `[Claude] Bootstrap failed: ${claudeInstallError instanceof Error ? claudeInstallError.message : String(claudeInstallError)}`
    )
    throw claudeInstallError
  }

  const systemPrompt = buildClaudeSystemPrompt({
    workflowType: workflowTypeForPrompt,
    devUrl,
    startPath,
    projectDir,
    browserGuidance,
    selectedModelLabel,
    skillLoadInstructions
  })
  const turnPrompts = buildClaudeTurnPrompts({
    workflowType: workflowTypeForPrompt,
    startPath,
    devUrl,
    customPrompt,
    crawlDepth,
    devAgentName,
    devAgentInstructions: effectiveDevAgentInstructions,
    devAgentExecutionMode,
    devAgentActionSteps: effectiveActionSteps,
    skillLoadInstructions,
    bundleBaselineSummary,
    beforeCls,
    beforeGrade,
    codeHints: clsCodeHints ?? undefined,
    devAgentSandboxBrowser,
    hasPackagedRunbook: Boolean(devAgentAshTarballUrl)
  })

  const transcript: string[] = []
  transcript.push("## System Prompt")
  transcript.push("```")
  transcript.push(systemPrompt)
  transcript.push("```")
  transcript.push("")
  transcript.push(`## Claude Session (${selectedModelLabel})`)
  transcript.push("")

  let currentSessionId: string | undefined
  let finalSummary = ""
  let totalCostUsd = 0
  let totalPromptTokens = 0
  let totalCompletionTokens = 0
  let totalCacheReadTokens = 0
  let totalCacheCreationTokens = 0

  for (let index = 0; index < turnPrompts.length; index++) {
    const baseTurnPrompt = turnPrompts[index]
    let turnPrompt = baseTurnPrompt
    let continuationCount = 0

    while (true) {
      await appendProgressLog(progressContext, `[Claude] ${turnPrompt.label}: ${turnPrompt.prompt.slice(0, 120)}`)
      let turnResult: ClaudeTurnResult
      try {
        turnResult = await runClaudeTurnInSandbox(sandbox, SANDBOX_CWD, turnPrompt, {
          sessionId: currentSessionId,
          systemPrompt: currentSessionId ? undefined : systemPrompt,
          modelId: modelSelection.modelId,
          gatewayAuthToken,
          gatewayAuthSourceLabel: gatewayAuthSource,
          progressContext
        })
      } catch (error) {
        await appendProgressLog(
          progressContext,
          `[Claude] ${turnPrompt.label} threw before completion: ${error instanceof Error ? error.message : String(error)}`
        )
        throw error
      }
      currentSessionId = turnResult.sessionId
      finalSummary = turnResult.resultText || finalSummary
      totalCostUsd += turnResult.costUsd
      totalPromptTokens += turnResult.usage.promptTokens
      totalCompletionTokens += turnResult.usage.completionTokens
      totalCacheReadTokens += turnResult.usage.cacheReadTokens
      totalCacheCreationTokens += turnResult.usage.cacheCreationTokens

      transcript.push(`### ${turnPrompt.label}`)
      transcript.push("")
      transcript.push("**User:**")
      transcript.push("```")
      transcript.push(turnPrompt.prompt)
      transcript.push("```")
      transcript.push("")
      transcript.push("**Claude:**")
      transcript.push(turnResult.resultText || "(no textual result)")
      transcript.push("")
      transcript.push("**Result JSON:**")
      transcript.push("```json")
      transcript.push(turnResult.rawJson)
      transcript.push("```")
      transcript.push("")

      if (!turnResult.needsContinuation) {
        break
      }

      if (baseTurnPrompt.label !== "Agent main task") {
        await appendProgressLog(
          progressContext,
          `[Claude] ${baseTurnPrompt.label} reached the chunk limit; proceeding without further setup continuations`
        )
        break
      }

      continuationCount += 1
      if (continuationCount >= 6) {
        throw new Error(`Claude exceeded the continuation limit during ${baseTurnPrompt.label}.`)
      }

      turnPrompt = {
        ...baseTurnPrompt,
        label: `${baseTurnPrompt.label} continuation ${continuationCount}`,
        prompt: buildClaudeContinuationPrompt(baseTurnPrompt.label)
      }
    }
  }

  return {
    transcript: transcript.join("\n"),
    summary: finalSummary,
    systemPrompt,
    modelId: modelSelection.modelId,
    skillsLoaded: getInstalledSkillNames(devAgentSkillRefs, { includeD3k: includeD3kSkill }),
    usage: {
      promptTokens: totalPromptTokens,
      completionTokens: totalCompletionTokens,
      cacheReadTokens: totalCacheReadTokens,
      cacheCreationTokens: totalCacheCreationTokens,
      totalTokens: totalPromptTokens + totalCompletionTokens + totalCacheReadTokens + totalCacheCreationTokens
    },
    costUsd: totalCostUsd
  }
}

function _synthesizeFinalOutputFromSteps(steps: unknown[], workflowType: string): string {
  const inspectedPaths = new Set<string>()
  const writtenFiles = new Set<string>()
  const verificationRuns: string[] = []
  const assistantNotes: string[] = []

  for (const rawStep of steps) {
    const step = rawStep as {
      text?: string
      toolCalls?: Array<{ toolName?: string; input?: unknown }>
      toolResults?: Array<{ output?: unknown }>
    }
    if (step.text?.trim()) {
      assistantNotes.push(step.text.trim())
    }

    const calls = Array.isArray(step.toolCalls) ? step.toolCalls : []
    const results = Array.isArray(step.toolResults) ? step.toolResults : []

    for (let i = 0; i < calls.length; i++) {
      const call = calls[i]
      const toolName = call?.toolName || "unknown"
      const input = (call?.input || {}) as Record<string, unknown>
      const outputRaw = results[i]?.output
      const outputText =
        typeof outputRaw === "string" ? outputRaw : outputRaw !== undefined ? JSON.stringify(outputRaw) : "[no result]"

      if (toolName === "readFile") {
        const path = typeof input.path === "string" ? input.path : ""
        if (path.includes(".next/diagnostics/analyze/ndjson")) {
          inspectedPaths.add(path)
        }
      }

      if (toolName === "listDir") {
        const path = typeof input.path === "string" ? input.path : ""
        if (path.includes(".next/diagnostics/analyze/ndjson")) {
          inspectedPaths.add(path)
        }
      }

      if (toolName === "runProjectCommand") {
        const command = typeof input.command === "string" ? input.command : ""
        if (
          command.includes("next build") ||
          command.includes("analyze-to-ndjson") ||
          command.includes("experimental-analyze")
        ) {
          const exitMatch = outputText.match(/Exit code:\s*(-?\d+)/i)
          const exitCode = exitMatch ? exitMatch[1] : "unknown"
          verificationRuns.push(`${command} (exit ${exitCode})`)
        }
      }

      if (toolName === "writeFile") {
        const path = typeof input.path === "string" ? input.path : ""
        if (path) writtenFiles.add(path)
      }
    }
  }

  const noteSnippet = assistantNotes.slice(-2).join("\n\n").trim()
  const lines: string[] = []
  lines.push("Auto-generated execution summary from tool activity.")
  lines.push("The model did not emit a dedicated final narrative before the step budget was reached.")
  lines.push("")
  lines.push(`Workflow focus: ${workflowType}`)
  lines.push(
    `Analyzer artifacts inspected: ${inspectedPaths.size > 0 ? Array.from(inspectedPaths).join(", ") : "not detected"}`
  )
  lines.push(`Files modified: ${writtenFiles.size > 0 ? Array.from(writtenFiles).join(", ") : "none detected"}`)
  lines.push(
    `Verification commands: ${verificationRuns.length > 0 ? verificationRuns.slice(0, 6).join(" | ") : "not detected"}`
  )
  if (noteSnippet) {
    lines.push("")
    lines.push("Recent assistant notes:")
    lines.push(noteSnippet)
  }

  return lines.join("\n")
}

// ============================================================
// Helper Functions
// ============================================================

async function resolveSandboxProjectDir(
  sandbox: Sandbox,
  projectDir: string | undefined,
  projectName: string,
  progressContext?: ProgressContext | null
): Promise<string | undefined> {
  const normalizedInput = projectDir?.replace(/^\/+|\/+$/g, "") || ""
  if (normalizedInput) {
    const inputCheck = await runSandboxCommand(sandbox, "sh", [
      "-c",
      `if [ -f "/vercel/sandbox/${normalizedInput}/package.json" ]; then echo ok; fi`
    ])
    if (inputCheck.stdout.includes("ok")) {
      await appendProgressLog(progressContext, `[Sandbox] Using project directory: ${normalizedInput}`)
      return normalizedInput
    }
    await appendProgressLog(
      progressContext,
      `[Sandbox] Provided project directory not found: ${normalizedInput} (attempting monorepo auto-detect)`
    )
  }

  const detectScript = `
const fs = require("fs")
const path = require("path")
const root = "/vercel/sandbox"
const name = ${JSON.stringify(projectName)}
const candidates = [\`apps/\${name}\`, \`packages/\${name}\`, \`projects/\${name}\`, \`services/\${name}\`, name]
for (const candidate of candidates) {
  const abs = path.join(root, candidate)
  if (fs.existsSync(path.join(abs, "package.json"))) {
    process.stdout.write(candidate)
    process.exit(0)
  }
}
process.stdout.write("")
`
  const detectResult = await runSandboxCommand(sandbox, "sh", ["-c", `node <<'NODE'\n${detectScript}\nNODE`])
  const resolved = detectResult.stdout.trim()
  if (resolved) {
    await appendProgressLog(progressContext, `[Sandbox] Auto-detected monorepo project directory: ${resolved}`)
    return resolved
  }

  await appendProgressLog(progressContext, "[Sandbox] Could not auto-detect project directory, using repo root")
  return normalizedInput || undefined
}

async function readSandboxSkillsInfo(
  sandbox: Sandbox
): Promise<{ skillsInstalled: string[]; skillsAgentId?: string | null }> {
  try {
    const sessionResult = await readLatestSandboxSession(sandbox)
    if (!sessionResult.session) {
      return { skillsInstalled: [] }
    }

    const parsed = sessionResult.session as { skillsInstalled?: string[]; skillsAgentId?: string | null }

    return {
      skillsInstalled: Array.isArray(parsed.skillsInstalled) ? parsed.skillsInstalled : [],
      skillsAgentId: parsed.skillsAgentId ?? null
    }
  } catch (error) {
    workflowLog(
      `[Agent] Failed to read skills from sandbox session: ${error instanceof Error ? error.message : String(error)}`
    )
    return { skillsInstalled: [] }
  }
}

async function runSandboxCommand(
  sandbox: Sandbox,
  cmd: string,
  args: string[],
  options?: { timeoutMs?: number }
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return runSandboxCommandWithOptions(
    sandbox,
    {
      cmd,
      args
    },
    options
  )
}

async function runSandboxCommandWithOptions(
  sandbox: Sandbox,
  options: Parameters<Sandbox["runCommand"]>[0],
  execOptions?: { timeoutMs?: number }
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const timeoutMs = execOptions?.timeoutMs
  const controller = new AbortController()
  let stdout = ""
  let stderr = ""
  const timeoutId =
    typeof timeoutMs === "number" && timeoutMs > 0
      ? setTimeout(() => {
          controller.abort()
        }, timeoutMs)
      : null

  try {
    const commandSegments = [
      ...Object.entries(options.env ?? {}).map(([key, value]) => `export ${key}=${shellEscape(value)}`),
      options.cwd ? `cd ${shellEscape(options.cwd)}` : null,
      `exec ${[options.cmd, ...(options.args ?? [])].map(shellEscape).join(" ")}`
    ]
      .filter(Boolean)
      .join(" && ")

    const result = await sandbox.runCommand("sh", ["-lc", commandSegments], {
      signal: controller.signal
    })

    for await (const log of result.logs()) {
      if (log.stream === "stdout") stdout += log.data
      else stderr += log.data
    }

    return { exitCode: result.exitCode, stdout, stderr }
  } catch (error) {
    if (controller.signal.aborted && typeof timeoutMs === "number" && timeoutMs > 0) {
      return {
        exitCode: 124,
        stdout,
        stderr: stderr || `Command timed out after ${timeoutMs}ms`
      }
    }

    throw error
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId)
    }
  }
}

async function readLatestSandboxSession(
  sandbox: Sandbox
): Promise<{ sessionPath: string | null; session: Record<string, unknown> | null }> {
  try {
    const sessionPathResult = await runSandboxCommand(
      sandbox,
      "sh",
      ["-c", "ls -t /home/vercel-sandbox/.d3k/*/session.json 2>/dev/null | head -1"],
      {
        timeoutMs: 5000
      }
    )
    const sessionPath = sessionPathResult.stdout.trim().split("\n")[0] || null
    if (!sessionPath) {
      return { sessionPath: null, session: null }
    }

    const sessionResult = await runSandboxCommand(sandbox, "sh", ["-c", `cat "${sessionPath}" 2>/dev/null`], {
      timeoutMs: 5000
    })
    if (!sessionResult.stdout.trim()) {
      return { sessionPath, session: null }
    }

    return {
      sessionPath,
      session: JSON.parse(sessionResult.stdout) as Record<string, unknown>
    }
  } catch (error) {
    workflowLog(`[Sandbox] Failed to read latest session: ${error instanceof Error ? error.message : String(error)}`)
    return { sessionPath: null, session: null }
  }
}

function extractSandboxCdpUrl(value: unknown): string | null {
  if (typeof value === "string" && /^wss?:\/\/.+\/devtools\/browser\//.test(value)) {
    return value
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = extractSandboxCdpUrl(item)
      if (found) return found
    }
    return null
  }
  if (value && typeof value === "object") {
    for (const nested of Object.values(value)) {
      const found = extractSandboxCdpUrl(nested)
      if (found) return found
    }
  }
  return null
}

async function captureScreenshotWithSandboxChromium(
  sandbox: Sandbox,
  screenshotPath: string,
  targetUrl: string,
  waitMs: number
): Promise<{ success: boolean; error?: string }> {
  const result = await runSandboxCommandWithOptions(
    sandbox,
    {
      cmd: "sh",
      args: [
        "-c",
        `
set -e
CHROME_BIN=""
for candidate in /tmp/chromium chromium chromium-browser google-chrome-stable google-chrome; do
  if [ -x "$candidate" ]; then
    CHROME_BIN="$candidate"
    break
  fi
  if command -v "$candidate" >/dev/null 2>&1; then
    CHROME_BIN="$(command -v "$candidate")"
    break
  fi
done

if [ -z "$CHROME_BIN" ]; then
  echo "No Chromium binary available" >&2
  exit 1
fi

mkdir -p "$(dirname ${JSON.stringify(screenshotPath)})"

"$CHROME_BIN" \
  --headless=new \
  --no-sandbox \
  --disable-gpu \
  --disable-dev-shm-usage \
  --hide-scrollbars \
  --run-all-compositor-stages-before-draw \
  --window-size=1280,800 \
  --virtual-time-budget=${Math.max(0, waitMs)} \
  --screenshot=${JSON.stringify(screenshotPath)} \
  ${JSON.stringify(targetUrl)}
      `
      ]
    },
    {
      timeoutMs: Math.max(waitMs + 15000, 20000)
    }
  )

  if (result.exitCode !== 0) {
    return {
      success: false,
      error: result.stderr.trim() || result.stdout.trim() || "Chromium screenshot command failed"
    }
  }

  return { success: true }
}

async function captureScreenshotViaCDP(
  sandbox: Sandbox,
  screenshotPath: string,
  targetUrl?: string
): Promise<{ success: boolean; error?: string }> {
  const { sessionPath, session } = await readLatestSandboxSession(sandbox)
  const cdpUrl = extractSandboxCdpUrl(session)
  if (!cdpUrl) {
    return {
      success: false,
      error: `No sandbox CDP URL available${sessionPath ? ` in ${sessionPath}` : ""}`
    }
  }

  const captureScript = `
import fs from "node:fs"

const cdpUrl = process.env.D3K_CDP_URL
const outputPath = process.env.D3K_SCREENSHOT_PATH
const targetUrl = process.env.D3K_TARGET_URL || ""

if (!cdpUrl) throw new Error("Missing D3K_CDP_URL")
if (!outputPath) throw new Error("Missing D3K_SCREENSHOT_PATH")

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const browser = new WebSocket(cdpUrl)
let nextId = 0
const pending = new Map()
let pageLoadResolver = null

const send = (method, params = {}, sessionId) =>
  new Promise((resolve, reject) => {
    const id = ++nextId
    pending.set(id, { resolve, reject })
    browser.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }))
  })

browser.onmessage = (event) => {
  const message = JSON.parse(event.data)
  if (message.method === "Page.loadEventFired" && message.sessionId && pageLoadResolver) {
    const resolve = pageLoadResolver
    pageLoadResolver = null
    resolve()
    return
  }

  if (!message.id || !pending.has(message.id)) return
  const { resolve, reject } = pending.get(message.id)
  pending.delete(message.id)
  if (message.error) reject(new Error(JSON.stringify(message.error)))
  else resolve(message.result)
}

await new Promise((resolve, reject) => {
  browser.onopen = resolve
  browser.onerror = () => reject(new Error("Failed to connect to sandbox CDP"))
})

let targetId = null
let sessionId = null
let createdTarget = false

const cleanup = async () => {
  try {
    if (sessionId) {
      await send("Target.detachFromTarget", { sessionId })
    }
  } catch {}

  try {
    if (createdTarget && targetId) {
      await send("Target.closeTarget", { targetId })
    }
  } catch {}

  browser.close()
}

const normalizedTargetUrl = targetUrl.replace(/\\/$/, "")

const matchesTargetUrl = (info) => {
  if (!info || info.type !== "page" || typeof info.url !== "string") return false
  const normalizedInfoUrl = info.url.replace(/\\/$/, "")
  if (!normalizedTargetUrl) {
    return normalizedInfoUrl.startsWith("http://localhost:3000")
  }
  return (
    normalizedInfoUrl === normalizedTargetUrl ||
    normalizedInfoUrl.startsWith(normalizedTargetUrl) ||
    normalizedTargetUrl.startsWith(normalizedInfoUrl)
  )
}

try {
  const targetList = await send("Target.getTargets")
  const targetInfos = Array.isArray(targetList.targetInfos) ? targetList.targetInfos : []
  const existingTarget = targetInfos.find(matchesTargetUrl) || null

  if (existingTarget?.targetId) {
    targetId = existingTarget.targetId
    await send("Target.activateTarget", { targetId })
  } else {
    const created = await send("Target.createTarget", { url: targetUrl || "about:blank" })
    targetId = created.targetId
    createdTarget = true
  }

  const attached = await send("Target.attachToTarget", { targetId, flatten: true })
  sessionId = attached.sessionId

  await send("Page.enable", {}, sessionId)
  await send("Runtime.enable", {}, sessionId)
  await send("Page.bringToFront", {}, sessionId)

  if (createdTarget && targetUrl) {
    pageLoadResolver = () => {}
    const pageLoaded = new Promise((resolve) => {
      pageLoadResolver = resolve
    })
    await send("Page.navigate", { url: targetUrl }, sessionId)
    await Promise.race([pageLoaded, delay(10000)])
  }

  await delay(500)
  await send(
    "Runtime.evaluate",
    {
      expression: \`
        JSON.stringify({
          href: location.href,
          title: document.title,
          readyState: document.readyState,
          bodyTextLength: document.body?.innerText?.trim().length ?? 0,
          bodyScrollHeight: document.body?.scrollHeight ?? 0
        })
      \`,
      returnByValue: true,
      awaitPromise: true
    },
    sessionId
  )
  await delay(250)
  await send(
    "Runtime.evaluate",
    {
      expression: "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
      awaitPromise: true,
      returnByValue: true
    },
    sessionId
  )

  const screenshot = await send(
    "Page.captureScreenshot",
    {
      format: "png",
      fromSurface: true
    },
    sessionId
  )

  if (!screenshot?.data) {
    throw new Error("CDP screenshot returned no image data")
  }

  fs.writeFileSync(outputPath, Buffer.from(screenshot.data, "base64"))
  console.log(JSON.stringify({ success: true }))
  await cleanup()
} catch (error) {
  await cleanup()
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
`

  const result = await runSandboxCommandWithOptions(
    sandbox,
    {
      cmd: "node",
      args: ["--input-type=module", "-e", captureScript],
      env: {
        D3K_CDP_URL: cdpUrl,
        D3K_SCREENSHOT_PATH: screenshotPath,
        ...(targetUrl ? { D3K_TARGET_URL: targetUrl } : {})
      }
    },
    {
      timeoutMs: 20000
    }
  )

  if (result.exitCode !== 0) {
    return {
      success: false,
      error: result.stderr.trim() || result.stdout.trim() || "CDP screenshot command failed"
    }
  }

  return { success: true }
}

async function fetchWebVitalsFromDocumentStart(
  sandbox: Sandbox,
  targetUrl: string
): Promise<{ vitals: import("@/types").WebVitals | null; diagnosticLogs: string[] }> {
  const diagnosticLogs: string[] = []
  const diagLog = (msg: string) => {
    workflowLog(msg)
    diagnosticLogs.push(msg)
  }

  const { sessionPath, session } = await readLatestSandboxSession(sandbox)
  const cdpUrl = extractSandboxCdpUrl(session)
  if (!cdpUrl) {
    diagLog(
      `[fetchWebVitals] No sandbox CDP URL available${sessionPath ? ` in ${sessionPath}` : ""}; falling back to browser CLI capture`
    )
    return { vitals: null, diagnosticLogs }
  }

  const initScript = JSON.stringify(buildWebVitalsInitScript())
  const readScript = JSON.stringify(buildWebVitalsReadScript())
  const measureScript = `
const cdpUrl = process.env.D3K_CDP_URL
const targetUrl = process.env.D3K_TARGET_URL

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const gradeValue = (value, goodThreshold, needsImprovementThreshold) => {
  if (value <= goodThreshold) return "good"
  if (value <= needsImprovementThreshold) return "needs-improvement"
  return "poor"
}

const browser = new WebSocket(cdpUrl)
let nextId = 0
const pending = new Map()

const send = (method, params = {}, sessionId) =>
  new Promise((resolve, reject) => {
    const id = ++nextId
    pending.set(id, { resolve, reject })
    browser.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }))
  })

browser.onmessage = (event) => {
  const message = JSON.parse(event.data)
  if (!message.id || !pending.has(message.id)) return
  const { resolve, reject } = pending.get(message.id)
  pending.delete(message.id)
  if (message.error) reject(new Error(JSON.stringify(message.error)))
  else resolve(message.result)
}

await new Promise((resolve, reject) => {
  browser.onopen = resolve
  browser.onerror = () => reject(new Error("Failed to connect to sandbox CDP"))
})

const cleanup = async (targetId) => {
  try {
    if (targetId) {
      if (attachedToExistingTarget && sessionId) {
        await send("Target.detachFromTarget", { sessionId })
      } else {
        await send("Target.closeTarget", { targetId })
      }
    }
  } finally {
    browser.close()
  }
}

let targetId = null
let attachedToExistingTarget = false
let sessionId = null

try {
  const targetList = await send("Target.getTargets")
  const targetInfos = Array.isArray(targetList.targetInfos) ? targetList.targetInfos : []
  const normalizedTargetUrl = targetUrl.replace(/\\/$/, "")
  const existingTarget =
    targetInfos.find(
      (info) =>
        info?.type === "page" &&
        typeof info.url === "string" &&
        (info.url.replace(/\\/$/, "") === normalizedTargetUrl ||
          info.url.startsWith(normalizedTargetUrl) ||
          info.url.startsWith("http://localhost:3000"))
    ) || null

  if (existingTarget?.targetId) {
    targetId = existingTarget.targetId
    attachedToExistingTarget = true
    await send("Target.activateTarget", { targetId })
  } else {
    const target = await send("Target.createTarget", { url: "about:blank" })
    targetId = target.targetId
  }

  const attached = await send("Target.attachToTarget", { targetId, flatten: true })
  sessionId = attached.sessionId

  await send("Page.enable", {}, sessionId)
  await send("Runtime.enable", {}, sessionId)
  await send("Page.bringToFront", {}, sessionId)
  await send("Page.addScriptToEvaluateOnNewDocument", {
    source: ${initScript}
  }, sessionId)

  if (attachedToExistingTarget) {
    await send("Page.reload", { ignoreCache: true }, sessionId)
  } else {
    await send("Page.navigate", { url: targetUrl }, sessionId)
  }
  await delay(3000)

  const evalResult = await send(
    "Runtime.evaluate",
    {
      expression: ${readScript},
      returnByValue: true,
      awaitPromise: true
    },
    sessionId
  )

  const raw = JSON.parse(evalResult.result.value)
  const vitals = {}
  if (raw.lcp !== null) vitals.lcp = { value: raw.lcp, grade: gradeValue(raw.lcp, 2500, 4000) }
  if (raw.fcp !== null) vitals.fcp = { value: raw.fcp, grade: gradeValue(raw.fcp, 1800, 3000) }
  if (raw.ttfb !== null) vitals.ttfb = { value: raw.ttfb, grade: gradeValue(raw.ttfb, 800, 1800) }
  if (raw.cls !== null) vitals.cls = { value: raw.cls, grade: gradeValue(raw.cls, 0.1, 0.25) }
  if (raw.inp !== null) vitals.inp = { value: raw.inp, grade: gradeValue(raw.inp, 200, 500) }

  console.log(JSON.stringify({ vitals, raw, attachedToExistingTarget }))
  await cleanup(targetId)
} catch (error) {
  await cleanup(targetId)
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
`

  const result = await Promise.race([
    runSandboxCommandWithOptions(
      sandbox,
      {
        cmd: "node",
        args: ["--input-type=module", "-e", measureScript],
        env: {
          D3K_CDP_URL: cdpUrl,
          D3K_TARGET_URL: targetUrl
        }
      },
      {
        timeoutMs: 7000
      }
    ),
    new Promise<{ exitCode: number; stdout: string; stderr: string }>((resolve) =>
      setTimeout(
        () =>
          resolve({
            exitCode: 124,
            stdout: "",
            stderr: "Document-start CDP capture exceeded outer timeout"
          }),
        8000
      )
    )
  ])

  if (result.exitCode !== 0 || !result.stdout.trim()) {
    diagLog(
      `[fetchWebVitals] Document-start CDP capture failed: ${result.stderr.trim() || result.stdout.trim() || "no output"}`
    )
    return { vitals: null, diagnosticLogs }
  }

  try {
    const parsed = JSON.parse(result.stdout.trim()) as {
      vitals?: import("@/types").WebVitals
      raw?: Record<string, unknown>
    }
    diagLog(
      `[fetchWebVitals] Document-start CDP result: ${JSON.stringify(parsed.raw || parsed.vitals || {}).slice(0, 500)}`
    )
    return { vitals: parsed.vitals || {}, diagnosticLogs }
  } catch (error) {
    diagLog(
      `[fetchWebVitals] Failed to parse document-start CDP JSON: ${error instanceof Error ? error.message : String(error)}`
    )
    return { vitals: null, diagnosticLogs }
  }
}

async function readSandboxD3kLogs(sandbox: Sandbox): Promise<string> {
  const logReadScript = String.raw`
const fs = require("fs")
const path = require("path")

const baseDir = "/home/vercel-sandbox/.d3k"
const seen = new Set()
const logFiles = []

const addFile = (filePath) => {
  if (!filePath || seen.has(filePath) || !fs.existsSync(filePath)) return
  const stat = fs.statSync(filePath)
  if (!stat.isFile()) return
  seen.add(filePath)
  logFiles.push({ path: filePath, mtimeMs: stat.mtimeMs })
}

const addDirLogs = (dirPath) => {
  if (!dirPath || !fs.existsSync(dirPath)) return
  for (const entry of fs.readdirSync(dirPath)) {
    if (!entry.endsWith(".log")) continue
    addFile(path.join(dirPath, entry))
  }
}

let sessionPath = null
let session = null

if (fs.existsSync(baseDir)) {
  const sessionCandidates = []
  for (const entry of fs.readdirSync(baseDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const candidate = path.join(baseDir, entry.name, "session.json")
    if (fs.existsSync(candidate)) sessionCandidates.push(candidate)
  }
  sessionCandidates.sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs)
  sessionPath = sessionCandidates[0] || null
}

if (sessionPath) {
  try {
    session = JSON.parse(fs.readFileSync(sessionPath, "utf8"))
  } catch {}
}

if (session && typeof session.logFilePath === "string") {
  addFile(session.logFilePath)
  addDirLogs(path.dirname(session.logFilePath))
}

if (sessionPath) {
  const projectDir = path.dirname(sessionPath)
  addDirLogs(path.join(projectDir, "logs"))
  addFile(path.join(projectDir, "d3k.log"))
}

addDirLogs(path.join(baseDir, "logs"))

logFiles.sort((left, right) => left.mtimeMs - right.mtimeMs)

for (const file of logFiles) {
  try {
    process.stdout.write(fs.readFileSync(file.path, "utf8"))
    process.stdout.write("\n")
  } catch {}
}
`

  const logsResult = await runSandboxCommand(sandbox, "sh", ["-c", `node <<'NODE'\n${logReadScript}\nNODE`])
  return logsResult.stdout || ""
}

async function fetchClsData(sandbox: Sandbox): Promise<{
  clsScore: number | null
  clsGrade: "good" | "needs-improvement" | "poor" | null
  screenshots: Array<{ timestamp: number; blobUrl: string; label?: string }>
  d3kLogs: string
}> {
  const result = {
    clsScore: null as number | null,
    clsGrade: null as "good" | "needs-improvement" | "poor" | null,
    screenshots: [] as Array<{ timestamp: number; blobUrl: string; label?: string }>,
    d3kLogs: ""
  }

  try {
    // Read d3k logs for CLS from the active project session directory.
    result.d3kLogs = await readSandboxD3kLogs(sandbox)

    // Log diagnostic info about the log file
    workflowLog(`[fetchClsData] Log file size: ${result.d3kLogs.length} chars`)
    // Show last 500 chars of logs for debugging
    const logTail = result.d3kLogs.slice(-500)
    workflowLog(`[fetchClsData] Log tail: ${logTail.replace(/\n/g, "\\n").substring(0, 300)}...`)

    // CRITICAL: We need to determine CLS from the MOST RECENT page load.
    // When CLS = 0, there's NO "Detected X layout shifts" line - only "CLS observer installed".
    // So we need to:
    // 1. Find the LAST "CLS observer installed" entry (marks a new page load)
    // 2. Check if there are any "Detected X layout shifts" entries AFTER it
    // 3. If none, CLS = 0 (no shifts detected on that page load)

    const logs = result.d3kLogs

    // Find all timestamps for "CLS observer installed" (marks new page loads)
    const observerMatches = [...logs.matchAll(/\[(\d{2}:\d{2}:\d{2}\.\d{3})\].*CLS observer installed/g)]
    // Find all CLS detection entries with timestamps
    const clsMatches = [
      ...logs.matchAll(/\[(\d{2}:\d{2}:\d{2}\.\d{3})\].*\[CDP\] Detected (\d+) layout shifts \(CLS: ([\d.]+)\)/g)
    ]

    workflowLog(`[fetchClsData] Found ${observerMatches.length} observer installs, ${clsMatches.length} CLS entries`)

    if (observerMatches.length > 0) {
      const lastObserverTime = observerMatches[observerMatches.length - 1][1]
      workflowLog(`[fetchClsData] Last observer install at: ${lastObserverTime}`)

      // Find CLS entries AFTER the last observer install
      const clsAfterObserver = clsMatches.filter((m) => m[1] > lastObserverTime)
      workflowLog(`[fetchClsData] CLS entries after last observer: ${clsAfterObserver.length}`)

      if (clsAfterObserver.length > 0) {
        // Use the LAST CLS entry after the observer
        const lastCls = clsAfterObserver[clsAfterObserver.length - 1]
        result.clsScore = parseFloat(lastCls[3])
        result.clsGrade = result.clsScore <= 0.1 ? "good" : result.clsScore <= 0.25 ? "needs-improvement" : "poor"
        workflowLog(`[fetchClsData] CLS after observer: ${result.clsScore} (${result.clsGrade})`)
      } else {
        // No CLS detected after observer = CLS is 0!
        result.clsScore = 0
        result.clsGrade = "good"
        workflowLog("[fetchClsData] No CLS detected after observer install = CLS is 0! (GOOD)")
      }
    } else if (clsMatches.length > 0) {
      // Fallback: no observer found, use last CLS entry
      const lastCls = clsMatches[clsMatches.length - 1]
      result.clsScore = parseFloat(lastCls[3])
      result.clsGrade = result.clsScore <= 0.1 ? "good" : result.clsScore <= 0.25 ? "needs-improvement" : "poor"
      workflowLog(`[fetchClsData] Fallback - using LAST CLS: ${result.clsScore} (${result.clsGrade})`)
    } else {
      workflowLog("[fetchClsData] No CLS entries found in logs!")
    }

    // Screenshot capture is handled by d3k locally; no tools server in cloud.
  } catch (err) {
    workflowLog(`[fetchClsData] Error: ${err instanceof Error ? err.message : String(err)}`)
  }

  return result
}

/**
 * Fetch Web Vitals using the configured browser CLI.
 * This avoids any dependency on external tools services.
 */
async function fetchWebVitalsViaCDP(
  sandbox: Sandbox,
  targetUrl?: string,
  browserMode: CloudBrowserMode = "agent-browser",
  options?: {
    desiredSuccessfulSamples?: number
    overallTimeoutMs?: number
    browserStepTimeoutMs?: number
  }
): Promise<{ vitals: import("@/types").WebVitals; diagnosticLogs: string[] }> {
  const diagnosticLogs: string[] = []
  let documentStartVitals: import("@/types").WebVitals | null = null
  const desiredSuccessfulSamples = Math.max(1, options?.desiredSuccessfulSamples ?? 3)
  const overallTimeoutMs = options?.overallTimeoutMs ?? 18000
  const browserStepTimeoutMs = options?.browserStepTimeoutMs ?? 4000
  const captureStart = Date.now()

  // Helper to log and capture diagnostics
  const diagLog = (msg: string) => {
    workflowLog(msg)
    diagnosticLogs.push(msg)
  }

  // Helper to determine grade
  const gradeValue = (
    value: number,
    goodThreshold: number,
    needsImprovementThreshold: number
  ): "good" | "needs-improvement" | "poor" => {
    if (value <= goodThreshold) return "good"
    if (value <= needsImprovementThreshold) return "needs-improvement"
    return "poor"
  }

  const maxAttempts = Math.max(desiredSuccessfulSamples + 1, 4)
  let vitals: import("@/types").WebVitals = {}
  const successfulSamples: import("@/types").WebVitals[] = []

  const aggregateSamples = (samples: import("@/types").WebVitals[]): import("@/types").WebVitals => {
    const keys: Array<keyof import("@/types").WebVitals> = ["lcp", "fcp", "ttfb", "cls", "inp"]
    const aggregated: import("@/types").WebVitals = {}

    for (const key of keys) {
      const values = samples
        .map((sample) => sample[key]?.value)
        .filter((value): value is number => typeof value === "number")
      if (values.length === 0) continue

      const mean = values.reduce((sum, value) => sum + value, 0) / values.length
      const roundedValue = key === "cls" ? Number(mean.toFixed(4)) : Number(mean.toFixed(0))

      aggregated[key] = {
        value: roundedValue,
        grade:
          key === "cls"
            ? gradeValue(mean, 0.1, 0.25)
            : key === "fcp"
              ? gradeValue(mean, 1800, 3000)
              : key === "ttfb"
                ? gradeValue(mean, 800, 1800)
                : key === "inp"
                  ? gradeValue(mean, 200, 500)
                  : gradeValue(mean, 2500, 4000)
      }
    }

    return aggregated
  }

  if (targetUrl) {
    const documentStartResult = await fetchWebVitalsFromDocumentStart(sandbox, targetUrl)
    diagnosticLogs.push(...documentStartResult.diagnosticLogs)
    if (documentStartResult.vitals && Object.keys(documentStartResult.vitals).length > 0) {
      documentStartVitals = documentStartResult.vitals
      successfulSamples.push(documentStartVitals)
      diagLog(
        `[fetchWebVitals] Document-start candidate captured for ${targetUrl}: ${JSON.stringify(documentStartVitals)}`
      )
      diagLog(
        `[fetchWebVitals] Counting document-start candidate as sample ${successfulSamples.length}/${desiredSuccessfulSamples}`
      )
    }
  }

  for (let attempt = 1; attempt <= maxAttempts && Date.now() - captureStart < overallTimeoutMs; attempt++) {
    try {
      diagLog(
        `[fetchWebVitals] Capturing Web Vitals via ${browserMode} evaluate (attempt ${attempt}/${maxAttempts})...`
      )

      if (targetUrl) {
        diagLog(`[fetchWebVitals] Opening ${targetUrl} before capture`)
        const navResult = await navigateBrowser(sandbox, targetUrl, browserMode, false, browserStepTimeoutMs)
        diagLog(
          `[fetchWebVitals] Navigation result: success=${navResult.success}${navResult.error ? `, error=${navResult.error}` : ""}`
        )
        await new Promise((resolve) => setTimeout(resolve, 1000))

        const reloadResult = await reloadBrowser(sandbox, browserMode, false, browserStepTimeoutMs)
        diagLog(
          `[fetchWebVitals] Reload result: success=${reloadResult.success}${reloadResult.error ? `, error=${reloadResult.error}` : ""}`
        )
        await new Promise((resolve) => setTimeout(resolve, 1000))
      }

      const finalizeLcpScript = `
        document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        document.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        'lcp-finalized'
      `
      await evaluateInBrowser(sandbox, finalizeLcpScript, browserMode, false, browserStepTimeoutMs)
      await new Promise((resolve) => setTimeout(resolve, 250))

      await evaluateInBrowser(sandbox, buildWebVitalsInitScript(), browserMode, false, browserStepTimeoutMs)
      await new Promise((resolve) => setTimeout(resolve, 1000))

      const evalResult = await evaluateInBrowser(
        sandbox,
        buildWebVitalsReadScript(),
        browserMode,
        false,
        browserStepTimeoutMs
      )
      diagLog(`[fetchWebVitals] Eval result: ${JSON.stringify(evalResult).substring(0, 500)}`)

      if (!evalResult.success) {
        const errMessage = evalResult.error || ""
        if (
          targetUrl &&
          /Target page, context or browser has been closed|browserType\.launchPersistentContext/i.test(errMessage)
        ) {
          diagLog(`[fetchWebVitals] Browser context closed; reopening ${targetUrl} before retry`)
          const navResult = await navigateBrowser(sandbox, targetUrl, browserMode, false, browserStepTimeoutMs)
          diagLog(
            `[fetchWebVitals] Reopen navigation result: success=${navResult.success}${navResult.error ? `, error=${navResult.error}` : ""}`
          )
          await new Promise((resolve) => setTimeout(resolve, 1000))
          const reloadResult = await reloadBrowser(sandbox, browserMode, false, browserStepTimeoutMs)
          diagLog(
            `[fetchWebVitals] Reopen reload result: success=${reloadResult.success}${reloadResult.error ? `, error=${reloadResult.error}` : ""}`
          )
          await new Promise((resolve) => setTimeout(resolve, 1000))
        }
      }

      if (evalResult.success && evalResult.result) {
        let rawVitals: {
          lcp: number | null
          fcp: number | null
          ttfb: number | null
          cls: number
          inp: number | null
        } | null = null
        try {
          const resultStr = extractWebVitalsResultString(evalResult)
          if (resultStr) {
            rawVitals = JSON.parse(resultStr)
          }
        } catch (err) {
          diagLog(`[fetchWebVitals] Failed to parse result: ${err instanceof Error ? err.message : String(err)}`)
        }

        if (rawVitals) {
          const attemptVitals: import("@/types").WebVitals = {}
          if (rawVitals.lcp !== null) {
            attemptVitals.lcp = { value: rawVitals.lcp, grade: gradeValue(rawVitals.lcp, 2500, 4000) }
          }
          if (rawVitals.fcp !== null) {
            attemptVitals.fcp = { value: rawVitals.fcp, grade: gradeValue(rawVitals.fcp, 1800, 3000) }
          }
          if (rawVitals.ttfb !== null) {
            attemptVitals.ttfb = { value: rawVitals.ttfb, grade: gradeValue(rawVitals.ttfb, 800, 1800) }
          }
          // CLS should be reported as 0 when no shifts were detected.
          if (rawVitals.cls !== null) {
            attemptVitals.cls = { value: rawVitals.cls, grade: gradeValue(rawVitals.cls, 0.1, 0.25) }
          }
          if (rawVitals.inp !== null) {
            attemptVitals.inp = { value: rawVitals.inp, grade: gradeValue(rawVitals.inp, 200, 500) }
          }

          if (Object.keys(attemptVitals).length > 0) {
            successfulSamples.push(attemptVitals)
            diagLog(
              `[fetchWebVitals] Successful sample ${successfulSamples.length}/${desiredSuccessfulSamples}: ${JSON.stringify(attemptVitals)}`
            )
            if (successfulSamples.length >= desiredSuccessfulSamples) {
              break
            }
          }
        }
      }
    } catch (err) {
      diagLog(`[fetchWebVitals] Error: ${err instanceof Error ? err.message : String(err)}`)
    }

    if (attempt < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
  }

  if (Date.now() - captureStart >= overallTimeoutMs) {
    diagLog(`[fetchWebVitals] Reached overall timeout after ${overallTimeoutMs}ms; using best available evidence`)
  }

  if (successfulSamples.length > 0) {
    vitals = aggregateSamples(successfulSamples)
    diagLog(
      `[fetchWebVitals] Aggregated ${successfulSamples.length} sample${successfulSamples.length === 1 ? "" : "s"} into ${JSON.stringify(vitals)}`
    )
  }

  if (documentStartVitals && Object.keys(documentStartVitals).length > 0) {
    if (Object.keys(vitals).length === 0) {
      vitals = documentStartVitals
      diagLog("[fetchWebVitals] Active-browser capture unavailable; using document-start candidate")
    } else {
      const mergedVitals: import("@/types").WebVitals = {
        ...documentStartVitals,
        ...vitals
      }
      const reconciledCls = pickMoreCredibleCls(
        {
          value: vitals.cls?.value ?? null,
          grade: vitals.cls?.grade ?? null
        },
        {
          value: documentStartVitals.cls?.value ?? null,
          grade: documentStartVitals.cls?.grade ?? null
        }
      )
      if (reconciledCls.value !== null && reconciledCls.grade) {
        mergedVitals.cls = {
          value: reconciledCls.value,
          grade: reconciledCls.grade
        }
      }
      vitals = mergedVitals
      diagLog(
        `[fetchWebVitals] Reconciled active/document-start CLS: active=${vitals.cls?.value ?? "null"}, documentStart=${documentStartVitals.cls?.value ?? "null"}, chosen=${reconciledCls.value ?? "null"} (${reconciledCls.source ?? "none"})`
      )
    }
  }

  if (!vitals.cls) {
    const clsFallback = await fetchClsData(sandbox)
    if (clsFallback.clsScore !== null) {
      vitals.cls = {
        value: clsFallback.clsScore,
        grade:
          clsFallback.clsGrade ||
          (clsFallback.clsScore <= 0.1 ? "good" : clsFallback.clsScore <= 0.25 ? "needs-improvement" : "poor")
      }
      diagLog(`[fetchWebVitals] CLS fallback from d3k logs: ${clsFallback.clsScore} (${vitals.cls.grade})`)
    }
  }

  diagLog(`[fetchWebVitals] Final result: ${JSON.stringify(vitals)}`)
  return { vitals, diagnosticLogs }
}

// ============================================================
// CLEANUP
// ============================================================

export async function cleanupSandbox(sandboxId: string): Promise<void> {
  workflowLog(`[Cleanup] Stopping sandbox ${sandboxId}`)
  try {
    const sandbox = await Sandbox.get({ sandboxId })
    await sandbox.stop()
    workflowLog("[Cleanup] Sandbox stopped")
  } catch (err) {
    workflowLog(`[Cleanup] Error stopping sandbox: ${err instanceof Error ? err.message : String(err)}`)
  }
}

// ============================================================
// STEP 3: Create Pull Request
// ============================================================

/** Timing data for PR creation step */
export interface PRStepTiming {
  totalMs: number
  steps: { name: string; durationMs: number; startedAt: string }[]
}

export async function createPullRequestStep(
  sandboxId: string,
  githubPat: string,
  repoOwner: string,
  repoName: string,
  baseBranch: string,
  _projectName: string,
  beforeCls: number | null,
  afterCls: number | null,
  reportId: string,
  reportBlobUrl: string,
  workflowType: string | undefined,
  progressContext?: ProgressContext | null,
  prScreenshots?: Array<{ route: string; beforeBlobUrl: string | null; afterBlobUrl: string | null }>
): Promise<{ prUrl: string; prNumber: number; branch: string; timing: PRStepTiming } | { error: string } | null> {
  const timer = new StepTimer()

  workflowLog(`[PR] Creating PR for ${repoOwner}/${repoName}...`)
  await updateProgress(progressContext, 5, "Creating GitHub PR...")

  try {
    timer.start("Get sandbox")
    workflowLog(`[PR] Getting sandbox ${sandboxId}...`)
    const sandbox = await Sandbox.get({ sandboxId })
    workflowLog(`[PR] Sandbox status: ${sandbox.status}`)
    if (sandbox.status !== "running") {
      throw new Error(`Sandbox not running: ${sandbox.status}`)
    }

    const SANDBOX_CWD = "/vercel/sandbox"
    const workflowKind = workflowType || "cls-fix"
    const branchPrefix =
      workflowKind === "turbopack-bundle-analyzer"
        ? "turbopack-bundle"
        : workflowKind === "react-performance"
          ? "react-performance"
          : workflowKind === "design-guidelines"
            ? "design-guidelines"
            : "cls-fix"
    const branchName = `d3k/${branchPrefix}-${Date.now()}`

    // Configure git user (required for commits)
    timer.start("Configure git")
    workflowLog(`[PR] Configuring git user...`)
    const gitConfigResult = await runSandboxCommand(sandbox, "sh", [
      "-c",
      `cd ${SANDBOX_CWD} && git config user.email "d3k-bot@vercel.com" && git config user.name "d3k bot"`
    ])
    workflowLog(`[PR] Git config result: exit=${gitConfigResult.exitCode}`)

    // Create and checkout new branch
    timer.start("Create branch")
    workflowLog(`[PR] Creating branch: ${branchName}`)
    const branchResult = await runSandboxCommand(sandbox, "sh", [
      "-c",
      `cd ${SANDBOX_CWD} && git checkout -b "${branchName}"`
    ])
    if (branchResult.exitCode !== 0) {
      workflowLog(`[PR] Failed to create branch: ${branchResult.stderr}`)
      return { error: `Failed to create branch: ${branchResult.stderr || branchResult.stdout}` }
    }

    // Stage all changes (excluding package manager lock files which may have been modified)
    timer.start("Stage and commit")
    await runSandboxCommand(sandbox, "sh", [
      "-c",
      `cd ${SANDBOX_CWD} && git add -A && git reset -- package-lock.json pnpm-lock.yaml yarn.lock 2>/dev/null || true`
    ])

    type ReportPrContext = {
      agentAnalysis?: string
      workflowType?: string
      turbopackBundleComparison?: {
        delta?: {
          compressedBytes?: number
          compressedPercent?: number | null
          rawBytes?: number
          rawPercent?: number | null
        }
      }
    }
    let reportContext: ReportPrContext | null = null
    try {
      reportContext = await readBlobJson<ReportPrContext>(reportBlobUrl)
    } catch {
      reportContext = null
    }

    const effectiveWorkflowType = reportContext?.workflowType || workflowKind
    const turbos = reportContext?.turbopackBundleComparison?.delta

    // Create commit message
    const commitMessage =
      effectiveWorkflowType === "turbopack-bundle-analyzer"
        ? `perf: optimize turbopack bundle size

Automated Turbopack bundle optimization by d3k

🤖 Generated with d3k (https://d3k.dev)`
        : `fix: ${
            typeof beforeCls === "number" && typeof afterCls === "number"
              ? `CLS ${beforeCls.toFixed(3)} → ${afterCls.toFixed(3)}`
              : "CLS improvements"
          }

Automated fix by d3k

🤖 Generated with d3k (https://d3k.dev)`

    // Commit changes
    workflowLog("[PR] Committing changes...")
    const commitResult = await runSandboxCommand(sandbox, "sh", [
      "-c",
      `cd ${SANDBOX_CWD} && git commit -m '${commitMessage.replace(/'/g, "'\\''")}'`
    ])
    if (commitResult.exitCode !== 0) {
      workflowLog(`[PR] Failed to commit: ${commitResult.stderr}`)
      return { error: `Failed to commit: ${commitResult.stderr || commitResult.stdout}` }
    }

    // Configure git to use PAT for authentication
    // Use the PAT in the remote URL for pushing
    const authUrl = `https://x-access-token:${githubPat}@github.com/${repoOwner}/${repoName}.git`

    // Push to GitHub
    timer.start("Push to GitHub")
    workflowLog("[PR] Pushing to GitHub...")
    const pushResult = await runSandboxCommand(sandbox, "sh", [
      "-c",
      `cd ${SANDBOX_CWD} && git push "${authUrl}" "${branchName}" 2>&1`
    ])
    if (pushResult.exitCode !== 0) {
      workflowLog(`[PR] Failed to push: ${pushResult.stderr || pushResult.stdout}`)
      return { error: `Failed to push: ${pushResult.stderr || pushResult.stdout}` }
    }

    // Create PR via GitHub API
    timer.start("Create PR via GitHub API")
    workflowLog("[PR] Creating pull request...")
    const prTitle =
      effectiveWorkflowType === "turbopack-bundle-analyzer"
        ? `perf(turbopack): optimize bundle size`
        : `fix(cls): reduce layout shift (${beforeCls?.toFixed(3) || "?"} → ${afterCls?.toFixed(3) || "?"})`

    // Build visual comparison section if screenshots available
    let visualComparisonSection = ""
    if (prScreenshots && prScreenshots.length > 0) {
      const screenshotRows = prScreenshots
        .map((s) => {
          const beforeImg = s.beforeBlobUrl ? `![Before](${s.beforeBlobUrl})` : "_New page_"
          const afterImg = s.afterBlobUrl ? `![After](${s.afterBlobUrl})` : "_Failed_"
          return `| \`${s.route}\` | ${beforeImg} | ${afterImg} |`
        })
        .join("\n")

      visualComparisonSection = `

### Visual Comparison
| Route | Before | After |
|-------|--------|-------|
${screenshotRows}
`
    }

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://dev3000.ai"
    const reportPageUrl = `${siteUrl}/dev-agents/runs/${reportId}/report`

    const extractFinalOutputSummary = (analysis?: string): string[] => {
      if (!analysis) return []
      const match = analysis.match(/## Final Output\s+([\s\S]*)$/)
      const raw = (match?.[1] || "").replace(/```[\s\S]*?```/g, "").trim()
      if (!raw) return []
      return raw
        .split("\n")
        .map((line) =>
          line
            .trim()
            .replace(/^[-*]\s+/, "")
            .replace(/^\d+\.\s+/, "")
        )
        .filter(Boolean)
        .filter((line) => !line.startsWith("#"))
        .slice(0, 4)
    }
    const summaryLines = extractFinalOutputSummary(reportContext?.agentAnalysis)
    const shortSummary =
      summaryLines.length > 0
        ? summaryLines.map((line) => `- ${line}`).join("\n")
        : "- See workflow report for full transcript and evidence."

    const workflowHeading =
      effectiveWorkflowType === "turbopack-bundle-analyzer"
        ? "Turbopack Bundle Analyzer Improvements"
        : "CLS Improvements"
    const resultsSection =
      effectiveWorkflowType === "turbopack-bundle-analyzer"
        ? `### Results
| Metric | Delta |
|--------|-------|
| Compressed JS | ${typeof turbos?.compressedBytes === "number" ? `${(turbos.compressedBytes / 1024).toFixed(1)} KB` : "unknown"} (${typeof turbos?.compressedPercent === "number" ? `${turbos.compressedPercent.toFixed(2)}%` : "unknown"}) |
| Raw JS | ${typeof turbos?.rawBytes === "number" ? `${(turbos.rawBytes / 1024).toFixed(1)} KB` : "unknown"} (${typeof turbos?.rawPercent === "number" ? `${turbos.rawPercent.toFixed(2)}%` : "unknown"}) |`
        : `### Results
| Metric | Before | After |
|--------|--------|-------|
| CLS Score | ${beforeCls?.toFixed(3) || "unknown"} | ${afterCls?.toFixed(3) || "unknown"} |`

    const prBody = `## ${workflowHeading}

${resultsSection}
${visualComparisonSection}
### Summary
${shortSummary}

### Workflow Report
- Report page: ${reportPageUrl}
- Report JSON: ${reportBlobUrl}

---
Generated by [d3k](https://d3k.dev)`

    const prResponse = await fetch(`https://api.github.com/repos/${repoOwner}/${repoName}/pulls`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${githubPat}`,
        Accept: "application/vnd.github.v3+json",
        "Content-Type": "application/json",
        "User-Agent": "d3k-workflow"
      },
      body: JSON.stringify({
        title: prTitle,
        body: prBody,
        head: branchName,
        base: baseBranch
      })
    })

    if (!prResponse.ok) {
      const errorText = await prResponse.text()
      workflowLog(`[PR] GitHub API error: ${prResponse.status} - ${errorText}`)
      return { error: `GitHub API error ${prResponse.status}: ${errorText}` }
    }

    const prData = (await prResponse.json()) as { html_url: string; number: number }
    workflowLog(`[PR] Created: ${prData.html_url}`)
    await updateProgress(progressContext, 5, `PR created: #${prData.number}`)

    // Update the report blob to include the PR URL
    timer.start("Update report with PR URL")
    try {
      workflowLog(`[PR] Updating report ${reportId} with PR URL...`)
      const report = await readBlobJson<Record<string, unknown>>(reportBlobUrl)
      if (report) {
        report.prUrl = prData.html_url

        // Re-upload the updated report
        await putBlobAndBuildUrl(`report-${reportId}.json`, JSON.stringify(report, null, 2), {
          contentType: "application/json",
          addRandomSuffix: false,
          allowOverwrite: true,
          absoluteUrl: true
        })
        workflowLog(`[PR] Report updated with PR URL`)
      } else {
        workflowLog(`[PR] Could not fetch report to update`)
      }
    } catch (reportErr) {
      workflowLog(
        `[PR] Failed to update report with PR URL: ${reportErr instanceof Error ? reportErr.message : String(reportErr)}`
      )
      // Don't fail the whole step, PR was still created successfully
    }

    timer.end()

    // Log timing breakdown
    const timingData = timer.getData()
    workflowLog(`[PR] ⏱️ TIMING BREAKDOWN (total: ${(timingData.totalMs / 1000).toFixed(1)}s)`)
    for (const step of timingData.steps) {
      const secs = (step.durationMs / 1000).toFixed(1)
      const pct = ((step.durationMs / timingData.totalMs) * 100).toFixed(0)
      workflowLog(`[PR]   ${step.name}: ${secs}s (${pct}%)`)
    }

    return {
      prUrl: prData.html_url,
      prNumber: prData.number,
      branch: branchName,
      timing: timingData
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    workflowLog(`[PR] Error: ${errorMsg}`)
    return { error: `Exception: ${errorMsg}` }
  }
}

// ============================================================
// Screenshot Capture for PR
// ============================================================

/**
 * Capture before/after screenshots for routes affected by the PR.
 * - Gets changed files from git diff
 * - Maps them to URL routes
 * - Screenshots production (before) and localhost (after)
 * - Uploads to blob storage for PR embedding
 */
export async function captureScreenshotsForPRStep(
  sandboxId: string,
  productionUrl: string,
  localhostUrl: string,
  projectName: string,
  _progressContext?: ProgressContext | null
): Promise<Array<{ route: string; beforeBlobUrl: string | null; afterBlobUrl: string | null }>> {
  workflowLog(`[Screenshots] Capturing before/after screenshots...`)
  workflowLog(`[Screenshots] Production: ${productionUrl}`)
  workflowLog(`[Screenshots] Localhost: ${localhostUrl}`)

  try {
    // Get sandbox
    const sandbox = await Sandbox.get({ sandboxId })
    if (sandbox.status !== "running") {
      workflowLog(`[Screenshots] Sandbox not running: ${sandbox.status}`)
      return []
    }

    // Get changed files from git
    const SANDBOX_CWD = "/vercel/sandbox"
    const diffResult = await runSandboxCommand(sandbox, "sh", ["-c", `cd ${SANDBOX_CWD} && git diff --name-only HEAD`])

    if (diffResult.exitCode !== 0) {
      workflowLog(`[Screenshots] Failed to get git diff: ${diffResult.stderr}`)
      return []
    }

    const changedFiles = diffResult.stdout.trim().split("\n").filter(Boolean)
    workflowLog(`[Screenshots] Changed files: ${changedFiles.length}`)

    if (changedFiles.length === 0) {
      return []
    }

    // Map files to routes
    const { mapFilesToRoutes, filterPageRoutes } = await import("@/lib/file-to-route")
    const routeMappings = mapFilesToRoutes(changedFiles)
    const routes = filterPageRoutes(routeMappings, 3)

    workflowLog(`[Screenshots] Routes to capture: ${routes.join(", ") || "(none)"}`)

    if (routes.length === 0) {
      return []
    }

    // Capture screenshots
    const { captureBeforeAfterScreenshots } = await import("@/lib/cloud/pr-screenshot-service")
    const screenshots = await captureBeforeAfterScreenshots({
      sandbox,
      productionUrl,
      localhostUrl,
      routes,
      projectName
    })

    workflowLog(`[Screenshots] Captured ${screenshots.length} screenshot set(s)`)
    return screenshots
  } catch (err) {
    workflowLog(`[Screenshots] Error: ${err instanceof Error ? err.message : String(err)}`)
    return []
  }
}

// ============================================================
// Prompt Builders
// ============================================================

/**
 * Build the CLS-specific system prompt (default for cls-fix workflow type)
 */
function _buildClsFixPrompt(
  beforeCls: number | null,
  beforeGrade: "good" | "needs-improvement" | "poor" | null,
  startPath: string
): string {
  return `You are a CLS fix specialist. Fix the layout shift issue efficiently.

## FIRST STEP - LOAD THE SKILL

**IMPORTANT:** Before doing anything else, call the \`get_skill\` tool to load the d3k skill:

\`\`\`
get_skill({ name: "d3k" })
\`\`\`

## CRITICAL: You MUST write a fix!
Your goal is to WRITE CODE that fixes the CLS issue, not just analyze it.
You have limited steps - be efficient and focused.

## Workflow (5-7 steps max):
1. **Load skill** - Call \`get_skill({ name: "d3k" })\`
2. **diagnose** - See what's shifting (1 step)
3. **Find code** - Search for the shifting element in code (1-2 steps)
4. **writeFile** - FIX THE CODE (1 step) ← THIS IS REQUIRED!
5. **diagnose** - Verify fix worked (1 step)

## CLS Fix Patterns (use these!):
- Conditional rendering causing shift → Use \`visibility: hidden\` instead of \`return null\`
- Delayed content appearing → Reserve space with min-height or fixed dimensions
- Elements shifting down → Add height/min-height from initial render
- Images without dimensions → Add explicit width/height

## Example Fix:
BEFORE (causes CLS):
\`\`\`tsx
if (!show) return null
return <div style={{height: '200px'}}>Content</div>
\`\`\`

AFTER (no CLS):
\`\`\`tsx
return <div style={{height: '200px', visibility: show ? 'visible' : 'hidden'}}>Content</div>
\`\`\`

## Current Status
Before CLS: ${beforeCls?.toFixed(4) || "unknown"} (${beforeGrade || "unknown"})
Target: CLS ≤ 0.1 (GOOD)
Page: ${startPath}

Start with diagnose, then QUICKLY find and fix the code. Do not over-analyze!`
}

/**
 * Build system prompt for the design-guidelines workflow type
 * This instructs the agent to use the get_skill tool to load the vercel-design-guidelines skill
 */
function _buildDesignGuidelinesPrompt(startPath: string, devUrl: string, crawlDepth?: number | "all"): string {
  // Determine if we should crawl multiple pages
  const shouldCrawl = crawlDepth && crawlDepth !== 1
  const crawlInstructions = shouldCrawl
    ? `
## MULTI-PAGE CRAWL MODE

You are in **multi-page crawl mode** with depth=${crawlDepth}. This means you should audit MULTIPLE pages, not just the start page.

### Crawl Workflow:
1. **FIRST: Use crawl_app** - Run \`crawl_app\` with depth=${crawlDepth} to discover all pages on the site
2. **Review the discovered URLs** - The crawl_app tool returns a list of all pages found
3. **Audit each important page** - Read the code and check against the design guidelines
4. **Aggregate findings** - Combine issues from all pages before fixing
5. **Fix common issues first** - Issues appearing on multiple pages (like global CSS, layout, nav) should be fixed first

`
    : ""

  return `You are a design guidelines auditor. Your task is to evaluate this web interface against Vercel's design guidelines and implement fixes.

## FIRST STEP - LOAD THE SKILLS

**IMPORTANT:** Before doing anything else, you MUST call the \`get_skill\` tool to load the d3k skill and the design-guidelines skill:

\`\`\`
get_skill({ name: "d3k" })
get_skill({ name: "vercel-design-guidelines" })
\`\`\`

This will give you the complete design guidelines audit instructions, including:
- All audit categories (Interactions, Animations, Layout, Content, Forms, Performance, Design, Copywriting)
- Severity levels (Critical, Warning, Suggestion)
- Quick checklist of high-impact items
- Output format for reporting issues
- Example violations and fixes

${crawlInstructions}
## YOUR MISSION

${shouldCrawl ? `1. **Load skills** - Call \`get_skill({ name: "d3k" })\` then \`get_skill({ name: "vercel-design-guidelines" })\`` : '1. **Load skills** - Call `get_skill({ name: "d3k" })` then `get_skill({ name: "vercel-design-guidelines" })`'}
${shouldCrawl ? `2. **Use crawl_app** to discover all pages on the site (depth=${crawlDepth})` : ""}
${shouldCrawl ? "3" : "2"}. **Read the code** - Use readFile, globSearch to examine components, styles, HTML
${shouldCrawl ? "4" : "3"}. **Audit against guidelines** - Check each category, note violations with file:line references
${shouldCrawl ? "5" : "4"}. **IMPLEMENT FIXES** - Write code to fix Critical issues first, then Warnings
${shouldCrawl ? "6" : "5"}. **Verify** - Use diagnose to confirm changes work
${shouldCrawl ? "7" : "6"}. **Document** - Track what you fixed in your summary

## AVAILABLE TOOLS

### Skill Tool (USE THIS FIRST!)
- **get_skill** - Load a d3k skill to get detailed instructions. Call with \`{ name: "d3k" }\` then \`{ name: "vercel-design-guidelines" }\`
${
  shouldCrawl
    ? `
### Site Crawler (USE AFTER LOADING SKILL!)
- **crawl_app** - Crawls the site to discover all pages.
`
    : ""
}
### Code Tools
- **readFile** - Read any file in the codebase
- **writeFile** - Create or modify files (HMR applies changes immediately)
- **globSearch** - Find files by pattern (e.g., "**/*.tsx", "layout.*")
- **grepSearch** - Search file contents for patterns
- **listDir** - List directory contents
- **gitDiff** - See your changes

### Browser Tools
- **diagnose** - Navigate and get CLS measurements + screenshots
- **getWebVitals** - Get all Core Web Vitals (LCP, FCP, TTFB, CLS, INP)

## IMPORTANT RULES

1. **START by calling get_skill({ name: "d3k" }) then get_skill({ name: "vercel-design-guidelines" })**${
    shouldCrawl ? ", then crawl_app" : ""
  }
2. **YOU MUST WRITE CODE** - Don't just analyze, actually fix issues!
3. **Prioritize Critical issues first** - Then Warnings, then Suggestions
4. **Be efficient** - You have limited steps (15 max), focus on high-impact fixes
5. **Verify your fixes** - Run diagnose after making changes

## DEVELOPMENT ENVIRONMENT
- **App URL**: ${devUrl}
- **Start Page**: ${startPath}
- **Working Directory**: /vercel/sandbox
${shouldCrawl ? `- **Crawl Depth**: ${crawlDepth}` : ""}

${shouldCrawl ? `Start by calling get_skill to load the d3k skill and design guidelines, then use crawl_app to discover all pages.` : `Start by calling get_skill({ name: "d3k" }) then get_skill({ name: "vercel-design-guidelines" }) to load the full design guidelines, then read the code and audit it.`}`
}

/**
 * Build system prompt for the react-performance workflow type
 * This instructs the agent to use the get_skill tool to load the react-performance skill
 */
function _buildReactPerformancePrompt(startPath: string, devUrl: string): string {
  return `You are a React/Next.js performance optimization specialist. Your task is to analyze this codebase for performance issues and implement fixes.

## FIRST STEP - LOAD THE SKILLS

**IMPORTANT:** Before doing anything else, you MUST call the \`get_skill\` tool to load the d3k skill and the react-performance skill:

\`\`\`
get_skill({ name: "d3k" })
get_skill({ name: "react-performance" })
\`\`\`

This will give you the complete React Performance Guidelines, including:
- Eliminating waterfalls (CRITICAL - 2-10x improvement)
- Bundle size optimization (CRITICAL)
- Server-side performance (HIGH impact)
- Client-side data fetching (MEDIUM-HIGH)
- Re-render optimization (MEDIUM)
- Rendering performance (MEDIUM)
- JavaScript micro-optimizations (LOW-MEDIUM)
- Advanced patterns (LOW)

## YOUR MISSION

1. **Load skills** - Call \`get_skill({ name: "d3k" })\` then \`get_skill({ name: "react-performance" })\`
2. **Capture baseline** - Use \`getWebVitals\` to measure current performance
3. **Analyze code** - Use readFile, globSearch to examine components, data fetching, imports
4. **Identify issues** - Check for waterfalls, large bundles, unnecessary re-renders
5. **IMPLEMENT FIXES** - Write code to fix high-impact issues first
6. **Verify** - Use getWebVitals to confirm improvements
7. **Document** - Track what you optimized in your summary

## AVAILABLE TOOLS

### Skill Tool (USE THIS FIRST!)
- **get_skill** - Load a d3k skill to get detailed instructions. Call with \`{ name: "d3k" }\` then \`{ name: "react-performance" }\`

### Code Tools
- **readFile** - Read any file in the codebase
- **writeFile** - Create or modify files (HMR applies changes immediately)
- **globSearch** - Find files by pattern (e.g., "**/*.tsx", "layout.*")
- **grepSearch** - Search file contents for patterns
- **listDir** - List directory contents
- **gitDiff** - See your changes

### Performance Tools
- **getWebVitals** - Get all Core Web Vitals (LCP, FCP, TTFB, CLS, INP)
- **diagnose** - Navigate and get CLS measurements + screenshots

## HIGH-IMPACT PATTERNS TO LOOK FOR

1. **Sequential awaits** → Use Promise.all() for independent operations
2. **Large imports** → Use dynamic imports with next/dynamic
3. **Missing memoization** → Add React.memo, useMemo, useCallback where needed
4. **Prop drilling objects** → Narrow to specific fields to prevent re-renders
5. **Client-side fetching without SWR** → Add deduplication with SWR

## IMPORTANT RULES

1. **START by calling get_skill({ name: "d3k" }) then get_skill({ name: "react-performance" })**
2. **YOU MUST WRITE CODE** - Don't just analyze, actually implement fixes!
3. **Prioritize by impact** - CRITICAL issues first (waterfalls, bundles), then lower
4. **Be efficient** - You have limited steps (15 max), focus on high-impact fixes
5. **Verify with getWebVitals** - Run after making changes to measure improvement

## DEVELOPMENT ENVIRONMENT
- **App URL**: ${devUrl}
- **Start Page**: ${startPath}
- **Working Directory**: /vercel/sandbox

Start by calling get_skill({ name: "d3k" }) then get_skill({ name: "react-performance" }) to load the full performance guidelines, then use getWebVitals to capture baseline metrics.`
}

/**
 * Build system prompt for the turbopack-bundle-analyzer workflow type.
 */
function _buildTurbopackBundleAnalyzerPrompt(startPath: string, devUrl: string): string {
  return `You are a Turbopack bundle optimization specialist.

Your only mission is to reduce bundle size and improve load performance by reducing shipped JavaScript.
Do not pursue unrelated goals.

## FIRST STEP - LOAD THE SKILL

Before doing anything else, call:
\`\`\`
get_skill({ name: "d3k" })
get_skill({ name: "analyze-bundle" })
\`\`\`

## ANALYSIS WORKFLOW
1. Inspect NDJSON files at \`.next/diagnostics/analyze/ndjson/\`:
   - \`routes.ndjson\`
   - \`sources.ndjson\`
   - \`output_files.ndjson\`
   - \`module_edges.ndjson\`
   - \`modules.ndjson\`
2. Identify highest-impact shipped-JS problems from analyzer evidence.
3. Implement code changes that reduce bundle size.
4. Do minimal smoke checks only to ensure no regressions.
5. Explain expected bundle impact and tradeoffs from your code changes with analyzer evidence.
6. Do not manually run analyzer build commands; workflow runtime performs post-change analyzer rerun and computes before/after deltas.

## RULES
- You are expected to make code changes when clear optimization opportunities exist.
- If no safe bundle improvement is found, make no code changes and explain why with analyzer evidence.
- Be explicit about confidence and uncertainty.
- Prefer optimizations that reduce JavaScript shipped, duplicate modules, and initial route payload.
- Use \`runProjectCommand\` only for minimal smoke checks (for example lint/typecheck/sanity checks), not analyzer reruns.
- Forbidden unless directly tied to bundle-size reduction: styling/UX fixes, CLS-only fixes, accessibility audits, copy/content edits, and general cleanup refactors.

## ENVIRONMENT
- App URL: ${devUrl}
- Start Path: ${startPath}
- Working Directory: /vercel/sandbox
`
}

/**
 * Build an enhanced system prompt that wraps the user's custom instructions
 * with d3k tooling guidance and best practices
 */
function _buildEnhancedPrompt(userPrompt: string, startPath: string, devUrl: string): string {
  return `You are an AI developer assistant with access to a live development environment.
You can make changes to the codebase and see results in real-time.

## YOUR TASK
${userPrompt}

## DEVELOPMENT ENVIRONMENT
- **App URL**: ${devUrl}
- **Start Page**: ${startPath}
- **Working Directory**: /vercel/sandbox (this is a git repository)

## AVAILABLE TOOLS

### Skill Tool (USE THIS FIRST!)
- **get_skill** - Load a d3k skill to get detailed instructions. Call with \`{ name: "d3k" }\`

### Code Tools
- **readFile** - Read any file in the codebase
- **writeFile** - Create or modify files (changes are applied immediately via Hot Module Replacement)
- **searchFiles** - Search for files by glob pattern (e.g., "**/*.tsx")
- **grep** - Search file contents for text patterns
- **listDir** - List directory contents
- **gitDiff** - See your changes so far

### Browser & Debugging Tools
- **diagnose** - Navigate to the page and get CLS (layout shift) measurements
  Use this for CLS-specific debugging
- **getWebVitals** - Get all Core Web Vitals performance metrics:
  - LCP (Largest Contentful Paint) - loading performance
  - FCP (First Contentful Paint) - initial render time
  - TTFB (Time to First Byte) - server response time
  - CLS (Cumulative Layout Shift) - visual stability
  - INP (Interaction to Next Paint) - interactivity
  Use this for performance optimization tasks!

## WORKFLOW GUIDELINES

1. **Start by loading the d3k skill** - Call \`get_skill({ name: "d3k" })\`
2. **Start with getWebVitals or diagnose** - Capture the initial performance metrics
3. **Explore first** - Use readFile, searchFiles, and grep to understand the codebase
4. **Make targeted changes** - Edit only what's necessary
5. **Verify with diagnose** - After changes, use diagnose to confirm they work
6. **Be efficient** - You have limited steps, so be focused

## IMPORTANT NOTES
- Changes are saved immediately when you use writeFile
- Hot Module Replacement (HMR) applies changes without full page reload
- Always use diagnose after making changes to capture the "after" state
- The diagnose tool will show you any console errors or layout shifts

Now, complete the task described above. Start by calling get_skill({ name: "d3k" }) and then use diagnose to capture the current state of the page.`
}
