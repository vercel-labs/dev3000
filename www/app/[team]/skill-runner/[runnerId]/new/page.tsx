import type { Route } from "next"
import { notFound, redirect } from "next/navigation"
import DevAgentRunClient from "@/app/dev-agents/[agentId]/new/dev-agent-run-client"
import { DevAgentsDashboardShell } from "@/components/dev-agents/dashboard-shell"
import { isAdminUser } from "@/lib/admin"
import { getAuthorizePath } from "@/lib/auth-redirect"
import { isV0DevAgentRunnerEnabled } from "@/lib/cloud/dev-agent-runner"
import { getDevAgentsRouteContext } from "@/lib/dev-agents-route"
import { getSkillRunner, getSkillRunnerTeamSettings } from "@/lib/skill-runners"

export default async function RunSkillRunnerPage({ params }: { params: Promise<{ team: string; runnerId: string }> }) {
  const { team, runnerId } = await params
  const routeContext = await getDevAgentsRouteContext(team)

  if (!routeContext.user) {
    redirect(getAuthorizePath(`/${team}/skill-runner/${runnerId}/new`))
  }

  if (!routeContext.selectedTeam) {
    if (routeContext.defaultTeam) {
      redirect(`/${routeContext.defaultTeam.slug}/skill-runner/${runnerId}/new` as Route)
    }
    notFound()
  }

  const selectedTeam = routeContext.selectedTeam
  const [skillRunner, teamSettings] = await Promise.all([
    getSkillRunner(selectedTeam, runnerId),
    getSkillRunnerTeamSettings(selectedTeam)
  ])

  if (!skillRunner) {
    notFound()
  }

  const ownerName = skillRunner.runnerCanonicalPath?.split("/")[0] || "Vercel"

  return (
    <DevAgentsDashboardShell
      teams={routeContext.teams}
      selectedTeam={selectedTeam}
      section="skill-runner"
      showAdminLink={isAdminUser(routeContext.user)}
      title={skillRunner.name}
      description={skillRunner.description}
    >
      <DevAgentRunClient
        devAgent={skillRunner}
        ownerName={ownerName}
        team={selectedTeam}
        user={routeContext.user}
        defaultUseV0DevAgentRunner={isV0DevAgentRunnerEnabled()}
        runnerKind="skill-runner"
        skillRunnerExecutionMode={teamSettings.executionMode}
        skillRunnerWorkerBaseUrl={teamSettings.workerBaseUrl}
      />
    </DevAgentsDashboardShell>
  )
}
