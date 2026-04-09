import { getCurrentUser } from "@/lib/auth"
import { importSkillRunnerForTeam, listSkillRunners, removeSkillRunnerForTeam } from "@/lib/skill-runners"
import { resolveTeamFromParam } from "@/lib/vercel-teams"

async function resolveApiTeam(teamParam: string | null) {
  if (!teamParam) return null
  const { selectedTeam } = await resolveTeamFromParam(teamParam)
  return selectedTeam
}

export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) {
    return Response.json({ success: false, error: "Unauthorized" }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const team = await resolveApiTeam(searchParams.get("team"))
  if (!team) {
    return Response.json({ success: false, error: "Team not found" }, { status: 404 })
  }

  const runners = await listSkillRunners(team)
  return Response.json({ success: true, runners })
}

export async function POST(request: Request) {
  const user = await getCurrentUser()
  if (!user) {
    return Response.json({ success: false, error: "Unauthorized" }, { status: 401 })
  }

  const body = await request.json()
  const team = await resolveApiTeam(typeof body.team === "string" ? body.team : null)
  if (!team) {
    return Response.json({ success: false, error: "Team not found" }, { status: 404 })
  }

  if (!body.selection || typeof body.selection !== "object") {
    return Response.json({ success: false, error: "selection is required" }, { status: 400 })
  }

  const runner = await importSkillRunnerForTeam(team, body.selection)
  return Response.json({ success: true, runner })
}

export async function DELETE(request: Request) {
  const user = await getCurrentUser()
  if (!user) {
    return Response.json({ success: false, error: "Unauthorized" }, { status: 401 })
  }

  const body = await request.json()
  const team = await resolveApiTeam(typeof body.team === "string" ? body.team : null)
  if (!team) {
    return Response.json({ success: false, error: "Team not found" }, { status: 404 })
  }

  if (typeof body.runnerId !== "string" || body.runnerId.trim().length === 0) {
    return Response.json({ success: false, error: "runnerId is required" }, { status: 400 })
  }

  await removeSkillRunnerForTeam(team, body.runnerId.trim())
  return Response.json({ success: true })
}
