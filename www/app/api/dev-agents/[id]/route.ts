import { getCurrentUser } from "@/lib/auth"
import {
  canEditDevAgent,
  type DevAgentActionStep,
  type DevAgentActionStepKind,
  type DevAgentSkillRef,
  type DevAgentTeam,
  getDevAgent,
  isDevAgentExecutionMode,
  isDevAgentSandboxBrowser,
  parseDevAgentSkillRef,
  updateCustomDevAgent
} from "@/lib/dev-agents"

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const devAgent = await getDevAgent(id)

  if (!devAgent) {
    return Response.json({ success: false, error: "Dev Agent not found." }, { status: 404 })
  }

  return Response.json({ success: true, devAgent })
}

const VALID_ACTION_STEP_KINDS: Set<string> = new Set([
  "browse-to-page",
  "start-dev-server",
  "capture-loading-frames",
  "capture-cwv",
  "go-back-to-step",
  "send-prompt"
])

function isValidActionStep(value: unknown): value is DevAgentActionStep {
  if (!value || typeof value !== "object") return false
  const step = value as Record<string, unknown>
  return (
    typeof step.kind === "string" &&
    VALID_ACTION_STEP_KINDS.has(step.kind) &&
    typeof step.config === "object" &&
    step.config !== null
  )
}

function isValidSkillRef(value: unknown): value is DevAgentSkillRef {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as DevAgentSkillRef).installArg === "string" &&
    typeof (value as DevAgentSkillRef).skillName === "string" &&
    typeof (value as DevAgentSkillRef).displayName === "string"
  )
}

function isValidDevAgentTeam(value: unknown): value is DevAgentTeam {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as DevAgentTeam).id === "string" &&
    typeof (value as DevAgentTeam).slug === "string" &&
    typeof (value as DevAgentTeam).name === "string" &&
    typeof (value as DevAgentTeam).isPersonal === "boolean"
  )
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) {
    return Response.json({ success: false, error: "Not authenticated" }, { status: 401 })
  }

  const { id } = await params
  const existingDevAgent = await getDevAgent(id)
  if (!existingDevAgent) {
    return Response.json({ success: false, error: "Dev Agent not found." }, { status: 404 })
  }

  if (!canEditDevAgent(existingDevAgent, user)) {
    return Response.json(
      { success: false, error: "You do not have permission to edit this dev agent." },
      { status: 403 }
    )
  }

  try {
    const body = (await request.json()) as {
      name?: string
      description?: string
      prompt?: string
      instructions?: string
      executionMode?: string
      sandboxBrowser?: string
      actionSteps?: unknown[]
      skillRefs?: unknown[]
      team?: DevAgentTeam
      successEval?: string
    }

    const name = body.name?.trim() || ""
    const description = body.description?.trim() || ""
    const instructions = body.prompt?.trim() || body.instructions?.trim() || ""
    const executionMode = body.executionMode || ""
    const sandboxBrowser = body.sandboxBrowser || ""
    const rawActionSteps = Array.isArray(body.actionSteps) ? body.actionSteps : []
    const rawSkillRefs = Array.isArray(body.skillRefs) ? body.skillRefs : []
    const team = isValidDevAgentTeam(body.team) ? body.team : undefined

    if (!name || !description || !instructions) {
      return Response.json({ success: false, error: "Name, description, and prompt are required." }, { status: 400 })
    }

    if (!isDevAgentExecutionMode(executionMode)) {
      return Response.json({ success: false, error: "Invalid execution mode." }, { status: 400 })
    }

    if (!isDevAgentSandboxBrowser(sandboxBrowser)) {
      return Response.json({ success: false, error: "Invalid sandbox browser." }, { status: 400 })
    }

    if (rawSkillRefs.length === 0) {
      return Response.json({ success: false, error: "Choose at least one skill." }, { status: 400 })
    }

    const skillRefs = rawSkillRefs.filter(isValidSkillRef).map((skillRef) =>
      parseDevAgentSkillRef({
        installArg: skillRef.installArg,
        sourceUrl: skillRef.sourceUrl,
        displayName: skillRef.displayName
      })
    )

    if (skillRefs.length === 0) {
      return Response.json({ success: false, error: "No valid skills were provided." }, { status: 400 })
    }

    const actionSteps = rawActionSteps.filter(isValidActionStep).map(
      (step): DevAgentActionStep => ({
        kind: step.kind as DevAgentActionStepKind,
        config: step.config as Record<string, string>
      })
    )

    const devAgent = await updateCustomDevAgent(id, {
      name,
      description,
      instructions,
      executionMode,
      sandboxBrowser,
      actionSteps: actionSteps.length > 0 ? actionSteps : undefined,
      skillRefs,
      author: user,
      team,
      successEval: typeof body.successEval === "string" ? body.successEval : undefined
    })

    if (!devAgent) {
      return Response.json({ success: false, error: "Dev Agent not found." }, { status: 404 })
    }

    return Response.json({ success: true, devAgent })
  } catch (error) {
    return Response.json(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    )
  }
}
