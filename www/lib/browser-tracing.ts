/**
 * Browser-side OTEL tracing initialization.
 *
 * Call `initBrowserTracing()` once from a client component (e.g. in a
 * useEffect in a provider or layout). This sets up:
 *
 * 1. Auto-instrumentation for document load (LCP, FCP, etc.)
 * 2. Auto-instrumentation for fetch requests
 * 3. A batch exporter that sends OTLP JSON to /api/traces
 *
 * All spans include `code.filepath` and `code.function` attributes
 * so they can be joined with git blame data later.
 */

import { trace } from "@opentelemetry/api"
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http"
import { registerInstrumentations } from "@opentelemetry/instrumentation"
import { DocumentLoadInstrumentation } from "@opentelemetry/instrumentation-document-load"
import { FetchInstrumentation } from "@opentelemetry/instrumentation-fetch"
import { resourceFromAttributes } from "@opentelemetry/resources"
import { BatchSpanProcessor, WebTracerProvider } from "@opentelemetry/sdk-trace-web"
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions"

let initialized = false

export function initBrowserTracing() {
  if (initialized || typeof window === "undefined") return
  initialized = true

  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: "dev3000-www-browser",
    "browser.language": navigator.language,
    "browser.user_agent": navigator.userAgent
  })

  const exporter = new OTLPTraceExporter({
    url: "/api/traces",
    headers: {}
  })

  const provider = new WebTracerProvider({
    resource,
    spanProcessors: [
      new BatchSpanProcessor(exporter, {
        maxQueueSize: 100,
        maxExportBatchSize: 10,
        scheduledDelayMillis: 5000 // Batch every 5s to reduce /api/traces calls
      })
    ]
  })

  provider.register()

  registerInstrumentations({
    instrumentations: [
      new DocumentLoadInstrumentation(),
      new FetchInstrumentation({
        // Don't trace the trace exporter's own requests (infinite loop)
        ignoreUrls: [/\/api\/traces/],
        // Propagate W3C trace context to same-origin API calls
        propagateTraceHeaderCorsUrls: [/^\/api\//]
      })
    ]
  })
}

/**
 * Get a browser-side tracer for manual span creation.
 *
 * Usage:
 *   import { getBrowserTracer } from "@/lib/browser-tracing"
 *   const tracer = getBrowserTracer()
 *   tracer.startActiveSpan("user.clickCheckout", (span) => {
 *     span.setAttribute("code.filepath", "app/checkout/page.tsx")
 *     span.setAttribute("code.function", "handleCheckout")
 *     // ... do work ...
 *     span.end()
 *   })
 */
export function getBrowserTracer() {
  return trace.getTracer("dev3000-www-browser")
}
