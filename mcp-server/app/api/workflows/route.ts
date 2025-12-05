import { deleteWorkflowRuns, listWorkflowRuns } from "@/lib/workflow-storage"

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
      return Response.json({ error: "userId is required" }, { status: 400 })
    }

    console.log(`[Workflows API] Fetching runs for user: ${userId}`)

    const runs = await listWorkflowRuns(userId)

    console.log(`[Workflows API] Found ${runs.length} runs`)

    return Response.json({
      success: true,
      runs
    })
  } catch (error) {
    console.error("[Workflows API] Error fetching workflow runs:", error)
    return Response.json(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
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
      return Response.json({ error: "userId is required" }, { status: 400 })
    }

    if (!runIds || !Array.isArray(runIds) || runIds.length === 0) {
      return Response.json({ error: "runIds array is required" }, { status: 400 })
    }

    console.log(`[Workflows API] Deleting ${runIds.length} runs for user: ${userId}`)

    const result = await deleteWorkflowRuns(userId, runIds)

    console.log(`[Workflows API] Deleted ${result.deleted} runs, ${result.errors.length} errors`)

    return Response.json({
      success: true,
      deleted: result.deleted,
      errors: result.errors
    })
  } catch (error) {
    console.error("[Workflows API] Error deleting workflow runs:", error)
    return Response.json(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    )
  }
}
