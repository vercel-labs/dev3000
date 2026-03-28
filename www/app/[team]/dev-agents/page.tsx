import { Plus } from "lucide-react"
import type { Route } from "next"
import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { DevAgentsDashboardShell } from "@/components/dev-agents/dashboard-shell"
import { DevAgentsCatalog } from "@/components/dev-agents/dev-agents-catalog"
import { Button } from "@/components/ui/button"
import { getAuthorizePath } from "@/lib/auth-redirect"
import { canEditDevAgent, listDevAgents, MARKETPLACE_AGENT_STATS } from "@/lib/dev-agents"
import { getDevAgentsRouteContext } from "@/lib/dev-agents-route"

export default async function DevAgentsPage({ params }: { params: Promise<{ team: string }> }) {
  const { team } = await params
  const routeContext = await getDevAgentsRouteContext(team)

  if (!routeContext.user) {
    redirect(getAuthorizePath(`/${team}/dev-agents`))
  }

  if (!routeContext.selectedTeam) {
    if (routeContext.defaultTeam) {
      redirect(`/${routeContext.defaultTeam.slug}/dev-agents` as Route)
    }
    notFound()
  }

  const user = routeContext.user
  const selectedTeam = routeContext.selectedTeam
  const teamBasePath = `/${selectedTeam.slug}/dev-agents`
  const devAgents = await listDevAgents({ teamId: selectedTeam.id, teamSlug: selectedTeam.slug })

  const teamAgentsWithActions = devAgents
    .filter((a) => a.kind !== "marketplace")
    .map((devAgent) => {
      const ownerName = devAgent.author.id === "system" ? "Vercel" : devAgent.author.name || devAgent.author.username
      return { devAgent, ownerName, canEdit: canEditDevAgent(devAgent, user) }
    })

  const marketplaceAgents = devAgents
    .filter((a) => a.kind === "marketplace")
    .map((devAgent) => {
      const ownerName = devAgent.author.name || devAgent.author.username
      const stats = MARKETPLACE_AGENT_STATS[devAgent.id] ?? {
        projectRuns: "0",
        successRate: "—",
        tokensUsed: "0",
        previouslyPurchased: false
      }
      return { devAgent, ownerName, stats }
    })

  return (
    <DevAgentsDashboardShell
      teams={routeContext.teams}
      selectedTeam={selectedTeam}
      title="Dev Agents"
      description="Reusable fixers, audits, and project workflows."
      actions={
        <Button
          asChild
          size="sm"
          className="h-8 rounded-md bg-[#ededed] px-3 text-[13px] font-medium text-[#0a0a0a] hover:bg-white"
        >
          <Link href={`${teamBasePath}/new` as Route}>
            <Plus className="size-3.5" />
            New
          </Link>
        </Button>
      }
    >
      <DevAgentsCatalog
        teamBasePath={teamBasePath}
        teamAgents={teamAgentsWithActions}
        marketplaceAgents={marketplaceAgents}
      />
    </DevAgentsDashboardShell>
  )
}
