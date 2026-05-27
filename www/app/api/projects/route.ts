import { getVercelApiAccessToken } from "@/lib/auth"

interface VercelProjectsResponse {
  projects?: Array<{
    id?: string
    name?: string
    framework?: string
    rootDirectory?: string
    createdAt?: number | string
    updatedAt?: number | string
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

const DEFAULT_PROJECT_LIMIT = 20
const DEFAULT_SEARCH_LIMIT = 50
const MAX_PROJECT_LIMIT = 100
const MAX_PROJECT_PAGES = 20

function parseLimit(value: string | null, fallback: number): number {
  if (!value) return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback
  return Math.min(parsed, MAX_PROJECT_LIMIT)
}

async function fetchProjects(
  accessToken: string,
  options: { maxPages: number; teamId?: string | null; search?: string | null; limit: number }
) {
  const projects: NonNullable<VercelProjectsResponse["projects"]> = []
  let until: string | null = null
  let next: number | undefined

  for (let page = 0; page < options.maxPages; page++) {
    const apiUrl = new URL("https://api.vercel.com/v9/projects")
    if (options.teamId) {
      apiUrl.searchParams.set("teamId", options.teamId)
    }
    if (options.search) {
      apiUrl.searchParams.set("search", options.search)
    }
    apiUrl.searchParams.set("limit", String(options.limit))
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
    next = nextCursor
    if (!nextCursor || pageProjects.length === 0) {
      break
    }

    until = String(nextCursor)
  }

  return {
    hasMore: Boolean(next),
    next,
    projects
  }
}

/**
 * API Route to fetch Vercel projects for a team/account
 *
 * Query params:
 * - teamId: Team ID or username (optional - if omitted, fetches personal projects)
 * - search: Project name search query (optional)
 * - limit: Maximum projects to return for each page (default: 20, search default: 50, max: 100)
 * - all: Set to 1 to paginate through up to 20 pages. Omit for picker-friendly bounded fetches.
 */
export async function GET(request: Request) {
  try {
    const accessToken = await getVercelApiAccessToken()

    if (!accessToken) {
      return Response.json({ error: "Not authenticated" }, { status: 401 })
    }

    const url = new URL(request.url)
    const teamId = url.searchParams.get("teamId")
    const search = url.searchParams.get("search")?.trim() || null
    const limit = parseLimit(url.searchParams.get("limit"), search ? DEFAULT_SEARCH_LIMIT : DEFAULT_PROJECT_LIMIT)
    const fetchAll = url.searchParams.get("all") === "1"

    const result = await fetchProjects(accessToken, {
      maxPages: fetchAll ? MAX_PROJECT_PAGES : 1,
      teamId,
      search,
      limit
    })
    const fetchedProjects = result.projects
    console.log(
      `[Projects API] Fetched ${fetchedProjects.length} projects${teamId ? ` for team ${teamId}` : " for personal account"}${search ? ` matching "${search}"` : ""}${result.hasMore ? " (more available)" : ""}`
    )

    // Handle case where no projects exist
    if (fetchedProjects.length === 0) {
      return Response.json({
        success: true,
        projects: [],
        pagination: {
          hasMore: result.hasMore,
          next: result.next
        }
      })
    }

    // Format projects data
    const projects = fetchedProjects.map((project) => ({
      id: project.id,
      name: project.name,
      framework: project.framework,
      rootDirectory: project.rootDirectory,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
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
      projects,
      pagination: {
        hasMore: result.hasMore,
        next: result.next
      }
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
