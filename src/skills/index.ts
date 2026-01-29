/**
 * Skill module for d3k
 *
 * Skills are managed by `npx skills` and stored in .agents/skills/
 * d3k also bundles its own skill which gets copied to .agents/skills/d3k/ on startup.
 */

import { existsSync, readdirSync, readFileSync } from "fs"
import { homedir } from "os"
import { dirname, join } from "path"
import { fileURLToPath } from "url"

export interface SkillInfo {
  name: string
  description: string
  path: string
}

export interface SkillResult {
  found: boolean
  name: string
  content?: string
  path?: string
  error?: string
  availableSkills?: string[]
}

/**
 * Get the path to d3k's bundled skills directory.
 * Returns null if not found (e.g., running in development without build).
 */
export function getBundledSkillsPath(): string | null {
  // Check if running from compiled binary
  const moduleUrl = import.meta.url
  const isCompiledBinary = moduleUrl.startsWith("file:///$bunfs") || moduleUrl.startsWith("/$bunfs")

  if (isCompiledBinary) {
    // Try process.argv[0] first (more reliable for Bun compiled binaries)
    // Then fall back to process.execPath
    const possiblePaths = [process.argv[0], process.execPath].filter(Boolean)

    for (const binaryPath of possiblePaths) {
      if (binaryPath && existsSync(binaryPath)) {
        const binDir = dirname(binaryPath)
        const packageDir = dirname(binDir)
        const skillsDir = join(packageDir, "skills")
        if (existsSync(skillsDir)) {
          return skillsDir
        }
      }
    }
  }

  // Fallback for npm-installed package: look for dist/skills relative to this module
  // import.meta.url is like "file:///path/to/node_modules/dev3000/dist/skills/index.js"
  if (moduleUrl.startsWith("file://")) {
    const modulePath = fileURLToPath(moduleUrl)
    // This file is at dist/skills/index.js, so skills are at dist/skills/
    const skillsDir = dirname(modulePath)
    if (existsSync(join(skillsDir, "d3k", "SKILL.md"))) {
      return skillsDir
    }
  }

  return null
}

/**
 * Get directories where skills can be found.
 * Skills are managed by `npx skills` in .agents/skills/
 */
export function getSkillDirectories(cwd?: string): string[] {
  const dirs: string[] = []
  const projectDir = cwd || process.cwd()

  // Project-local skills (highest priority)
  dirs.push(join(projectDir, ".agents", "skills"))

  // Global skills
  dirs.push(join(homedir(), ".agents", "skills"))

  // d3k's bundled skills (fallback for d3k skill before it's copied)
  const bundled = getBundledSkillsPath()
  if (bundled) {
    dirs.push(bundled)
  }

  return dirs.filter((dir) => existsSync(dir))
}

/**
 * Find a skill by name.
 */
export function findSkill(name: string, cwd?: string): string | null {
  for (const dir of getSkillDirectories(cwd)) {
    const skillPath = join(dir, name, "SKILL.md")
    if (existsSync(skillPath)) {
      return skillPath
    }
  }
  return null
}

/**
 * Get the content of a skill by name.
 */
export function getSkill(name: string, cwd?: string): SkillResult {
  const skillPath = findSkill(name, cwd)

  if (skillPath) {
    try {
      const content = readFileSync(skillPath, "utf-8")
      return { found: true, name, content, path: skillPath }
    } catch (error) {
      return {
        found: false,
        name,
        error: `Failed to read skill: ${error instanceof Error ? error.message : String(error)}`,
        availableSkills: listAvailableSkills(cwd)
      }
    }
  }

  return {
    found: false,
    name,
    error: `Skill "${name}" not found`,
    availableSkills: listAvailableSkills(cwd)
  }
}

/**
 * List all available skills.
 */
export function listAvailableSkills(cwd?: string): string[] {
  const skills = new Set<string>()

  for (const dir of getSkillDirectories(cwd)) {
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory() && existsSync(join(dir, entry.name, "SKILL.md"))) {
          skills.add(entry.name)
        }
      }
    } catch {
      // Directory not readable
    }
  }

  return Array.from(skills).sort()
}

/**
 * Get detailed info about all available skills.
 */
export function getSkillsInfo(cwd?: string): SkillInfo[] {
  const skillsMap = new Map<string, SkillInfo>()

  for (const dir of getSkillDirectories(cwd)) {
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory() && !skillsMap.has(entry.name)) {
          const skillPath = join(dir, entry.name, "SKILL.md")
          if (existsSync(skillPath)) {
            try {
              const content = readFileSync(skillPath, "utf-8")
              skillsMap.set(entry.name, {
                name: entry.name,
                description: extractDescription(content),
                path: skillPath
              })
            } catch {
              // Skip unreadable
            }
          }
        }
      }
    } catch {
      // Directory not readable
    }
  }

  return Array.from(skillsMap.values()).sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Extract description from SKILL.md frontmatter or first paragraph.
 */
function extractDescription(content: string): string {
  // Try YAML frontmatter
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/)
  if (frontmatterMatch) {
    const descMatch = frontmatterMatch[1].match(/description:\s*(.+)/)
    if (descMatch) {
      return descMatch[1].trim()
    }
  }

  // Fallback: first non-heading, non-empty line
  for (const line of content.split("\n")) {
    const trimmed = line.trim()
    if (trimmed && !trimmed.startsWith("#") && !trimmed.startsWith("---")) {
      return trimmed.length > 100 ? `${trimmed.slice(0, 97)}...` : trimmed
    }
  }

  return "No description available"
}
