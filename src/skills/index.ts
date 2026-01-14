/**
 * Shared skill module for d3k
 *
 * Skills are prompt templates stored as SKILL.md files that provide
 * specialized instructions for specific tasks.
 *
 * This module is used by both:
 * - CLI: `d3k skill <name>`
 * - MCP: `get_skill` tool
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
 * Get the base directories where skills can be found.
 * Searches in order of priority:
 * 1. Project-local skills (.claude/skills/)
 * 2. Global skills (~/.claude/skills/)
 * 3. Source skills (src/skills/) - for development
 * 4. Dist skills (dist/skills/) - for installed packages
 */
export function getSkillDirectories(cwd?: string): string[] {
  const dirs: string[] = []

  // 1. Project-local skills (highest priority)
  const projectDir = cwd || process.cwd()
  dirs.push(join(projectDir, ".claude", "skills"))

  // 2. Global skills (~/.claude/skills/)
  dirs.push(join(homedir(), ".claude", "skills"))

  // 3. Check if we're running from a compiled binary (bun compile)
  // In compiled binaries, import.meta.url returns /$bunfs/... virtual path
  // We detect this by checking if the URL starts with /$bunfs
  const moduleUrl = import.meta.url
  const isCompiledBinary = moduleUrl.startsWith("file:///$bunfs") || moduleUrl.startsWith("/$bunfs")

  if (isCompiledBinary) {
    // For compiled binaries, process.execPath contains the actual binary path
    const binaryPath = process.execPath
    if (binaryPath && existsSync(binaryPath)) {
      const binDir = dirname(binaryPath) // bin/
      const packageDir = dirname(binDir) // platform package root (e.g., @d3k/darwin-arm64)
      dirs.push(join(packageDir, "skills"))
    }
  }

  // 4. Source and dist skills from the d3k package
  // Handle both ESM (__dirname equivalent) and different execution contexts
  try {
    const currentFile = fileURLToPath(import.meta.url)
    const srcDir = dirname(currentFile) // src/skills
    const packageRoot = dirname(dirname(srcDir)) // package root

    // Source skills (for development)
    dirs.push(join(packageRoot, "src", "skills"))

    // Dist skills (for installed package)
    dirs.push(join(packageRoot, "dist", "skills"))

    // Also check if we're in a binary distribution
    dirs.push(join(packageRoot, "skills"))
  } catch {
    // Fallback for CommonJS or other contexts
  }

  return dirs.filter((dir) => existsSync(dir))
}

/**
 * Find a skill by name.
 * Returns the path to the SKILL.md file if found.
 */
export function findSkill(name: string, cwd?: string): string | null {
  const skillDirs = getSkillDirectories(cwd)

  for (const dir of skillDirs) {
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
      return {
        found: true,
        name,
        content,
        path: skillPath
      }
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
  const skillDirs = getSkillDirectories(cwd)

  for (const dir of skillDirs) {
    try {
      const entries = readdirSync(dir, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const skillFile = join(dir, entry.name, "SKILL.md")
          if (existsSync(skillFile)) {
            skills.add(entry.name)
          }
        }
      }
    } catch {
      // Directory might not exist or be readable
    }
  }

  return Array.from(skills).sort()
}

/**
 * Get detailed info about all available skills.
 */
export function getSkillsInfo(cwd?: string): SkillInfo[] {
  const skillsMap = new Map<string, SkillInfo>()
  const skillDirs = getSkillDirectories(cwd)

  for (const dir of skillDirs) {
    try {
      const entries = readdirSync(dir, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.isDirectory() && !skillsMap.has(entry.name)) {
          const skillPath = join(dir, entry.name, "SKILL.md")
          if (existsSync(skillPath)) {
            try {
              const content = readFileSync(skillPath, "utf-8")
              const description = extractDescription(content)
              skillsMap.set(entry.name, {
                name: entry.name,
                description,
                path: skillPath
              })
            } catch {
              // Skip unreadable skills
            }
          }
        }
      }
    } catch {
      // Directory might not exist or be readable
    }
  }

  return Array.from(skillsMap.values()).sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Extract description from SKILL.md frontmatter or first paragraph.
 */
function extractDescription(content: string): string {
  // Try to extract from YAML frontmatter
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/)
  if (frontmatterMatch) {
    const frontmatter = frontmatterMatch[1]
    const descMatch = frontmatter.match(/description:\s*(.+)/)
    if (descMatch) {
      return descMatch[1].trim()
    }
  }

  // Fallback: use first non-heading, non-empty line
  const lines = content.split("\n")
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed && !trimmed.startsWith("#") && !trimmed.startsWith("---")) {
      return trimmed.slice(0, 100) + (trimmed.length > 100 ? "..." : "")
    }
  }

  return "No description available"
}
