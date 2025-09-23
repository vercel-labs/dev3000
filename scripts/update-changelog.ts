#!/usr/bin/env tsx

import { execSync } from "child_process"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

interface Commit {
  hash: string
  subject: string
  author: string
  date: string
}

type ReleaseType = "major" | "minor" | "patch"

interface Release {
  version: string
  date: string
  type: ReleaseType
  highlights: string[]
}

// Function to get git commits since last release
function getCommitsSinceLastRelease(): Commit[] {
  try {
    // Get the last release tag
    const lastTag = execSync('git describe --tags --abbrev=0 --match="v*" HEAD~1 2>/dev/null || echo "HEAD~10"', {
      encoding: "utf8"
    }).trim()

    // Get commits since last tag (or last 10 commits if no tags)
    const commits = execSync(`git log ${lastTag}..HEAD --pretty=format:"%h|%s|%an|%ad" --date=short`, {
      encoding: "utf8"
    }).trim()

    if (!commits) return []

    return commits.split("\n").map((line) => {
      const [hash, subject, author, date] = line.split("|")
      return { hash, subject, author, date }
    })
  } catch (_error) {
    console.log("⚠️ Could not get git commits, using empty list")
    return []
  }
}

// Categories for grouping commits
const FEATURE_CATEGORIES = {
  tui: { keywords: ["tui", "terminal ui", "terminal user interface", "ink", "console ui"], name: "Terminal UI" },
  mcp: { keywords: ["mcp", "model context protocol", "mcp server"], name: "MCP Server" },
  browser: { keywords: ["chrome", "browser", "cdp", "devtools", "profile"], name: "Browser Integration" },
  process: { keywords: ["process", "spawn", "port", "health check", "singleton"], name: "Process Management" },
  logs: { keywords: ["log", "logging", "visual timeline", "timeline"], name: "Logging & Timeline" },
  dx: { keywords: ["cli", "command", "flag", "install", "setup"], name: "Developer Experience" },
  ai: { keywords: ["ai", "claude", "tool", "debug"], name: "AI Integration" }
}

// Function to categorize and analyze commits
function analyzeCommits(commits: Commit[]): Map<string, Set<string>> {
  const categorizedChanges = new Map<string, Set<string>>()

  const skipPatterns = [
    /^Merge/i,
    /^Bump to v.*canary/i,
    /^Release v/i,
    /^Fix formatting/i,
    /^Update changelog/i,
    /^Apply linter/i,
    /^formatting$/i,
    /generated with.*claude code/i
  ]

  for (const commit of commits) {
    const subject = commit.subject.toLowerCase()

    // Skip certain types of commits
    if (skipPatterns.some((pattern) => pattern.test(commit.subject))) {
      continue
    }

    // Check each category
    for (const [categoryKey, category] of Object.entries(FEATURE_CATEGORIES)) {
      if (category.keywords.some((keyword) => subject.includes(keyword))) {
        if (!categorizedChanges.has(categoryKey)) {
          categorizedChanges.set(categoryKey, new Set())
        }
        categorizedChanges.get(categoryKey)?.add(commit.subject)
        break // Only categorize in the first matching category
      }
    }
  }

  return categorizedChanges
}

// Function to extract highlights from commits with intelligent analysis
function extractHighlights(commits: Commit[]): string[] {
  const highlights: string[] = []
  const categorized = analyzeCommits(commits)

  // Check for major feature additions
  if (categorized.has("tui")) {
    const tuiCommits = Array.from(categorized.get("tui") || new Set())
    if (tuiCommits.some((c) => c.toLowerCase().includes("add") && c.toLowerCase().includes("default"))) {
      highlights.push("Introduced gorgeous Terminal UI (TUI) as the default experience - a complete visual overhaul")
    } else if (tuiCommits.length > 2) {
      highlights.push("Major Terminal UI improvements with enhanced visuals and user experience")
    }
  }

  // Check for MCP server changes
  if (categorized.has("mcp")) {
    const mcpCommits = Array.from(categorized.get("mcp") || new Set())
    if (mcpCommits.some((c) => c.toLowerCase().includes("singleton") || c.toLowerCase().includes("persistent"))) {
      highlights.push("Revolutionized MCP server architecture: now a persistent singleton for better performance")
    } else if (mcpCommits.some((c) => c.toLowerCase().includes("multi-project"))) {
      highlights.push("Added multi-project support for MCP server with intelligent session tracking")
    } else if (mcpCommits.length > 2) {
      highlights.push("Significant MCP server improvements for better AI integration")
    }
  }

  // Check for browser/Chrome improvements
  if (categorized.has("browser")) {
    const browserCommits = Array.from(categorized.get("browser") || new Set())
    if (browserCommits.some((c) => c.toLowerCase().includes("profile") && c.toLowerCase().includes("project"))) {
      highlights.push("Added project-specific Chrome profiles for isolated development environments")
    } else if (browserCommits.some((c) => c.toLowerCase().includes("custom browser"))) {
      highlights.push("Added support for custom browser executables with --browser flag")
    }
  }

  // Check for process management improvements
  if (categorized.has("process")) {
    const processCommits = Array.from(categorized.get("process") || new Set())
    if (processCommits.some((c) => c.toLowerCase().includes("health check"))) {
      highlights.push("Enhanced process monitoring with automatic health checks and recovery")
    } else if (processCommits.some((c) => c.toLowerCase().includes("port"))) {
      highlights.push("Improved port management with intelligent auto-increment and conflict resolution")
    }
  }

  // Check for logging improvements
  if (categorized.has("logs")) {
    const logCommits = Array.from(categorized.get("logs") || new Set())
    if (logCommits.some((c) => c.toLowerCase().includes("visual timeline"))) {
      highlights.push("Enhanced Visual Timeline with better navigation and multi-project support")
    } else if (logCommits.some((c) => c.toLowerCase().includes("format") || c.toLowerCase().includes("align"))) {
      highlights.push("Improved log formatting with better alignment and readability")
    }
  }

  // If we don't have enough highlights, add some generic ones based on commit count
  if (highlights.length < 3) {
    const fixCommits = commits.filter((c) => c.subject.toLowerCase().includes("fix"))
    const addCommits = commits.filter(
      (c) => c.subject.toLowerCase().includes("add") || c.subject.toLowerCase().includes("implement")
    )

    if (fixCommits.length > 5) {
      highlights.push(`Fixed ${fixCommits.length} bugs for improved stability and reliability`)
    }
    if (addCommits.length > 3) {
      highlights.push("Added several new features and enhancements")
    }
  }

  // Ensure we have at least one highlight
  if (highlights.length === 0) {
    highlights.push("Various improvements and bug fixes")
  }

  // Return top 5 most impactful highlights
  return highlights.slice(0, 5)
}

