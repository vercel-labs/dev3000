import { redirect } from "next/navigation"
import { getCurrentUser } from "@/lib/auth"
import { listWorkflowRuns } from "@/lib/workflow-storage"
import WorkflowsClient from "./workflows-client"

export default async function WorkflowsPage() {
  const user = await getCurrentUser()

  if (!user) {
    redirect("/signin")
  }

  const runs = await listWorkflowRuns(user.id)

  return <WorkflowsClient user={user} initialRuns={runs} />
}
