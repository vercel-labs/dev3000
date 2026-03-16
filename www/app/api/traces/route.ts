/**
 * POST /api/traces
 *
 * Collector endpoint for browser-side OTEL spans.
 * Receives OTLP JSON-encoded trace data from the browser SDK,
 * validates it, and forwards it to the server-side OTEL pipeline.
 *
 * This exists because Vercel's native OTEL collector only handles
 * server-side traces. Client traces need a proxy route.
 */

import { SpanStatusCode, trace } from "@opentelemetry/api"
import { withAttributedSpan } from "@/lib/tracing"

const tracer = trace.getTracer("dev3000-www")

// Max payload size: 512KB (browser spans shouldn't be huge)
const MAX_PAYLOAD_BYTES = 512 * 1024

export async function POST(request: Request) {
  return withAttributedSpan({ name: "traces.ingest", file: "app/api/traces/route.ts", fn: "POST" }, async (span) => {
    // Basic size check via content-length header
    const contentLength = request.headers.get("content-length")
    if (contentLength && Number.parseInt(contentLength, 10) > MAX_PAYLOAD_BYTES) {
      span.setAttribute("http.status_code", 413)
      return Response.json({ error: "Payload too large" }, { status: 413 })
    }

    const body = await request.json()

    // Validate basic OTLP structure
    if (!body.resourceSpans || !Array.isArray(body.resourceSpans)) {
      span.setAttribute("http.status_code", 400)
      return Response.json({ error: "Invalid OTLP payload: missing resourceSpans" }, { status: 400 })
    }

    // Count spans for observability
    let spanCount = 0
    for (const rs of body.resourceSpans) {
      for (const ss of rs.scopeSpans ?? []) {
        spanCount += (ss.spans ?? []).length
      }
    }

    span.setAttribute("traces.span_count", spanCount)
    span.setAttribute("traces.source", "browser")

    // Re-emit each browser span as a server-side span linked to the original.
    // This gets them into Vercel's native OTEL pipeline without a custom exporter.
    for (const rs of body.resourceSpans) {
      for (const ss of rs.scopeSpans ?? []) {
        for (const clientSpan of ss.spans ?? []) {
          try {
            tracer.startActiveSpan(`browser.${clientSpan.name ?? "unknown"}`, (serverSpan) => {
              serverSpan.setAttribute("span.origin", "browser")
              serverSpan.setAttribute("browser.span.traceId", clientSpan.traceId ?? "")
              serverSpan.setAttribute("browser.span.spanId", clientSpan.spanId ?? "")

              // Forward all client attributes (handle all OTLP value types)
              for (const attr of clientSpan.attributes ?? []) {
                const v = attr.value
                if (!v || !attr.key) continue

                if (v.stringValue !== undefined) {
                  serverSpan.setAttribute(`browser.${attr.key}`, v.stringValue)
                } else if (v.intValue !== undefined) {
                  serverSpan.setAttribute(`browser.${attr.key}`, Number(v.intValue))
                } else if (v.doubleValue !== undefined) {
                  serverSpan.setAttribute(`browser.${attr.key}`, v.doubleValue)
                } else if (v.boolValue !== undefined) {
                  serverSpan.setAttribute(`browser.${attr.key}`, v.boolValue)
                }
              }

              // Duration from client span
              if (clientSpan.startTimeUnixNano && clientSpan.endTimeUnixNano) {
                const durationMs =
                  Number(BigInt(clientSpan.endTimeUnixNano) - BigInt(clientSpan.startTimeUnixNano)) / 1_000_000
                serverSpan.setAttribute("browser.duration_ms", durationMs)
              }

              serverSpan.setStatus({ code: SpanStatusCode.OK })
              serverSpan.end()
            })
          } catch (_reemitError) {
            // Non-fatal: log but don't fail the whole batch
            span.setAttribute("traces.reemit_errors", true)
          }
        }
      }
    }

    return Response.json({ accepted: spanCount })
  })
}
