import { getCurrentUserFromRequest } from "@/lib/auth"
import { saveWorkflowRun, type WorkflowRun } from "@/lib/workflow-storage"

export const maxDuration = 60

function isWorkflowRun(value: unknown): value is WorkflowRun {
  if (!value || typeof value !== "object") return false
  const run = value as Partial<WorkflowRun>
  return (
    typeof run.id === "string" &&
    typeof run.userId === "string" &&
    typeof run.projectName === "string" &&
    typeof run.timestamp === "string" &&
    (run.status === "running" || run.status === "done" || run.status === "failure")
  )
}

export async function POST(request: Request) {
  const user = await getCurrentUserFromRequest(request)
  if (!user) {
    return Response.json({ success: false, error: "Not authenticated" }, { status: 401 })
  }

  const body = await request.json().catch(() => null)
  const run = body && typeof body === "object" ? (body as { run?: unknown }).run : undefined

  if (!isWorkflowRun(run)) {
    return Response.json({ success: false, error: "Invalid workflow run payload" }, { status: 400 })
  }

  if (run.userId !== user.id) {
    return Response.json({ success: false, error: "Workflow run user mismatch" }, { status: 403 })
  }

  await saveWorkflowRun(run)

  return Response.json({ success: true })
}
