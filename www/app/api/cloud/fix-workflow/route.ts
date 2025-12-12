import { start } from "workflow/api"
import { cloudFixWorkflow } from "./workflow"
import { cloudFixWorkflowV2 } from "./workflow-v2"

/**
 * POST /api/cloud/fix-workflow
 * HTTP endpoint that starts the workflow using the Workflow SDK
 *
 * Query params:
 * - version=v2 to use the new simplified workflow
 */
export async function POST(request: Request) {
  try {
    const url = new URL(request.url)
    const version = url.searchParams.get("version") || "v1"

    const body = await request.json()
    const { devUrl, projectName, repoOwner, repoName, baseBranch, repoUrl, repoBranch, runId, userId } = body

    // Validate required fields
    if (!projectName) {
      return Response.json({ error: "Missing required field: projectName" }, { status: 400 })
    }

    console.log(`[API] Starting fix workflow ${version} for ${projectName}`)

    // biome-ignore lint/suspicious/noExplicitAny: Workflow SDK types are incomplete
    let workflowRun: any
    if (version === "v2") {
      // V2 workflow - simplified "local-style" architecture
      if (!repoUrl) {
        return Response.json({ error: "v2 workflow requires repoUrl" }, { status: 400 })
      }

      // @ts-expect-error - Workflow SDK types are incomplete
      workflowRun = await start(cloudFixWorkflowV2, {
        repoUrl,
        repoBranch: repoBranch || "main",
        projectName,
        runId,
        userId
      })
    } else {
      // V1 workflow - original multi-step architecture
      if (!devUrl && !repoUrl) {
        return Response.json({ error: "Missing required field: devUrl or repoUrl" }, { status: 400 })
      }

      // @ts-expect-error - Workflow SDK types are incomplete
      workflowRun = await start(cloudFixWorkflow, {
        devUrl,
        projectName,
        repoOwner,
        repoName,
        baseBranch: baseBranch || "main",
        repoUrl,
        repoBranch,
        runId,
        userId
      })
    }

    console.log(`[API] Workflow started: ${workflowRun.id}`)

    // Wait for workflow to complete
    const result = await workflowRun.result()

    console.log(`[API] Workflow completed: ${result.status}`)

    return result
  } catch (error) {
    console.error("[API] Error starting workflow:", error)
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Unknown error",
        details: error instanceof Error ? error.stack : undefined
      },
      { status: 500 }
    )
  }
}
