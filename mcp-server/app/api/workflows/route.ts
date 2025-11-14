import { listWorkflowRuns } from "@/lib/workflow-storage"

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