// Function to determine version type based on changes
function determineVersionType(highlights: string[], versionBump: string): ReleaseType {
  // Check if it's a major version (x.0.0)
  if (versionBump.includes("major") || highlights.some((h) => h.toLowerCase().includes("breaking"))) {
    return "major"
  }

  // Check if it's a minor version (features, new tools, significant improvements)
  if (
    highlights.some(
      (h) =>
        h.toLowerCase().includes("add") ||
        h.toLowerCase().includes("implement") ||
        h.toLowerCase().includes("create") ||
        h.toLowerCase().includes("new")
    )
  ) {
    return "minor"
  }

  // Default to patch (fixes, improvements, etc.)
  return "patch"
}

// Function to update the changelog data file
function updateChangelogPage(version: string, highlights: string[], versionType: ReleaseType): void {
  const changelogPath = path.join(__dirname, "../www/lib/changelog.ts")

  if (!fs.existsSync(changelogPath)) {
    console.log("⚠️ Changelog data file not found, skipping update")
    return
  }

  const content = fs.readFileSync(changelogPath, "utf8")

  // Create new changelog entry
  const today = new Date().toISOString().split("T")[0]
  const newEntry: Release = {
    version: version.replace("v", ""),
    date: today,
    type: versionType,
    highlights: highlights.length > 0 ? highlights : [`Version ${version} release with various improvements and fixes`]
  }

  // Find the changelog array in the file
  const changelogStartRegex = /export const changelog: Release\[\] = \[([\s\S]*?)\]/
  const match = content.match(changelogStartRegex)

  if (!match) {
    console.log("⚠️ Could not find changelog array in file, skipping update")
    return
  }

  // Parse existing entries (simple parsing for our structured data)
  const existingChangelogText = match[1]

  // Create the new entry text
  const newEntryText = `  {
    version: "${newEntry.version}",
    date: "${newEntry.date}",
    type: "${newEntry.type}",
    highlights: [
${newEntry.highlights.map((h) => `      "${h.replace(/"/g, '\\"')}"`).join(",\n")}
    ]
  }`

  // Insert at the beginning of the array
  let updatedContent: string
  if (existingChangelogText.trim() === "") {
    // Empty array
    updatedContent = content.replace(
      "export const changelog: Release[] = []",
      `export const changelog: Release[] = [\n${newEntryText}\n]`
    )
  } else {
    // Add to beginning of existing array
    updatedContent = content.replace(
      changelogStartRegex,
      `export const changelog: Release[] = [
${newEntryText},
$1]`
    )
  }

  fs.writeFileSync(changelogPath, updatedContent)
  console.log("✅ Updated changelog data file")
}

// Main function
function main(): void {
  const args = process.argv.slice(2)
  if (args.length < 1 || args[0] === "--help" || args[0] === "-h") {
    console.log("Usage: tsx update-changelog.ts <version>")
    console.log("Example: tsx update-changelog.ts v0.0.63")
    process.exit(args[0] === "--help" || args[0] === "-h" ? 0 : 1)
  }

  const version = args[0]

  console.log(`📝 Updating changelog for ${version}...`)

  // Get recent commits
  const commits = getCommitsSinceLastRelease()
  console.log(`📋 Found ${commits.length} commits since last release`)

  // Extract highlights
  const highlights = extractHighlights(commits)
  console.log(`✨ Extracted ${highlights.length} highlights:`, highlights)

  // Determine version type
  const versionType = determineVersionType(highlights, version)
  console.log(`🏷️ Determined version type: ${versionType}`)

  // Update changelog page
  updateChangelogPage(version, highlights, versionType)

  console.log("🎉 Changelog update completed!")
}

// Run main function if this script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}

export { updateChangelogPage, extractHighlights, getCommitsSinceLastRelease }
