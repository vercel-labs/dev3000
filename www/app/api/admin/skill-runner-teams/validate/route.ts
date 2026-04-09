import { isAdminUser } from "@/lib/admin"
import { getCurrentUser, getValidAccessToken } from "@/lib/auth"
import { SKILL_RUNNER_WORKER_PROJECT_NAME } from "@/lib/skill-runner-config"
import { findSkillRunnerWorkerProject } from "@/lib/skill-runner-worker"
import { resolveTeamFromParam } from "@/lib/vercel-teams"

function unauthorized() {
  return Response.json({ success: false, error: "Unauthorized" }, { status: 401 })
}

async function resolveApiTeam(teamParam: string | null) {
  if (!teamParam) return null
  const { selectedTeam } = await resolveTeamFromParam(teamParam)
  return selectedTeam
}

export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!isAdminUser(user)) {
    return unauthorized()
  }

  const accessToken = await getValidAccessToken()
  if (!accessToken) {
    return Response.json({ success: false, error: "Not authenticated" }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const team = await resolveApiTeam(searchParams.get("team"))
  if (!team) {
    return Response.json({ success: false, error: "Team not found" }, { status: 404 })
  }

  try {
    const project = await findSkillRunnerWorkerProject(accessToken, team)
    if (!project) {
      return Response.json({
        success: true,
        installed: false,
        expectedProjectName: SKILL_RUNNER_WORKER_PROJECT_NAME,
        message: `No ${SKILL_RUNNER_WORKER_PROJECT_NAME} project found in ${team.name}.`
      })
    }

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
        error: error instanceof Error ? error.message : "Failed to validate runner installation."
      },
      { status: 500 }
    )
  }
}
