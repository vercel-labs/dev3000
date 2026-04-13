import { getCurrentUser, getValidAccessToken } from "@/lib/auth"
import { SKILL_RUNNER_WORKER_PROJECT_NAME } from "@/lib/skill-runner-config"
import { findSkillRunnerWorkerProject, installSkillRunnerWorkerProject } from "@/lib/skill-runner-worker"
import { updateSkillRunnerTeamSettings } from "@/lib/skill-runners"
import { resolveTeamFromParam } from "@/lib/vercel-teams"

async function resolveApiTeam(teamParam: string | null) {
  if (!teamParam) return null
  const { selectedTeam } = await resolveTeamFromParam(teamParam)
  return selectedTeam
}

function unauthorized() {
  return Response.json({ success: false, error: "Unauthorized" }, { status: 401 })
}

function getWorkerStatus(
  project: { workerBaseUrl?: string; missingEnvKeys?: string[] } | null
): "unconfigured" | "provisioning" | "ready" | "error" {
  if (!project) return "unconfigured"
  if (!project.workerBaseUrl) return "provisioning"
  if (project.missingEnvKeys && project.missingEnvKeys.length > 0) return "error"
  return "ready"
}

async function persistWorkerProject(teamParam: string | null, accessToken: string, install: boolean) {
  const team = await resolveApiTeam(teamParam)
  if (!team) {
    return Response.json({ success: false, error: "Team not found" }, { status: 404 })
  }

  const project = install
    ? await installSkillRunnerWorkerProject(accessToken, team)
    : await findSkillRunnerWorkerProject(accessToken, team)

  if (!project) {
    await updateSkillRunnerTeamSettings(team, {
      executionMode: "self-hosted",
      workerProjectId: "",
      workerBaseUrl: "",
      workerStatus: "unconfigured"
    })

    return Response.json({
      success: true,
      installed: false,
      expectedProjectName: SKILL_RUNNER_WORKER_PROJECT_NAME,
      message: `No ${SKILL_RUNNER_WORKER_PROJECT_NAME} project found in ${team.name}.`
    })
  }

  const settings = await updateSkillRunnerTeamSettings(team, {
    executionMode: "self-hosted",
    workerProjectId: project.projectId,
    workerBaseUrl: project.workerBaseUrl || "",
    workerStatus: getWorkerStatus(project)
  })

  return Response.json({
    success: true,
    installed: true,
    expectedProjectName: SKILL_RUNNER_WORKER_PROJECT_NAME,
    project,
    settings
  })
}

export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) {
    return unauthorized()
  }

  const accessToken = await getValidAccessToken()
  if (!accessToken) {
    return Response.json({ success: false, error: "Not authenticated" }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  try {
    return await persistWorkerProject(searchParams.get("team"), accessToken, false)
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

export async function POST(request: Request) {
  const user = await getCurrentUser()
  if (!user) {
    return unauthorized()
  }

  const accessToken = await getValidAccessToken()
  if (!accessToken) {
    return Response.json({ success: false, error: "Not authenticated" }, { status: 401 })
  }

  const body = await request.json()
  try {
    return await persistWorkerProject(typeof body.team === "string" ? body.team : null, accessToken, true)
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
