# Code-to-Execution Attribution: Implementation Log

## Project Goal
Connect developer code authorship to production execution data to enable:
1. Performance review attribution ("Engineer X's code handled Y requests")
2. (Future) AI-generated code efficacy validation for model providers

## Target Project
- **Repo**: `vercel-labs/dev3000/www`
- **Stack**: Next.js 16 (App Router, canary.100), bun, TypeScript
- **Infra**: Vercel-only (Blob already in use, KV2 for future aggregation)

---

## Implementation Steps

### Legend
- 🔧 **Code Change**: Requires modifying application code
- ⚙️ **Vercel Config**: Requires Vercel dashboard/project settings
- 🖥️ **CLI Available**: Can be done via `vercel` CLI
- 🚫 **No CLI**: Must use dashboard (friction point for automation)
- 📊 **Data Source**: Where we pull data from

---

## Phase 1: Server-Side OTEL Instrumentation

### 1.1 Install OTEL Dependencies
- **Type**: 🔧 Code Change
- **Status**: [x] Complete
- **Commands**:
  ```bash
  bun add @vercel/otel @opentelemetry/api
  ```
- **Notes**: Uses bun (not npm) per project's packageManager field. `@vercel/otel` wraps the full OTEL SDK and auto-configures the Vercel OTLP exporter.

### 1.2 Create Instrumentation File
- **Type**: 🔧 Code Change
- **Status**: [x] Complete
- **File**: `instrumentation.ts` (project root)
- **What it does**:
  - Calls `registerOTel({ serviceName: "dev3000-www" })`
  - Attaches `deployment.environment`, `git.commit.sha`, `git.commit.ref` as resource attributes on every span
  - These attributes come from Vercel's build-time env vars (`VERCEL_ENV`, `VERCEL_GIT_COMMIT_SHA`, `VERCEL_GIT_COMMIT_REF`)
- **Notes**: Next.js 13.4+ has native `register()` hook in `instrumentation.ts`. No special config needed in Next 15+; the file is auto-detected.

### 1.3 Configure Next.js for Instrumentation
- **Type**: 🔧 Code Change
- **Status**: [x] Complete
- **File**: `next.config.ts`
- **Change**: Added `instrumentationHook: true` to `experimental` block
- **Notes**: On Next.js 16 canary this may already be the default, but explicit is safer for now. Can remove once stable.

### 1.4 Enable OTEL on Vercel Project
- **Type**: No config needed — auto-enabled
- **Status**: [x] Complete (no action required)
- **How it works**: Vercel detects `@vercel/otel` + `instrumentation.ts` at deploy time and starts collecting traces automatically. There is no dashboard toggle.
- **Viewing traces**: Enable **Session Tracing** via the Vercel Toolbar in your browser, then go to Logs → use the tracing filter icon. Traces are also available via Log Drains (Datadog, Dash0) with trace/span ID correlation.
- **Previous note was wrong**: There is no "Enable OpenTelemetry" toggle in Project Settings. The original log entry was based on outdated information.

### 1.5 Add Custom Spans for Key Code Paths
- **Type**: 🔧 Code Change
- **Status**: [x] Complete
- **Files created**:
  - `lib/tracing.ts` — Core tracing utilities
- **Files modified**:
  - `app/api/workflows/route.ts` — GET and DELETE handlers wrapped
  - `app/api/dev-agents/route.ts` — GET handler wrapped
- **Utilities provided**:
  - `withSpan(name, fn)` — Simple span wrapper for any async function
  - `withAttributedSpan({ name, file, fn, lines? }, callback)` — Span with source-code attribution metadata (`code.filepath`, `code.function`, `code.lineno`, `vcs.commit.sha`, `vcs.branch`)
  - `addAttribution(span, { file, fn, lines? })` — Attach attribution to an existing span
- **Pattern**: Every API route handler gets wrapped in `withAttributedSpan` with its file path and function name. These attributes are what Phase 4's git-blame join will key on.

---

## Phase 2: Frontend OTEL (Browser)

### 2.1 Install Browser OTEL SDK
- **Type**: 🔧 Code Change
- **Status**: [x] Complete
- **Commands**:
  ```bash
  bun add @opentelemetry/sdk-trace-web @opentelemetry/exporter-trace-otlp-http @opentelemetry/instrumentation-document-load @opentelemetry/instrumentation-fetch @opentelemetry/instrumentation @opentelemetry/resources @opentelemetry/semantic-conventions
  ```
- **Notes**: These are all peer dependencies of the browser OTEL SDK. `@opentelemetry/api` is already installed from Phase 1.

### 2.2 Create Browser Tracing Provider
- **Type**: 🔧 Code Change
- **Status**: [x] Complete
- **Files created**:
  - `lib/browser-tracing.ts` — Initializes WebTracerProvider with auto-instrumentations
  - `app/tracing.client.tsx` — "use client" component that lazy-loads browser tracing via dynamic import
