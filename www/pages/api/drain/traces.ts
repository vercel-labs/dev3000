import { createHmac } from "node:crypto"
import { put } from "@vercel/blob"
import type { NextApiRequest, NextApiResponse } from "next"

export const config = {
  api: {
    bodyParser: false
  }
}

async function readRawBody(req: NextApiRequest): Promise<string> {
  const chunks: Buffer[] = []

  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }

  return Buffer.concat(chunks).toString("utf8")
}

function verifySignature(body: string, signature: string | null): boolean {
  const secret = process.env.TRACE_DRAIN_SECRET
  if (!secret) {
    console.warn("[TraceDrain] TRACE_DRAIN_SECRET not set — skipping signature verification")
    return true
  }

  if (!signature) {
    return false
  }

  const expected = createHmac("sha1", secret.trimEnd()).update(body).digest("hex")
  return signature === expected
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST")
    return res.status(405).json({ error: "Method not allowed" })
  }

  try {
    const rawBody = await readRawBody(req)
    const signatureHeader = req.headers["x-vercel-signature"]
    const signature = Array.isArray(signatureHeader) ? (signatureHeader[0] ?? null) : (signatureHeader ?? null)

    if (!verifySignature(rawBody, signature)) {
      return res.status(401).json({ error: "Invalid signature" })
    }

    const payload = JSON.parse(rawBody) as {
      resourceSpans?: Array<{
        resource?: {
          attributes?: Array<{
            key?: string
            value?: { stringValue?: string }
          }>
        }
        scopeSpans?: Array<{ spans?: unknown[] }>
      }>
    }

    if (!payload.resourceSpans || !Array.isArray(payload.resourceSpans)) {
      return res.status(400).json({ error: "Invalid OTLP payload" })
    }

    let spanCount = 0
    let deploymentId = ""
    let projectId = ""

    for (const resourceSpan of payload.resourceSpans) {
      for (const attr of resourceSpan.resource?.attributes ?? []) {
        if (attr.key === "vercel.deploymentId" && attr.value?.stringValue) {
          deploymentId = attr.value.stringValue
        }
        if (attr.key === "vercel.projectId" && attr.value?.stringValue) {
          projectId = attr.value.stringValue
        }
      }

      for (const scopeSpan of resourceSpan.scopeSpans ?? []) {
        spanCount += (scopeSpan.spans ?? []).length
      }
    }

    const now = new Date()
    const dateStr = now.toISOString().split("T")[0]
    const blobPath = `traces/${dateStr}/${now.getTime()}.json`
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
      access: "public",
      addRandomSuffix: true
    })

    return res.status(200).json({ accepted: spanCount })
  } catch (error) {
    console.error("[TraceDrain] Error processing trace payload:", error)
    return res.status(500).json({ error: error instanceof Error ? error.message : "Internal error" })
  }
}
