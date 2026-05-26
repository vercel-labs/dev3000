import { getCurrentUserFromRequest, getVercelApiAccessTokenFromRequest } from "@/lib/auth"
import { SKILL_RUNNER_WORKER_PROJECT_NAME } from "@/lib/skill-runner-config"
import {
  findSkillRunnerWorkerProject,
  installSkillRunnerWorkerProject,
  resolveSkillRunnerWorkerStatus,
  type SkillRunnerWorkerInstallProgress,
  SkillRunnerWorkerSetupError
} from "@/lib/skill-runner-worker"
import { getSkillRunnerTeamSettings, updateSkillRunnerTeamSettings } from "@/lib/skill-runners"
import {
  buildIdentityProps,
  buildTelemetryEvent,
  classifyFailure,
  emitTelemetryEvent,
  type TeamIdentity,
  type UserIdentity
} from "@/lib/telemetry"
import { resolveTeamFromParamWithAccessToken, type VercelTeam } from "@/lib/vercel-teams"

async function resolveApiTeam(teamParam: string | null, accessToken: string) {
  if (!teamParam) return null
  const { selectedTeam } = await resolveTeamFromParamWithAccessToken(teamParam, accessToken)
  return selectedTeam
}

function unauthorized() {
  return Response.json({ success: false, error: "Unauthorized" }, { status: 401 })
}

function formatSetupErrorPayload(error: unknown, fallbackMessage: string) {
  const message = error instanceof Error ? error.message : fallbackMessage
  return {
    success: false,
    error: message,
    code: error instanceof SkillRunnerWorkerSetupError ? error.code : undefined,
    actionLabel: error instanceof SkillRunnerWorkerSetupError ? error.actionLabel : undefined,
    actionUrl: error instanceof SkillRunnerWorkerSetupError ? error.actionUrl : undefined,
    deploymentUrl: error instanceof SkillRunnerWorkerSetupError ? error.deploymentUrl : undefined,
    details: error instanceof SkillRunnerWorkerSetupError ? error.details : undefined,
    projectName: error instanceof SkillRunnerWorkerSetupError ? error.projectName : undefined,
    repo: error instanceof SkillRunnerWorkerSetupError ? error.repo : undefined
  }
}

