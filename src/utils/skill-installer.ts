import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs"
import { homedir } from "os"
import path from "path"
import { getSkillsInfo } from "../skills/index.js"
import { getProjectDir } from "./project-name.js"

const GITHUB_REPO = "vercel-labs/agent-skills"
const SKILLS_PATH = "skills"

// Folders to ignore when fetching skills
const IGNORED_SKILL_FOLDERS = ["claude.ai"]

export type InstallLocation = "project" | "global"

export interface AvailableSkill {
  name: string
  description: string
  path: string
  sha: string
  isNew: boolean
  isUpdate: boolean
}

interface GitHubContentItem {
  name: string
  path: string
  sha: string
  type: "file" | "dir"
  download_url: string | null
}

interface InstalledSkillInfo {
  installedAt: string
  sha: string
}

export interface InstalledSkills {
  skills: Record<string, InstalledSkillInfo>
  seenSkills: string[] // Format: "skillName:sha"
}

// Skills are installed to project's .claude/skills/ (where Claude Code expects them)
function getProjectSkillsDir(): string {
  return path.join(process.cwd(), ".claude", "skills")
}

// Global skills are installed to ~/.claude/skills/
function getGlobalSkillsDir(): string {
  return path.join(homedir(), ".claude", "skills")
}

// Get skills directory based on install location
export function getSkillsDir(location: InstallLocation): string {
  return location === "global" ? getGlobalSkillsDir() : getProjectSkillsDir()
}

/**
 * Detect if the current project uses React by checking package.json
 */
export function detectsReact(): boolean {
  try {
    const packageJsonPath = path.join(process.cwd(), "package.json")
    if (!existsSync(packageJsonPath)) {
      return false
    }
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"))
    const deps = { ...packageJson.dependencies, ...packageJson.devDependencies }
    return Boolean(deps.react || deps["react-dom"] || deps.next || deps["@remix-run/react"])
  } catch {
    return false
  }
}

/**
 * Get bundled skills from d3k package that are installable
 * (excludes the main 'd3k' skill which is for internal use)
 * (excludes project-local skills - those are already installed)
 */
export function getBundledSkills(): AvailableSkill[] {
  const bundledSkills: AvailableSkill[] = []
  const skillsInfo = getSkillsInfo()
  const projectSkillsDir = getProjectSkillsDir()

  for (const info of skillsInfo) {
    // Skip the main d3k skill - it's for MCP/CLI internal use
    if (info.name === "d3k") continue

    // Skip project-local skills - they're already installed, not "bundled" with d3k
    if (info.path.startsWith(projectSkillsDir)) continue

    bundledSkills.push({
      name: info.name,
      description: info.description,
      path: info.path,
      sha: "bundled", // Special marker for bundled skills
      isNew: false,
      isUpdate: false
    })
  }

  return bundledSkills
}

/**
 * Check if a skill is actually installed on disk (not just tracked)
 * Checks both project and global locations
 */
function isSkillInstalledOnDisk(skillName: string): boolean {
  const projectSkillDir = path.join(getProjectSkillsDir(), skillName)
  const globalSkillDir = path.join(getGlobalSkillsDir(), skillName)
  return existsSync(projectSkillDir) || existsSync(globalSkillDir)
}

// Tracking data stored in ~/.d3k/{projectName}/skills.json
function getInstalledSkillsPath(): string {
  return path.join(getProjectDir(), "skills.json")
}

export function loadInstalledSkills(): InstalledSkills {
  const filePath = getInstalledSkillsPath()
  if (!existsSync(filePath)) {
    return { skills: {}, seenSkills: [] }
  }
  try {
    const content = readFileSync(filePath, "utf-8")
    return JSON.parse(content) as InstalledSkills
  } catch {
    return { skills: {}, seenSkills: [] }
  }
}

export function saveInstalledSkills(data: InstalledSkills): void {
  const projectDir = getProjectDir()
  if (!existsSync(projectDir)) {
    mkdirSync(projectDir, { recursive: true })
  }
  writeFileSync(getInstalledSkillsPath(), JSON.stringify(data, null, 2))
}

function parseSkillDescription(content: string): string {
  // Parse YAML frontmatter to extract description
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/)
  if (!frontmatterMatch) {
    return ""
  }
  const frontmatter = frontmatterMatch[1]
  const descriptionMatch = frontmatter.match(/description:\s*(.+)/)
  if (descriptionMatch) {
    return descriptionMatch[1].trim()
  }
  return ""
}

export async function fetchAvailableSkills(): Promise<AvailableSkill[]> {
  try {
    // Fetch list of skills from GitHub
    const response = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${SKILLS_PATH}`)
    if (!response.ok) {
      return []
    }

    const items = (await response.json()) as GitHubContentItem[]

    // Filter to only directories (actual skills, not .zip files), excluding ignored folders
    const skillDirs = items.filter((item) => item.type === "dir" && !IGNORED_SKILL_FOLDERS.includes(item.name))

    // Fetch description for each skill
    const skills: AvailableSkill[] = []
    for (const dir of skillDirs) {
      try {
        const skillMdUrl = `https://raw.githubusercontent.com/${GITHUB_REPO}/main/${dir.path}/SKILL.md`
        const skillMdResponse = await fetch(skillMdUrl)
        let description = ""
        if (skillMdResponse.ok) {
          const content = await skillMdResponse.text()
          description = parseSkillDescription(content)
        }

        skills.push({
          name: dir.name,
          description: description || `${dir.name} skill`,
          path: dir.path,
          sha: dir.sha,
          isNew: false, // Will be set by getActionableSkills
          isUpdate: false // Will be set by getActionableSkills
        })
      } catch {
        // Skip skills we can't fetch
      }
    }

    return skills
  } catch {
    // Network error or API rate limit - return empty
    return []
  }
}

