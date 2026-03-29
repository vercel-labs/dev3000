import { withAttributedSpan } from "@/lib/tracing"
import { proxyWorkflowRequest, shouldProxyWorkflowRequest } from "@/lib/workflow-api"
import { deleteWorkflowRuns, listWorkflowRuns } from "@/lib/workflow-storage"

// CORS headers - allowing credentials from localhost
const corsHeaders = {
  "Access-Control-Allow-Origin": "http://localhost:3000",
  "Access-Control-Allow-Methods": "GET, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Credentials": "true"
}

// Handle OPTIONS preflight request
export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders
  })
}

/**
 * GET /api/dev-agents/runs
 * Fetches all dev agent runs for a user
 *
 * Query params:
 * - userId: Required. The user ID to fetch runs for
 */
export async function GET(request: Request) {
  if (shouldProxyWorkflowRequest(request)) {
    return proxyWorkflowRequest(request)
  }

  return withAttributedSpan(
    { name: "dev-agent-runs.list", file: "app/api/dev-agents/runs/route.ts", fn: "GET" },
    async (span) => {
      try {
        const { searchParams } = new URL(request.url)
        const userId = searchParams.get("userId")

        if (!userId) {
          span.setAttribute("http.status_code", 400)
          return Response.json({ error: "userId is required" }, { status: 400, headers: corsHeaders })
        }

        span.setAttribute("user.id", userId)
        const runs = await listWorkflowRuns(userId)
        span.setAttribute("workflows.count", runs.length)

        return Response.json(
          {
            success: true,
            runs
          },
          { headers: corsHeaders }
        )
      } catch (error) {
        console.error("[Workflows API] Error fetching workflow runs:", error)
        return Response.json(
          {
            success: false,
            error: error instanceof Error ? error.message : String(error)
          },
          { status: 500, headers: corsHeaders }
        )
      }
    }
  )
}

/**
 * DELETE /api/dev-agents/runs
 * Deletes dev agent runs and their associated blobs
 *
 * Body:
 * - userId: Required. The user ID
 * - runIds: Required. Array of run IDs to delete
 */
export async function DELETE(request: Request) {
  if (shouldProxyWorkflowRequest(request)) {
    return proxyWorkflowRequest(request)
  }

  return withAttributedSpan(
    { name: "dev-agent-runs.delete", file: "app/api/dev-agents/runs/route.ts", fn: "DELETE" },
    async (span) => {
      try {
        const body = await request.json()
        const { userId, runIds } = body

        if (!userId) {
          span.setAttribute("http.status_code", 400)
          return Response.json({ error: "userId is required" }, { status: 400, headers: corsHeaders })
        }

        if (!runIds || !Array.isArray(runIds) || runIds.length === 0) {
          span.setAttribute("http.status_code", 400)
          return Response.json({ error: "runIds array is required" }, { status: 400, headers: corsHeaders })
        }

        span.setAttribute("user.id", userId)
        span.setAttribute("workflows.delete_count", runIds.length)
        console.log(`[Workflows API] Deleting ${runIds.length} runs for user: ${userId}`)

        const result = await deleteWorkflowRuns(userId, runIds)
        span.setAttribute("workflows.deleted", result.deleted)
        span.setAttribute("workflows.errors", result.errors.length)

        console.log(`[Workflows API] Deleted ${result.deleted} runs, ${result.errors.length} errors`)

        return Response.json(
          {
            success: true,
            deleted: result.deleted,
            errors: result.errors
          },
          { headers: corsHeaders }
        )
      } catch (error) {
        console.error("[Workflows API] Error deleting workflow runs:", error)
        return Response.json(
          {
            success: false,
            error: error instanceof Error ? error.message : String(error)
          },
          { status: 500, headers: corsHeaders }
        )
      }
    }
  )
}