- **What it does**:
  - Auto-instruments document load metrics (LCP, FCP, TTFB via document-load instrumentation)
  - Auto-instruments all fetch() calls (with W3C trace context propagation to same-origin /api/ routes)
  - Batches spans (5s interval, max 10 per batch) and exports via OTLP JSON to `/api/traces`
  - Ignores `/api/traces` requests to avoid infinite trace loops
  - Exposes `getBrowserTracer()` for manual span creation in client components
- **Notes**: Lazy-loaded in useEffect to avoid SSR issues and keep initial JS bundle small.

### 2.3 Configure OTEL Exporter Endpoint (API Route Collector)
- **Type**: 🔧 Code Change
- **Status**: [x] Complete
- **File**: `app/api/traces/route.ts`
- **What it does**:
  - Receives OTLP JSON from browser SDK
  - Validates payload structure and size (512KB max)
  - Re-emits each browser span as a server-side span with `span.origin=browser` prefix
  - This bridges browser traces into Vercel's native OTEL pipeline without needing a custom exporter
- **Design decision**: We chose API route collector over direct-to-Blob because:
  1. Browser traces flow through the same OTEL pipeline as server traces (unified view)
  2. No CORS issues (same-origin)
  3. No Blob presigned URL management needed
  4. Can add auth/rate-limiting later

### 2.4 Wire Into Root Layout
- **Type**: 🔧 Code Change
- **Status**: [x] Complete
- **File**: `app/layout.tsx`
- **Change**: Added `<BrowserTracing />` component in a Suspense boundary, alongside existing `<AnalyticsTools />`

### 2.5 Upload Source Maps
- **Type**: ⚙️ Vercel Config
- **CLI Available**: [ ] TBD — need to check if `vercel deploy` auto-uploads or if separate config needed
- **Status**: [ ] Not started
- **Notes**: Required to map minified stack traces back to source for accurate `code.filepath` attribution in browser spans.

---

## Phase 3: Trace Storage & Querying

### 3.1 Set Up Trace Drain → Blob Pipeline
- **Type**: 🔧 Code Change + ⚙️ Vercel Config (dashboard-only)
- **Status**: [x] Complete — receiver deployed, drain active
- **Drain ID**: `drn_rKQi8xXdW9WC6hyD`
- **Drain endpoint**: `https://dev3000.ai/api/drain/traces`
- **Created via**: `vercel api /v1/drains -X POST` (not dashboard — CLI works despite no dedicated `vercel drain` command)
- **Architecture**:
  - Vercel Trace Drain → `POST /api/drain/traces` → Vercel Blob
  - Raw OTLP payloads stored at `traces/{YYYY-MM-DD}/{timestamp}-{random}.json`
  - Each blob wraps the raw `resourceSpans` in a metadata envelope with `receivedAt`, `spanCount`, `deploymentId`, `projectId`
- **File**: `app/api/drain/traces/route.ts`
- **Features**:
  - HMAC signature verification via `x-vercel-signature` header (set `TRACE_DRAIN_SECRET` env var)
  - OTLP JSON payload validation
  - Metadata extraction (deployment ID, project ID, span count) for efficient listing
- **Manual step**: Team Settings → Drains → Add Drain → Traces → Custom Endpoint:
  - URL: `https://<deployment>.vercel.app/api/drain/traces`
  - Format: JSON
  - Set a signature verification secret → add as `TRACE_DRAIN_SECRET` env var
- **Why Blob over KV2**: Traces are write-heavy, append-only, variable-sized. Blob handles this well. KV2 is better for the aggregated lookups in Phase 5.
- **Limitation**: Custom spans from Edge Runtime functions are NOT forwarded via Trace Drains (Vercel limitation).

### 3.2 Create Trace Aggregation Storage
- **Type**: 🔧 Code Change
- **Status**: [ ] Not started
- **Storage**: Vercel KV2
- **Schema**: TBD — needs to support querying by function/file/author
- **Plan**: Processor reads from Blob, aggregates span data by `code.filepath` + `code.function`, writes rollups to KV2

### 3.3 Build Trace Processor
- **Type**: 🔧 Code Change
- **Status**: [ ] Not started
- **Notes**: Cron job or edge function to process raw traces into aggregated metrics

---

## Phase 4: Git Attribution Layer (Not Started)

### 4.1 Extract Git Blame Data at Build Time
- **Type**: 🔧 Code Change
- **Status**: [ ] Not started
- **Notes**: Run `git blame --porcelain` during build for all .ts/.tsx files. Store as JSON mapping: `file:lineRange → { author, commit, date }`. Vercel build env has git context (`VERCEL_GIT_COMMIT_SHA` confirmed available).

### 4.2 Store Attribution Map
- **Type**: 🔧 Code Change
- **Status**: [ ] Not started
- **Storage**: Bundle into build output as JSON (small enough for most repos), or Vercel Blob for large repos
- **Schema**:
  ```json
  {
    "file": "app/api/checkout/route.ts",
    "function": "POST",
    "lines": "15-45",
    "author": "lindsey@vercel.com",
    "commit": "abc123",
    "pr": "#456"
  }
  ```

