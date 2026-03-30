import { readFile } from "node:fs/promises"
import { join } from "node:path"
import type { Route } from "next"
import { notFound, redirect } from "next/navigation"
import NewDevAgentClient from "@/app/dev-agents/new/new-dev-agent-client"
import { DevAgentsDashboardShell } from "@/components/dev-agents/dashboard-shell"
import { getAuthorizePath } from "@/lib/auth-redirect"
import { getDevAgentsRouteContext } from "@/lib/dev-agents-route"
import { inferDevServerCommandFromPackageJson } from "@/lib/dev-server-command"

async function getWorkspaceDefaultDevServerCommand(): Promise<string> {
  try {
    const packageJson = JSON.parse(await readFile(join(process.cwd(), "package.json"), "utf8")) as {
      packageManager?: string
      scripts?: Record<string, string>
    }
    return inferDevServerCommandFromPackageJson(packageJson, "bun")
  } catch {
    return "bun run dev"
  }
}

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
  const defaultDevServerCommand = await getWorkspaceDefaultDevServerCommand()

  return (
    <DevAgentsDashboardShell teams={routeContext.teams} selectedTeam={selectedTeam}>
      <NewDevAgentClient user={user} team={selectedTeam} defaultDevServerCommand={defaultDevServerCommand} />
    </DevAgentsDashboardShell>
  )
}
