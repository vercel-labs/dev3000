import { del, get, type PutBlobResult, put } from "@vercel/blob"
import { DEV3000_URL } from "@/lib/constants"

type BlobPutBody = Parameters<typeof put>[1]

const PUBLIC_BLOB_PREFIXES = ["report-", "workflow-", "pr-", "v0-source-", "dev-agents/ash/cache/"] as const

function normalizeAbsoluteBaseUrl(value?: string | null): string | null {
  const trimmed = value?.trim()
  if (!trimmed) return null

  try {
    return new URL(trimmed.startsWith("http://") || trimmed.startsWith("https://") ? trimmed : `https://${trimmed}`)
      .origin
  } catch {
    return null
  }
}

function getBlobProxyBaseUrl() {
  return (
    normalizeAbsoluteBaseUrl(process.env.NEXT_PUBLIC_SITE_URL) ||
    normalizeAbsoluteBaseUrl(process.env.VERCEL_PROJECT_PRODUCTION_URL) ||
    normalizeAbsoluteBaseUrl(process.env.VERCEL_URL) ||
    DEV3000_URL
  )
}

export function isPublicBlobPathname(pathname: string): boolean {
  return PUBLIC_BLOB_PREFIXES.some((prefix) => pathname.startsWith(prefix))
}

export function buildBlobProxyUrl(pathname: string, options?: { absolute?: boolean }): string {
  const relativeUrl = `/api/blob?pathname=${encodeURIComponent(pathname)}`
  if (!options?.absolute) {
    return relativeUrl
  }

  return new URL(relativeUrl, getBlobProxyBaseUrl()).toString()
}

export function resolveBlobPathname(pathOrUrl: string): string {
  const trimmed = pathOrUrl.trim()
  if (!trimmed) {
    throw new Error("Missing blob pathname")
  }

  if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://") && !trimmed.startsWith("/")) {
    return trimmed.replace(/^\/+/, "")
  }

  const url = new URL(trimmed, getBlobProxyBaseUrl())
  if (url.pathname === "/api/blob") {
    const pathname = url.searchParams.get("pathname")?.trim()
    if (!pathname) {
      throw new Error("Blob proxy URL is missing pathname")
    }
    return pathname
  }

  return url.pathname.replace(/^\/+/, "")
}

export async function readBlobResponse(pathOrUrl: string): Promise<Response | null> {
  try {
    if (pathOrUrl.startsWith("http://") || pathOrUrl.startsWith("https://")) {
      const publicResponse = await fetch(pathOrUrl, { cache: "no-store" })
      if (publicResponse.ok) {
        return publicResponse
      }
    }

    const pathname = resolveBlobPathname(pathOrUrl)
    const blob = await get(pathname, { access: "private", useCache: false })
    if (!blob || blob.statusCode !== 200) {
      return null
    }

    const headers = new Headers()
    if (blob.blob.contentType) {
      headers.set("content-type", blob.blob.contentType)
    }
    if (blob.blob.contentDisposition) {
      headers.set("content-disposition", blob.blob.contentDisposition)
    }
    if (blob.blob.cacheControl) {
      headers.set("cache-control", blob.blob.cacheControl)
    }
    if (blob.blob.etag) {
      headers.set("etag", blob.blob.etag)
    }

    return new Response(blob.stream, {
      headers
    })
  } catch {
    return null
  }
}

export async function readBlobJson<T>(pathOrUrl: string): Promise<T | null> {
  const response = await readBlobResponse(pathOrUrl)
  if (!response?.ok) {
    return null
  }

  return (await response.json()) as T
}

export async function putBlobAndBuildUrl(
  pathname: string,
  body: BlobPutBody,
  options: {
    contentType?: string
    addRandomSuffix?: boolean
    allowOverwrite?: boolean
    absoluteUrl?: boolean
  } = {}
): Promise<
  PutBlobResult & {
    appUrl: string
  }
> {
  const blob = await put(pathname, body, {
    access: "private",
    contentType: options.contentType,
    addRandomSuffix: options.addRandomSuffix,
    allowOverwrite: options.allowOverwrite
  })

  return {
    ...blob,
    appUrl: buildBlobProxyUrl(blob.pathname, { absolute: options.absoluteUrl })
  }
}

export async function deleteBlobByPathOrUrl(pathOrUrl: string): Promise<void> {
  await del(resolveBlobPathname(pathOrUrl))
}
