import { start } from "workflow/api"
import { getCurrentUserFromRequest } from "@/lib/auth"
import { resolveDevAgentRunner } from "@/lib/cloud/dev-agent-runner"
import { type DevAgent, ensureDevAgentAshArtifactPrepared, getDevAgent, incrementDevAgentUsage } from "@/lib/dev-agents"
import { SKILL_RUNNER_WORKER_MODE_ENV } from "@/lib/skill-runner-config"
import {
  findSkillRunnerWorkerProject,
  installSkillRunnerWorkerProject,
  resolveSkillRunnerWorkerStatus
} from "@/lib/skill-runner-worker"
import {
  getSkillRunnerForExecution,
  getSkillRunnerTeamSettings,
  incrementSkillRunnerUsage,
  updateSkillRunnerTeamSettings
} from "@/lib/skill-runners"
import {
  buildIdentityProps,
  buildTelemetryEvent,
  emitTelemetryEvent,
  type TeamIdentity,
  type UserIdentity
} from "@/lib/telemetry"
import { proxyWorkflowJsonRequest, shouldProxyWorkflowRequest } from "@/lib/workflow-api"
import { clearWorkflowLog, workflowError, workflowLog } from "@/lib/workflow-logger"
import {
  getWorkflowMirrorSecret,
  persistWorkflowRun,
  type WorkflowRunMirrorTarget,
  type WorkflowType
} from "@/lib/workflow-storage"
import { cloudFixWorkflow } from "../fix-workflow/workflow"

/**
 * API Route to Start Cloud Fix Workflow
 *
 * This endpoint uses the Workflow SDK's start() API to invoke the workflow
 * and waits for the result using run.returnValue, which includes the blob URL
 * where the fix proposal was uploaded.
 */

// Configure longer timeout for workflow execution (10 minutes)
export const maxDuration = 600

// CORS headers - allowing credentials from localhost
const corsHeaders = {
  "Access-Control-Allow-Origin": "http://localhost:3000",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Credentials": "true"
}

type StartFixRequestBody = {
  [key: string]: unknown
  baseBranch?: string
  bypassToken?: string
  crawlDepth?: number | "all"
  customPrompt?: string
  devUrl?: string
  forwardedAccessToken?: string
  githubPat?: string
  npmToken?: string
  productionUrl?: string
  projectDir?: string
  projectEnv?: Record<string, unknown>
  projectId?: string
  publicUrl?: string
  projectName?: string
  repoBranch?: string
  repoName?: string
  repoOwner?: string
  repoUrl?: string
  skillRunnerId?: string
  skillRunnerTeam?: {
    id?: string
    slug?: string
    name?: string
    isPersonal?: boolean
  }
  resolvedSkillRunner?: {
    devAgent?: DevAgent
    canonicalPath?: string
    validationWarning?: string
  }
  startPath?: string
  submitPullRequest?: boolean
  teamId?: string
  userId?: string
  useV0DevAgentRunner?: boolean
  workflowType?: WorkflowType
}

type WorkflowAuthSource =
  | "worker-runtime-oidc"
  | "worker-platform-header-oidc"
  | "user-access-token"
  | "forwarded-user-token"
  | "control-plane-runtime-oidc"
  | "control-plane-vercel-token"
  | "missing"

function isPrivateOrLocalHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase()
  if (normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1") return true
  if (normalized.endsWith(".local")) return true

  const parts = normalized.split(".")
  if (parts.length === 4 && parts.every((part) => /^\d+$/.test(part))) {
    const [a, b] = parts.map((part) => Number.parseInt(part, 10))
    if (a === 10) return true
    if (a === 127) return true
    if (a === 169 && b === 254) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
  }

  return false
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}

function parseForwardedSkillRunner(
  value: unknown,
  expectedSkillRunnerId: string
): { devAgent: DevAgent; canonicalPath?: string; validationWarning?: string } | null {
  if (!isRecord(value)) return null

  const devAgent = value.devAgent
  if (!isRecord(devAgent)) return null
  if (devAgent.kind !== "skill-runner") return null
  if (devAgent.id !== expectedSkillRunnerId) return null
  if (typeof devAgent.name !== "string" || typeof devAgent.description !== "string") return null
  if (typeof devAgent.instructions !== "string") return null
  if (!Array.isArray(devAgent.skillRefs)) return null

  const ashArtifact = devAgent.ashArtifact
  if (!isRecord(ashArtifact) || typeof ashArtifact.tarballUrl !== "string" || !ashArtifact.tarballUrl.trim()) {
    return null
  }

  return {
    devAgent: devAgent as unknown as DevAgent,
    canonicalPath: typeof value.canonicalPath === "string" ? value.canonicalPath : undefined,
    validationWarning: typeof value.validationWarning === "string" ? value.validationWarning : undefined
  }
}

