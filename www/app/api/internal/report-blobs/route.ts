import { isPublicBlobPathname, putBlobAndBuildUrl } from "@/lib/blob-store"
import { getWorkflowMirrorSecret } from "@/lib/workflow-storage"

export const maxDuration = 60

function isValidReportBlobPayload(value: unknown): value is {
  content: string
  contentType?: string
  pathname: string
} {
  if (!value || typeof value !== "object") return false
  const payload = value as { content?: unknown; contentType?: unknown; pathname?: unknown }
  return (
    typeof payload.pathname === "string" &&
    payload.pathname.startsWith("report-") &&
    isPublicBlobPathname(payload.pathname) &&
    typeof payload.content === "string" &&
    (typeof payload.contentType === "undefined" || typeof payload.contentType === "string")
  )
}

export async function POST(request: Request) {
  const configuredMirrorSecret = getWorkflowMirrorSecret()
  const providedMirrorSecret = request.headers.get("x-dev3000-workflow-mirror-secret")?.trim()

  if (!configuredMirrorSecret || providedMirrorSecret !== configuredMirrorSecret) {
    return Response.json({ success: false, error: "Not authenticated" }, { status: 401 })
  }

  const body = await request.json().catch(() => null)
  if (!isValidReportBlobPayload(body)) {
    return Response.json({ success: false, error: "Invalid report blob payload" }, { status: 400 })
  }

  const blob = await putBlobAndBuildUrl(body.pathname, body.content, {
    contentType: body.contentType || "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
    absoluteUrl: true
  })

  return Response.json({ success: true, appUrl: blob.appUrl })
}
