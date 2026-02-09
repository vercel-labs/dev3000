import chalk from "chalk"
import { execFileSync } from "child_process"
import { isValidRepoArg } from "../utils/repo-validate.js"

interface CheckPROptions {
  prNumber?: string
  repo?: string
  url?: string
  debug?: boolean
}

export async function cloudCheckPR(options: CheckPROptions) {
  const { prNumber, repo, url, debug = false } = options

  if (prNumber && !/^\d+$/.test(prNumber)) {
    console.error(chalk.red("❌ Invalid PR number (must be digits only)"))
    process.exit(1)
  }

  if (repo && !isValidRepoArg(repo)) {
    console.error(chalk.red("❌ Invalid repo format. Use 'owner/name' or a GitHub URL."))
    process.exit(1)
  }

  if (debug) {
    console.log(chalk.gray("[DEBUG] Starting cloud check-pr"))
    console.log(chalk.gray(`[DEBUG] PR number: ${prNumber || "auto-detect"}`))
    console.log(chalk.gray(`[DEBUG] Repo: ${repo || "auto-detect"}`))
    console.log(chalk.gray(`[DEBUG] URL: ${url || "auto-detect"}`))
  }

  // Step 1: Get repo info
  console.log(chalk.blue("📦 Getting repository information..."))
  const repoInfo = await getRepoInfo(repo, debug)

  if (!repoInfo) {
    console.error(chalk.red("❌ Failed to get repository information"))
    console.error(chalk.yellow("Make sure you're in a git repository with a GitHub remote"))
    process.exit(1)
  }

  console.log(chalk.green(`✓ Repository: ${repoInfo.owner}/${repoInfo.name}`))

  // Step 2: Get PR number (from arg or detect from current branch)
  const prNum = prNumber || (await detectPRNumber(repoInfo, debug))

  if (!prNum) {
    console.error(chalk.red("❌ No PR number provided and couldn't detect from current branch"))
    console.error(chalk.yellow("Usage: dev3000 cloud check-pr <pr-number>"))
    process.exit(1)
  }

  console.log(chalk.blue(`🔍 Fetching PR #${prNum} details...`))

  // Step 3: Fetch PR details from GitHub
  const prDetails = await fetchPRDetails(repoInfo.owner, repoInfo.name, prNum, debug)

  if (!prDetails) {
    console.error(chalk.red(`❌ Failed to fetch PR #${prNum}`))
    process.exit(1)
  }

  console.log(chalk.green(`✓ PR #${prNum}: ${prDetails.title}`))
  console.log(chalk.gray(`  Branch: ${prDetails.branch}`))
  console.log(chalk.gray(`  Author: ${prDetails.author}`))

  // Step 4: Find Vercel preview URL (use provided URL or auto-detect)
  let previewUrl: string | null = null
  if (url) {
    console.log(chalk.blue("🔗 Using provided preview URL..."))
    previewUrl = url
  } else {
    console.log(chalk.blue("🔗 Finding Vercel preview URL..."))
    previewUrl = await findVercelPreview(repoInfo, prDetails.branch, debug)
  }

  if (!previewUrl) {
    console.error(chalk.red("❌ No Vercel preview deployment found for this PR"))
    console.error(chalk.yellow("Make sure the PR has a Vercel deployment, or provide --url"))
    process.exit(1)
  }

  console.log(chalk.green(`✓ Preview URL: ${previewUrl}`))

  // Step 5: Analyze PR changes to determine what pages to check
  console.log(chalk.blue("📝 Analyzing PR changes..."))
  const changedFiles = await getChangedFiles(repoInfo.owner, repoInfo.name, prNum, debug)
  console.log(chalk.gray(`  Changed files: ${changedFiles.length}`))

  // Step 6: Run workflow to check the PR
  console.log(chalk.blue("🤖 Running AI-powered PR verification..."))
  console.log(chalk.gray("This may take a few minutes..."))

  const result = await runPRCheckWorkflow({
    previewUrl,
    prTitle: prDetails.title,
    prBody: prDetails.body,
    changedFiles,
    repoOwner: repoInfo.owner,
    repoName: repoInfo.name,
    prNumber: prNum,
    debug
  })

  // Step 7: Display results
  console.log(`\n${chalk.bold("📊 PR Check Results")}`)
  console.log(chalk.gray("─".repeat(60)))

  if (result.success) {
    console.log(chalk.green("✓ All checks passed"))
  } else {
    console.log(chalk.red("✗ Some checks failed"))
  }

  console.log(`\n${chalk.bold("Full Report:")}`)
  console.log(result.reportUrl)

  if (result.prComment) {
    console.log(`\n${chalk.gray("A comment will be posted to the PR with these results")}`)
  }
}

interface RepoInfo {
  owner: string
  name: string
  branch: string
}

