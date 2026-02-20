import { cookies } from "next/headers"

/**
 * API Route to fetch Vercel teams for the authenticated user
 *
 * Returns all teams the user has access to, including their personal account.
 */
export async function GET() {
  try {
    const cookieStore = await cookies()
    const accessToken = cookieStore.get("access_token")?.value

    if (!accessToken) {
      return Response.json({ error: "Not authenticated" }, { status: 401 })
    }

    // First, fetch the user's info to get their personal account
    const userResponse = await fetch("https://api.vercel.com/v2/user", {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    })

    if (!userResponse.ok) {
      const errorText = await userResponse.text()
      console.error("Failed to fetch user:", userResponse.status, errorText)
      return Response.json(
        { error: `Failed to fetch user: ${userResponse.status} ${errorText}` },
        { status: userResponse.status }
      )
    }

    const userData = (await userResponse.json()) as {
      user?: { id?: string; username?: string; name?: string }
    }

    // Then fetch all teams the user belongs to (paginated).
    const teamsData = await fetchAllTeams(accessToken)

    // Build teams array with personal account first
    const teams = []

    // Add personal account as a "team"
    if (userData.user) {
      teams.push({
        id: userData.user.id,
        slug: userData.user.username,
        name: userData.user.name || userData.user.username,
        isPersonal: true
      })
    }

    // Add actual teams
    if (teamsData.length > 0) {
      for (const team of teamsData) {
        teams.push({
          id: team.id,
          slug: team.slug,
          name: team.name,
          isPersonal: false
        })
      }
    }

    // Sort alphabetically for stable UX in team picker.
    teams.sort((a, b) => (a.name || a.slug || "").localeCompare(b.name || b.slug || "", undefined, { sensitivity: "base" }))

    const hasVercelTeam = teams.some((team) => {
      const slug = (team.slug || "").toLowerCase()
      const name = (team.name || "").toLowerCase()
      return slug === "vercel" || name === "vercel"
    })
    console.log(
      `[Teams API] fetched=${teams.length} hasVercelTeam=${hasVercelTeam} sample=${teams
        .slice(0, 10)
        .map((team) => `${team.name || "unknown"}(${team.slug || "no-slug"})`)
        .join(", ")}`
    )

    return Response.json({
      success: true,
      teams
    })
  } catch (error) {
    console.error("Error fetching teams:", error)
    return Response.json(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    )
  }
}

type VercelTeam = {
  id?: string
  slug?: string
  name?: string
}

type TeamsResponse = {
  teams?: VercelTeam[]
  pagination?: {
    next?: number
  }
}

async function fetchAllTeams(accessToken: string): Promise<VercelTeam[]> {
  const teams: VercelTeam[] = []
  const seenTeamIds = new Set<string>()
  let until: string | null = null

  for (let page = 0; page < 20; page++) {
    const apiUrl = new URL("https://api.vercel.com/v2/teams")
    apiUrl.searchParams.set("limit", "100")
    if (until) {
      apiUrl.searchParams.set("until", until)
    }

    const teamsResponse = await fetch(apiUrl.toString(), {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    })

    if (!teamsResponse.ok) {
      const errorText = await teamsResponse.text()
      throw new Error(`Failed to fetch teams: ${teamsResponse.status} ${errorText}`)
    }

    const pageData = (await teamsResponse.json()) as TeamsResponse
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
