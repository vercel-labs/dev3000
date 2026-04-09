import { cookies } from "next/headers"

interface VercelProjectsResponse {
  projects?: Array<{
    id?: string
    name?: string
    framework?: string
    rootDirectory?: string
    link?: unknown
    latestDeployments?: Array<{
      id?: string
      url?: string
      state?: string
      readyState?: string
      createdAt?: number
      gitSource?: {
        type?: string
        repoId?: number
        ref?: string
        sha?: string
        message?: string
      }
      meta?: {
        githubOrg?: string
        githubRepo?: string
      }
    }>
  }>
  pagination?: {
    next?: number
  }
}

async function fetchAllProjects(accessToken: string, options: { teamId?: string | null; search?: string | null }) {
  const projects: NonNullable<VercelProjectsResponse["projects"]> = []
  let until: string | null = null

  for (let page = 0; page < 20; page++) {
    const apiUrl = new URL("https://api.vercel.com/v9/projects")
    if (options.teamId) {
      apiUrl.searchParams.set("teamId", options.teamId)
    }
    if (options.search) {
      apiUrl.searchParams.set("search", options.search)
    }
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
      throw new Error(`Failed to fetch projects: ${response.status} ${errorText}`)
    }

    const data = (await response.json()) as VercelProjectsResponse
    const pageProjects = Array.isArray(data.projects) ? data.projects : []
    projects.push(...pageProjects)

    const nextCursor = data.pagination?.next
    if (!nextCursor || pageProjects.length === 0) {
      break
    }

    until = String(nextCursor)
  }

  return projects
}

/**
 * API Route to fetch Vercel projects for a team/account
 *
 * Query params:
 * - teamId: Team ID or username (optional - if omitted, fetches personal projects)
 * - search: Project name search query (optional)
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
    const search = url.searchParams.get("search")

    const fetchedProjects = await fetchAllProjects(accessToken, { teamId, search })
    console.log(
      `[Projects API] Fetched ${fetchedProjects.length} projects${teamId ? ` for team ${teamId}` : " for personal account"}`
    )

    // Handle case where no projects exist
    if (fetchedProjects.length === 0) {
      return Response.json({
        success: true,
        projects: []
      })
    }

    // Format projects data
    const projects = fetchedProjects.map((project) => ({
      id: project.id,
      name: project.name,
      framework: project.framework,
      rootDirectory: project.rootDirectory,
      link: project.link,
      latestDeployments:
        project.latestDeployments?.map((deployment) => ({
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
            : null,
          // Include GitHub metadata for PR creation (fallback when project.link is missing)
          meta: deployment.meta
            ? {
                githubOrg: deployment.meta.githubOrg,
                githubRepo: deployment.meta.githubRepo
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
