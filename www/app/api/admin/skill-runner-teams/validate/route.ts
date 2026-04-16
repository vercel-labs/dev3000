import { isAdminUser } from "@/lib/admin"
import { getCurrentUser, getValidAccessToken } from "@/lib/auth"
import { SKILL_RUNNER_WORKER_PROJECT_NAME } from "@/lib/skill-runner-config"
import { findSkillRunnerWorkerProject } from "@/lib/skill-runner-worker"
import { getSkillRunnerTeamSettings } from "@/lib/skill-runners"
import { buildIdentityProps, buildTelemetryEvent, emitTelemetryEvent } from "@/lib/telemetry"
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

  const identity = {
    id: team.id,
    slug: team.slug,
    name: team.name,
    isPersonal: team.isPersonal
  }
  const userIdentity = user ? { id: user.id, name: user.name || user.username, username: user.username } : null
  const settings = await getSkillRunnerTeamSettings(identity).catch(() => null)
  const executionMode = settings?.executionMode || "self-hosted"

  try {
    const project = await findSkillRunnerWorkerProject(accessToken, team)
    if (!project) {
      if (userIdentity) {
        void emitTelemetryEvent(
          buildTelemetryEvent({
            eventType: "skill_runner_validated",
            ...buildIdentityProps(userIdentity, identity, executionMode)
          })
        ).catch(() => {})
      }
      return Response.json({
        success: true,
        installed: false,
        expectedProjectName: SKILL_RUNNER_WORKER_PROJECT_NAME,
        message: `No ${SKILL_RUNNER_WORKER_PROJECT_NAME} project found in ${team.name}.`
      })
    }

    if (userIdentity) {
      void emitTelemetryEvent(
        buildTelemetryEvent({
          eventType: "skill_runner_validated",
          ...buildIdentityProps(userIdentity, identity, executionMode),
          workerProjectId: project.projectId,
          workerBaseUrl: project.workerBaseUrl || undefined,
          failureCategory: project.missingEnvKeys?.length ? "env_missing" : undefined
        })
      ).catch(() => {})
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
