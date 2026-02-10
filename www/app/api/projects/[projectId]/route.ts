import { cookies } from "next/headers"

/**
 * API Route to fetch a single Vercel project by ID.
 *
 * Query params:
 * - teamId: Team ID or username (optional - if omitted, fetches personal projects)
 */
export async function GET(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const cookieStore = await cookies()
    const accessToken = cookieStore.get("access_token")?.value

    if (!accessToken) {
      return Response.json({ error: "Not authenticated" }, { status: 401 })
    }

    const { projectId } = await params
    const url = new URL(request.url)
    const teamId = url.searchParams.get("teamId")

    const apiUrl = new URL(`https://api.vercel.com/v9/projects/${projectId}`)
    if (teamId) {
      apiUrl.searchParams.set("teamId", teamId)
    }

    const response = await fetch(apiUrl.toString(), {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error("Failed to fetch project:", response.status, errorText)
      return Response.json(
        { error: `Failed to fetch project: ${response.status} ${errorText}` },
        { status: response.status }
      )
    }

    const project = (await response.json()) as {
      id?: string
      name?: string
      framework?: string
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
    }

    const formatted = {
      id: project.id,
      name: project.name,
      framework: project.framework,
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
          meta: deployment.meta
            ? {
                githubOrg: deployment.meta.githubOrg,
                githubRepo: deployment.meta.githubRepo
              }
            : null
        })) || []
    }

    return Response.json({ success: true, project: formatted })
  } catch (error) {
    console.error("Error fetching project:", error)
    return Response.json(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    )
  }
}
