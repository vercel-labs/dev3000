import { isAdminUser } from "@/lib/admin"
import { getCurrentUser } from "@/lib/auth"
import { getSkillRunnerTeamSettings, updateSkillRunnerTeamSettings } from "@/lib/skill-runners"
import { resolveTeamFromParam } from "@/lib/vercel-teams"

async function resolveApiTeam(teamParam: string | null) {
  if (!teamParam) return null
  const { selectedTeam } = await resolveTeamFromParam(teamParam)
  return selectedTeam
}

function unauthorized() {
  return Response.json({ success: false, error: "Unauthorized" }, { status: 401 })
}

export async function PATCH(request: Request) {
  const user = await getCurrentUser()
  if (!isAdminUser(user)) {
    return unauthorized()
  }

  const body = await request.json()
  const team = await resolveApiTeam(typeof body.team === "string" ? body.team : null)
  if (!team) {
    return Response.json({ success: false, error: "Team not found" }, { status: 404 })
  }

  const executionMode =
    body.executionMode === "hosted" || body.executionMode === "self-hosted" ? body.executionMode : undefined
  const workerBaseUrl = typeof body.workerBaseUrl === "string" ? body.workerBaseUrl : undefined
  const workerProjectId = typeof body.workerProjectId === "string" ? body.workerProjectId : undefined
  const workerStatus =
    body.workerStatus === "unconfigured" ||
    body.workerStatus === "provisioning" ||
    body.workerStatus === "ready" ||
    body.workerStatus === "error"
      ? body.workerStatus
      : undefined

  const settings = await updateSkillRunnerTeamSettings(team, {
    executionMode,
    workerBaseUrl,
    workerProjectId,
    workerStatus
  })

  return Response.json({ success: true, settings })
}

export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!isAdminUser(user)) {
    return unauthorized()
  }

  const { searchParams } = new URL(request.url)
  const team = await resolveApiTeam(searchParams.get("team"))
  if (!team) {
    return Response.json({ success: false, error: "Team not found" }, { status: 404 })
  }

  const settings = await getSkillRunnerTeamSettings(team)
  return Response.json({ success: true, settings })
}
