#!/usr/bin/env tsx

/**
 * Enhanced Changelog Generator for dev3000
 *
 * Uses Vercel-style changelog writing principles:
 *
 * ✍️ STYLE & TONE:
 * - Get to the point. Always choose the shorter, simpler word (help, use, start)
 * - Cut filler. Remove "just," "very," "actually," etc.
 * - Be confident. Avoid "I think," "maybe," "sort of."
 * - Use inclusive language. No jargon or idioms.
 * - Write short, declarative sentences. Fewer commas. More periods.
 * - Vary sentence length for impact—mix one-liners and longer lines.
 * - Use Oxford commas.
 * - Active voice, present tense.
 *
 * 🏗️ STRUCTURE:
 * - Promise the core benefit
 * - Be concrete, visual, and falsifiable
 * - Focus on what changed and why it matters—focus on the product or user, not "we"
 * - Single feature: 1–2 short paragraphs explaining use cases and benefits
 * - Multiple updates: bullet format with bold feature names
 *
 * ✅ BEST PRACTICES:
 * - Link to docs, not jargon
 * - No fluff: if a competitor could write it, cut it
 * - Rewrite ruthlessly—remove every unnecessary word
 * - Treat the reader as if they know nothing
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

// Enhanced pattern matching for casual commit messages
const CASUAL_PATTERNS = {
  fixes: [
    /fix(es|ed|ing)?\s+#\d+/i, // "fixes #34"
    /resolve(s|d)?\s+#\d+/i,
    /close(s|d)?\s+#\d+/i,
    /fix(es|ed)?\s+.*(bug|issue|problem|error)/i,
    /^fix/i
  ],
  improvements: [
    /^lil\s+/i, // "lil README fix"
    /^more\s+lil/i, // "more lil changes"
    /improv/i,
    /better/i,
    /enhance/i,
    /update/i,
    /refactor/i,
    /clean/i
  ],
  builds: [/typegen/i, /build/i, /compile/i, /bundl/i],
  features: [/^add/i, /implement/i, /create/i, /new\s+/i, /introduce/i],
  dx: [/ctrl[+-]c/i, /canary/i, /script/i, /cli/i, /command/i]
}

// Specific feature patterns for concrete changelog entries
const FEATURE_PATTERNS = {
  cls: [/CLS|cumulative layout shift|screencast|video|jank/i],
  mcp: [/MCP|auto-config|\.mcp\.json|cursor\.mcp/i],
  chrome: [/chrome.*launch|intelligent.*polling|chrome.*timeout/i],
  delegation: [/delegat|orchestrat|coordinate/i],
  cdp: [/CDP.*URL|chrome.*devtools.*protocol/i],
  tui: [/TUI|terminal.*UI|header.*status/i],
  browserSupport: [/arc|comet|edge|brave|browser.*support|browser.*path/i],
  errorPrioritization: [/priorit|priority.*score|worst.*issue|highest.*priority/i],
  prCreation: [/PR.*creation|create.*PR|pull.*request|one-PR-per-run/i],
  portDetection: [/port.*detection|port.*3000|port.*5173|svelte.*port|detect.*port/i]
}

// Function to extract highlights using Vercel-style changelog writing
// Based on: https://vercel.com/blog style guide
// Style: Get to the point, cut filler, be confident, short declarative sentences
function extractHighlights(commits: Commit[]): string[] {
  const highlights: string[] = []

  // Filter out noise commits first
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

  // Analyze commit patterns with flexible matching
  const analysis = {
    fixes: meaningfulCommits.filter((c) => CASUAL_PATTERNS.fixes.some((pattern) => pattern.test(c.subject))),
    improvements: meaningfulCommits.filter((c) =>
      CASUAL_PATTERNS.improvements.some((pattern) => pattern.test(c.subject))
    ),
    builds: meaningfulCommits.filter((c) => CASUAL_PATTERNS.builds.some((pattern) => pattern.test(c.subject))),
    features: meaningfulCommits.filter((c) => CASUAL_PATTERNS.features.some((pattern) => pattern.test(c.subject))),
    dx: meaningfulCommits.filter((c) => CASUAL_PATTERNS.dx.some((pattern) => pattern.test(c.subject)))
  }

  // Detect specific features across ALL commits (not just features category)
  const detectedFeatures = {
    cls: meaningfulCommits.some((c) => FEATURE_PATTERNS.cls.some((pattern) => pattern.test(c.subject))),
    mcp: meaningfulCommits.some((c) => FEATURE_PATTERNS.mcp.some((pattern) => pattern.test(c.subject))),
    chrome: meaningfulCommits.some((c) => FEATURE_PATTERNS.chrome.some((pattern) => pattern.test(c.subject))),
    delegation: meaningfulCommits.some((c) => FEATURE_PATTERNS.delegation.some((pattern) => pattern.test(c.subject))),
    cdp: meaningfulCommits.some((c) => FEATURE_PATTERNS.cdp.some((pattern) => pattern.test(c.subject))),
    tui: meaningfulCommits.some((c) => FEATURE_PATTERNS.tui.some((pattern) => pattern.test(c.subject))),
    browserSupport: meaningfulCommits.some((c) =>
      FEATURE_PATTERNS.browserSupport.some((pattern) => pattern.test(c.subject))
    ),
    errorPrioritization: meaningfulCommits.some((c) =>
      FEATURE_PATTERNS.errorPrioritization.some((pattern) => pattern.test(c.subject))
    ),
    prCreation: meaningfulCommits.some((c) => FEATURE_PATTERNS.prCreation.some((pattern) => pattern.test(c.subject))),
    portDetection: meaningfulCommits.some((c) =>
      FEATURE_PATTERNS.portDetection.some((pattern) => pattern.test(c.subject))
    )
  }

  // Generate concrete highlights based on detected features
  if (detectedFeatures.cls) {
    highlights.push(
      "🎬 **Passive Screencast Capture**: Automatically records page loads and navigations for performance analysis"
    )
    highlights.push("🎯 **CLS Detection**: Watch frame-by-frame video of layout shifts with precise element tracking")
  }

  if (detectedFeatures.mcp) {
    highlights.push(
      "🔧 **Auto-Configuration for AI CLIs**: Automatically writes `.mcp.json` (Claude Code) and `.cursor/mcp.json` (Cursor) so MCP servers are instantly available"
    )
  }

  if (detectedFeatures.chrome) {
    highlights.push(
      "⚡ **Intelligent Chrome Launch**: Replaced fixed timeout with smart polling - dev3000 starts as soon as Chrome is ready instead of waiting arbitrarily"
    )
  }

  if (detectedFeatures.delegation) {
    highlights.push(
      "🤖 **Augmented Delegation**: dev3000 now intelligently delegates to chrome-devtools MCP when detected, creating a powerful debugging orchestration layer"
    )
  }

  if (detectedFeatures.cdp) {
    highlights.push(
      "📡 **CDP URL Sharing**: Shares Chrome DevTools Protocol URL with other MCPs to prevent duplicate browser instances"
    )
  }

  if (detectedFeatures.tui) {
    highlights.push("🎨 **Improved TUI**: Better header and status line rendering for narrow terminal windows")
  }

  if (detectedFeatures.browserSupport) {
    // Extract browser names from commits for concrete description
    const browserNames = meaningfulCommits
      .filter((c) => FEATURE_PATTERNS.browserSupport.some((pattern) => pattern.test(c.subject)))
      .flatMap((c) => c.subject.match(/arc|comet|edge|brave/gi))
      .filter(Boolean)
      .map((name) => name.charAt(0).toUpperCase() + name.slice(1).toLowerCase())
    const uniqueBrowsers = [...new Set(browserNames)]
    if (uniqueBrowsers.length > 0) {
      highlights.push(`🌐 **Browser Support**: Added support for ${uniqueBrowsers.join(", ")} browsers`)
    } else {
      highlights.push("🌐 **Expanded Browser Support**: Added support for additional Chromium-based browsers")
    }
  }

  if (detectedFeatures.errorPrioritization) {
    highlights.push(
      "🎯 **Smart Error Prioritization**: Automatically scores and ranks errors by severity - build errors (1000+), server errors (500+), browser errors (300+), with modifiers for recency and reproducibility"
    )
  }

  if (detectedFeatures.prCreation) {
    highlights.push(
      "🚀 **One-PR-Per-Run**: Creates focused single-issue PRs for the highest priority error - no more overwhelming multi-fix PRs"
    )
  }

  if (detectedFeatures.portDetection) {
    highlights.push(
      "⚡ **Improved Port Detection**: Works with non-standard ports (like Svelte's 5173) and shows loading spinner until port is confirmed"
    )
  }

  // Add fix highlights
  if (analysis.fixes.length > 0) {
    // Check for GitHub issue fixes first
    const githubIssues = analysis.fixes
      .filter((c) => /#\d+/.test(c.subject))
      .flatMap((c) => {
        // Extract all issue numbers from the commit subject
        const matches = c.subject.match(/#(\d+)/g)
        return matches ? matches.map((match) => match.replace("#", "")) : []
      })
      .filter(Boolean)

    if (githubIssues.length > 0) {
      const uniqueIssues = [...new Set(githubIssues)] // Remove duplicates
      const issueLinks = uniqueIssues
        .map((issue) => `[#${issue}](https://github.com/anthropics/claude-code/issues/${issue})`)
        .join(", ")
      highlights.push(`Resolved GitHub issues ${issueLinks}`)
    } else if (analysis.fixes.length >= 3) {
      highlights.push(`🐛 **Fixed ${analysis.fixes.length} bugs for improved stability**`)
    } else {
      highlights.push("Bug fixes improve overall reliability")
    }
  }

  // Add build improvements if significant
  if (analysis.builds.length > 0) {
    if (analysis.builds.some((c) => c.subject.toLowerCase().includes("typegen"))) {
      highlights.push("Build process optimized to prevent duplicate type generation")
    }
  }

  // Add DX improvements
  if (analysis.dx.length > 0) {
    if (analysis.dx.some((c) => c.subject.toLowerCase().includes("ctrl"))) {
      highlights.push("Keyboard shortcuts now work consistently across all modes")
    }
    if (analysis.dx.some((c) => c.subject.toLowerCase().includes("canary"))) {
      highlights.push("Canary builds streamlined for faster testing and deployment")
    }
  }

  // Generic fallback only if no specific features detected
  if (highlights.length === 0) {
    if (analysis.features.length > 0) {
      highlights.push("New development tools make debugging faster and more reliable")
    }
    if (analysis.improvements.length > 0) {
      highlights.push("Developer experience improvements across CLI and interface")
    }
  }

  // Final fallback for when we really can't categorize
  if (highlights.length === 0) {
    if (meaningfulCommits.length >= 5) {
      highlights.push("Performance and stability improvements across all systems")
    } else {
      highlights.push("Quality improvements and bug fixes")
    }
  }

  // Return top 5 highlights (expanded from 3 to capture more detail for feature-rich releases)
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
