import type { Route } from "next"
import { notFound, redirect } from "next/navigation"
import { DevAgentsDashboardShell } from "@/components/dev-agents/dashboard-shell"
import { SkillRunnersCatalog } from "@/components/skill-runners/skill-runners-catalog"
import { isAdminUser } from "@/lib/admin"
import { getAuthorizePath } from "@/lib/auth-redirect"
import { getDevAgentsRouteContext } from "@/lib/dev-agents-route"
import { listSkillRunners } from "@/lib/skill-runners"

export default async function SkillRunnerPage({ params }: { params: Promise<{ team: string }> }) {
  const { team } = await params
  const routeContext = await getDevAgentsRouteContext(team)

  if (!routeContext.user) {
    redirect(getAuthorizePath(`/${team}/skill-runner`))
  }

  if (!routeContext.selectedTeam) {
    if (routeContext.defaultTeam) {
      redirect(`/${routeContext.defaultTeam.slug}/skill-runner` as Route)
    }
    notFound()
  }

  const selectedTeam = routeContext.selectedTeam
  const runners = await listSkillRunners(selectedTeam)

  return (
    <DevAgentsDashboardShell
      teams={routeContext.teams}
      selectedTeam={selectedTeam}
      section="skill-runner"
      showAdminLink={isAdminUser(routeContext.user)}
      title="Skill Runner"
      description="Run high-confidence skills against a project and get a PR, with imported skills listed first."
    >
      <SkillRunnersCatalog teamSlug={selectedTeam.slug} runners={runners} />
    </DevAgentsDashboardShell>
  )
}