async function validatePublicUrl(
  input: string
): Promise<{ ok: true; normalizedUrl: string } | { ok: false; error: string }> {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    return { ok: false, error: "Invalid URL format" }
  }

  if (url.protocol !== "https:") {
    return { ok: false, error: "URL must use https://" }
  }

  if (isPrivateOrLocalHost(url.hostname)) {
    return { ok: false, error: "URL must be publicly reachable (not localhost/private network)" }
  }

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8000)
    const response = await fetch(url.toString(), {
      method: "GET",
      redirect: "follow",
      signal: controller.signal
    })
    clearTimeout(timeout)

    if (!response.ok) {
      return { ok: false, error: `URL responded with HTTP ${response.status}` }
    }

    return { ok: true, normalizedUrl: response.url }
  } catch (error) {
    return { ok: false, error: `Could not reach URL: ${error instanceof Error ? error.message : String(error)}` }
  }
}

async function forwardSelfHostedStartRequest({
  body,
  request,
  accessToken,
  workerBaseUrl
}: {
  body: Record<string, unknown>
  request: Request
  accessToken: string | undefined
  workerBaseUrl: string
}): Promise<Response> {
  const targetUrl = new URL("/api/cloud/start-fix", workerBaseUrl)
  const headers = new Headers()
  headers.set("content-type", "application/json")

  if (accessToken) {
    headers.set("authorization", `Bearer ${accessToken}`)
  } else {
    const authHeader = request.headers.get("authorization")
    if (authHeader) {
      headers.set("authorization", authHeader)
    }
  }

  headers.set("x-dev3000-skill-runner-worker-forwarded", "1")
  const forwardedBody = accessToken ? { ...body, forwardedAccessToken: accessToken } : body

  const upstream = await fetch(targetUrl.toString(), {
    method: "POST",
    headers,
    body: JSON.stringify(forwardedBody),
    cache: "no-store"
  })

  const text = await upstream.text()
  let parsed: unknown = null

  if (text.length > 0) {
    try {
      parsed = JSON.parse(text)
    } catch {
      return Response.json(
        {
          success: false,
          error: "Self-hosted worker returned a non-JSON response.",
          upstreamStatus: upstream.status,
          upstreamBodyPreview: text.slice(0, 400)
        },
        { status: upstream.ok ? 502 : upstream.status, headers: corsHeaders }
      )
    }
  }

  return Response.json(parsed, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: corsHeaders
  })
}

// Handle OPTIONS preflight request
export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders
  })
}

