import { listCurrentUserTeams } from "@/lib/vercel-teams"

/**
 * API Route to fetch Vercel teams for the authenticated user
 *
 * Returns all teams the user has access to, including their personal account.
 */
export async function GET() {
  try {
    const teams = await listCurrentUserTeams()

    if (teams.length === 0) {
      return Response.json({ error: "Not authenticated" }, { status: 401 })
    }

    const hasVercelTeam = teams.some((team) => {
      const slug = team.slug.toLowerCase()
      const name = team.name.toLowerCase()
      return slug === "vercel" || name === "vercel"
    })
    console.log(
      `[Teams API] fetched=${teams.length} hasVercelTeam=${hasVercelTeam} sample=${teams
        .slice(0, 10)
        .map((team) => `${team.name}(${team.slug})`)
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
