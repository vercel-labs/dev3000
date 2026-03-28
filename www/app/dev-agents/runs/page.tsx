import { redirect } from "next/navigation"
import { getCurrentUser } from "@/lib/auth"
import { getSignInPath } from "@/lib/auth-redirect"
import { listWorkflowRuns } from "@/lib/workflow-storage"
import DevAgentRunsClient from "./runs-client"

export default async function DevAgentRunsPage() {
  const user = await getCurrentUser()

  if (!user) {
    redirect(getSignInPath("/dev-agents/runs"))
  }

  const runs = await listWorkflowRuns(user.id)

  return <DevAgentRunsClient user={user} initialRuns={runs} />
}
