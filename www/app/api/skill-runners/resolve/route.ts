import { getCurrentUserFromRequest, getVercelApiAccessTokenFromRequest } from "@/lib/auth"
import { resolveSkillRunnerLookupForCli } from "@/lib/skill-runners"
import { resolveTeamFromParamWithAccessToken } from "@/lib/vercel-teams"

export async function GET(request: Request) {
  const user = await getCurrentUserFromRequest(request)
  if (!user) {
    return Response.json({ success: false, error: "Unauthorized" }, { status: 401 })
  }

  const accessToken = await getVercelApiAccessTokenFromRequest(request)
  if (!accessToken) {
    return Response.json({ success: false, error: "Not authenticated" }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const teamParam = searchParams.get("team")?.trim()
  const query = searchParams.get("q")?.trim() || ""

  if (!teamParam) {
    return Response.json({ success: false, error: "team is required" }, { status: 400 })
  }

  if (!query) {
    return Response.json({ success: false, error: "q is required" }, { status: 400 })
  }

  const { selectedTeam } = await resolveTeamFromParamWithAccessToken(teamParam, accessToken)
  if (!selectedTeam) {
    return Response.json({ success: false, error: "Team not found" }, { status: 404 })
  }

  try {
    const resolution = await resolveSkillRunnerLookupForCli(selectedTeam, query)
    return Response.json({ success: true, ...resolution })
  } catch (error) {
    return Response.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to resolve skill runner."
      },
      { status: 500 }
    )
  }
}
