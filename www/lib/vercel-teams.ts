import { cookies } from "next/headers"
import { getVercelApiAccessToken } from "@/lib/auth"
import { LAST_SELECTED_TEAM_COOKIE_NAME } from "@/lib/team-selection"

export interface VercelTeam {
  id: string
  slug: string
  name: string
  isPersonal: boolean
  avatarUrl?: string
  planLabel?: string
}

interface RawVercelTeam {
  id?: string
  slug?: string
  name?: string
  avatar?: string
  avatarUrl?: string
  image?: string
  profileImage?: string
  plan?: string
  billing?: {
    plan?: string
  }
}

interface RawVercelUser {
  uid?: string
  id?: string
  username?: string
  name?: string
  email?: string
  avatar?: string
  avatarUrl?: string
  image?: string
  profileImage?: string
  plan?: string
  billing?: {
    plan?: string
  }
}

interface UserResponse {
  user?: RawVercelUser
}

interface TeamsResponse {
  teams?: RawVercelTeam[]
  pagination?: {
    next?: number
  }
}

function normalizePlanLabel(value: string | undefined, fallback?: string): string | undefined {
  const normalized = value?.trim().toLowerCase()
  if (!normalized) {
    return fallback
  }

  if (normalized === "hobby") return "Hobby"
  if (normalized === "pro") return "Pro"
  if (normalized === "enterprise") return "Enterprise"

  return normalized.charAt(0).toUpperCase() + normalized.slice(1)
}

function pickAvatarUrl(value: {
  id?: string
  avatar?: string
  avatarUrl?: string
  image?: string
  profileImage?: string
}): string | undefined {
  if (value.id) {
    return `https://vercel.com/api/www/avatar?s=64&teamId=${encodeURIComponent(value.id)}`
  }

  const direct = value.avatarUrl || value.image || value.profileImage
  if (direct) {
    return direct
  }

  const avatar = value.avatar?.trim()
  if (!avatar) {
    return undefined
  }

  if (avatar.startsWith("http://") || avatar.startsWith("https://")) {
    return avatar
  }

  return `https://api.vercel.com/www/avatar/${avatar}`
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
      },
      cache: "no-store"
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

function normalizePersonalTeam(user: RawVercelUser | undefined): VercelTeam | null {
  const id = user?.uid || user?.id || user?.username
  const slug = user?.username

  if (!id || !slug) {
    return null
  }

  return {
    id,
    slug,
    name: user.name || user.username || user.email || "Personal Account",
    isPersonal: true,
    avatarUrl: pickAvatarUrl({
      avatar: user.avatar,
      avatarUrl: user.avatarUrl,
      image: user.image,
      profileImage: user.profileImage
    }),
    planLabel: normalizePlanLabel(user.plan || user.billing?.plan, "Personal")
  }
}

export async function listTeamsForAccessToken(accessToken: string): Promise<VercelTeam[]> {
  // Fetch user info and teams in parallel, but degrade gracefully if the
  // Vercel API flakes so report pages still render.
  const [userResult, teamsResult] = await Promise.allSettled([
    fetch("https://api.vercel.com/v2/user", {
      headers: {
        Authorization: `Bearer ${accessToken}`
      },
      cache: "no-store"
    }),
    fetchAllTeams(accessToken)
  ])

  let personalTeam: VercelTeam | null = null
  if (userResult.status === "fulfilled") {
    if (userResult.value.ok) {
      const userData = (await userResult.value.json()) as UserResponse
      personalTeam = normalizePersonalTeam(userData.user)
    } else {
      const errorText = await userResult.value.text()
      console.error(`[Vercel Teams] Failed to fetch user: ${userResult.value.status} ${errorText}`)
    }
  } else {
    console.error("[Vercel Teams] Failed to fetch user:", userResult.reason)
  }

  const fetchedTeams =
    teamsResult.status === "fulfilled"
      ? teamsResult.value
      : (() => {
          console.error("[Vercel Teams] Failed to fetch teams:", teamsResult.reason)
          return []
        })()

  const teams: VercelTeam[] = []
  const seenTeamIds = new Set<string>()
  const seenTeamSlugs = new Set<string>()

  for (const team of fetchedTeams) {
    if (!team.id || !team.slug || !team.name) continue
    const normalizedId = team.id.toLowerCase()
    const normalizedSlug = team.slug.toLowerCase()
    if (seenTeamIds.has(normalizedId) || seenTeamSlugs.has(normalizedSlug)) {
      continue
    }

    seenTeamIds.add(normalizedId)
    seenTeamSlugs.add(normalizedSlug)
    teams.push({
      id: team.id,
      slug: team.slug,
      name: team.name,
      isPersonal: false,
      avatarUrl: pickAvatarUrl(team),
      planLabel: normalizePlanLabel(team.plan || team.billing?.plan)
    })
  }

  if (personalTeam) {
    const normalizedPersonalId = personalTeam.id.toLowerCase()
    const normalizedPersonalSlug = personalTeam.slug.toLowerCase()
    if (!seenTeamIds.has(normalizedPersonalId) && !seenTeamSlugs.has(normalizedPersonalSlug)) {
      teams.push(personalTeam)
    }
  }

  teams.sort((a, b) => {
    if (a.isPersonal && !b.isPersonal) return -1
    if (!a.isPersonal && b.isPersonal) return 1
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
  })

  return teams
}

export async function listCurrentUserTeams(): Promise<VercelTeam[]> {
  const accessToken = await getVercelApiAccessToken()
  if (!accessToken) {
    return []
  }

  return listTeamsForAccessToken(accessToken)
}

export async function getPreferredTeam(teams: VercelTeam[]): Promise<VercelTeam | null> {
  if (teams.length === 0) {
    return null
  }

  const cookieStore = await cookies()
  const lastSelectedTeam = cookieStore.get(LAST_SELECTED_TEAM_COOKIE_NAME)?.value?.trim().toLowerCase()
  if (lastSelectedTeam) {
    const preferredTeam =
      teams.find((team) => team.id.toLowerCase() === lastSelectedTeam) ||
      teams.find((team) => !team.isPersonal && team.slug.toLowerCase() === lastSelectedTeam) ||
      teams.find((team) => team.slug.toLowerCase() === lastSelectedTeam)
    if (preferredTeam) {
      return preferredTeam
    }
  }

  const firstOrganizationTeam = teams.find((team) => !team.isPersonal)
  if (firstOrganizationTeam) {
    return firstOrganizationTeam
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
  return resolveTeamFromList(teamParam, teams)
}

export async function resolveTeamFromParamWithAccessToken(
  teamParam: string,
  accessToken: string
): Promise<{
  selectedTeam: VercelTeam | null
  teams: VercelTeam[]
}> {
  const teams = await listTeamsForAccessToken(accessToken)
  return resolveTeamFromList(teamParam, teams)
}

function resolveTeamFromList(
  teamParam: string,
  teams: VercelTeam[]
): {
  selectedTeam: VercelTeam | null
  teams: VercelTeam[]
} {
  const normalizedTeamParam = teamParam.trim().toLowerCase()
  const selectedTeam =
    teams.find((team) => team.id.toLowerCase() === normalizedTeamParam) ||
    teams.find((team) => !team.isPersonal && team.slug.toLowerCase() === normalizedTeamParam) ||
    teams.find((team) => team.slug.toLowerCase() === normalizedTeamParam) ||
    null

  return { selectedTeam, teams }
}