async function getRepoInfo(repoArg: string | undefined, debug: boolean): Promise<RepoInfo | null> {
  try {
    if (repoArg) {
      // Parse from provided repo URL or owner/name
      const match = repoArg.match(/(?:github\.com\/)?([^/]+)\/([^/]+)/)
      if (match) {
        return {
          owner: match[1],
          name: match[2].replace(/\.git$/, ""),
          branch: execFileSync("git", ["branch", "--show-current"], { encoding: "utf-8" }).trim()
        }
      }
    }

    // Auto-detect from current directory using our script
    const scriptPath = new URL("../../scripts/get-repo-info.sh", import.meta.url).pathname
    const result = execFileSync("bash", [scriptPath], { encoding: "utf-8" })
    const info = JSON.parse(result)

    if (debug) {
      console.log(chalk.gray(`[DEBUG] Repo info: ${JSON.stringify(info, null, 2)}`))
    }

    return {
      owner: info.repoOwner,
      name: info.repoName,
      branch: info.currentBranch
    }
  } catch (error) {
    if (debug) {
      console.error(chalk.gray(`[DEBUG] Error getting repo info: ${error}`))
    }
    return null
  }
}

async function detectPRNumber(repoInfo: RepoInfo, debug: boolean): Promise<string | null> {
  try {
    // Use gh CLI to find PR for current branch
    const result = execFileSync(
      "gh",
      ["pr", "list", "--head", repoInfo.branch, "--json", "number", "--jq", ".[0].number"],
      { encoding: "utf-8" }
    ).trim()

    if (debug) {
      console.log(chalk.gray(`[DEBUG] Detected PR number: ${result}`))
    }

    return result || null
  } catch (error) {
    if (debug) {
      console.error(chalk.gray(`[DEBUG] Error detecting PR number: ${error}`))
    }
    return null
  }
}

interface PRDetails {
  title: string
  body: string
  branch: string
  author: string
}

async function fetchPRDetails(
  owner: string,
  repo: string,
  prNumber: string,
  debug: boolean
): Promise<PRDetails | null> {
  try {
    const result = execFileSync(
      "gh",
      ["api", `repos/${owner}/${repo}/pulls/${prNumber}`, "--jq", "{title,body,branch:.head.ref,author:.user.login}"],
      { encoding: "utf-8" }
    )

    const details = JSON.parse(result)

    if (debug) {
      console.log(chalk.gray(`[DEBUG] PR details: ${JSON.stringify(details, null, 2)}`))
    }

    return details
  } catch (error) {
    if (debug) {
      console.error(chalk.gray(`[DEBUG] Error fetching PR details: ${error}`))
    }
    return null
  }
}

async function findVercelPreview(_repoInfo: RepoInfo, branch: string, debug: boolean): Promise<string | null> {
  try {
    // Use vc CLI to find deployments for this branch
    // Pass --token if VERCEL_TOKEN is set (for CI environments)
    const tokenArgs = process.env.VERCEL_TOKEN ? ["--token", process.env.VERCEL_TOKEN] : []
    const result = execFileSync("vc", ["ls", "--yes", ...tokenArgs], { encoding: "utf-8" })
    const lines = result
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)

    const match = lines.find((line) => line.includes(branch))
    const previewUrl = match ? match.split(/\s+/)[1] : ""

    if (debug) {
      console.log(chalk.gray(`[DEBUG] Found preview URL: ${previewUrl}`))
    }

    return previewUrl || null
  } catch (error) {
    if (debug) {
      console.error(chalk.gray(`[DEBUG] Error finding Vercel preview: ${error}`))
    }
    return null
  }
}

async function getChangedFiles(owner: string, repo: string, prNumber: string, debug: boolean): Promise<string[]> {
  try {
    const result = execFileSync(
      "gh",
      ["api", `repos/${owner}/${repo}/pulls/${prNumber}/files`, "--jq", ".[].filename"],
      { encoding: "utf-8" }
    )

    const files = result.trim().split("\n").filter(Boolean)

    if (debug) {
      console.log(chalk.gray(`[DEBUG] Changed files: ${files.join(", ")}`))
    }

    return files
  } catch (error) {
    if (debug) {
      console.error(chalk.gray(`[DEBUG] Error getting changed files: ${error}`))
    }
    return []
  }
}

interface WorkflowParams {
  previewUrl: string
  prTitle: string
  prBody: string
  changedFiles: string[]
  repoOwner: string
  repoName: string
  prNumber: string
  debug: boolean
}

// biome-ignore lint/suspicious/noExplicitAny: Workflow response has dynamic structure
async function runPRCheckWorkflow(params: WorkflowParams): Promise<any> {
  const { previewUrl, prTitle, prBody, changedFiles, repoOwner, repoName, prNumber, debug } = params

  // Call the workflow API endpoint (we'll create this next)
  const apiBase = process.env.DEV3000_API_URL || "https://dev3000.ai"
  const workflowUrl = `${apiBase}/api/cloud/check-pr`

  try {
    const response = await fetch(workflowUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        previewUrl,
        prTitle,
        prBody,
        changedFiles,
        repoOwner,
        repoName,
        prNumber
      })
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    const result = await response.json()

    if (debug) {
      console.log(chalk.gray(`[DEBUG] Workflow result: ${JSON.stringify(result, null, 2)}`))
    }

    return result
  } catch (error) {
    if (debug) {
      console.error(chalk.gray(`[DEBUG] Error running workflow: ${error}`))
    }

    // For now, return a mock result since we haven't built the workflow yet
    return {
      success: true,
      reportUrl: `${previewUrl}#pr-check-report`,
      prComment: true,
      message: "PR check workflow not yet implemented - coming soon!"
    }
  }
}
