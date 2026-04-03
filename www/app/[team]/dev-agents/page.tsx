import { Plus } from "lucide-react"
import type { Route } from "next"
import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { DevAgentsDashboardShell } from "@/components/dev-agents/dashboard-shell"
import { DevAgentsCatalog } from "@/components/dev-agents/dev-agents-catalog"
import { Button } from "@/components/ui/button"
import { getAuthorizePath } from "@/lib/auth-redirect"
import { canEditDevAgent, listDevAgents, MARKETPLACE_AGENT_ORDER, MARKETPLACE_AGENT_STATS } from "@/lib/dev-agents"
import { getDevAgentsRouteContext } from "@/lib/dev-agents-route"

function getTeamAgentMockStats(devAgent: { id: string; usageCount: number }) {
  const mockStatsById: Record<string, { avgTime: string; avgCost: string }> = {
    r_c84m2f: { avgTime: "7m", avgCost: "$3.40" },
    r_d91q7k: { avgTime: "3m", avgCost: "$1.10" },
    r_p47n6x: { avgTime: "5m", avgCost: "$2.80" },
    r_t62v8m: { avgTime: "4m", avgCost: "$1.60" }
  }

  return (
    mockStatsById[devAgent.id] ?? {
      avgTime: devAgent.usageCount > 20 ? "5m" : "3m",
      avgCost: devAgent.usageCount > 20 ? "$2.30" : "$0.90"
    }
  )
}

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
      const mockStats = getTeamAgentMockStats(devAgent)
      return {
        devAgent,
        ownerName,
        canEdit: canEditDevAgent(devAgent, user),
        stats: {
          projectRuns: devAgent.usageCount.toLocaleString(),
          successRate: "—",
          mergeRate: "—",
          tokensUsed: "—",
          avgTime: mockStats.avgTime,
          avgCost: mockStats.avgCost,
          estCost: "—",
          previouslyPurchased: false
        }
      }
    })

  const marketplaceAgents = devAgents
    .filter((a) => a.kind === "marketplace")
    .sort((a, b) => {
      const aIndex = MARKETPLACE_AGENT_ORDER.indexOf(a.id as (typeof MARKETPLACE_AGENT_ORDER)[number])
      const bIndex = MARKETPLACE_AGENT_ORDER.indexOf(b.id as (typeof MARKETPLACE_AGENT_ORDER)[number])
      const normalizedAIndex = aIndex === -1 ? Number.MAX_SAFE_INTEGER : aIndex
      const normalizedBIndex = bIndex === -1 ? Number.MAX_SAFE_INTEGER : bIndex
      if (normalizedAIndex !== normalizedBIndex) return normalizedAIndex - normalizedBIndex
      return a.name.localeCompare(b.name)
    })
    .map((devAgent) => {
      const ownerName = devAgent.author.name || devAgent.author.username
      const stats = MARKETPLACE_AGENT_STATS[devAgent.id] ?? {
        projectRuns: "0",
        successRate: "—",
        mergeRate: "—",
        tokensUsed: "0",
        avgTime: "—",
        avgCost: "—",
        estCost: "—",
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
