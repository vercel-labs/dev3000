import { getVercelOidcToken } from "@vercel/oidc"
import { createVercelWorld } from "@workflow/world-vercel"
import { after } from "next/server"
import { type StartOptions, start } from "workflow/api"
import { getCurrentUserFromRequest } from "@/lib/auth"
import { resolveDevAgentRunner } from "@/lib/cloud/dev-agent-runner"
import { type DevAgent, ensureDevAgentAshArtifactPrepared, getDevAgent, incrementDevAgentUsage } from "@/lib/dev-agents"
import { describeOidcClaimsForLog, getOidcSandboxBinding, isOidcTokenBoundToProject } from "@/lib/oidc-token-binding"
import { isSelfHostedSkillRunnerRuntime } from "@/lib/skill-runner-runtime"
import {
  findSkillRunnerWorkerProject,
  installSkillRunnerWorkerProject,
  resolveSkillRunnerWorkerStatus,
  type SkillRunnerWorkerProject
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
import {
  extractAutomationProtectionBypassToken,
  type VercelProtectionBypassResponse
} from "@/lib/vercel-protection-bypass"
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

// Configure longer timeout for workflow startup on Pro/Enterprise runners.
// Hobby runner deployments patch this value down to their plan limit at upload time.
export const maxDuration = 600

// CORS headers - allowing credentials from localhost
const corsHeaders = {
  "Access-Control-Allow-Origin": "http://localhost:3000",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Credentials": "true"
}

const WORKER_OIDC_EXPIRATION_BUFFER_MS = 10 * 60 * 1000

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
  sandboxProjectId?: string
  sandboxTeamId?: string
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
  | "worker-oidc-helper"
  | "worker-project-oidc-refresh"
  | "worker-platform-header-oidc"
  | "user-access-token"
  | "forwarded-user-token"
  | "control-plane-ai-gateway-api-key"
  | "control-plane-runtime-oidc"
  | "control-plane-vercel-token"
  | "missing"

type WorkflowStartOptionsWithoutDeploymentId = Extract<StartOptions, { deploymentId?: undefined }>

function describeErrorForLog(error: unknown, depth = 0): Record<string, unknown> {
  if (!(error instanceof Error)) {
    return { value: String(error) }
  }

  const extra: Record<string, unknown> = {}
  const errorWithExtras = error as Error & { cause?: unknown; code?: unknown }
  if (typeof errorWithExtras.code === "string" || typeof errorWithExtras.code === "number") {
    extra.code = errorWithExtras.code
  }
  if (errorWithExtras.cause && depth < 3) {
    extra.cause = describeErrorForLog(errorWithExtras.cause, depth + 1)
  }

  return {
    name: error.name,
    message: error.message,
    stack: error.stack,
    ...extra
  }
}

function createSelfHostedWorkflowStartOptions({
  isSelfHostedWorker,
  workflowWorldToken
}: {
  isSelfHostedWorker: boolean
  workflowWorldToken?: string
}): WorkflowStartOptionsWithoutDeploymentId | undefined {
  if (!isSelfHostedWorker) return undefined

  const authToken = workflowWorldToken?.trim()
  const oidcBinding = getOidcSandboxBinding(authToken)
  const projectId = process.env.VERCEL_PROJECT_ID?.trim() || oidcBinding.projectId
  const deploymentId = process.env.VERCEL_DEPLOYMENT_ID?.trim()

  if (!authToken || !projectId) {
    console.error("[Start Fix] Missing explicit self-hosted Workflow world config", {
      hasToken: Boolean(authToken),
      hasProjectId: Boolean(projectId),
      hasDeploymentId: Boolean(deploymentId)
    })
    return undefined
  }

  console.log("[Start Fix] Self-hosted Workflow world config", {
    projectId,
    teamId: oidcBinding.teamId || null,
    deploymentId: deploymentId || null,
    tokenClaims: describeOidcClaimsForLog(authToken)
  })

  return {
    world: createVercelWorld({
      token: authToken
    })
  }
}

function runnerSetupRequiredResponse(error: string) {
  return Response.json(
    {
      success: false,
      code: "runner_setup_required",
      error
    },
    { status: 409, headers: corsHeaders }
  )
}

function getSelfHostedRuntimeOidcBinding() {
  return {
    projectId: process.env.VERCEL_PROJECT_ID?.trim() || undefined,
    teamId: (process.env.VERCEL_ORG_ID || process.env.VERCEL_TEAM_ID)?.trim() || undefined
  }
}

function isUsableSelfHostedOidcToken(token: string | undefined): token is string {
  return isOidcTokenBoundToProject(token, getSelfHostedRuntimeOidcBinding())
}

function warnAboutRejectedRuntimeOidcToken(context: string, source: WorkflowAuthSource, token: string | undefined) {
  console.warn(`[Start Fix] Ignoring ${context} OIDC token with mismatched project binding`, {
    source,
    expected: getSelfHostedRuntimeOidcBinding(),
    claims: describeOidcClaimsForLog(token)
  })
}

function warnAboutRejectedSelfHostedOidcToken(source: WorkflowAuthSource, token: string | undefined) {
  warnAboutRejectedRuntimeOidcToken("self-hosted", source, token)
}

async function resolveControlPlaneRuntimeOidcToken(runtimeOidcToken: string | undefined): Promise<string | undefined> {
  if (runtimeOidcToken) {
    try {
      const token = (await getVercelOidcToken({ expirationBufferMs: WORKER_OIDC_EXPIRATION_BUFFER_MS })).trim()
      if (isUsableSelfHostedOidcToken(token)) {
        console.log("[Start Fix] Resolved control-plane OIDC token", {
          source: "control-plane-runtime-oidc",
          claims: describeOidcClaimsForLog(token)
        })
        return token
      }
      if (token) {
        warnAboutRejectedRuntimeOidcToken("control-plane", "control-plane-runtime-oidc", token)
      }
    } catch (error) {
      console.warn("[Start Fix] Failed to resolve control-plane OIDC token", describeErrorForLog(error))
    }

    if (isUsableSelfHostedOidcToken(runtimeOidcToken)) {
      console.log("[Start Fix] Resolved control-plane OIDC token", {
        source: "control-plane-runtime-oidc",
        claims: describeOidcClaimsForLog(runtimeOidcToken)
      })
      return runtimeOidcToken
    }
    warnAboutRejectedRuntimeOidcToken("control-plane", "control-plane-runtime-oidc", runtimeOidcToken)
  }

  return undefined
}

async function refreshSelfHostedProjectOidcToken({
  isSelfHostedWorker,
  projectRefreshToken
}: {
  isSelfHostedWorker: boolean
  projectRefreshToken?: string
}): Promise<string | undefined> {
  if (!isSelfHostedWorker || !projectRefreshToken) return undefined

  const projectId = process.env.VERCEL_PROJECT_ID?.trim()
  const teamId = (process.env.VERCEL_ORG_ID || process.env.VERCEL_TEAM_ID)?.trim()

  if (!projectId) {
    console.warn("[Start Fix] Cannot refresh worker OIDC token without VERCEL_PROJECT_ID")
    return undefined
  }

  const apiUrl = new URL(`https://api.vercel.com/v1/projects/${projectId}/token`)
  apiUrl.searchParams.set("source", "vercel-oidc-refresh")
  if (teamId) {
    apiUrl.searchParams.set("teamId", teamId)
  }

  const response = await fetch(apiUrl.toString(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${projectRefreshToken}`
    },
    cache: "no-store"
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Failed to refresh worker OIDC token: ${response.status} ${errorText}`)
  }

  const data = (await response.json()) as { token?: unknown }
  return typeof data.token === "string" && data.token.trim().length > 0 ? data.token.trim() : undefined
}

async function resolveSelfHostedWorkerOidcToken({
  headerOidcToken,
  isSelfHostedWorker,
  projectRefreshToken,
  runtimeOidcToken
}: {
  headerOidcToken?: string
  isSelfHostedWorker: boolean
  projectRefreshToken?: string
  runtimeOidcToken?: string
}): Promise<{ source: WorkflowAuthSource; token?: string }> {
  if (!isSelfHostedWorker) return { source: "missing" }

  try {
    const token = (await getVercelOidcToken({ expirationBufferMs: WORKER_OIDC_EXPIRATION_BUFFER_MS })).trim()
    if (isUsableSelfHostedOidcToken(token)) {
      console.log("[Start Fix] Resolved worker OIDC token", {
        source: "worker-oidc-helper",
        claims: describeOidcClaimsForLog(token)
      })
      return { source: "worker-oidc-helper", token }
    }
    warnAboutRejectedSelfHostedOidcToken("worker-oidc-helper", token)
  } catch (error) {
    console.warn("[Start Fix] Failed to resolve worker OIDC token", describeErrorForLog(error))
  }

  if (isUsableSelfHostedOidcToken(headerOidcToken)) {
    console.log("[Start Fix] Resolved worker OIDC token", {
      source: "worker-platform-header-oidc",
      claims: describeOidcClaimsForLog(headerOidcToken)
    })
    return { source: "worker-platform-header-oidc", token: headerOidcToken }
  }
  if (headerOidcToken) {
    warnAboutRejectedSelfHostedOidcToken("worker-platform-header-oidc", headerOidcToken)
  }

  if (isUsableSelfHostedOidcToken(runtimeOidcToken)) {
    console.log("[Start Fix] Resolved worker OIDC token", {
      source: "worker-runtime-oidc",
      claims: describeOidcClaimsForLog(runtimeOidcToken)
    })
    return { source: "worker-runtime-oidc", token: runtimeOidcToken }
  }
  if (runtimeOidcToken) {
    warnAboutRejectedSelfHostedOidcToken("worker-runtime-oidc", runtimeOidcToken)
  }

  try {
    const token = await refreshSelfHostedProjectOidcToken({
      isSelfHostedWorker,
      projectRefreshToken
    })
    if (isUsableSelfHostedOidcToken(token)) {
      process.env.VERCEL_OIDC_TOKEN = token
      console.log("[Start Fix] Resolved worker OIDC token", {
        source: "worker-project-oidc-refresh",
        claims: describeOidcClaimsForLog(token)
      })
      return { source: "worker-project-oidc-refresh", token }
    }
    if (token) {
      warnAboutRejectedSelfHostedOidcToken("worker-project-oidc-refresh", token)
    }
  } catch (error) {
    console.warn("[Start Fix] Failed to refresh worker project OIDC token", describeErrorForLog(error))
  }

  return { source: "missing" }
}

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
  bypassToken,
  workerBaseUrl
}: {
  body: Record<string, unknown>
  request: Request
  accessToken: string | undefined
  bypassToken?: string
  workerBaseUrl: string
}): Promise<Response> {
  const targetUrl = new URL("/api/cloud/start-fix", workerBaseUrl)
  if (bypassToken) {
    targetUrl.searchParams.set("x-vercel-set-bypass-cookie", "true")
    targetUrl.searchParams.set("x-vercel-protection-bypass", bypassToken)
  }

  const headers = new Headers()
  headers.set("content-type", "application/json")
  if (bypassToken) {
    headers.set("x-vercel-protection-bypass", bypassToken)
  }

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

async function generateWorkerProtectionBypassToken({
  accessToken,
  projectId,
  teamId
}: {
  accessToken: string
  projectId: string
  teamId: string
}): Promise<string | undefined> {
  const apiUrl = new URL(`https://api.vercel.com/v1/projects/${encodeURIComponent(projectId)}/protection-bypass`)
  apiUrl.searchParams.set("teamId", teamId)

  const response = await fetch(apiUrl.toString(), {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: "{}",
    cache: "no-store"
  })

  if (!response.ok) {
    const errorText = await response.text()
    workflowError("[Start Fix] Failed to generate worker protection bypass token:", errorText)
    return undefined
  }

  const data = (await response.json()) as VercelProtectionBypassResponse
  return extractAutomationProtectionBypassToken(data)
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
  let selfHostedWorkerProjectId: string | undefined
  let selfHostedWorkerTeamId: string | undefined
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
    const isForwardedSkillRunnerWorkerRequest = request.headers.get("x-dev3000-skill-runner-worker-forwarded") === "1"
    const forwardedAccessToken =
      isForwardedSkillRunnerWorkerRequest &&
      typeof body.forwardedAccessToken === "string" &&
      body.forwardedAccessToken.trim().length > 0
        ? body.forwardedAccessToken.trim()
        : undefined
    const forwardedSandboxProjectId =
      isForwardedSkillRunnerWorkerRequest &&
      typeof body.sandboxProjectId === "string" &&
      body.sandboxProjectId.trim().length > 0
        ? body.sandboxProjectId.trim()
        : undefined
    const forwardedSandboxTeamId =
      isForwardedSkillRunnerWorkerRequest &&
      typeof body.sandboxTeamId === "string" &&
      body.sandboxTeamId.trim().length > 0
        ? body.sandboxTeamId.trim()
        : undefined

    const isSelfHostedWorker = isSelfHostedSkillRunnerRuntime()
    const runtimeOidcToken = process.env.VERCEL_OIDC_TOKEN?.trim() || undefined
    const headerOidcToken = request.headers.get("x-vercel-oidc-token")?.trim() || undefined
    const controlPlaneAiGatewayApiKey = process.env.AI_GATEWAY_API_KEY?.trim() || undefined
    const fallbackVercelToken = process.env.VERCEL_TOKEN?.trim() || undefined
    const selfHostedProjectOidcRefreshToken = isSelfHostedWorker
      ? forwardedAccessToken || accessToken || fallbackVercelToken
      : undefined
    const workerOidcAuth = await resolveSelfHostedWorkerOidcToken({
      headerOidcToken,
      isSelfHostedWorker,
      projectRefreshToken: selfHostedProjectOidcRefreshToken,
      runtimeOidcToken
    })
    const controlPlaneOidcToken = isSelfHostedWorker
      ? undefined
      : await resolveControlPlaneRuntimeOidcToken(runtimeOidcToken)
    const workerOidcBinding = getOidcSandboxBinding(workerOidcAuth.token)

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
    const workflowWorldToken = isSelfHostedWorker ? workerOidcAuth.token || fallbackVercelToken : undefined
    const workflowWorldAuthSource: WorkflowAuthSource = !workflowWorldToken
      ? "missing"
      : workerOidcAuth.token && workflowWorldToken === workerOidcAuth.token
        ? workerOidcAuth.source
        : "control-plane-vercel-token"
    // Keep AI Gateway billing aligned with the execution host: hosted runs use
    // the control-plane project, self-hosted skill-runners use the worker project.
    const hostedGatewayAuthToken = controlPlaneOidcToken || controlPlaneAiGatewayApiKey
    const gatewayAuthToken = isSelfHostedWorker ? workerOidcAuth.token : hostedGatewayAuthToken
    const gatewayAuthSource: WorkflowAuthSource = !gatewayAuthToken
      ? "missing"
      : isSelfHostedWorker && workerOidcAuth.token && gatewayAuthToken === workerOidcAuth.token
        ? workerOidcAuth.source
        : !isSelfHostedWorker && controlPlaneOidcToken && gatewayAuthToken === controlPlaneOidcToken
          ? "control-plane-runtime-oidc"
          : !isSelfHostedWorker && controlPlaneAiGatewayApiKey && gatewayAuthToken === controlPlaneAiGatewayApiKey
            ? "control-plane-ai-gateway-api-key"
            : accessToken && gatewayAuthToken === accessToken
              ? "user-access-token"
              : forwardedAccessToken && gatewayAuthToken === forwardedAccessToken
                ? "forwarded-user-token"
                : runtimeOidcToken && gatewayAuthToken === runtimeOidcToken
                  ? "control-plane-runtime-oidc"
                  : "control-plane-vercel-token"
    if (isSelfHostedWorker && !workflowWorldToken) {
      throw new Error(
        "Self-hosted runner cannot start Workflow without a Vercel OIDC token. Enable Secure Backend Access with OIDC Federation on the runner project."
      )
    }
    if (isSelfHostedWorker && !workerOidcAuth.token) {
      throw new Error(
        "Self-hosted runner cannot authenticate AI Gateway without a Vercel OIDC token. Enable Secure Backend Access with OIDC Federation on the runner project, then redeploy it."
      )
    }

    workflowLog(`[Start Fix] Workflow world token available: ${!!workflowWorldToken}`)
    workflowLog(`[Start Fix] Workflow world token source: ${workflowWorldAuthSource}`)
    if (isSelfHostedWorker) {
      workflowLog(
        `[Start Fix] Workflow world token claims: ${JSON.stringify(describeOidcClaimsForLog(workflowWorldToken))}`
      )
      console.log("[Start Fix] Workflow world token claims", describeOidcClaimsForLog(workflowWorldToken))
    }
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
      "turbopack-bundle-analyzer",
      "deepsec-security-scan",
      "vercel-optimize-audit"
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
        isSelfHostedWorker && isForwardedSkillRunnerWorkerRequest
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
        ).catch((error: unknown) => {
          if (error instanceof Error && /skill runner not found/i.test(error.message)) {
            return null
          }
          throw error
        })
        if (!preparedSkillRunner) {
          return Response.json(
            {
              success: false,
              code: "skill_runner_not_found",
              error:
                "This skill runner is no longer available for this team. Refresh the skill runner catalog and try again."
            },
            { status: 404, headers: corsHeaders }
          )
        }
        devAgent = preparedSkillRunner.devAgent
        skillRunnerCanonicalPath = preparedSkillRunner.canonicalPath
        skillRunnerValidationWarning = preparedSkillRunner.validationWarning
        ashArtifactState = "reused"
        workflowType = devAgent.legacyWorkflowType || "prompt"
        workflowLog(
          `[Start Fix] Reusing ASH app: ${preparedSkillRunner.devAgent.ashArtifact?.sourceLabel || devAgent.name} (${preparedSkillRunner.devAgent.ashArtifact?.specHash?.slice(0, 8) || "unknown"})`
        )
      }

      if (teamSettings.executionMode === "self-hosted" && !isForwardedSkillRunnerWorkerRequest) {
        let workerProject: SkillRunnerWorkerProject | null = null
        const skillRunnerTeamIdentity = {
          id: team.id,
          slug: team.slug,
          name: team.name,
          isPersonal: Boolean(team.isPersonal)
        }
        try {
          workerProject = await findSkillRunnerWorkerProject(
            accessToken,
            skillRunnerTeamIdentity,
            teamSettings.workerProjectId
          )
        } catch (workerValidationError) {
          workflowError(
            "[Start Fix] Failed to validate self-hosted skill runner before forwarding:",
            workerValidationError
          )
          return runnerSetupRequiredResponse(
            `Could not validate the ${team.name} runner project before starting this run. Retry runner setup to repair it.`
          )
        }

        let liveWorkerStatus = resolveSkillRunnerWorkerStatus(workerProject)

        if (liveWorkerStatus === "outdated" && workerProject) {
          workflowLog("[Start Fix] Team skill runner is outdated; updating runner shell before starting run...")
          try {
            workerProject = await installSkillRunnerWorkerProject(
              accessToken,
              skillRunnerTeamIdentity,
              workerProject.projectId
            )
            liveWorkerStatus = resolveSkillRunnerWorkerStatus(workerProject)
            workflowLog(`[Start Fix] Team skill runner update finished with status: ${liveWorkerStatus}`)
          } catch (workerUpdateError) {
            workflowError("[Start Fix] Failed to update self-hosted skill runner before forwarding:", workerUpdateError)
            return runnerSetupRequiredResponse(
              `The ${team.name} runner project needs an update before it can start runs, but dev3000 could not update it automatically. Open runner setup and retry.`
            )
          }
        }

        const liveWorkerProjectId = workerProject?.projectId || ""
        const liveWorkerBaseUrl = workerProject?.workerBaseUrl || ""
        await updateSkillRunnerTeamSettings(skillRunnerTeamIdentity, {
          executionMode: "self-hosted",
          workerProjectId: liveWorkerProjectId,
          workerBaseUrl: liveWorkerBaseUrl,
          workerStatus: liveWorkerStatus
        })

        if (!workerProject || !liveWorkerProjectId || !liveWorkerBaseUrl) {
          return runnerSetupRequiredResponse(
            `Self-hosted skill-runner mode is enabled for ${team.name}, but no runner project is configured yet.`
          )
        }

        if (liveWorkerStatus === "provisioning") {
          return runnerSetupRequiredResponse(
            `Self-hosted skill-runner mode is enabled for ${team.name}, but the runner project is still provisioning.`
          )
        }

        if (liveWorkerStatus === "outdated") {
          return runnerSetupRequiredResponse(
            `Self-hosted skill-runner mode is enabled for ${team.name}, but the runner project needs an update before it can start runs.`
          )
        }

        if (liveWorkerStatus !== "ready") {
          return runnerSetupRequiredResponse(
            `Self-hosted skill-runner mode is enabled for ${team.name}, but the runner project still needs its team-owned Blob setup repaired.`
          )
        }

        selfHostedWorkerBaseUrl = liveWorkerBaseUrl
        selfHostedWorkerProjectId = liveWorkerProjectId
        selfHostedWorkerTeamId = team.id
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

    if (
      (workflowType === "deepsec-security-scan" || workflowType === "vercel-optimize-audit") &&
      analysisTargetType !== "url" &&
      !repoUrl
    ) {
      const workflowLabel = workflowType === "vercel-optimize-audit" ? "Vercel Optimize" : "DeepSec"
      return Response.json(
        {
          success: false,
          error: `${workflowLabel} requires a GitHub-backed Vercel project. Select a project connected to a GitHub repository.`
        },
        { status: 400, headers: corsHeaders }
      )
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
      sandboxProjectId:
        forwardedSandboxProjectId ||
        (isSelfHostedWorker
          ? workerOidcBinding.projectId || process.env.VERCEL_PROJECT_ID?.trim() || undefined
          : undefined),
      sandboxTeamId:
        forwardedSandboxTeamId ||
        (isSelfHostedWorker
          ? workerOidcBinding.teamId ||
            process.env.VERCEL_ORG_ID?.trim() ||
            process.env.VERCEL_TEAM_ID?.trim() ||
            undefined
          : undefined),
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
      controlPlaneBaseUrl: isForwardedSkillRunnerWorkerRequest
        ? typeof body.controlPlaneBaseUrl === "string"
          ? body.controlPlaneBaseUrl
          : undefined
        : undefined,
      controlPlaneAccessToken: isForwardedSkillRunnerWorkerRequest ? accessToken : undefined,
      controlPlaneMirrorSecret: isForwardedSkillRunnerWorkerRequest
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
      const workerBaseUrl = selfHostedWorkerBaseUrl
      const workflowMirrorSecret = getWorkflowMirrorSecret()
      const forwardedBody =
        body && typeof body === "object"
          ? {
              ...(body as Record<string, unknown>),
              runId,
              timestamp: runTimestamp,
              workflowType,
              sandboxProjectId: selfHostedWorkerProjectId,
              sandboxTeamId: selfHostedWorkerTeamId,
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

      after(async () => {
        try {
          const workerResponse = await forwardSelfHostedStartRequest({
            body: forwardedBody,
            request,
            accessToken,
            bypassToken:
              accessToken && selfHostedWorkerProjectId && selfHostedWorkerTeamId
                ? await generateWorkerProtectionBypassToken({
                    accessToken,
                    projectId: selfHostedWorkerProjectId,
                    teamId: selfHostedWorkerTeamId
                  }).catch((error: unknown) => {
                    workflowError("[Start Fix] Failed to prepare worker protection bypass:", error)
                    return undefined
                  })
                : undefined,
            workerBaseUrl
          })
          const workerResult = (await workerResponse.json().catch(() => null)) as {
            success?: boolean
            error?: string
          } | null

          if (!workerResponse.ok || workerResult?.success !== true) {
            const errorMessage =
              workerResult?.error ||
              `Self-hosted worker failed to start run (${workerResponse.status} ${workerResponse.statusText}).`
            workflowError("[Start Fix] Self-hosted worker failed to start workflow:", errorMessage)

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
                  error: errorMessage,
                  customPrompt: workflowType === "prompt" ? customPrompt : undefined
                },
                { mirrorTarget: workflowMirrorTarget }
              ).catch((err) => workflowError("[Start Fix] Failed to save worker startup failure metadata:", err))
            }
          }
        } catch (workerStartError) {
          workflowError("[Start Fix] Failed to contact self-hosted worker:", workerStartError)

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
                error: workerStartError instanceof Error ? workerStartError.message : String(workerStartError),
                customPrompt: workflowType === "prompt" ? customPrompt : undefined
              },
              { mirrorTarget: workflowMirrorTarget }
            ).catch((err) => workflowError("[Start Fix] Failed to save worker contact failure metadata:", err))
          }
        }
      })

      workflowLog(`[Start Fix] Returning immediately with self-hosted runId: ${runId}`)

      return Response.json(
        {
          success: true,
          message: "Workflow start requested",
          projectName,
          runId,
          _debug: {
            userId,
            runIdGenerated: true
          }
        },
        {
          headers: corsHeaders
        }
      )
    }

    after(async () => {
      try {
        const workflowStartOptions = createSelfHostedWorkflowStartOptions({
          isSelfHostedWorker,
          workflowWorldToken
        })
        await start(cloudFixWorkflow, [workflowParams], workflowStartOptions)
        workflowLog(`[Start Fix] Workflow enqueued with runId: ${runId}`)
      } catch (startError) {
        workflowError("[Start Fix] Failed to enqueue workflow:", startError)
        console.error("[Start Fix] Failed to enqueue workflow", describeErrorForLog(startError))

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
      }
    })

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