export async function POST(request: Request) {
  if (shouldProxyWorkflowRequest(request)) {
    return proxyWorkflowJsonRequest(request)
  }

  let userId: string | undefined
  let projectName: string | undefined
  let runId: string | undefined
  let runTimestamp: string | undefined
  let workflowType: WorkflowType = "cls-fix"
  let devAgent: DevAgent | null = null
  let runnerKind: "dev-agent" | "skill-runner" = "dev-agent"
  let ashArtifactState: "existing" | "reused" | "stored" | null = null
  let customPrompt: string | undefined
  let crawlDepth: number | "all" | undefined
  let analysisTargetType: "vercel-project" | "url" = "vercel-project"
  let publicUrl: string | undefined
  let skillRunnerCanonicalPath: string | undefined
  let skillRunnerValidationWarning: string | undefined
  let selfHostedWorkerBaseUrl: string | undefined
  let workflowMirrorTarget: WorkflowRunMirrorTarget | null = null
  let skillRunnerTelemetryContext: {
    team: TeamIdentity
    executionMode: "hosted" | "self-hosted"
  } | null = null

  try {
    // Get user's access token from cookies or Authorization header
    const { cookies: getCookies } = await import("next/headers")
    const cookieStore = await getCookies()
    let accessToken = cookieStore.get("access_token")?.value

    // Fallback to Authorization header for cross-origin requests
    if (!accessToken) {
      const authHeader = request.headers.get("Authorization")
      if (authHeader?.startsWith("Bearer ")) {
        accessToken = authHeader.substring(7)
      }
    }

    if (!accessToken) {
      return Response.json(
        { success: false, error: "Not authenticated. Please sign in to use workflows." },
        { status: 401, headers: corsHeaders }
      )
    }

    // Clear workflow log file at start of new workflow
    clearWorkflowLog()

    const body = (await request.json()) as StartFixRequestBody
    const forwardedAccessToken =
      request.headers.get("x-dev3000-skill-runner-worker-forwarded") === "1" &&
      typeof body.forwardedAccessToken === "string" &&
      body.forwardedAccessToken.trim().length > 0
        ? body.forwardedAccessToken.trim()
        : undefined

    const isSelfHostedWorker = process.env[SKILL_RUNNER_WORKER_MODE_ENV] === "1"
    const runtimeOidcToken = process.env.VERCEL_OIDC_TOKEN?.trim() || undefined
    const headerOidcToken = request.headers.get("x-vercel-oidc-token")?.trim() || undefined
    const fallbackVercelToken = process.env.VERCEL_TOKEN?.trim() || undefined

    // Resolve the token used by downstream Vercel project/sandbox APIs inside the workflow.
    // Hosted control-plane requests should prefer the signed-in user's token.
    // Self-hosted worker requests still need a user-scoped/project-scoped token for APIs like
    // reading target project env vars; worker OIDC is reserved for AI Gateway auth below.
    const vercelApiToken = isSelfHostedWorker
      ? forwardedAccessToken || accessToken || fallbackVercelToken
      : accessToken || forwardedAccessToken || headerOidcToken || runtimeOidcToken || fallbackVercelToken
    const vercelApiTokenSource: WorkflowAuthSource = !vercelApiToken
      ? "missing"
      : accessToken && vercelApiToken === accessToken
        ? "user-access-token"
        : forwardedAccessToken && vercelApiToken === forwardedAccessToken
          ? "forwarded-user-token"
          : runtimeOidcToken && vercelApiToken === runtimeOidcToken
            ? "control-plane-runtime-oidc"
            : "control-plane-vercel-token"
    const gatewayAuthToken = isSelfHostedWorker ? runtimeOidcToken || headerOidcToken || undefined : vercelApiToken
    const gatewayAuthSource: WorkflowAuthSource = !gatewayAuthToken
      ? "missing"
      : isSelfHostedWorker && runtimeOidcToken && gatewayAuthToken === runtimeOidcToken
        ? "worker-runtime-oidc"
        : isSelfHostedWorker && headerOidcToken && gatewayAuthToken === headerOidcToken
          ? "worker-platform-header-oidc"
          : accessToken && gatewayAuthToken === accessToken
            ? "user-access-token"
            : forwardedAccessToken && gatewayAuthToken === forwardedAccessToken
              ? "forwarded-user-token"
              : runtimeOidcToken && gatewayAuthToken === runtimeOidcToken
                ? "control-plane-runtime-oidc"
                : "control-plane-vercel-token"
    workflowLog(`[Start Fix] Vercel API token available: ${!!vercelApiToken}`)
    workflowLog(`[Start Fix] Vercel API token source: ${vercelApiTokenSource}`)
    workflowLog(`[Start Fix] AI Gateway token available: ${!!gatewayAuthToken}`)
    workflowLog(`[Start Fix] AI Gateway token source: ${gatewayAuthSource}`)

    const devAgentRunner = resolveDevAgentRunner(
      typeof body.useV0DevAgentRunner === "boolean" ? body.useV0DevAgentRunner : undefined
    )
    const useV0DevAgentRunner = devAgentRunner === "v0"
    const {
      devUrl,
      repoOwner,
      repoName,
      baseBranch,
      bypassToken,
      repoUrl,
      repoBranch,
      githubPat,
      npmToken,
      submitPullRequest,
      startPath,
      productionUrl,
      projectDir,
      projectId,
      teamId,
      projectEnv
    } = body
    const normalizedProjectEnv =
      projectEnv && typeof projectEnv === "object"
        ? Object.fromEntries(
            Object.entries(projectEnv as Record<string, unknown>)
              .map(([key, value]) => [key.trim(), typeof value === "string" ? value.trim() : ""])
              .filter(([key, value]) => key.length > 0 && value.length > 0)
          )
        : undefined
    const resolvedNpmToken =
      typeof npmToken === "string" && npmToken.trim().length > 0
        ? npmToken.trim()
        : normalizedProjectEnv?.NPM_TOKEN ||
          normalizedProjectEnv?.NODE_AUTH_TOKEN ||
          process.env.NPM_TOKEN ||
          process.env.NODE_AUTH_TOKEN
    // Validate workflowType is a valid WorkflowType
    const validWorkflowTypes: WorkflowType[] = [
      "cls-fix",
      "prompt",
      "design-guidelines",
      "react-performance",
      "url-audit",
      "turbopack-bundle-analyzer"
    ]
    if (typeof body.skillRunnerId === "string" && body.skillRunnerId.trim().length > 0) {
      const requestedSkillRunnerId = body.skillRunnerId.trim()
      const team = body.skillRunnerTeam
      if (!team || typeof team.id !== "string" || typeof team.slug !== "string" || typeof team.name !== "string") {
        return Response.json(
          { success: false, error: "skillRunnerTeam is required to start a skill runner." },
          { status: 400, headers: corsHeaders }
        )
      }

      const teamSettings = await getSkillRunnerTeamSettings({
        id: team.id,
        slug: team.slug,
        name: team.name,
        isPersonal: Boolean(team.isPersonal)
      })
      skillRunnerTelemetryContext = {
        team: {
          id: team.id,
          slug: team.slug,
          name: team.name,
          isPersonal: Boolean(team.isPersonal)
        },
        executionMode: teamSettings.executionMode
      }

      const forwardedSkillRunner =
        isSelfHostedWorker && request.headers.get("x-dev3000-skill-runner-worker-forwarded") === "1"
          ? parseForwardedSkillRunner(body.resolvedSkillRunner, requestedSkillRunnerId)
          : null

      runnerKind = "skill-runner"
      if (forwardedSkillRunner) {
        devAgent = forwardedSkillRunner.devAgent
        skillRunnerCanonicalPath = forwardedSkillRunner.canonicalPath
        skillRunnerValidationWarning = forwardedSkillRunner.validationWarning
        ashArtifactState = "reused"
        workflowType = devAgent.legacyWorkflowType || "prompt"
        workflowLog(
          `[Start Fix] Using forwarded skill runner ASH app: ${devAgent.ashArtifact?.sourceLabel || devAgent.name} (${devAgent.ashArtifact?.specHash?.slice(0, 8) || "unknown"})`
        )
      } else {
        const preparedSkillRunner = await getSkillRunnerForExecution(
          {
            id: team.id,
            slug: team.slug,
            name: team.name,
            isPersonal: Boolean(team.isPersonal)
          },
          requestedSkillRunnerId
        )
        devAgent = preparedSkillRunner.devAgent
        skillRunnerCanonicalPath = preparedSkillRunner.canonicalPath
        skillRunnerValidationWarning = preparedSkillRunner.validationWarning
        ashArtifactState = "reused"
        workflowType = devAgent.legacyWorkflowType || "prompt"
        workflowLog(
          `[Start Fix] Reusing ASH app: ${preparedSkillRunner.devAgent.ashArtifact?.sourceLabel || devAgent.name} (${preparedSkillRunner.devAgent.ashArtifact?.specHash?.slice(0, 8) || "unknown"})`
        )
      }

      if (teamSettings.executionMode === "self-hosted" && process.env[SKILL_RUNNER_WORKER_MODE_ENV] !== "1") {
        const runnerTeamIdentity = {
          id: team.id,
          slug: team.slug,
          name: team.name,
          isPersonal: Boolean(team.isPersonal)
        }

        if (!teamSettings.workerProjectId) {
          return Response.json(
            {
              success: false,
              error: `Self-hosted skill-runner mode is enabled for ${team.name}, but no runner project is configured yet in /admin.`
            },
            { status: 409, headers: corsHeaders }
          )
        }

        const resolvedProject = await findSkillRunnerWorkerProject(accessToken, runnerTeamIdentity)
        if (!resolvedProject) {
          return Response.json(
            {
              success: false,
              error: `Self-hosted skill-runner mode is enabled for ${team.name}, but no runner project is configured yet in /admin.`
            },
            { status: 409, headers: corsHeaders }
          )
        }

        let resolvedWorkerProject = resolvedProject
        let resolvedWorkerStatus = resolveSkillRunnerWorkerStatus(resolvedWorkerProject)

        if (resolvedWorkerStatus === "outdated") {
          resolvedWorkerProject = await installSkillRunnerWorkerProject(accessToken, runnerTeamIdentity)
          resolvedWorkerStatus = resolveSkillRunnerWorkerStatus(resolvedWorkerProject)
        }

        await updateSkillRunnerTeamSettings(runnerTeamIdentity, {
          executionMode: "self-hosted",
          workerProjectId: resolvedWorkerProject.projectId,
          workerBaseUrl: resolvedWorkerProject.workerBaseUrl || "",
          workerStatus: resolvedWorkerStatus
        })

        if (resolvedWorkerStatus === "provisioning" || !resolvedWorkerProject.workerBaseUrl) {
          return Response.json(
            {
              success: false,
              error: `Self-hosted skill-runner mode is enabled for ${team.name}, but the runner project is still provisioning.`
            },
            { status: 409, headers: corsHeaders }
          )
        }

        if (resolvedWorkerStatus === "outdated") {
          return Response.json(
            {
              success: false,
              error: `Self-hosted skill-runner mode is enabled for ${team.name}, but the runner project is updating to the latest shell version.`
            },
            { status: 409, headers: corsHeaders }
          )
        }

        if (resolvedWorkerStatus !== "ready") {
          return Response.json(
            {
              success: false,
              error: `Self-hosted skill-runner mode is enabled for ${team.name}, but the runner project still needs its team-owned Blob setup repaired.`
            },
            { status: 409, headers: corsHeaders }
          )
        }

        selfHostedWorkerBaseUrl = resolvedWorkerProject.workerBaseUrl
      }
    } else if (typeof body.devAgentId === "string" && body.devAgentId.trim().length > 0) {
      devAgent = await getDevAgent(body.devAgentId.trim())
      if (!devAgent) {
        return Response.json({ success: false, error: "Dev Agent not found." }, { status: 404, headers: corsHeaders })
      }
      const preparedAshArtifact = await ensureDevAgentAshArtifactPrepared(devAgent)
      ashArtifactState = preparedAshArtifact.state
      devAgent = {
        ...devAgent,
        ashArtifact: preparedAshArtifact.artifact
      }
      const ashStatusLabel =
        preparedAshArtifact.state === "reused" || preparedAshArtifact.state === "existing"
          ? "Reusing ASH app"
          : "Storing ASH app"
      workflowType = devAgent.legacyWorkflowType || "prompt"
      workflowLog(
        `[Start Fix] ${ashStatusLabel}: ${preparedAshArtifact.artifact.sourceLabel} (${preparedAshArtifact.artifact.specHash.slice(0, 8)})`
      )
    } else if (body.workflowType && validWorkflowTypes.includes(body.workflowType)) {
      workflowType = body.workflowType
    }
    analysisTargetType =
      body.analysisTargetType === "url" ||
      workflowType === "url-audit" ||
      (typeof body.publicUrl === "string" && body.publicUrl.trim().length > 0)
        ? "url"
        : "vercel-project"
    publicUrl = typeof body.publicUrl === "string" ? body.publicUrl : undefined
    customPrompt = typeof body.customPrompt === "string" ? body.customPrompt : undefined
    crawlDepth = typeof body.crawlDepth === "number" || body.crawlDepth === "all" ? body.crawlDepth : undefined
    userId = body.userId
    projectName = body.projectName

    if (devAgent?.requiresCustomPrompt && !customPrompt?.trim()) {
      return Response.json(
        { success: false, error: "This dev agent requires custom instructions before it can run." },
        { status: 400, headers: corsHeaders }
      )
    }

    if (analysisTargetType === "url") {
      if (!publicUrl) {
        return Response.json(
          { success: false, error: "publicUrl is required for URL analysis" },
          { status: 400, headers: corsHeaders }
        )
      }
      const validation = await validatePublicUrl(publicUrl)
      if (!validation.ok) {
        return Response.json({ success: false, error: validation.error }, { status: 400, headers: corsHeaders })
      }
      publicUrl = validation.normalizedUrl
      const hostname = new URL(publicUrl).hostname
      projectName = projectName || `url-audit-${hostname}`
    }

    workflowLog("[Start Fix] Starting cloud fix workflow...")
    workflowLog(`[Start Fix] Dev URL: ${devUrl}`)
    workflowLog(`[Start Fix] Project: ${projectName}`)
    workflowLog(`[Start Fix] User ID: ${userId}`)
    workflowLog(`[Start Fix] Start Path: ${startPath || "/"}`)
    workflowLog(`[Start Fix] Bypass Token: ${bypassToken ? "provided" : "not provided"}`)
    workflowLog(`[Start Fix] GitHub PAT: ${githubPat ? "provided" : "not provided"}`)
    workflowLog(`[Start Fix] NPM token: ${resolvedNpmToken ? "provided" : "not provided"}`)
    workflowLog(`[Start Fix] Submit PR: ${submitPullRequest === false ? "no" : "yes"}`)
    workflowLog(`[Start Fix] Dev Agent runner: ${devAgentRunner}`)
    workflowLog(`[Start Fix] Workflow auth source: ${vercelApiTokenSource}`)
    if (repoUrl) {
      workflowLog(`[Start Fix] Will create sandbox from: ${repoUrl}`)
      workflowLog(`[Start Fix] Branch: ${repoBranch || "main"}`)
    }
    if (publicUrl) {
      workflowLog(`[Start Fix] Public URL: ${publicUrl}`)
    }
    if (repoOwner && repoName) {
      workflowLog(`[Start Fix] GitHub: ${repoOwner}/${repoName} (base: ${baseBranch || "main"})`)
    }
    if (productionUrl) {
      workflowLog(`[Start Fix] Production URL: ${productionUrl}`)
    }

    // Validate required fields for v2 workflow
    if (analysisTargetType !== "url" && !repoUrl && !(useV0DevAgentRunner && projectId)) {
      return Response.json(
        {
          success: false,
          error: "repoUrl is required for the workflow unless a Vercel project-backed V0 devAgent run is used."
        },
        { status: 400, headers: corsHeaders }
      )
    }

    if (!projectName) {
      return Response.json(
        { success: false, error: "projectName is required for the workflow" },
        { status: 400, headers: corsHeaders }
      )
    }

    const providedRunId = typeof body.runId === "string" && body.runId.trim().length > 0 ? body.runId.trim() : undefined
    const providedTimestamp =
      typeof body.timestamp === "string" && body.timestamp.trim().length > 0 ? body.timestamp.trim() : undefined

    // Generate runId BEFORE starting workflow (following workflow-builder-template pattern)
    // The SDK's start() doesn't reliably return an id, so we generate our own.
    // Self-hosted workers may receive a control-plane-generated runId/timestamp and must reuse them.
    runId = providedRunId || `d3k_${crypto.randomUUID()}`
    runTimestamp = providedTimestamp || new Date().toISOString()

    if (!runId || !runTimestamp) {
      throw new Error("Failed to initialize workflow run metadata")
    }

    console.log(`[Start Fix] Generated runId: ${runId}`)
    console.log(`[Start Fix] userId: ${userId}, projectName: ${projectName}`)

    const ashActionLabel =
      ashArtifactState === "stored"
        ? "Storing ASH app"
        : ashArtifactState === "existing"
          ? "Using existing ASH app"
          : "Reusing ASH app"
    const initialAshStep =
      devAgent?.ashArtifact?.sourceLabel && devAgent?.ashArtifact?.specHash ? `${ashActionLabel}...` : undefined
    const initialProgressLogs = [
      ...(devAgent?.ashArtifact?.sourceLabel && devAgent?.ashArtifact?.specHash
        ? [
            `[ASH] ${ashActionLabel}: ${devAgent.ashArtifact.sourceLabel} (${devAgent.ashArtifact.specHash.slice(0, 8)})`
          ]
        : []),
      "[Sandbox] Queued sandbox creation..."
    ]

    const currentUserForTelemetry =
      runnerKind === "skill-runner" ? await getCurrentUserFromRequest(request).catch(() => null) : null
    const compiledAshSpec = devAgent?.ashArtifact?.compiledSpec
    const effectiveDevAgentExecutionMode = compiledAshSpec?.executionMode ?? devAgent?.executionMode
    const effectiveDevAgentSandboxBrowser = compiledAshSpec?.sandboxBrowser ?? devAgent?.sandboxBrowser
    const effectiveDevAgentAiAgent = compiledAshSpec?.aiAgent ?? devAgent?.aiAgent
    const effectiveDevAgentDevServerCommand = compiledAshSpec?.devServerCommand || devAgent?.devServerCommand
    const effectiveDevAgentActionSteps = compiledAshSpec?.actionSteps ?? devAgent?.actionSteps
    const effectiveDevAgentSkillRefs = compiledAshSpec?.skillRefs ?? devAgent?.skillRefs
    const effectiveDevAgentSuccessEval = compiledAshSpec?.successEval || devAgent?.successEval
    const effectiveDevAgentEarlyExitMode = compiledAshSpec?.earlyExitMode ?? devAgent?.earlyExitMode
    const effectiveDevAgentEarlyExitEval = compiledAshSpec?.earlyExitEval || devAgent?.earlyExitEval
    const effectiveDevAgentEarlyExitRule = compiledAshSpec?.earlyExitRule
      ? {
          metricType: compiledAshSpec.earlyExitRule.metricType,
          metricKey: compiledAshSpec.earlyExitRule.metricKey,
          label: compiledAshSpec.earlyExitRule.label || undefined,
          valueType: compiledAshSpec.earlyExitRule.valueType,
          operator: compiledAshSpec.earlyExitRule.operator,
          valueNumber: compiledAshSpec.earlyExitRule.valueNumber ?? undefined,
          secondaryValueNumber: compiledAshSpec.earlyExitRule.secondaryValueNumber ?? undefined,
          valueBoolean: compiledAshSpec.earlyExitRule.valueBoolean ?? undefined,
          valueString: compiledAshSpec.earlyExitRule.valueString || undefined
        }
      : devAgent?.earlyExitRule

    // V2 workflow params - simplified "local-style" architecture
    const workflowParams = {
      repoUrl:
        analysisTargetType === "url"
          ? (repoUrl as string | undefined) || "https://github.com/vercel-labs/dev3000"
          : repoUrl,
      repoBranch: repoBranch || baseBranch || "main",
      projectDir:
        analysisTargetType === "url"
          ? (projectDir as string | undefined) || "example-apps/nextjs-test-app"
          : projectDir,
      projectId: analysisTargetType === "url" ? undefined : projectId,
      teamId: analysisTargetType === "url" ? undefined : teamId,
      projectName,
      vercelOidcToken: vercelApiToken,
      vercelAuthSource: vercelApiTokenSource,
      gatewayAuthToken,
      gatewayAuthSource,
      runId, // Pass runId to workflow for tracking
      userId, // For progress updates
      timestamp: runTimestamp, // For progress updates
      workflowType, // For progress updates
      initialStepNumber: devAgent ? 0 : 1,
      initialCurrentStep: initialAshStep || "Creating sandbox environment...",
      initialProgressLogs,
      devAgentId: devAgent?.id,
      devAgentName: devAgent?.name,
      devAgentDescription: devAgent?.description,
      devAgentInstructions: devAgent?.ashArtifact?.systemPrompt || devAgent?.instructions,
      devAgentCompiledSpec: compiledAshSpec,
      devAgentAshTarballUrl: devAgent?.ashArtifact?.tarballUrl,
      devAgentRevision: devAgent?.ashArtifact?.revision,
      devAgentSpecHash: devAgent?.ashArtifact?.specHash,
      runnerKind,
      skillRunnerCanonicalPath,
      skillRunnerValidationWarning,
      devAgentExecutionMode: effectiveDevAgentExecutionMode,
      devAgentSandboxBrowser: effectiveDevAgentSandboxBrowser,
      devAgentAiAgent: effectiveDevAgentAiAgent,
      devAgentDevServerCommand: effectiveDevAgentDevServerCommand,
      isMarketplaceAgent: devAgent?.kind === "marketplace",
      devAgentActionSteps: effectiveDevAgentActionSteps,
      devAgentSkillRefs: effectiveDevAgentSkillRefs,
      devAgentSuccessEval: effectiveDevAgentSuccessEval,
      devAgentEarlyExitMode: effectiveDevAgentEarlyExitMode,
      devAgentEarlyExitEval: effectiveDevAgentEarlyExitEval,
      devAgentEarlyExitRule: effectiveDevAgentEarlyExitRule,
      analysisTargetType,
      publicUrl,
      startPath: startPath || "/", // Page path to analyze (e.g., "/about")
      customPrompt: workflowType === "prompt" ? customPrompt : undefined, // User's custom instructions
      crawlDepth: devAgent?.supportsCrawlDepth || workflowType === "design-guidelines" ? crawlDepth : undefined,
      // PR creation params
      githubPat,
      npmToken: resolvedNpmToken,
      projectEnv: normalizedProjectEnv,
      submitPullRequest: submitPullRequest !== false,
      repoOwner,
      repoName,
      baseBranch: baseBranch || "main",
      // For before/after screenshots in PR
      productionUrl,
      useV0DevAgentRunner,
      controlPlaneBaseUrl:
        request.headers.get("x-dev3000-skill-runner-worker-forwarded") === "1"
          ? typeof body.controlPlaneBaseUrl === "string"
            ? body.controlPlaneBaseUrl
            : undefined
          : undefined,
      controlPlaneAccessToken:
        request.headers.get("x-dev3000-skill-runner-worker-forwarded") === "1" ? accessToken : undefined,
      controlPlaneMirrorSecret:
        request.headers.get("x-dev3000-skill-runner-worker-forwarded") === "1"
          ? typeof body.controlPlaneMirrorSecret === "string"
            ? body.controlPlaneMirrorSecret
            : undefined
          : undefined,
      skillRunnerTelemetryUserName: currentUserForTelemetry?.name || currentUserForTelemetry?.username || undefined,
      skillRunnerTelemetryUserHandle: currentUserForTelemetry?.username || undefined,
      skillRunnerTelemetryTeamId: skillRunnerTelemetryContext?.team.id,
      skillRunnerTelemetryTeamSlug: skillRunnerTelemetryContext?.team.slug,
      skillRunnerTelemetryTeamName: skillRunnerTelemetryContext?.team.name,
      skillRunnerTelemetryTeamIsPersonal: skillRunnerTelemetryContext?.team.isPersonal,
      skillRunnerTelemetryExecutionMode: skillRunnerTelemetryContext?.executionMode
    }

    workflowMirrorTarget =
      workflowParams.controlPlaneBaseUrl &&
      (workflowParams.controlPlaneMirrorSecret || workflowParams.controlPlaneAccessToken)
        ? {
            apiBaseUrl: workflowParams.controlPlaneBaseUrl,
            accessToken: workflowParams.controlPlaneAccessToken,
            internalSecret: workflowParams.controlPlaneMirrorSecret
          }
        : null

    // Save workflow run metadata BEFORE returning — the client navigates to the report
    // page immediately, so the run must exist in blob storage when the page loads.
    if (userId && projectName) {
      try {
        await persistWorkflowRun(
          {
            id: runId,
            userId,
            projectName,
            timestamp: runTimestamp,
            status: "running",
            runnerKind,
            type: workflowType,
            devAgentId: devAgent?.id,
            devAgentName: devAgent?.name,
            devAgentDescription: devAgent?.description,
            devAgentRevision: devAgent?.ashArtifact?.revision,
            devAgentSpecHash: devAgent?.ashArtifact?.specHash,
            devAgentExecutionMode: devAgent?.executionMode,
            devAgentSandboxBrowser: devAgent?.sandboxBrowser,
            skillRunnerCanonicalPath,
            skillRunnerValidationWarning,
            currentStep: initialAshStep || "Creating sandbox environment...",
            stepNumber: devAgent ? 0 : 1,
            progressLogs: initialProgressLogs,
            customPrompt: workflowType === "prompt" ? customPrompt : undefined
          },
          { mirrorTarget: workflowMirrorTarget }
        )
        workflowLog(`[Start Fix] Saved workflow run metadata (running): ${runId}`)
      } catch (saveError) {
        workflowError("[Start Fix] ERROR saving workflow metadata:", saveError)
      }
    } else {
      workflowError(`[Start Fix] Cannot save - missing userId (${!!userId}) or projectName (${!!projectName})`)
    }

    if (devAgent?.id) {
      const updateUsage =
        runnerKind === "skill-runner" ? incrementSkillRunnerUsage(devAgent.id) : incrementDevAgentUsage(devAgent.id)
      void updateUsage.catch((usageError) => {
        workflowError("[Start Fix] Failed to update devAgent usage count:", usageError)
      })
    }

    if (
      !isSelfHostedWorker &&
      runnerKind === "skill-runner" &&
      skillRunnerTelemetryContext &&
      userId &&
      runId &&
      devAgent
    ) {
      const requestUser = await getCurrentUserFromRequest(request).catch(() => null)
      const identityUser: UserIdentity = requestUser
        ? { id: requestUser.id, name: requestUser.name || requestUser.username, username: requestUser.username }
        : { id: userId, name: userId, username: userId }
      void emitTelemetryEvent(
        buildTelemetryEvent({
          eventType: "skill_run_started",
          ...buildIdentityProps(
            identityUser,
            skillRunnerTelemetryContext.team,
            skillRunnerTelemetryContext.executionMode
          ),
          runId,
          skillRunnerId: devAgent.id,
          skillName: devAgent.name,
          skillCanonicalPath: skillRunnerCanonicalPath
        })
      ).catch(() => {})
    }

    if (selfHostedWorkerBaseUrl) {
      const workflowMirrorSecret = getWorkflowMirrorSecret()
      const forwardedBody =
        body && typeof body === "object"
          ? {
              ...(body as Record<string, unknown>),
              runId,
              timestamp: runTimestamp,
              workflowType,
              controlPlaneBaseUrl: new URL(request.url).origin,
              controlPlaneMirrorSecret: workflowMirrorSecret,
              resolvedSkillRunner:
                runnerKind === "skill-runner" && devAgent
                  ? {
                      devAgent,
                      canonicalPath: skillRunnerCanonicalPath,
                      validationWarning: skillRunnerValidationWarning
                    }
                  : undefined
            }
          : body

      return forwardSelfHostedStartRequest({
        body: forwardedBody,
        request,
        accessToken,
        workerBaseUrl: selfHostedWorkerBaseUrl
      })
    }

    // Enqueue the workflow before returning so the request cannot finish first
    // and leave the run stuck in its initial "running" placeholder state.
    try {
      await start(cloudFixWorkflow, [workflowParams])
      workflowLog(`[Start Fix] Workflow enqueued with runId: ${runId}`)
    } catch (startError) {
      workflowError("[Start Fix] Failed to enqueue workflow:", startError)

      if (userId && projectName && runId && runTimestamp) {
        await persistWorkflowRun(
          {
            id: runId,
            userId,
            projectName,
            timestamp: runTimestamp,
            status: "failure",
            runnerKind,
            type: workflowType,
            devAgentId: devAgent?.id,
            devAgentName: devAgent?.name,
            devAgentDescription: devAgent?.description,
            devAgentRevision: devAgent?.ashArtifact?.revision,
            devAgentSpecHash: devAgent?.ashArtifact?.specHash,
            devAgentExecutionMode: devAgent?.executionMode,
            devAgentSandboxBrowser: devAgent?.sandboxBrowser,
            skillRunnerCanonicalPath,
            skillRunnerValidationWarning,
            completedAt: new Date().toISOString(),
            error: startError instanceof Error ? startError.message : String(startError),
            customPrompt: workflowType === "prompt" ? customPrompt : undefined
          },
          { mirrorTarget: workflowMirrorTarget }
        ).catch((err) => workflowError("[Start Fix] Failed to save startup failure metadata:", err))
      }

      throw startError
    }

    // Return immediately - client can navigate to report and poll.
    workflowLog(`[Start Fix] Returning immediately with runId: ${runId}`)

    return Response.json(
      {
        success: true,
        message: "Workflow started successfully",
        projectName,
        runId,
        // Debug info to verify metadata was saved
        _debug: {
          userId,
          runIdGenerated: true
        }
      },
      {
        headers: corsHeaders
      }
    )
  } catch (error) {
    workflowError("[Start Fix] Error running workflow:", error)

    // Update workflow run metadata with failure status (use same timestamp to overwrite)
    if (userId && projectName && runId && runTimestamp) {
      await persistWorkflowRun(
        {
          id: runId,
          userId,
          projectName,
          timestamp: runTimestamp,
          status: "failure",
          runnerKind,
          type: workflowType,
          devAgentId: devAgent?.id,
          devAgentName: devAgent?.name,
          devAgentDescription: devAgent?.description,
          devAgentRevision: devAgent?.ashArtifact?.revision,
          devAgentSpecHash: devAgent?.ashArtifact?.specHash,
          devAgentExecutionMode: devAgent?.executionMode,
          devAgentSandboxBrowser: devAgent?.sandboxBrowser,
          skillRunnerCanonicalPath,
          skillRunnerValidationWarning,
          completedAt: new Date().toISOString(),
          error: error instanceof Error ? error.message : String(error),
          customPrompt: workflowType === "prompt" ? customPrompt : undefined
        },
        { mirrorTarget: workflowMirrorTarget }
      ).catch((err) => workflowError("[Start Fix] Failed to save error metadata:", err))
      workflowLog(`[Start Fix] Updated workflow run metadata to failure: ${runId}`)
    }

    return Response.json(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      },
      { status: 500, headers: corsHeaders }
    )
  }
}
