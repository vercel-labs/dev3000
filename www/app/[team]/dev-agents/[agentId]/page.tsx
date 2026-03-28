import type { Route } from "next"
import { notFound, redirect } from "next/navigation"
import NewDevAgentClient from "@/app/dev-agents/new/new-dev-agent-client"
import { DevAgentsDashboardShell } from "@/components/dev-agents/dashboard-shell"
import { getAuthorizePath } from "@/lib/auth-redirect"
import { canEditDevAgent, getDevAgent } from "@/lib/dev-agents"
import { getDevAgentsRouteContext } from "@/lib/dev-agents-route"

export default async function EditDevAgentPage({ params }: { params: Promise<{ team: string; agentId: string }> }) {
  const { team, agentId } = await params

  // Fetch route context and dev agent in parallel
  const [routeContext, devAgent] = await Promise.all([getDevAgentsRouteContext(team), getDevAgent(agentId)])

  if (!routeContext.user) {
    redirect(getAuthorizePath(`/${team}/dev-agents/${agentId}`))
  }

  if (!routeContext.selectedTeam) {
    if (routeContext.defaultTeam) {
      redirect(`/${routeContext.defaultTeam.slug}/dev-agents/${agentId}` as Route)
    }
    notFound()
  }

  if (!devAgent) {
    notFound()
  }

  const user = routeContext.user
  const selectedTeam = routeContext.selectedTeam
  if (devAgent.team && devAgent.team.id !== selectedTeam.id) {
    redirect(`/${devAgent.team.slug}/dev-agents/${devAgent.id}` as Route)
  }

  return (
    <DevAgentsDashboardShell teams={routeContext.teams} selectedTeam={selectedTeam}>
      <NewDevAgentClient
        user={user}
        team={selectedTeam}
        devAgent={devAgent}
        mode="edit"
        canEdit={canEditDevAgent(devAgent, user)}
      />
    </DevAgentsDashboardShell>
  )
}
