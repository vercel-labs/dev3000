import type { Route } from "next"
import { notFound, redirect } from "next/navigation"
import NewDevAgentClient from "@/app/dev-agents/new/new-dev-agent-client"
import { DevAgentsDashboardShell } from "@/components/dev-agents/dashboard-shell"
import { getAuthorizePath } from "@/lib/auth-redirect"
import { getDevAgentsRouteContext } from "@/lib/dev-agents-route"

export default async function NewDevAgentPage({ params }: { params: Promise<{ team: string }> }) {
  const { team } = await params
  const routeContext = await getDevAgentsRouteContext(team)

  if (!routeContext.user) {
    redirect(getAuthorizePath(`/${team}/dev-agents/new`))
  }

  if (!routeContext.selectedTeam) {
    if (routeContext.defaultTeam) {
      redirect(`/${routeContext.defaultTeam.slug}/dev-agents/new` as Route)
    }
    notFound()
  }

  const user = routeContext.user
  const selectedTeam = routeContext.selectedTeam

  return (
    <DevAgentsDashboardShell teams={routeContext.teams} selectedTeam={selectedTeam}>
      <NewDevAgentClient user={user} team={selectedTeam} />
    </DevAgentsDashboardShell>
  )
}
