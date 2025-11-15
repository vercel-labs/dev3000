/**
 * Script to run CLS detection on your most recently contributed Vercel projects
 *
 * Usage:
 *   pnpm exec tsx scripts/run-cls-detection.ts [--team your-team-slug] [--no-prompt]
 */

interface Project {
  id: string
  name: string
  updatedAt: number
  link?: {
    type: string
    repo: string
    org: string
    repoId: number
  }
  targets: {
    production: {
      url: string
    }
  }
}

interface WorkflowResult {
  projectName: string
  success: boolean
  blobUrl?: string
  error?: string
  clsIssues?: Array<{
    element: string
    score: number
    description: string
  }>
}

async function getRecentProjects(teamSlug?: string, limit = 5): Promise<Project[]> {
  // Use Vercel CLI to get projects
  const { execSync } = await import("child_process")

  try {
    // Fetch projects using Vercel CLI
    const command = teamSlug ? `vc project ls --scope ${teamSlug}` : "vc project ls"

    console.log(`Running: ${command}`)
    const output = execSync(`${command} 2>&1`, {
      encoding: "utf-8"
    })

    // Parse the table output from vc project ls
    // Format: Project Name | Latest Production URL | Updated | Node Version
    const lines = output.trim().split("\n")
    const projects: Project[] = []

    // Skip header lines and parse data
    for (const line of lines) {
      const trimmed = line.trim()

      // Skip empty lines, headers, status messages
      if (
        !trimmed ||
        trimmed.startsWith("Vercel CLI") ||
        trimmed.startsWith("Fetching") ||
        trimmed.startsWith(">") ||
        trimmed.toLowerCase().includes("project name") ||
        trimmed.startsWith("─")
      ) {
        continue
      }

      // Split on multiple spaces (2+)
      const parts = trimmed.split(/\s{2,}/)

      if (parts.length >= 2) {
        const name = parts[0].trim()
        const url = parts[1].trim()

        // Only include projects with valid URLs (not "--")
        if (url?.includes(".") && url.startsWith("http")) {
          projects.push({
            id: name,
            name,
            updatedAt: Date.now(), // Projects are already sorted by CLI
            targets: {
              production: {
                url: url.replace(/^https?:\/\//, "") // Remove protocol if present
              }
            }
          })
        }
      }
    }

    // Limit results
    return projects.slice(0, limit)
  } catch (error) {
    console.error("Failed to fetch projects from Vercel:", error)
    console.error("Make sure you are logged in with: vc login")
    throw error
  }
}

async function runCLSDetection(
  projectUrl: string,
  projectName: string,
  userId: string,
  repoInfo?: { owner: string; name: string; baseBranch?: string }
): Promise<WorkflowResult> {
  // Use the existing start-fix endpoint which will analyze the page
  const workflowEndpoint = process.env.WORKFLOW_ENDPOINT || "https://dev3000-mcp.vercel.sh/api/cloud/start-fix"

  console.log(`\n🔍 Running analysis on ${projectName}...`)
  console.log(`   URL: ${projectUrl}`)

  try {
    const response = await fetch(workflowEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        devUrl: projectUrl,
        projectName,
        userId,
        repoOwner: repoInfo?.owner,
        repoName: repoInfo?.name,
        baseBranch: repoInfo?.baseBranch || "main"
      })
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${await response.text()}`)
    }

    const result = await response.json()

    // Parse CLS issues from the fix proposal if present
    const clsIssues: Array<{ element: string; score: number; description: string }> = []
    if (result.fixProposal?.includes("CLS")) {
      // Basic parsing - could be enhanced
      clsIssues.push({
        element: "detected",
        score: 0,
        description: "See blob URL for details"
      })
    }

    return {
      projectName,
      success: result.success,
      blobUrl: result.blobUrl,
      clsIssues
    }
  } catch (error) {
    console.error(`❌ Failed to run analysis: ${error}`)
    return {
      projectName,
      success: false,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

async function getTeams(): Promise<string[]> {
  const { execSync } = await import("child_process")

  try {
    const output = execSync("vc teams ls 2>&1", {
      encoding: "utf-8"
    })

    const lines = output.trim().split("\n")
    const teams: string[] = []

    // Parse team slugs - they're in the first column and contain lowercase letters, numbers, hyphens
    // Skip header lines that start with status messages or contain "id" "Team name"
    for (const line of lines) {
      const trimmed = line.trim()

      // Skip empty lines, header lines, and status messages
      if (
        !trimmed ||
        trimmed.startsWith("Vercel CLI") ||
        trimmed.startsWith("Fetching") ||
        trimmed.toLowerCase().includes("team name")
      ) {
        continue
      }

      // Split by 2+ spaces to get columns
      const parts = trimmed.split(/\s{2,}/)

      if (parts.length >= 2) {
        const slug = parts[0].trim()
        const teamName = parts[1].trim()

        // Team slugs are lowercase with hyphens/numbers, no spaces
        // And the second column should be a real team name (not "Team name")
        if (slug && /^[a-z0-9-]+$/.test(slug) && teamName && teamName.toLowerCase() !== "team name") {
          teams.push(slug)
        }
      }
    }

    return teams
  } catch (error) {
    console.error("Failed to fetch teams:", error)
    return []
  }
}

async function promptTeamSelection(teams: string[]): Promise<string | undefined> {
  const readline = await import("readline")
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  })

  return new Promise((resolve) => {
    console.log("\n📋 Available teams:")
    console.log("0. Personal account (no team)")
    teams.forEach((team, i) => {
      console.log(`${i + 1}. ${team}`)
    })

    rl.question("\nSelect a team (enter number): ", (answer) => {
      rl.close()
      const num = parseInt(answer, 10)

      if (num === 0) {
        resolve(undefined)
      } else if (num > 0 && num <= teams.length) {
        resolve(teams[num - 1])
      } else {
        console.log("Invalid selection, using personal account")
        resolve(undefined)
      }
    })
  })
}

async function promptProjectSelection(projects: Project[]): Promise<Project[]> {
  const readline = await import("readline")
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  })

  console.log("\n📋 Available projects (sorted by last update):")
  console.log("─".repeat(60))

  projects.forEach((project, i) => {
    console.log(`${i + 1}. ${project.name}`)
    console.log(`   ${project.targets.production.url}`)
  })

  console.log("─".repeat(60))

  return new Promise((resolve) => {
    rl.question('\nEnter project numbers (comma-separated, e.g. "1,3,5" or "1-5"): ', (answer) => {
      rl.close()

      const selected: Project[] = []
      const input = answer.trim()

      if (!input) {
        console.log("No projects selected, exiting.")
        resolve([])
        return
      }

      // Parse ranges and individual numbers
      const parts = input.split(",").map((p) => p.trim())

      for (const part of parts) {
        if (part.includes("-")) {
          // Range like "1-5"
          const [start, end] = part.split("-").map((n) => parseInt(n.trim(), 10))
          if (!Number.isNaN(start) && !Number.isNaN(end)) {
            for (let i = start; i <= end && i <= projects.length; i++) {
              if (i > 0 && !selected.includes(projects[i - 1])) {
                selected.push(projects[i - 1])
              }
            }
          }
        } else {
          // Single number
          const num = parseInt(part, 10)
          if (!Number.isNaN(num) && num > 0 && num <= projects.length) {
            if (!selected.includes(projects[num - 1])) {
              selected.push(projects[num - 1])
            }
          }
        }
      }

      if (selected.length === 0) {
        console.log("No valid projects selected, exiting.")
      } else {
        console.log(`\n✅ Selected ${selected.length} project(s)`)
      }

      resolve(selected)
    })
  })
}

async function getCurrentUser(): Promise<string> {
  const { execSync } = await import("child_process")

  try {
    const output = execSync("vc whoami 2>&1", {
      encoding: "utf-8"
    })

    // Extract username from whoami output
    // Format is typically: "You are logged in as <username>"
    const match = output.match(/logged in as (\S+)/)
    if (match?.[1]) {
      return match[1]
    }

    // Fallback: try to extract from the raw output
    const lines = output.trim().split("\n")
    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed && !trimmed.startsWith("Vercel CLI") && !trimmed.startsWith(">")) {
        return trimmed
      }
    }

    throw new Error("Could not determine current user")
  } catch (error) {
    console.error("Failed to get current user:", error)
    console.error("Make sure you are logged in with: vc login")
    throw error
  }
}

async function main() {
  const args = process.argv.slice(2)
  const teamIndex = args.indexOf("--team")
  const noPrompt = args.includes("--no-prompt")

  let team = teamIndex >= 0 ? args[teamIndex + 1] : undefined

  console.log("🚀 CLS Detection Batch Runner")
  console.log("=".repeat(50))

  // Get current user
  console.log("\n📋 Getting current user...")
  const userId = await getCurrentUser()
  console.log(`✅ User: ${userId}`)

  // Interactive team selection if no team specified and not in no-prompt mode
  if (!team && !noPrompt) {
    console.log("\n📋 Fetching your teams...")
    const teams = await getTeams()
    console.log(`Found ${teams.length} teams`)
    if (teams.length > 0) {
      team = await promptTeamSelection(teams)
    } else {
      console.log("No teams found, using personal account")
    }
  }

  if (team) {
    console.log(`\n✅ Team: ${team}`)
  } else {
    console.log(`\n✅ Team: Personal account`)
  }

  // Fetch ALL projects (no limit)
  console.log("\n📋 Fetching your Vercel projects...")
  const allProjects = await getRecentProjects(team, 100) // Fetch up to 100 projects

  if (allProjects.length === 0) {
    console.log("❌ No projects found.")
    return
  }

  // Interactive project selection
  let selectedProjects: Project[]
  if (noPrompt) {
    // In non-interactive mode, use first 5 projects
    selectedProjects = allProjects.slice(0, 5)
    console.log(`\n✅ Using first 5 projects (non-interactive mode)`)
  } else {
    selectedProjects = await promptProjectSelection(allProjects)
    if (selectedProjects.length === 0) {
      return
    }
  }

  // Run analysis on each project
  console.log("\n🔍 Running analysis workflows...\n")
  const results: WorkflowResult[] = []

  for (let i = 0; i < selectedProjects.length; i++) {
    const project = selectedProjects[i]
    console.log(`\n[${i + 1}/${selectedProjects.length}] Processing ${project.name}...`)

    const repoInfo = project.link
      ? {
          owner: project.link.org,
          name: project.link.repo
        }
      : undefined

    const result = await runCLSDetection(`https://${project.targets.production.url}`, project.name, userId, repoInfo)

    results.push(result)

    // Show immediate result
    if (result.success) {
      console.log(`   ✅ Success - Report: ${result.blobUrl}`)
    } else {
      console.log(`   ❌ Failed - ${result.error}`)
    }

    // Add a small delay between requests to avoid rate limiting
    if (i < projects.length - 1) {
      console.log("   ⏱️  Waiting 2s before next request...")
      await new Promise((resolve) => setTimeout(resolve, 2000))
    }
  }

  // Print summary
  console.log(`\n${"=".repeat(50)}`)
  console.log("📊 Summary")
  console.log("=".repeat(50))

  const successful = results.filter((r) => r.success)
  const failed = results.filter((r) => !r.success)

  console.log(`\n✅ Successful: ${successful.length}/${results.length}`)
  console.log(`❌ Failed: ${failed.length}/${results.length}`)

  if (successful.length > 0) {
    console.log("\n✅ Successful runs:")
    successful.forEach((r) => {
      console.log(`\n  ${r.projectName}`)
      if (r.blobUrl) {
        console.log(`  📄 Report: ${r.blobUrl}`)
      }
      if (r.clsIssues && r.clsIssues.length > 0) {
        console.log(`  ⚠️  ${r.clsIssues.length} CLS issues found`)
      }
    })
  }

  if (failed.length > 0) {
    console.log("\n❌ Failed runs:")
    failed.forEach((r) => {
      console.log(`\n  ${r.projectName}`)
      console.log(`  Error: ${r.error}`)
    })
  }

  console.log("\n✨ Done!\n")
}

main().catch((error) => {
  console.error("Fatal error:", error)
  process.exit(1)
})
