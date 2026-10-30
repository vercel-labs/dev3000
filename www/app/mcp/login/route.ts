import { authPage } from "@/lib/hosted/auth-page"

export async function GET(request: Request) {
  try {
    return await authPage(request, false)
  } catch {
    return new Response("Hosted login is not configured yet.", { status: 503 })
  }
}
