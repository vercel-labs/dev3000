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

    const userData = await userResponse.json()

    // Then fetch teams the user belongs to
    const teamsResponse = await fetch("https://api.vercel.com/v2/teams", {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    })

    if (!teamsResponse.ok) {
      const errorText = await teamsResponse.text()
      console.error("Failed to fetch teams:", teamsResponse.status, errorText)
      return Response.json(
        { error: `Failed to fetch teams: ${teamsResponse.status} ${errorText}` },
        { status: teamsResponse.status }
      )
    }

    const teamsData = await teamsResponse.json()

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
    if (teamsData.teams && Array.isArray(teamsData.teams)) {
      // biome-ignore lint/suspicious/noExplicitAny: Vercel API response shape is external
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const team of teamsData.teams as any[]) {
        teams.push({
          id: team.id,
          slug: team.slug,
          name: team.name,
          isPersonal: false
        })
      }
    }

    console.log(`Fetched ${teams.length} teams (including personal account)`)

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
