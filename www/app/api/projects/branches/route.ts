import { getValidAccessToken } from "@/lib/auth"

/**
 * API Route to fetch branches with recent deployments for a project
 *
 * Query params:
 * - projectId: Vercel project ID (required)
 * - teamId: Team ID or username (optional)
 * - limit: Number of deployments to check (default: 20)
 */
export async function GET(request: Request) {
  try {
    const accessToken = await getValidAccessToken()

    if (!accessToken) {
      return Response.json({ error: "Not authenticated" }, { status: 401 })
    }

    const url = new URL(request.url)
    const projectId = url.searchParams.get("projectId")
    const teamId = url.searchParams.get("teamId")
    const limit = url.searchParams.get("limit") || "20"

    if (!projectId) {
      return Response.json({ error: "projectId is required" }, { status: 400 })
    }

    // Build the API URL to fetch recent deployments
    const apiUrl = new URL(`https://api.vercel.com/v6/deployments`)
    apiUrl.searchParams.set("projectId", projectId)
    apiUrl.searchParams.set("limit", limit)
    if (teamId) {
      apiUrl.searchParams.set("teamId", teamId)
    }

    console.log("Fetching deployments from Vercel API:", apiUrl.toString())
    const response = await fetch(apiUrl.toString(), {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error("Failed to fetch deployments:", response.status, errorText)
      return Response.json(
        { error: `Failed to fetch deployments: ${response.status} ${errorText}` },
        { status: response.status }
      )
    }

    const data = await response.json()
    console.log(`Fetched ${data.deployments?.length || 0} deployments`)

    // Extract unique branches with their latest deployment info
    const branchesMap = new Map<
      string,
      {
        name: string
        lastDeployment: {
          url: string
          createdAt: number
          state: string
          readyState: string
        }
      }
    >()

    for (const deployment of data.deployments || []) {
      const branch = deployment.meta?.githubCommitRef || deployment.gitSource?.ref || "main"

      // Only include deployments that are ready
      if (deployment.readyState !== "READY") {
        continue
      }

      // Only include the latest deployment per branch
      if (!branchesMap.has(branch)) {
        branchesMap.set(branch, {
          name: branch,
          lastDeployment: {
            url: deployment.url,
            createdAt: deployment.createdAt,
            state: deployment.state,
            readyState: deployment.readyState
          }
        })
      }
    }

    // Convert to array and sort by most recent deployment
    const branches = Array.from(branchesMap.values()).sort(
      (a, b) => b.lastDeployment.createdAt - a.lastDeployment.createdAt
    )

    console.log(
      `Found ${branches.length} unique branches with ready deployments:`,
      branches.map((b) => b.name)
    )

    return Response.json({
      success: true,
      branches
    })
  } catch (error) {
    console.error("Error fetching branches:", error)
    return Response.json(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    )
  }
}
