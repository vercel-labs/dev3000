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
 * GET /api/workflows
 * Fetches all workflow runs for a user
 *
 * Query params:
 * - userId: Required. The user ID to fetch runs for
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get("userId")

    if (!userId) {
      return Response.json({ error: "userId is required" }, { status: 400, headers: corsHeaders })
    }

    console.log(`[Workflows API] Fetching runs for user: ${userId}`)

    const runs = await listWorkflowRuns(userId)

    console.log(`[Workflows API] Found ${runs.length} runs`)

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

/**
 * DELETE /api/workflows
 * Deletes workflow runs and their associated blobs
 *
 * Body:
 * - userId: Required. The user ID
 * - runIds: Required. Array of run IDs to delete
 */
export async function DELETE(request: Request) {
  try {
    const body = await request.json()
    const { userId, runIds } = body

    if (!userId) {
      return Response.json({ error: "userId is required" }, { status: 400, headers: corsHeaders })
    }

    if (!runIds || !Array.isArray(runIds) || runIds.length === 0) {
      return Response.json({ error: "runIds array is required" }, { status: 400, headers: corsHeaders })
    }

    console.log(`[Workflows API] Deleting ${runIds.length} runs for user: ${userId}`)

    const result = await deleteWorkflowRuns(userId, runIds)

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
