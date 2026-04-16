import { notFound, redirect } from "next/navigation"
import AdminRunsClient from "@/app/admin/runs/runs-client"
import { DevAgentsDashboardShell } from "@/components/dev-agents/dashboard-shell"
import { isAdminUser } from "@/lib/admin"
import { getAuthorizePath } from "@/lib/auth-redirect"
import { getDefaultDevAgentsRouteContext } from "@/lib/dev-agents-route"
import { listTelemetryEvents } from "@/lib/telemetry-storage"

const INITIAL_SINCE_DAYS = 30

export default async function AdminRunsPage() {
  const routeContext = await getDefaultDevAgentsRouteContext()

  if (!routeContext.user) {
    redirect(getAuthorizePath("/admin/runs"))
  }

  if (!isAdminUser(routeContext.user)) {
    notFound()
  }

  const selectedTeam = routeContext.selectedTeam || routeContext.defaultTeam
  if (!selectedTeam) {
    notFound()
  }

  const since = new Date(Date.now() - INITIAL_SINCE_DAYS * 24 * 60 * 60 * 1000)
  const initialEvents = await listTelemetryEvents({ since, limit: 2000 })

  return (
    <DevAgentsDashboardShell
      teams={routeContext.teams}
      selectedTeam={selectedTeam}
      section="admin"
      showAdminLink
      title="All Runs"
      description="Skill-runner install and run events across every team that's self-hosted or hosted."
    >
      <AdminRunsClient initialEvents={initialEvents} initialSinceDays={INITIAL_SINCE_DAYS} />
    </DevAgentsDashboardShell>
  )
}
