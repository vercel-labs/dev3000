#!/usr/bin/env node
import { writeFileSync } from "node:fs"
import { join } from "node:path"

// Import changelog from the www package
const changelogPath = join(process.cwd(), "www/lib/changelog.ts")

// Dynamic import to read the changelog
async function generateChangelogMd() {
  try {
    // Use dynamic import to load the changelog module
    const { changelog } = await import(changelogPath)

    // Generate markdown content
    let md = "# Changelog\n\n"
    md += "All notable changes to dev3000 will be documented in this file.\n\n"
    md += "The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).\n\n"

    for (const release of changelog) {
      md += `## [${release.version}] - ${release.date}\n\n`

      // Add type badge
      const typeLabel =
        release.type === "major" ? "Major Release" : release.type === "minor" ? "Feature Release" : "Patch Release"
      md += `**${typeLabel}**\n\n`

      // Add highlights
      for (const highlight of release.highlights) {
        md += `- ${highlight}\n`
      }

      md += "\n"
    }

    // Write to CHANGELOG.md
    const outputPath = join(process.cwd(), "CHANGELOG.md")
    writeFileSync(outputPath, md, "utf-8")

    console.log("✅ Generated CHANGELOG.md successfully")
  } catch (error) {
    console.error("❌ Failed to generate CHANGELOG.md:", error)
    process.exit(1)
  }
}

generateChangelogMd()
