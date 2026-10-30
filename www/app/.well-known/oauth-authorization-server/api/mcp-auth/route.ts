import { oauthProviderAuthServerMetadata } from "@better-auth/oauth-provider"
import { hostedAuth } from "@/lib/hosted/auth"

export async function GET(request: Request) {
  try {
    return await oauthProviderAuthServerMetadata(hostedAuth().auth)(request)
  } catch {
    return Response.json({ error: "Hosted authentication is unavailable" }, { status: 503 })
  }
}
