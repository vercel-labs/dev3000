import { getCurrentUser } from "@/lib/auth"
import {
  createCustomDevAgent,
  type DevAgentActionStep,
  type DevAgentActionStepKind,
  type DevAgentAiAgent,
  type DevAgentEarlyExitRule,
  type DevAgentSkillRef,
  type DevAgentTeam,
  isDevAgentAiAgent,
  isDevAgentEarlyExitMode,
  isDevAgentEarlyExitRule,
  isDevAgentExecutionMode,
  isDevAgentSandboxBrowser,
  listDevAgents,
  parseDevAgentEarlyExitRule,
  parseDevAgentSkillRef
} from "@/lib/dev-agents"

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

export async function GET(request: Request) {
  const url = new URL(request.url)
  const teamId = url.searchParams.get("teamId") || undefined
  const teamSlug = url.searchParams.get("teamSlug") || undefined
  const devAgents = await listDevAgents({ teamId, teamSlug })
  return Response.json({ success: true, devAgents })
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

export async function POST(request: Request) {
  const user = await getCurrentUser()
  if (!user) {
    return Response.json({ success: false, error: "Not authenticated" }, { status: 401 })
  }

  try {
    const body = (await request.json()) as {
      name?: string
      description?: string
      prompt?: string
      instructions?: string
      executionMode?: string
      sandboxBrowser?: string
      aiAgent?: string
      devServerCommand?: string
      actionSteps?: unknown[]
      skillRefs?: unknown[]
      team?: DevAgentTeam
      successEval?: string
      earlyExitMode?: string
      earlyExitEval?: string
      earlyExitRule?: unknown
      earlyExitPlacementIndex?: unknown
    }

    const name = body.name?.trim() || ""
    const description = body.description?.trim() || ""
    const instructions = body.prompt?.trim() || body.instructions?.trim() || ""
    const executionMode = body.executionMode || ""
    const sandboxBrowser = body.sandboxBrowser || ""
    const aiAgent = body.aiAgent || ""
    const devServerCommand = body.devServerCommand?.trim() || ""
    const rawActionSteps = Array.isArray(body.actionSteps) ? body.actionSteps : []
    const rawSkillRefs = Array.isArray(body.skillRefs) ? body.skillRefs : []
    const team = isValidDevAgentTeam(body.team) ? body.team : null

    const hasActionSteps = rawActionSteps.length > 0
    if (!name || !description || (!instructions && !hasActionSteps)) {
      return Response.json(
        { success: false, error: "Name, description, and prompt (or action steps) are required." },
        { status: 400 }
      )
    }

    if (!isDevAgentExecutionMode(executionMode)) {
      return Response.json({ success: false, error: "Invalid execution mode." }, { status: 400 })
    }

    if (!isDevAgentSandboxBrowser(sandboxBrowser)) {
      return Response.json({ success: false, error: "Invalid sandbox browser." }, { status: 400 })
    }

    if (aiAgent && !isDevAgentAiAgent(aiAgent)) {
      return Response.json({ success: false, error: "Invalid AI agent." }, { status: 400 })
    }

    if (!devServerCommand) {
      return Response.json({ success: false, error: "A dev server command is required." }, { status: 400 })
    }

    if (typeof body.earlyExitMode !== "undefined" && !isDevAgentEarlyExitMode(body.earlyExitMode)) {
      return Response.json({ success: false, error: "Invalid early exit mode." }, { status: 400 })
    }

    if (typeof body.earlyExitRule !== "undefined" && !isDevAgentEarlyExitRule(body.earlyExitRule)) {
      return Response.json({ success: false, error: "Invalid early exit rule." }, { status: 400 })
    }

    if (body.earlyExitMode === "structured" && typeof body.earlyExitRule === "undefined") {
      return Response.json({ success: false, error: "Structured early exit mode requires a rule." }, { status: 400 })
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

    if (!team) {
      return Response.json({ success: false, error: "A team is required." }, { status: 400 })
    }

    const actionSteps = rawActionSteps.filter(isValidActionStep).map(
      (step): DevAgentActionStep => ({
        kind: step.kind as DevAgentActionStepKind,
        config: step.config as Record<string, string>
      })
    )
    const earlyExitRule =
      body.earlyExitRule && isDevAgentEarlyExitRule(body.earlyExitRule)
        ? parseDevAgentEarlyExitRule(body.earlyExitRule as DevAgentEarlyExitRule)
        : undefined
    const earlyExitPlacementIndex =
      typeof body.earlyExitPlacementIndex === "number" && Number.isInteger(body.earlyExitPlacementIndex)
        ? Math.max(0, body.earlyExitPlacementIndex)
        : undefined

    const devAgent = await createCustomDevAgent({
      name,
      description,
      instructions,
      executionMode,
      sandboxBrowser,
      aiAgent: aiAgent ? (aiAgent as DevAgentAiAgent) : undefined,
      devServerCommand,
      actionSteps: actionSteps.length > 0 ? actionSteps : undefined,
      skillRefs,
      author: user,
      team,
      successEval: typeof body.successEval === "string" ? body.successEval : undefined,
      earlyExitMode: body.earlyExitMode,
      earlyExitEval: typeof body.earlyExitEval === "string" ? body.earlyExitEval : undefined,
      earlyExitRule,
      earlyExitPlacementIndex
    })

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
