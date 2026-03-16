/**
 * Custom tracing utilities for code-to-execution attribution.
 *
 * Usage:
 *   import { withSpan, withAttributedSpan } from "@/lib/tracing"
 *
 *   // Simple span wrapping any async function
 *   const result = await withSpan("checkout.calculateTotal", async (span) => {
 *     span.setAttribute("cart.items", items.length)
 *     return calculateTotal(items)
 *   })
 *
 *   // Span with file/function attribution baked in (for git-blame join later)
 *   const result = await withAttributedSpan({
 *     name: "checkout.calculateTotal",
 *     file: "app/api/checkout/route.ts",
 *     fn: "POST",
 *   }, async (span) => {
 *     return calculateTotal(items)
 *   })
 */

import { type Span, SpanStatusCode, trace } from "@opentelemetry/api"

const tracer = trace.getTracer("dev3000-www")

/**
 * Wrap an async function in an OTEL span. Automatically records errors.
 */
export async function withSpan<T>(name: string, fn: (span: Span) => Promise<T>): Promise<T> {
  return tracer.startActiveSpan(name, async (span) => {
    try {
      const result = await fn(span)
      span.setStatus({ code: SpanStatusCode.OK })
      return result
    } catch (error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error)
      })
      span.recordException(error instanceof Error ? error : new Error(String(error)))
      throw error
    } finally {
      span.end()
    }
  })
}

/**
 * Span with source-code attribution metadata embedded.
 * These attributes are what Phase 4 (git blame join) will key on.
 */
interface AttributedSpanOptions {
  /** Span name, e.g. "workflows.list" */
  name: string
  /** Source file path relative to repo root, e.g. "app/api/workflows/route.ts" */
  file: string
  /** Function/handler name, e.g. "GET" or "listWorkflowRuns" */
  fn: string
  /** Optional line range for more precise attribution */
  lines?: string
}

export async function withAttributedSpan<T>(opts: AttributedSpanOptions, fn: (span: Span) => Promise<T>): Promise<T> {
  return tracer.startActiveSpan(opts.name, async (span) => {
    // Attribution metadata — these become span attributes queryable in the trace sink
    span.setAttribute("code.filepath", opts.file)
    span.setAttribute("code.function", opts.fn)
    if (opts.lines) {
      span.setAttribute("code.lineno", opts.lines)
    }
    // Git context from Vercel build env
    span.setAttribute("vcs.commit.sha", process.env.VERCEL_GIT_COMMIT_SHA ?? "unknown")
    span.setAttribute("vcs.branch", process.env.VERCEL_GIT_COMMIT_REF ?? "unknown")

    try {
      const result = await fn(span)
      span.setStatus({ code: SpanStatusCode.OK })
      return result
    } catch (error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error)
      })
      span.recordException(error instanceof Error ? error : new Error(String(error)))
      throw error
    } finally {
      span.end()
    }
  })
}

/**
 * Helper to add attribution to an existing span (e.g. inside middleware or
 * route handlers where you don't want to nest another span).
 */
export function addAttribution(span: Span, opts: Omit<AttributedSpanOptions, "name">): void {
  span.setAttribute("code.filepath", opts.file)
  span.setAttribute("code.function", opts.fn)
  if (opts.lines) {
    span.setAttribute("code.lineno", opts.lines)
  }
  span.setAttribute("vcs.commit.sha", process.env.VERCEL_GIT_COMMIT_SHA ?? "unknown")
  span.setAttribute("vcs.branch", process.env.VERCEL_GIT_COMMIT_REF ?? "unknown")
}
