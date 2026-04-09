import { notFound, redirect } from "next/navigation"
import { SkillRunnerTeamSettingsPanel } from "@/components/admin/skill-runner-team-settings"
import { DevAgentsDashboardShell } from "@/components/dev-agents/dashboard-shell"
import { isAdminUser } from "@/lib/admin"
import { getAuthorizePath } from "@/lib/auth-redirect"
import { getDefaultDevAgentsRouteContext } from "@/lib/dev-agents-route"
import { listSkillRunnerTeamSettings } from "@/lib/skill-runners"

export default async function AdminPage() {
  const routeContext = await getDefaultDevAgentsRouteContext()

  if (!routeContext.user) {
    redirect(getAuthorizePath("/admin"))
  }

  if (!isAdminUser(routeContext.user)) {
    notFound()
  }

  const selectedTeam = routeContext.selectedTeam || routeContext.defaultTeam
  if (!selectedTeam) {
    notFound()
  }

  const items = await listSkillRunnerTeamSettings(
    routeContext.teams.map((team) => ({
      id: team.id,
      slug: team.slug,
      name: team.name,
      isPersonal: team.isPersonal
    }))
  )

  return (
    <DevAgentsDashboardShell
      teams={routeContext.teams}
      selectedTeam={selectedTeam}
      section="admin"
      showAdminLink
      title="Admin"
      description="Manage per-team skill-runner hosting mode and worker configuration."
    >
      <SkillRunnerTeamSettingsPanel items={items} />
    </DevAgentsDashboardShell>
  )
}
