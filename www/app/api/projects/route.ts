import { cookies } from "next/headers"

/**
 * API Route to fetch Vercel projects for a team/account
 *
 * Query params:
 * - teamId: Team ID or username (optional - if omitted, fetches personal projects)
 */
export async function GET(request: Request) {
  try {
    const cookieStore = await cookies()
    const accessToken = cookieStore.get("access_token")?.value

    if (!accessToken) {
      return Response.json({ error: "Not authenticated" }, { status: 401 })
    }

    const url = new URL(request.url)
    const teamId = url.searchParams.get("teamId")

    // Build the API URL with optional teamId parameter
    const apiUrl = new URL("https://api.vercel.com/v9/projects")
    if (teamId) {
      apiUrl.searchParams.set("teamId", teamId)
    }

    // Fetch projects from Vercel API
    console.log("Fetching projects from Vercel API:", apiUrl.toString())
    const response = await fetch(apiUrl.toString(), {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error("Failed to fetch projects:", response.status, errorText)
      return Response.json(
        { error: `Failed to fetch projects: ${response.status} ${errorText}` },
        { status: response.status }
      )
    }

    const data = await response.json()
    console.log("Projects API response:", JSON.stringify(data, null, 2))
    console.log(`Fetched ${data.projects?.length || 0} projects from Vercel API`)

    // Handle case where no projects exist
    if (!data.projects || data.projects.length === 0) {
      return Response.json({
        success: true,
        projects: []
      })
    }

    // Format projects data
    // biome-ignore lint/suspicious/noExplicitAny: Vercel API response shape is external
    const projects = data.projects.map((project: any) => ({
      id: project.id,
      name: project.name,
      framework: project.framework,
      link: project.link,
      latestDeployments:
        // biome-ignore lint/suspicious/noExplicitAny: Vercel API response shape is external
        project.latestDeployments?.map((deployment: any) => ({
          id: deployment.id,
          url: deployment.url,
          state: deployment.state,
          readyState: deployment.readyState,
          createdAt: deployment.createdAt,
          gitSource: deployment.gitSource
            ? {
                type: deployment.gitSource.type,
                repoId: deployment.gitSource.repoId,
                ref: deployment.gitSource.ref,
                sha: deployment.gitSource.sha,
                message: deployment.gitSource.message
              }
            : null
        })) || []
    }))

    return Response.json({
      success: true,
      projects
    })
  } catch (error) {
    console.error("Error fetching projects:", error)
    return Response.json(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    )
  }
}
