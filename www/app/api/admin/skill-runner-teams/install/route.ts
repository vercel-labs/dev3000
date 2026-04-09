import { isAdminUser } from "@/lib/admin"
import { getCurrentUser, getValidAccessToken } from "@/lib/auth"
import { SKILL_RUNNER_WORKER_PROJECT_NAME } from "@/lib/skill-runner-config"
import { installSkillRunnerWorkerProject } from "@/lib/skill-runner-worker"
import { resolveTeamFromParam } from "@/lib/vercel-teams"

function unauthorized() {
  return Response.json({ success: false, error: "Unauthorized" }, { status: 401 })
}

async function resolveApiTeam(teamParam: string | null) {
  if (!teamParam) return null
  const { selectedTeam } = await resolveTeamFromParam(teamParam)
  return selectedTeam
}

export async function POST(request: Request) {
  const user = await getCurrentUser()
  if (!isAdminUser(user)) {
    return unauthorized()
  }

  const accessToken = await getValidAccessToken()
  if (!accessToken) {
    return Response.json({ success: false, error: "Not authenticated" }, { status: 401 })
  }

  const body = await request.json()
  const team = await resolveApiTeam(typeof body.team === "string" ? body.team : null)
  if (!team) {
    return Response.json({ success: false, error: "Team not found" }, { status: 404 })
  }

  try {
    const project = await installSkillRunnerWorkerProject(accessToken, team)
    return Response.json({
      success: true,
      installed: true,
      expectedProjectName: SKILL_RUNNER_WORKER_PROJECT_NAME,
      project
    })
  } catch (error) {
    return Response.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to install runner project."
      },
      { status: 500 }
    )
  }
}
