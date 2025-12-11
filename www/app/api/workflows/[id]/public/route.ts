import { getCurrentUser } from "@/lib/auth"
import { getWorkflowRun, setWorkflowPublic } from "@/lib/workflow-storage"

/**
 * PATCH /api/workflows/[id]/public
 * Toggle the public visibility of a workflow report
 *
 * Body:
 * - isPublic: boolean - Whether the report should be publicly accessible
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser()

    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { id } = await params
    const body = await request.json()
    const { isPublic } = body

    if (typeof isPublic !== "boolean") {
      return Response.json({ error: "isPublic must be a boolean" }, { status: 400 })
    }

    // Verify the user owns this workflow run
    const existingRun = await getWorkflowRun(user.id, id)
    if (!existingRun) {
      return Response.json({ error: "Workflow run not found" }, { status: 404 })
    }

    const updatedRun = await setWorkflowPublic(user.id, id, isPublic)

    if (!updatedRun) {
      return Response.json({ error: "Failed to update workflow run" }, { status: 500 })
    }

    return Response.json({
      success: true,
      run: updatedRun
    })
  } catch (error) {
    console.error("[Workflows API] Error updating public status:", error)
    return Response.json(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    )
  }
}
