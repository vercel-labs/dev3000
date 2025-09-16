#!/usr/bin/env node

import { execSync } from "child_process"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Function to get git commits since last release
function getCommitsSinceLastRelease() {
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
  } catch (error) {
    console.log("⚠️ Could not get git commits, using empty list")
    return []
  }
}

// Function to extract highlights from commits
function extractHighlights(commits) {
  const highlights = []
  const skipPatterns = [
    /^Merge/i,
    /^Bump to v.*canary/i,
    /^Release v/i,
    /^Fix formatting/i,
    /^Update changelog/i,
    /generated with.*claude code/i
  ]

  const importantPatterns = [
    { pattern: /add/i, prefix: "Added" },
    { pattern: /implement/i, prefix: "Implemented" },
    { pattern: /create/i, prefix: "Created" },
    { pattern: /fix/i, prefix: "Fixed" },
    { pattern: /improve/i, prefix: "Improved" },
    { pattern: /enhance/i, prefix: "Enhanced" },
    { pattern: /update/i, prefix: "Updated" },
    { pattern: /remove/i, prefix: "Removed" },
    { pattern: /refactor/i, prefix: "Refactored" }
  ]

  for (const commit of commits) {
    const subject = commit.subject

    // Skip certain types of commits
    if (skipPatterns.some((pattern) => pattern.test(subject))) {
      continue
    }

    // Clean up the subject
    const cleanSubject = subject
      .replace(/🤖.*$/g, "") // Remove bot signatures
      .replace(/Co-Authored-By:.*$/g, "")
      .trim()

    // Skip if too short or generic
    if (cleanSubject.length < 10) continue

    // Add to highlights
    highlights.push(cleanSubject)
  }

  // Limit to top 4-5 most important
  return highlights.slice(0, 4)
}

// Function to determine version type based on changes
function determineVersionType(highlights, versionBump) {
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

// Function to update the changelog page
function updateChangelogPage(version, highlights, versionType) {
  const changelogPath = path.join(__dirname, "../www/app/changelog/page.tsx")

  if (!fs.existsSync(changelogPath)) {
    console.log("⚠️ Changelog page not found, skipping update")
    return
  }

  const content = fs.readFileSync(changelogPath, "utf8")

  // Create new changelog entry
  const today = new Date().toISOString().split("T")[0]
  const newEntry = {
    version: version.replace("v", ""),
    date: today,
    type: versionType,
    highlights: highlights.length > 0 ? highlights : [`Version ${version} release with various improvements and fixes`]
  }

  // Find the changelog array in the file
  const changelogStartRegex = /const changelog = \[([\s\S]*?)\]/
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
    type: "${newEntry.type}" as const,
    highlights: [
${newEntry.highlights.map((h) => `      "${h.replace(/"/g, '\\"')}"`).join(",\n")}
    ]
  }`

  // Insert at the beginning of the array
  let updatedContent
  if (existingChangelogText.trim() === "") {
    // Empty array
    updatedContent = content.replace("const changelog = []", `const changelog = [\n${newEntryText}\n]`)
  } else {
    // Add to beginning of existing array
    updatedContent = content.replace(
      changelogStartRegex,
      `const changelog = [
${newEntryText},
$1]`
    )
  }

  fs.writeFileSync(changelogPath, updatedContent)
  console.log("✅ Updated changelog page")
}

// Main function
function main() {
  const args = process.argv.slice(2)
  if (args.length < 1) {
    console.log("Usage: node update-changelog.js <version>")
    process.exit(1)
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
