import { cookies } from "next/headers"

/**
 * API Route to fetch Vercel teams for the authenticated user
 *
 * Returns both personal account and team accounts from Vercel API
 */
export async function GET() {
  try {
    const cookieStore = await cookies()
    const accessToken = cookieStore.get("access_token")?.value

    if (!accessToken) {
      return Response.json({ error: "Not authenticated" }, { status: 401 })
    }

    // Fetch user's teams from Vercel API
    const teamsResponse = await fetch("https://api.vercel.com/v2/teams", {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    })

    // Fetch user info to get personal account
    const userResponse = await fetch("https://api.vercel.com/v2/user", {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    })

    if (!userResponse.ok) {
      console.error("Failed to fetch user info:", userResponse.status)
      return Response.json({ error: "Failed to fetch user info" }, { status: userResponse.status })
    }

    const userData = await userResponse.json()
    console.log("User data from Vercel API:", JSON.stringify(userData.user, null, 2))

    // For personal account, we should not pass a teamId to the projects API
    // So we use a special marker that the frontend can check
    const personalAccount = {
      id: userData.user.uid || userData.user.id || userData.user.username,
      slug: userData.user.username,
      name: userData.user.name || userData.user.username,
      isPersonal: true
    }
    console.log("Created personal account:", JSON.stringify(personalAccount, null, 2))

    // Get teams if the request succeeded
    // biome-ignore lint/suspicious/noExplicitAny: Vercel API response shape is external
    let teams: any[] = []
    if (teamsResponse.ok) {
      const teamsData = await teamsResponse.json()
      console.log("Teams data from Vercel API:", JSON.stringify(teamsData, null, 2))
      // biome-ignore lint/suspicious/noExplicitAny: Vercel API response shape is external
      teams = (teamsData.teams || []).map((team: any) => ({
        id: team.id || team.slug,
        slug: team.slug,
        name: team.name,
        isPersonal: false
      }))
      console.log(`Mapped ${teams.length} teams`)
    } else {
      const errorText = await teamsResponse.text()
      console.warn("Failed to fetch teams:", teamsResponse.status, errorText)
    }

    // Prepend personal account
    const allAccounts = [personalAccount, ...teams]
    console.log(`Returning ${allAccounts.length} total accounts (1 personal + ${teams.length} teams)`)

    return Response.json({
      success: true,
      teams: allAccounts
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