### 4.3 Link Deployment to Git SHA
- **Type**: 📊 Data Source
- **Source**: Vercel Deployments API
- **CLI Available**: 🖥️ `vercel list` / `vercel inspect` / REST API
- **Notes**: `VERCEL_GIT_COMMIT_SHA` is already embedded in every span via `instrumentation.ts`

---

## Phase 5: Attribution Engine (Not Started)

### 5.1 Join Traces to Git Blame
- **Type**: 🔧 Code Change
- **Status**: [ ] Not started
- **Notes**: Match `code.filepath` + `code.function` span attributes to git blame data. The `vcs.commit.sha` span attribute links to the specific deployment's blame map.

### 5.2 Build Attribution API
- **Type**: 🔧 Code Change
- **Status**: [ ] Not started
- **Endpoint**: `/api/attribution`
- **Query**: "Show me execution stats by author for last 30 days"

### 5.3 Create Attribution Dashboard
- **Type**: 🔧 Code Change
- **Status**: [ ] Not started
- **Notes**: Visualize author → execution impact

---

## Friction Points & Vercel Product Feedback

| Issue | Category | Severity | Notes |
|-------|----------|----------|-------|
| ~~OTEL enable not in CLI~~ | ~~Missing CLI~~ | ~~N/A~~ | **Retracted** — no toggle exists because OTEL auto-enables when `@vercel/otel` + `instrumentation.ts` are deployed. No config needed. |
| No dedicated `vercel drain` CLI command | Missing CLI | **Medium** | No first-class `vercel drain create` command, but `vercel api /v1/drains -X POST` works. Drain CRUD is fully scriptable via the REST API — just not discoverable. |
| No programmatic trace query API | Missing API | High | Can only view traces in dashboard — no REST API to query spans for aggregation. Solved by using Trace Drain → Blob pipeline instead. |
| Browser OTEL needs proxy route | Architecture gap | Medium | Vercel's OTEL collector is server-only. Client traces require a custom `/api/traces` route to bridge into the pipeline. A built-in client trace endpoint would eliminate this. |
| Edge Runtime spans excluded from Trace Drains | Platform limitation | Medium | Custom spans from Edge Runtime functions are NOT forwarded via Trace Drains. Only Node.js runtime spans are included. |
| Source map upload CLI status unknown | Missing docs | Low | Unclear if `vercel deploy` auto-uploads source maps for OTEL or if separate config is needed. |
| `instrumentationHook` still experimental | DX | Low | On Next 16 canary, `instrumentation.ts` works but the config flag is still under `experimental`. Minor — will resolve when stable. |

---

## Open Questions

1. ~~What's the trace retention on Vercel's native OTEL sink?~~ → OTEL auto-enables on deploy. Retention TBD — check after first deploy.
2. ~~Can we query traces programmatically via API, or only view in dashboard?~~ → Appears dashboard-only as of now. This is a **blocker** for Phase 3 without a custom sink.
3. ~~How do we get client-side traces into the same sink?~~ → **Solved**: API route collector at `/api/traces` re-emits browser spans into server pipeline.
4. What's the build-time git context available? → `VERCEL_GIT_COMMIT_SHA` and `VERCEL_GIT_COMMIT_REF` confirmed available. Already embedded in spans.
5. **NEW**: Does Vercel's OTEL support custom span attributes in the dashboard filter/query UI? If not, the `code.filepath` and `code.function` attributes we're attaching may only be visible in raw span data.

---

## Commands Reference

```bash
# Install server-side OTEL
bun add @vercel/otel @opentelemetry/api

# Install browser-side OTEL
bun add @opentelemetry/sdk-trace-web @opentelemetry/exporter-trace-otlp-http @opentelemetry/instrumentation-document-load @opentelemetry/instrumentation-fetch @opentelemetry/instrumentation @opentelemetry/resources @opentelemetry/semantic-conventions

# Verify instrumentation file is detected (dev)
bun run dev
# Look for: "▲ Next.js 16.x" + no instrumentation errors in console

# Deploy with OTEL (after enabling in dashboard)
vercel deploy

# Check deployment has OTEL (look for otel config in deployment inspect)
vercel inspect <deployment-url>
```

---

## Files Changed (Phase 1 + 2)

| File | Action | Type |
|------|--------|------|
| `instrumentation.ts` | Created | 🔧 Server OTEL registration |
| `next.config.ts` | Modified | 🔧 Added `instrumentationHook: true` |
| `lib/tracing.ts` | Created | 🔧 Custom span utilities with attribution |
| `lib/browser-tracing.ts` | Created | 🔧 Browser OTEL SDK initialization |
| `app/tracing.client.tsx` | Created | 🔧 Client component for lazy browser tracing |
| `app/layout.tsx` | Modified | 🔧 Added `<BrowserTracing />` |
| `app/api/traces/route.ts` | Created | 🔧 Browser trace collector endpoint |
| `app/api/workflows/route.ts` | Modified | 🔧 Wrapped GET/DELETE in attributed spans |
| `app/api/dev-agents/route.ts` | Modified | 🔧 Wrapped GET in attributed span |
| `package.json` | **Needs update** | 🔧 Run `bun add` commands above |
