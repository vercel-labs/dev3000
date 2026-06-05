import { getCurrentUserFromRequest } from "@/lib/auth"
import { isPublicBlobPathname, putBlobAndBuildUrl } from "@/lib/blob-store"
import { getWorkflowMirrorSecret } from "@/lib/workflow-storage"

export const maxDuration = 60

function isValidReportBlobPayload(value: unknown): value is {
  content: string
  contentType?: string
  pathname: string
  userId?: string
} {
  if (!value || typeof value !== "object") return false
  const payload = value as { content?: unknown; contentType?: unknown; pathname?: unknown }
  const maybeUserId = (value as { userId?: unknown }).userId
  return (
    typeof payload.pathname === "string" &&
    payload.pathname.startsWith("report-") &&
    isPublicBlobPathname(payload.pathname) &&
    typeof payload.content === "string" &&
    (typeof payload.contentType === "undefined" || typeof payload.contentType === "string") &&
    (typeof maybeUserId === "undefined" || typeof maybeUserId === "string")
  )
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  if (!isValidReportBlobPayload(body)) {
    return Response.json({ success: false, error: "Invalid report blob payload" }, { status: 400 })
  }

  const configuredMirrorSecret = getWorkflowMirrorSecret()
  const providedMirrorSecret = request.headers.get("x-dev3000-workflow-mirror-secret")?.trim()
  const hasValidMirrorSecret = Boolean(configuredMirrorSecret && providedMirrorSecret === configuredMirrorSecret)

  if (!hasValidMirrorSecret) {
    const user = await getCurrentUserFromRequest(request)
    if (!user) {
      return Response.json({ success: false, error: "Not authenticated" }, { status: 401 })
    }

    if (!body.userId || body.userId !== user.id) {
      return Response.json({ success: false, error: "Report blob user mismatch" }, { status: 403 })
    }
  }

  const blob = await putBlobAndBuildUrl(body.pathname, body.content, {
    contentType: body.contentType || "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
    absoluteUrl: true
  })

  return Response.json({ success: true, appUrl: blob.appUrl })
}
