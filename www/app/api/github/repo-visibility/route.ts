/**
 * GET /api/github/repo-visibility?owner=<owner>&repo=<repo>
 *
 * Checks GitHub repository visibility using unauthenticated GitHub API access.
 * - 200 + private=false => public
 * - 200 + private=true  => private
 * - 404                => private_or_unknown (GitHub hides private repos as 404)
 * - Other statuses      => unknown
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const owner = url.searchParams.get("owner")?.trim()
    const repo = url.searchParams.get("repo")?.trim()

    if (!owner || !repo) {
      return Response.json({ success: false, error: "Missing owner or repo" }, { status: 400 })
    }

    const githubResponse = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "dev3000-repo-visibility-check"
      }
    })

    if (githubResponse.status === 200) {
      const data = (await githubResponse.json()) as { private?: boolean }
      return Response.json({
        success: true,
        visibility: data.private ? "private" : "public"
      })
    }

    if (githubResponse.status === 404) {
      return Response.json({
        success: true,
        visibility: "private_or_unknown",
        reason: "not_found_or_private"
      })
    }

    // The GitHub REST API can return 403/429 for unauthenticated rate limits even when the
    // repository is public. Fall back to the public repo URL before forcing a PAT in the UI.
    const repoPageResponse = await fetch(`https://github.com/${owner}/${repo}`, {
      method: "HEAD",
      redirect: "follow",
      headers: {
        "User-Agent": "dev3000-repo-visibility-check"
      }
    })

    if (repoPageResponse.status === 200) {
      return Response.json({
        success: true,
        visibility: "public",
        reason: `repo_page_${githubResponse.status}`
      })
    }

    if (repoPageResponse.status === 404) {
      return Response.json({
        success: true,
        visibility: "private_or_unknown",
        reason: `repo_page_${githubResponse.status}_not_found_or_private`
      })
    }

    return Response.json({
      success: true,
      visibility: "unknown",
      reason: `github_status_${githubResponse.status}_repo_page_${repoPageResponse.status}`
    })
  } catch (error) {
    return Response.json(
      {
        success: true,
        visibility: "unknown",
        reason: error instanceof Error ? error.message : String(error)
      },
      { status: 200 }
    )
  }
}
