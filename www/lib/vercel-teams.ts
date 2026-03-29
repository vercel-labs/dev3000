import { cookies } from "next/headers"
import { getValidAccessToken } from "@/lib/auth"
import { LAST_SELECTED_TEAM_COOKIE_NAME } from "@/lib/team-selection"

export interface VercelTeam {
  id: string
  slug: string
  name: string
  isPersonal: boolean
}

interface RawVercelTeam {
  id?: string
  slug?: string
  name?: string
}

interface TeamsResponse {
  teams?: RawVercelTeam[]
  pagination?: {
    next?: number
  }
}

async function fetchAllTeams(accessToken: string): Promise<RawVercelTeam[]> {
  const teams: RawVercelTeam[] = []
  const seenTeamIds = new Set<string>()
  let until: string | null = null

  for (let page = 0; page < 20; page++) {
    const apiUrl = new URL("https://api.vercel.com/v2/teams")
    apiUrl.searchParams.set("limit", "100")
    if (until) {
      apiUrl.searchParams.set("until", until)
    }

    const response = await fetch(apiUrl.toString(), {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Failed to fetch teams: ${response.status} ${errorText}`)
    }

    const pageData = (await response.json()) as TeamsResponse
    const pageTeams = Array.isArray(pageData.teams) ? pageData.teams : []

    for (const team of pageTeams) {
      const dedupeKey = team.id || `${team.slug}:${team.name}`
      if (!dedupeKey || seenTeamIds.has(dedupeKey)) continue
      seenTeamIds.add(dedupeKey)
      teams.push(team)
    }

    const nextCursor = pageData.pagination?.next
    if (!nextCursor || pageTeams.length === 0) {
      break
    }

    until = String(nextCursor)
  }

  return teams
}

export async function listCurrentUserTeams(): Promise<VercelTeam[]> {
  const accessToken = await getValidAccessToken()
  if (!accessToken) {
    return []
  }

  // Fetch user info and teams in parallel to avoid sequential waterfall
  const [userResponse, fetchedTeams] = await Promise.all([
    fetch("https://api.vercel.com/v2/user", {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    }),
    fetchAllTeams(accessToken)
  ])

  if (!userResponse.ok) {
    const errorText = await userResponse.text()
    throw new Error(`Failed to fetch user: ${userResponse.status} ${errorText}`)
  }

  const userData = (await userResponse.json()) as {
    user?: { id?: string; username?: string; name?: string }
  }
  const teams: VercelTeam[] = []

  if (userData.user?.id && userData.user?.username) {
    teams.push({
      id: userData.user.id,
      slug: userData.user.username,
      name: userData.user.name || userData.user.username,
      isPersonal: true
    })
  }

  for (const team of fetchedTeams) {
    if (!team.id || !team.slug || !team.name) continue
    teams.push({
      id: team.id,
      slug: team.slug,
      name: team.name,
      isPersonal: false
    })
  }

  teams.sort((a, b) => {
    if (a.isPersonal && !b.isPersonal) return -1
    if (!a.isPersonal && b.isPersonal) return 1
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
  })

  return teams
}

export async function getPreferredTeam(teams: VercelTeam[]): Promise<VercelTeam | null> {
  if (teams.length === 0) {
    return null
  }

  const cookieStore = await cookies()
  const lastSelectedTeam = cookieStore.get(LAST_SELECTED_TEAM_COOKIE_NAME)?.value?.trim().toLowerCase()
  if (lastSelectedTeam) {
    const preferredTeam =
      teams.find((team) => team.slug.toLowerCase() === lastSelectedTeam) ||
      teams.find((team) => team.id.toLowerCase() === lastSelectedTeam)
    if (preferredTeam) {
      return preferredTeam
    }
  }

  return teams[0] ?? null
}

export async function getDefaultTeam(): Promise<VercelTeam | null> {
  const teams = await listCurrentUserTeams()
  return getPreferredTeam(teams)
}

export async function resolveTeamFromParam(teamParam: string): Promise<{
  selectedTeam: VercelTeam | null
  teams: VercelTeam[]
}> {
  const teams = await listCurrentUserTeams()
  const normalizedTeamParam = teamParam.trim().toLowerCase()
  const selectedTeam =
    teams.find((team) => team.slug.toLowerCase() === normalizedTeamParam) ||
    teams.find((team) => team.id.toLowerCase() === normalizedTeamParam) ||
    null

  return { selectedTeam, teams }
}
