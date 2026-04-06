import type { Route } from "next"
import { notFound, redirect } from "next/navigation"
import { DevAgentsDashboardShell } from "@/components/dev-agents/dashboard-shell"
import { getCurrentUser } from "@/lib/auth"
import { getSignInPath } from "@/lib/auth-redirect"
import { getDefaultDevAgentsRouteContext } from "@/lib/dev-agents-route"
import { listWorkflowRuns } from "@/lib/workflow-storage"
import DevAgentRunsClient from "./runs-client"

export default async function DevAgentRunsPage() {
  const user = await getCurrentUser()

  if (!user) {
    redirect(getSignInPath("/dev-agents/runs"))
  }

  const [runs, routeContext] = await Promise.all([listWorkflowRuns(user.id), getDefaultDevAgentsRouteContext()])

  if (!routeContext.selectedTeam) {
    if (routeContext.defaultTeam) {
      redirect(`/${routeContext.defaultTeam.slug}/dev-agents/runs` as Route)
    }
    notFound()
  }

  return (
    <DevAgentsDashboardShell teams={routeContext.teams} selectedTeam={routeContext.selectedTeam}>
      <DevAgentRunsClient userId={user.id} initialRuns={runs} />
    </DevAgentsDashboardShell>
  )
}
