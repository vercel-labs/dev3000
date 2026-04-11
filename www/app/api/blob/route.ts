import { getCurrentUser } from "@/lib/auth"
import { isPublicBlobPathname, readBlobResponse } from "@/lib/blob-store"

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const pathname = searchParams.get("pathname")?.trim()

  if (!pathname) {
    return new Response("Missing pathname", { status: 400 })
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

  return new Response(response.body, {
    status: response.status,
    headers: response.headers
  })
}