function streamWorkerInstall(
  teamParam: string | null,
  accessToken: string,
  emit: {
    user: UserIdentity
    mode: "install"
  }
) {
  const encoder = new TextEncoder()

  return new Response(
    new ReadableStream({
      async start(controller) {
        const send = (payload: Record<string, unknown>) => {
          controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`))
        }

        try {
          const response = await persistWorkerProject(teamParam, accessToken, true, emit, (progress) => {
            send({
              type: "progress",
              ...progress
            })
          })
          const data = await response.json()
          send({
            type: response.ok ? "result" : "error",
            status: response.status,
            data
          })
        } catch (error) {
          send({
            type: "error",
            status: 500,
            data: formatSetupErrorPayload(error, "Failed to install runner project.")
          })
        } finally {
          controller.close()
        }
      }
    }),
    {
      headers: {
        "Cache-Control": "no-store, max-age=0",
        "Content-Type": "application/x-ndjson"
      }
    }
  )
}

function toTeamIdentity(team: VercelTeam): TeamIdentity {
  return {
    id: team.id,
    slug: team.slug,
    name: team.name,
    isPersonal: team.isPersonal
  }
}

function toUserIdentity(user: { id: string; name?: string; username: string }): UserIdentity {
  return {
    id: user.id,
    name: user.name || user.username,
    username: user.username
  }
}

async function persistWorkerProject(
  teamParam: string | null,
  accessToken: string,
  install: boolean,
  emit?: {
    user: UserIdentity
    mode: "install" | "validate"
  },
  onProgress?: (progress: SkillRunnerWorkerInstallProgress) => void | Promise<void>
) {
  const team = await resolveApiTeam(teamParam, accessToken)
  if (!team) {
    return Response.json({ success: false, error: "Team not found" }, { status: 404 })
  }

  const identity = toTeamIdentity(team)
  const currentSettings = await getSkillRunnerTeamSettings(identity).catch(() => null)
  const executionMode = currentSettings?.executionMode || "self-hosted"

  if (emit && emit.mode === "install") {
    void emitTelemetryEvent(
      buildTelemetryEvent({
        eventType: "skill_runner_install_attempted",
        ...buildIdentityProps(emit.user, identity, executionMode)
      })
    ).catch(() => {})
  }

  const project = install
    ? await installSkillRunnerWorkerProject(accessToken, team, currentSettings?.workerProjectId, { onProgress })
    : await findSkillRunnerWorkerProject(accessToken, team, currentSettings?.workerProjectId)

  if (!project) {
    await updateSkillRunnerTeamSettings(team, {
      executionMode: "self-hosted",
      workerProjectId: "",
      workerBaseUrl: "",
      workerStatus: "unconfigured"
    })

    if (emit) {
      const eventType = emit.mode === "install" ? "skill_runner_install_failed" : "skill_runner_validated"
      void emitTelemetryEvent(
        buildTelemetryEvent({
          eventType,
          ...buildIdentityProps(emit.user, identity, executionMode),
          failureCategory: emit.mode === "install" ? "deployment_failed" : undefined
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

  const resolvedWorkerStatus = resolveSkillRunnerWorkerStatus(project)
  const settings = await updateSkillRunnerTeamSettings(team, {
    executionMode: "self-hosted",
    workerProjectId: project.projectId,
    workerBaseUrl: project.workerBaseUrl || "",
    workerStatus: resolvedWorkerStatus
  })

  if (emit) {
    const hasMissingEnv = Boolean(project.missingEnvKeys?.length)
    if (emit.mode === "install") {
      if (hasMissingEnv) {
        void emitTelemetryEvent(
          buildTelemetryEvent({
            eventType: "skill_runner_install_failed",
            ...buildIdentityProps(emit.user, identity, settings.executionMode),
            workerProjectId: project.projectId,
            workerBaseUrl: project.workerBaseUrl || undefined,
            failureCategory: "env_missing"
          })
        ).catch(() => {})
      } else {
        void emitTelemetryEvent(
          buildTelemetryEvent({
            eventType: "skill_runner_install_completed",
            ...buildIdentityProps(emit.user, identity, settings.executionMode),
            workerProjectId: project.projectId,
            workerBaseUrl: project.workerBaseUrl || undefined
          })
        ).catch(() => {})
      }
    } else {
      void emitTelemetryEvent(
        buildTelemetryEvent({
          eventType: "skill_runner_validated",
          ...buildIdentityProps(emit.user, identity, settings.executionMode),
          workerProjectId: project.projectId,
          workerBaseUrl: project.workerBaseUrl || undefined,
          failureCategory: hasMissingEnv ? "env_missing" : undefined
        })
      ).catch(() => {})
    }
  }

  return Response.json({
    success: true,
    installed: true,
    expectedProjectName: SKILL_RUNNER_WORKER_PROJECT_NAME,
    project,
    settings
  })
}

export async function GET(request: Request) {
  const user = await getCurrentUserFromRequest(request)
  if (!user) {
    return unauthorized()
  }

  const accessToken = await getVercelApiAccessTokenFromRequest(request)
  if (!accessToken) {
    return Response.json({ success: false, error: "Not authenticated" }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  try {
    return await persistWorkerProject(searchParams.get("team"), accessToken, false, {
      user: toUserIdentity(user),
      mode: "validate"
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

export async function POST(request: Request) {
  const user = await getCurrentUserFromRequest(request)
  if (!user) {
    return unauthorized()
  }

  const accessToken = await getVercelApiAccessTokenFromRequest(request)
  if (!accessToken) {
    return Response.json({ success: false, error: "Not authenticated" }, { status: 401 })
  }

  const body = await request.json()
  const identity = toUserIdentity(user)
  if (new URL(request.url).searchParams.get("stream") === "1") {
    return streamWorkerInstall(typeof body.team === "string" ? body.team : null, accessToken, {
      user: identity,
      mode: "install"
    })
  }

  try {
    return await persistWorkerProject(typeof body.team === "string" ? body.team : null, accessToken, true, {
      user: identity,
      mode: "install"
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to install runner project."
    const team = await resolveApiTeam(typeof body.team === "string" ? body.team : null, accessToken)
    if (team) {
      const teamIdentity = toTeamIdentity(team)
      const settings = await getSkillRunnerTeamSettings(teamIdentity).catch(() => null)
      void emitTelemetryEvent(
        buildTelemetryEvent({
          eventType: "skill_runner_install_failed",
          ...buildIdentityProps(identity, teamIdentity, settings?.executionMode || "self-hosted"),
          failureCategory: classifyFailure(message, null)
        })
      ).catch(() => {})
    }
    return Response.json(formatSetupErrorPayload(error, message), { status: 500 })
  }
}
