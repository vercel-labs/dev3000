import { putBlobAndBuildUrl } from "@/lib/blob-store"
import type { WorkflowRunMirrorTarget } from "@/lib/workflow-storage"

function normalizeMirrorApiBaseUrl(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null

  try {
    return new URL(trimmed).origin
  } catch {
    return null
  }
}

async function mirrorWorkflowReportBlob(
  pathname: string,
  content: string,
  mirrorTarget: WorkflowRunMirrorTarget | null | undefined
): Promise<string | undefined> {
  if (!mirrorTarget) return undefined

  const apiBaseUrl = normalizeMirrorApiBaseUrl(mirrorTarget.apiBaseUrl)
  const internalSecret = mirrorTarget.internalSecret?.trim()
  if (!apiBaseUrl || !internalSecret) return undefined

  const headers: HeadersInit = {
    "content-type": "application/json",
    "x-dev3000-workflow-mirror": "1",
    "x-dev3000-workflow-mirror-secret": internalSecret
  }

  const response = await fetch(new URL("/api/internal/report-blobs", apiBaseUrl), {
    method: "POST",
    headers,
    body: JSON.stringify({ pathname, content, contentType: "application/json" }),
    cache: "no-store"
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Report blob mirror failed with HTTP ${response.status}: ${body.slice(0, 400)}`)
  }

  const result = (await response.json()) as { appUrl?: string }
  return result.appUrl
}

export async function putWorkflowReportBlob(
  reportId: string,
  reportJson: string,
  options?: { mirrorTarget?: WorkflowRunMirrorTarget | null }
): Promise<{ appUrl: string }> {
  const pathname = `report-${reportId}.json`
  const blob = await putBlobAndBuildUrl(pathname, reportJson, {
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
    absoluteUrl: true
  })

  try {
    const mirroredAppUrl = await mirrorWorkflowReportBlob(pathname, reportJson, options?.mirrorTarget)
    if (mirroredAppUrl) {
      return { appUrl: mirroredAppUrl }
    }
  } catch (error) {
    console.warn(
      `[Workflow Report] Failed to mirror report blob: ${error instanceof Error ? error.message : String(error)}`
    )
  }

  return { appUrl: blob.appUrl }
}
