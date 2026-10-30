import { hostedAuth } from "@/lib/hosted/auth"

export const maxDuration = 60

async function handle(request: Request) {
  try {
    return await hostedAuth().auth.handler(request)
  } catch {
    return Response.json({ error: "Hosted authentication is unavailable" }, { status: 503 })
  }
}

export { handle as GET, handle as POST }
