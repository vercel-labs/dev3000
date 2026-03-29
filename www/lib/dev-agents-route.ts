import { getCurrentUser } from "@/lib/auth"
import { getPreferredTeam, listCurrentUserTeams, resolveTeamFromParam, type VercelTeam } from "@/lib/vercel-teams"

interface RouteContext {
  user: Awaited<ReturnType<typeof getCurrentUser>>
  teams: VercelTeam[]
  selectedTeam: VercelTeam | null
  defaultTeam: VercelTeam | null
}

export async function getDevAgentsRouteContext(teamParam: string): Promise<RouteContext> {
  // Check auth first — bail early if unauthenticated or network is down,
  // so we redirect to login instead of crashing the page.
  const user = await getCurrentUser()
  if (!user) {
    return { user, teams: [], selectedTeam: null, defaultTeam: null }
  }

  const { teams, selectedTeam } = await resolveTeamFromParam(teamParam)

  return {
    user,
    teams,
    selectedTeam,
    defaultTeam: teams[0] ?? null
  }
}

export async function getDefaultDevAgentsRouteContext(): Promise<RouteContext> {
  const user = await getCurrentUser()
  if (!user) {
    return { user, teams: [], selectedTeam: null, defaultTeam: null }
  }

  const teams = await listCurrentUserTeams()
  const defaultTeam = await getPreferredTeam(teams)

  return {
    user,
    teams,
    selectedTeam: defaultTeam,
    defaultTeam
  }
}
