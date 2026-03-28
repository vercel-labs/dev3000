import type { Route } from "next"
import { notFound, redirect } from "next/navigation"
import DevAgentRunClient from "@/app/dev-agents/[agentId]/new/dev-agent-run-client"
import { DevAgentsDashboardShell } from "@/components/dev-agents/dashboard-shell"
import { getAuthorizePath } from "@/lib/auth-redirect"
import { isV0DevAgentRunnerEnabled } from "@/lib/cloud/dev-agent-runner"
import { getDevAgent, MARKETPLACE_AGENT_STATS } from "@/lib/dev-agents"
import { getDevAgentsRouteContext } from "@/lib/dev-agents-route"

export default async function RunDevAgentPage({ params }: { params: Promise<{ team: string; agentId: string }> }) {
  const { team, agentId } = await params

  // Fetch route context and dev agent in parallel
  const [routeContext, devAgent] = await Promise.all([getDevAgentsRouteContext(team), getDevAgent(agentId)])

  if (!routeContext.user) {
    redirect(getAuthorizePath(`/${team}/dev-agents/${agentId}/new`))
  }

  if (!routeContext.selectedTeam) {
    if (routeContext.defaultTeam) {
      redirect(`/${routeContext.defaultTeam.slug}/dev-agents/${agentId}/new` as Route)
    }
    notFound()
  }

  if (!devAgent) {
    notFound()
  }

  const user = routeContext.user
  const selectedTeam = routeContext.selectedTeam
  if (devAgent.team && devAgent.team.id !== selectedTeam.id) {
    redirect(`/${devAgent.team.slug}/dev-agents/${devAgent.id}/new` as Route)
  }

  const ownerName = devAgent.author.id === "system" ? "Vercel" : devAgent.author.name || devAgent.author.username
  const marketplaceStats = MARKETPLACE_AGENT_STATS[agentId]

  return (
    <DevAgentsDashboardShell
      teams={routeContext.teams}
      selectedTeam={selectedTeam}
      title={devAgent.name}
      description={devAgent.description}
    >
      <DevAgentRunClient
        devAgent={devAgent}
        ownerName={ownerName}
        team={selectedTeam}
        user={user}
        defaultUseV0DevAgentRunner={isV0DevAgentRunnerEnabled()}
        marketplaceStats={marketplaceStats}
      />
    </DevAgentsDashboardShell>
  )
}
