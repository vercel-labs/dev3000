import type { Route } from "next"
import { notFound, redirect } from "next/navigation"
import { getAuthorizePath } from "@/lib/auth-redirect"
import { getDevAgentsRouteContext } from "@/lib/dev-agents-route"

export default async function TeamProjectsPage({ params }: { params: Promise<{ team: string }> }) {
  const { team } = await params
  const routeContext = await getDevAgentsRouteContext(team)

  if (!routeContext.user) {
    redirect(getAuthorizePath(`/${team}`))
  }

  if (!routeContext.selectedTeam) {
    if (routeContext.defaultTeam) {
      redirect(`/${routeContext.defaultTeam.slug}` as Route)
    }
    notFound()
  }

  redirect(`/${routeContext.selectedTeam.slug}/dev-agents` as Route)
}