export function getActionableSkills(available: AvailableSkill[], installed: InstalledSkills): AvailableSkill[] {
  const actionable: AvailableSkill[] = []

  for (const skill of available) {
    const installedInfo = installed.skills[skill.name]
    const seenKey = `${skill.name}:${skill.sha}`
    const existsOnDisk = isSkillInstalledOnDisk(skill.name)

    if (!installedInfo || !existsOnDisk) {
      // New skill OR tracked but deleted from disk - check if user already skipped this version
      if (!installed.seenSkills.includes(seenKey)) {
        actionable.push({ ...skill, isNew: true, isUpdate: false })
      }
    } else if (installedInfo.sha !== skill.sha) {
      // Update available - check if user already skipped this version
      if (!installed.seenSkills.includes(seenKey)) {
        actionable.push({ ...skill, isNew: false, isUpdate: true })
      }
    }
    // If sha matches and exists on disk, skill is up to date - skip
  }

  return actionable
}

function copyDirectory(srcDir: string, destDir: string): void {
  if (!existsSync(destDir)) {
    mkdirSync(destDir, { recursive: true })
  }

  const entries = readdirSync(srcDir, { withFileTypes: true })
  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name)
    const destPath = path.join(destDir, entry.name)

    if (entry.isDirectory()) {
      copyDirectory(srcPath, destPath)
    } else {
      copyFileSync(srcPath, destPath)
    }
  }
}

async function downloadDirectory(dirPath: string, targetDir: string): Promise<void> {
  const response = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${dirPath}`)
  if (!response.ok) {
    throw new Error(`Failed to fetch directory: ${dirPath}`)
  }

  const items = (await response.json()) as GitHubContentItem[]

  for (const item of items) {
    if (item.type === "file" && item.download_url) {
      // Download file
      const fileResponse = await fetch(item.download_url)
      if (!fileResponse.ok) {
        continue
      }
      const content = await fileResponse.text()
      const filePath = path.join(targetDir, item.name)
      writeFileSync(filePath, content)
    } else if (item.type === "dir") {
      // Create subdirectory and recurse
      const subDir = path.join(targetDir, item.name)
      if (!existsSync(subDir)) {
        mkdirSync(subDir, { recursive: true })
      }
      await downloadDirectory(item.path, subDir)
    }
  }
}

export async function installSkill(skill: AvailableSkill, location: InstallLocation = "project"): Promise<void> {
  const baseDir = getSkillsDir(location)
  const skillDir = path.join(baseDir, skill.name)

  // Create skill directory
  if (!existsSync(skillDir)) {
    mkdirSync(skillDir, { recursive: true })
  }

  if (skill.sha === "bundled") {
    // Bundled skill: copy from the d3k package
    const sourceDir = path.dirname(skill.path) // skill.path is the SKILL.md path, get parent dir
    copyDirectory(sourceDir, skillDir)
  } else {
    // Remote skill: download all files recursively
    await downloadDirectory(skill.path, skillDir)
  }

  // Update installed.json
  const installed = loadInstalledSkills()
  installed.skills[skill.name] = {
    installedAt: new Date().toISOString(),
    sha: skill.sha
  }
  // Remove from seenSkills if it was there (user chose to install after skipping)
  installed.seenSkills = installed.seenSkills.filter((s) => !s.startsWith(`${skill.name}:`))
  saveInstalledSkills(installed)
}

export function markSkillsAsSeen(skills: AvailableSkill[]): void {
  const installed = loadInstalledSkills()
  for (const skill of skills) {
    const seenKey = `${skill.name}:${skill.sha}`
    if (!installed.seenSkills.includes(seenKey)) {
      installed.seenSkills.push(seenKey)
    }
  }
  saveInstalledSkills(installed)
}

export async function checkForNewSkills(): Promise<AvailableSkill[]> {
  // Fetch remote skills from GitHub
  const remoteSkills = await fetchAvailableSkills()

  // Get bundled skills from d3k package
  const bundledSkills = getBundledSkills()

  // Combine both, with bundled skills first
  const available = [...bundledSkills, ...remoteSkills]

  const installed = loadInstalledSkills()
  return getActionableSkills(available, installed)
}

export async function installSelectedSkills(
  skills: AvailableSkill[],
  location: InstallLocation = "project",
  onProgress?: (skill: AvailableSkill, index: number, total: number) => void
): Promise<{ success: string[]; failed: string[] }> {
  const success: string[] = []
  const failed: string[] = []

  for (let i = 0; i < skills.length; i++) {
    const skill = skills[i]
    onProgress?.(skill, i, skills.length)
    try {
      await installSkill(skill, location)
      success.push(skill.name)
    } catch {
      failed.push(skill.name)
    }
  }

  return { success, failed }
}
