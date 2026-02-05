#!/usr/bin/env tsx

/**
 * Changelog Generator for dev3000
 *
 * Reads git commit messages between releases and creates a concise summary.
 * Uses Vercel-style changelog writing principles:
 *
 * ✍️ STYLE & TONE:
 * - Get to the point. Always choose the shorter, simpler word (help, use, start)
 * - Cut filler. Remove "just," "very," "actually," etc.
 * - Be confident. Avoid "I think," "maybe," "sort of."
 * - Use inclusive language. No jargon or idioms.
 * - Write short, declarative sentences. Fewer commas. More periods.
 * - Active voice, present tense.
 */

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

// Function to extract highlights from commit messages
function extractHighlights(commits: Commit[]): string[] {
  // Filter out noise commits
  const meaningfulCommits = commits.filter((commit) => {
    const skipPatterns = [
      /^merge/i,
      /^bump to v.*canary/i,
      /^release v/i,
      /^fix formatting/i,
      /^update changelog/i,
      /^apply linter/i,
      /^formatting$/i,
      /generated with.*claude code/i
    ]
    return !skipPatterns.some((pattern) => pattern.test(commit.subject))
  })

  if (meaningfulCommits.length === 0) {
    return ["Performance and stability improvements"]
  }

  // Simple summarization: just take the commit messages and clean them up
  const highlights = meaningfulCommits.slice(0, 5).map((commit) => {
    let subject = commit.subject

    // Remove "Feature:" or "Fix:" prefixes
    subject = subject.replace(/^(Feature|Fix|Feat|Chore|Docs|Style|Refactor|Test|Build|CI):\s*/i, "")

    // Capitalize first letter
    subject = subject.charAt(0).toUpperCase() + subject.slice(1)

    return subject
  })

  return highlights
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

  // Skip if this version already exists in the changelog
  if (content.includes(`version: "${version.replace("v", "")}"`)) {
    console.log(`ℹ️ Changelog already has ${version}, skipping update`)
    return
  }

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
