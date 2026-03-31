/**
 * POST /api/drain/traces
 *
 * Vercel Trace Drain receiver. Accepts OTLP/HTTP JSON payloads from
 * Vercel's Trace Drain system and stores them in Vercel Blob for
 * later processing and attribution.
 *
 * Setup: Team Settings → Drains → Add Drain → Traces → Custom Endpoint
 *   URL: https://<your-deployment>.vercel.app/api/drain/traces
 *   Format: JSON
 *
 * Storage layout in Blob:
 *   traces/{YYYY-MM-DD}/{timestamp}-{random}.json
 *
 * Each blob contains the raw OTLP resourceSpans payload plus metadata
 * we extract (span count, deployment ID, project ID) for efficient
 * listing without re-parsing.
 */

import { createHmac } from "node:crypto"
import { put } from "@vercel/blob"

// Verify the request came from Vercel using the drain signature secret.
// Set TRACE_DRAIN_SECRET env var to the secret you configure in the dashboard.
function verifySignature(body: string, signature: string | null): boolean {
  const secret = process.env.TRACE_DRAIN_SECRET
  if (!secret) {
    // If no secret configured, skip verification (dev mode)
    console.warn("[TraceDrain] TRACE_DRAIN_SECRET not set — skipping signature verification")
    return true
  }
  if (!signature) return false

  // `vercel env add <name> <target> <<EOF` stores the trailing newline from stdin.
  // Normalize that common case so the runtime secret matches the drain secret.
  const expected = createHmac("sha1", secret.trimEnd()).update(body).digest("hex")
  return signature === expected
}

export async function POST(request: Request) {
  try {
    const rawBody = await request.text()

    // Verify Vercel drain signature
    const signature = request.headers.get("x-vercel-signature")
    if (!verifySignature(rawBody, signature)) {
      return Response.json({ error: "Invalid signature" }, { status: 401 })
    }

    const payload = JSON.parse(rawBody)

    // Validate OTLP structure
    if (!payload.resourceSpans || !Array.isArray(payload.resourceSpans)) {
      return Response.json({ error: "Invalid OTLP payload" }, { status: 400 })
    }

    // Extract metadata for indexing without re-parsing later
    let spanCount = 0
    let deploymentId = ""
    let projectId = ""

    for (const rs of payload.resourceSpans) {
      // Extract Vercel resource attributes
      for (const attr of rs.resource?.attributes ?? []) {
        if (attr.key === "vercel.deploymentId" && attr.value?.stringValue) {
          deploymentId = attr.value.stringValue
        }
        if (attr.key === "vercel.projectId" && attr.value?.stringValue) {
          projectId = attr.value.stringValue
        }
      }

      for (const ss of rs.scopeSpans ?? []) {
        spanCount += (ss.spans ?? []).length
      }
    }

    // Build storage path: traces/{date}/{timestamp}.json (Blob adds random suffix)
    const now = new Date()
    const dateStr = now.toISOString().split("T")[0] // YYYY-MM-DD
    const blobPath = `traces/${dateStr}/${now.getTime()}.json`

    // Store with metadata envelope
    const envelope = {
      metadata: {
        receivedAt: now.toISOString(),
        spanCount,
        deploymentId,
        projectId
      },
      resourceSpans: payload.resourceSpans
    }

    await put(blobPath, JSON.stringify(envelope), {
      contentType: "application/json",
      access: "public", // Blob requires access level; data isn't sensitive (trace telemetry)
      addRandomSuffix: true
    })

    return Response.json({ accepted: spanCount })
  } catch (error) {
    console.error("[TraceDrain] Error processing trace payload:", error)
    return Response.json({ error: error instanceof Error ? error.message : "Internal error" }, { status: 500 })
  }
}
