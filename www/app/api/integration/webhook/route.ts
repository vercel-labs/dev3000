/**
 * Vercel Integration Webhook Handler
 *
 * This endpoint receives webhooks from Vercel when deployments are ready.
 * It automatically triggers PR checks for preview deployments.
 *
 * Note: This uses Vercel's deployment metadata which includes GitHub info
 * automatically - no GitHub token setup required!
 */

export async function POST(request: Request) {
  try {
    const payload = await request.json()

    console.log("[Webhook] Received deployment event")
    console.log(`[Webhook] Type: ${payload.type}`)
    console.log(`[Webhook] Deployment: ${payload.deployment?.url}`)

    // Only process deployment.created events for preview deployments
    if (payload.type !== "deployment.created") {
      return Response.json({ message: "Ignoring non-deployment event" })
    }

    const deployment = payload.deployment

    // Only process preview deployments (not production)
    if (deployment.target === "production") {
      console.log("[Webhook] Skipping production deployment")
      return Response.json({ message: "Skipping production deployment" })
    }

    // Check if this is a PR deployment
    if (!deployment.meta?.githubCommitRef || !deployment.meta?.githubOrg || !deployment.meta?.githubRepo) {
      console.log("[Webhook] Not a GitHub PR deployment")
      return Response.json({ message: "Not a GitHub PR deployment" })
    }

    const branch = deployment.meta.githubCommitRef
    const owner = deployment.meta.githubOrg
    const repo = deployment.meta.githubRepo
    const previewUrl = `https://${deployment.url}`

    console.log(`[Webhook] Processing PR deployment for ${owner}/${repo}#${branch}`)

    // Find the PR number for this branch
    const prNumber = await findPRNumber(owner, repo, branch)

    if (!prNumber) {
      console.log(`[Webhook] No PR found for branch: ${branch}`)
      return Response.json({ message: "No PR found for this branch" })
    }

    console.log(`[Webhook] Found PR #${prNumber}`)

    // Fetch PR details
    const prDetails = await fetchPRDetails(owner, repo, prNumber)

    if (!prDetails) {
      console.log(`[Webhook] Failed to fetch PR details`)
      return Response.json({ error: "Failed to fetch PR details" }, { status: 500 })
    }

    // Get changed files
    const changedFiles = await getChangedFiles(owner, repo, prNumber)

    // Trigger the check-pr workflow
    console.log(`[Webhook] Triggering PR check workflow`)

    const workflowUrl = "https://dev3000-mcp.vercel.sh/api/cloud/check-pr"

    const workflowResponse = await fetch(workflowUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        previewUrl,
        prTitle: prDetails.title,
        prBody: prDetails.body,
        changedFiles,
        repoOwner: owner,
        repoName: repo,
        prNumber
      })
    })

    if (!workflowResponse.ok) {
      console.error(`[Webhook] Workflow failed: ${workflowResponse.status}`)
      return Response.json({ error: "Workflow failed" }, { status: 500 })
    }

    const result = await workflowResponse.json()

    console.log(`[Webhook] Workflow completed: ${result.success ? "success" : "failed"}`)
    console.log(`[Webhook] Report URL: ${result.reportUrl}`)

    // Optional: Post comment on PR if GITHUB_TOKEN is set
    if (process.env.GITHUB_TOKEN) {
      await postPRComment(owner, repo, prNumber, result)
      await setGitHubCheck(owner, repo, deployment.meta.githubCommitSha, result)
      console.log(`[Webhook] Posted results to PR`)
    } else {
      console.log(`[Webhook] Skipping GitHub comment (no GITHUB_TOKEN set)`)
      console.log(`[Webhook] View report at: ${result.reportUrl}`)
    }

    return Response.json({
      success: true,
      prNumber,
      reportUrl: result.reportUrl,
      checksPassed: result.success,
      githubCommentPosted: !!process.env.GITHUB_TOKEN
    })
  } catch (error) {
    console.error("[Webhook] Error:", error)
    return Response.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 })
  }
}

