import { getVercelApiAccessToken } from "@/lib/auth"
import {
  extractAutomationProtectionBypassToken,
  type VercelProtectionBypassResponse
} from "@/lib/vercel-protection-bypass"

export async function POST(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await params
    const url = new URL(request.url)
    const teamId = url.searchParams.get("teamId")

    const accessToken = await getVercelApiAccessToken()

    if (!accessToken) {
      return Response.json({ error: "Unauthorized" }, { status: 401 })
    }

    // Generate/update deployment protection bypass token for the project
    const response = await fetch(
      `https://api.vercel.com/v1/projects/${projectId}/protection-bypass${teamId ? `?teamId=${teamId}` : ""}`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        },
        body: "{}"
      }
    )

    if (!response.ok) {
      const error = await response.text()
      console.error("Failed to generate bypass token:", response.status, error)
      return Response.json({ error: "Failed to generate bypass token", details: error }, { status: response.status })
    }

    const data = (await response.json()) as VercelProtectionBypassResponse

    return Response.json({
      success: true,
      token: extractAutomationProtectionBypassToken(data)
    })
  } catch (error) {
    console.error("Error generating bypass token:", error)
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}
