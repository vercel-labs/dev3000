import { getCurrentUser } from "@/lib/auth"
import { isPublicBlobPathname, readBlobResponse } from "@/lib/blob-store"

const INLINE_RASTER_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"])

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const pathname = searchParams.get("pathname")?.trim()

  if (!pathname) {
    return new Response("Missing pathname", { status: 400 })
  }

  // The proxy only ever addresses stored blobs by pathname. Reject absolute
  // URLs so this route can't be used as an authenticated SSRF primitive
  // (readBlobResponse would otherwise fetch an arbitrary http(s) target).
  if (/^https?:\/\//i.test(pathname)) {
    return new Response("Invalid pathname", { status: 400 })
  }

  if (!isPublicBlobPathname(pathname)) {
    const user = await getCurrentUser()
    if (!user) {
      return new Response("Unauthorized", { status: 401 })
    }
  }

  const response = await readBlobResponse(pathname)
  if (!response?.ok) {
    return new Response("Not found", { status: 404 })
  }

  // Stored metadata is untrusted, including for blobs uploaded before this check.
  // Keep raster screenshots embeddable, but never serve active documents (such as
  // SVG or HTML) on the application origin. Fetch-based JSON/archive readers are
  // unaffected by the download headers.
  const headers = new Headers(response.headers)
  const contentType = headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() || ""
  const isRasterImage = INLINE_RASTER_IMAGE_TYPES.has(contentType)
  headers.set("content-type", isRasterImage ? contentType : "application/octet-stream")
  headers.set("content-disposition", isRasterImage ? "inline" : "attachment")
  headers.set("x-content-type-options", "nosniff")
  headers.set("content-security-policy", "sandbox; default-src 'none'; base-uri 'none'; form-action 'none'")

  return new Response(response.body, {
    status: response.status,
    headers
  })
}
