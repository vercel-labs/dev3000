import { detectProject } from "../utils/project-detector.js"
import { isValidRepoArg } from "../utils/repo-validate.js"

export interface CloudFixOptions {
  debug?: boolean
  repo?: string
  branch?: string
  projectDir?: string
}

const DEFAULT_API_URL = "https://dev3000.ai"

/**
 * Cloud Fix Command
 *
 * Starts a cloud workflow run for the current repo.
 */
export async function cloudFix(options: CloudFixOptions = {}): Promise<void> {
  const { debug = false, repo, branch, projectDir } = options

  if (repo && !isValidRepoArg(repo)) {
    throw new Error("Invalid repo format. Use 'owner/name' or a GitHub URL.")
  }

  const project =
    repo && branch
      ? {
          repoUrl: repo,
          branch,
          relativePath: projectDir || "",
          name: projectDir || "app"
        }
      : await (async () => {
          console.log("🔍 Detecting project...")
          return await detectProject()
        })()

  const repoUrl = project.repoUrl
  const repoBranch = branch || project.branch || "main"
  const projectName = projectDir || project.relativePath || project.name || "app"

  console.log("🚀 Starting cloud fix workflow...")
  console.log(`  Repository: ${repoUrl}`)
  console.log(`  Branch: ${repoBranch}`)
  console.log(`  Project: ${projectName}`)
  console.log()

  const apiBase = process.env.DEV3000_API_URL || DEFAULT_API_URL
  const workflowUrl = `${apiBase}/api/cloud/start-fix`

  const headers: Record<string, string> = {
    "Content-Type": "application/json"
  }

  if (process.env.WORKFLOW_TEST_BYPASS_TOKEN) {
    headers["x-test-bypass-token"] = process.env.WORKFLOW_TEST_BYPASS_TOKEN
  }

  if (process.env.VERCEL_OIDC_TOKEN) {
    headers["x-vercel-oidc-token"] = process.env.VERCEL_OIDC_TOKEN
  }

  if (debug) {
    console.log(`  API: ${workflowUrl}`)
    console.log(`  Test bypass token: ${process.env.WORKFLOW_TEST_BYPASS_TOKEN ? "provided" : "not provided"}`)
  }

  const response = await fetch(workflowUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({
      repoUrl,
      repoBranch,
      projectName
    })
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Workflow request failed: ${response.status} - ${errorText}`)
  }

  const result = (await response.json()) as {
    success?: boolean
    message?: string
    projectName?: string
    runId?: string
  }

  if (result.success) {
    console.log("✅ Workflow started successfully")
    if (result.runId) {
      console.log(`  Run ID: ${result.runId}`)
    }
    if (result.projectName) {
      console.log(`  Project: ${result.projectName}`)
    }
    console.log(`  Track progress at: ${apiBase}/workflows`)
  } else {
    console.log("⚠️ Workflow start returned an unexpected response")
    if (debug) {
      console.log(JSON.stringify(result, null, 2))
    }
  }
}
