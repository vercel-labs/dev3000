import { getVercelApiAccessToken } from "@/lib/auth"

/**
 * API Route to fetch a single Vercel project by ID.
 *
 * Query params:
 * - teamId: Team ID or username (optional - if omitted, fetches personal projects)
 */
export async function GET(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const accessToken = await getVercelApiAccessToken()

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
          githubRepoOwner?: string
          githubCommitOrg?: string
          githubCommitRepo?: string
          githubCommitRepoId?: string
        }
      }>
    }

    const formatted = {
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
          meta: deployment.meta
            ? {
                githubOrg: deployment.meta.githubOrg,
                githubRepo: deployment.meta.githubRepo,
                githubRepoOwner: deployment.meta.githubRepoOwner,
                githubCommitOrg: deployment.meta.githubCommitOrg,
                githubCommitRepo: deployment.meta.githubCommitRepo,
                githubCommitRepoId: deployment.meta.githubCommitRepoId
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