/**
 * Find PR number for a given branch
 */
async function findPRNumber(owner: string, repo: string, branch: string): Promise<string | null> {
  try {
    const headers: Record<string, string> = {
      Accept: "application/vnd.github.v3+json"
    }

    // Only add Authorization header if token is available
    if (process.env.GITHUB_TOKEN) {
      headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`
    }

    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/pulls?head=${owner}:${branch}&state=open`,
      { headers }
    )

    if (!response.ok) {
      console.error(`Failed to find PR: ${response.status}`)
      return null
    }

    const prs = await response.json()
    return prs.length > 0 ? String(prs[0].number) : null
  } catch (error) {
    console.error("Error finding PR:", error)
    return null
  }
}

/**
 * Fetch PR details from GitHub
 */
async function fetchPRDetails(owner: string, repo: string, prNumber: string) {
  try {
    const headers: Record<string, string> = {
      Accept: "application/vnd.github.v3+json"
    }

    // Only add Authorization header if token is available
    if (process.env.GITHUB_TOKEN) {
      headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`
    }

    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}`, {
      headers
    })

    if (!response.ok) {
      return null
    }

    const pr = await response.json()
    return {
      title: pr.title,
      body: pr.body || "",
      number: pr.number
    }
  } catch (error) {
    console.error("Error fetching PR details:", error)
    return null
  }
}

/**
 * Get changed files in PR
 */
async function getChangedFiles(owner: string, repo: string, prNumber: string): Promise<string[]> {
  try {
    const headers: Record<string, string> = {
      Accept: "application/vnd.github.v3+json"
    }

    // Only add Authorization header if token is available
    if (process.env.GITHUB_TOKEN) {
      headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`
    }

    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/files`, {
      headers
    })

    if (!response.ok) {
      return []
    }

    const files = await response.json()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- GitHub API file objects have dynamic structure
    return files.map((file: any) => file.filename)
  } catch (error) {
    console.error("Error getting changed files:", error)
    return []
  }
}

/**
 * Post comment on PR with results
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Workflow result object has dynamic structure
async function postPRComment(owner: string, repo: string, prNumber: string, result: any) {
  try {
    const statusEmoji = result.success ? "✅" : "❌"
    const comment = `## ${statusEmoji} dev3000 PR Check Results

**Status**: ${result.success ? "All checks passed" : "Some checks failed"}

### Summary
${result.verification?.summary || "Check completed"}

${result.performance?.slowPagesCount > 0 ? `\n⚠️ **Performance**: ${result.performance.slowPagesCount} slow page(s) detected` : ""}

**Full Report**: [View Details](${result.reportUrl})

---
*Powered by [dev3000](https://github.com/vercel-labs/dev3000)*`

    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${prNumber}/comments`, {
      method: "POST",
      headers: {
        Accept: "application/vnd.github.v3+json",
        Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ body: comment })
    })

    if (!response.ok) {
      console.error(`Failed to post comment: ${response.status}`)
    } else {
      console.log(`[Webhook] Posted comment on PR #${prNumber}`)
    }
  } catch (error) {
    console.error("Error posting PR comment:", error)
  }
}

/**
 * Set GitHub Check status
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Workflow result object has dynamic structure
async function setGitHubCheck(owner: string, repo: string, sha: string, result: any) {
  try {
    const status = result.success ? "success" : "failure"
    const description = result.success ? "All PR checks passed" : "Some PR checks failed"

    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/statuses/${sha}`, {
      method: "POST",
      headers: {
        Accept: "application/vnd.github.v3+json",
        Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        state: status,
        target_url: result.reportUrl,
        description,
        context: "dev3000/pr-check"
      })
    })

    if (!response.ok) {
      console.error(`Failed to set GitHub check: ${response.status}`)
    } else {
      console.log(`[Webhook] Set GitHub check status: ${status}`)
    }
  } catch (error) {
    console.error("Error setting GitHub check:", error)
  }
}
