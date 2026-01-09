import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs"
import path from "path"
import { getProjectDir } from "./project-name.js"

const GITHUB_REPO = "vercel-labs/agent-skills"
const SKILLS_PATH = "dx/skills"

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

/**
 * Check if a skill is actually installed on disk (not just tracked)
 */
function isSkillInstalledOnDisk(skillName: string): boolean {
  const skillDir = path.join(getProjectSkillsDir(), skillName)
  return existsSync(skillDir)
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

    // Filter to only directories (actual skills, not .zip files)
    const skillDirs = items.filter((item) => item.type === "dir")

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

export async function installSkill(skill: AvailableSkill): Promise<void> {
  const skillDir = path.join(getProjectSkillsDir(), skill.name)

  // Create skill directory
  if (!existsSync(skillDir)) {
    mkdirSync(skillDir, { recursive: true })
  }

  // Download all files recursively
  await downloadDirectory(skill.path, skillDir)

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
  const available = await fetchAvailableSkills()
  const installed = loadInstalledSkills()
  return getActionableSkills(available, installed)
}

export async function installSelectedSkills(
  skills: AvailableSkill[],
  onProgress?: (skill: AvailableSkill, index: number, total: number) => void
): Promise<{ success: string[]; failed: string[] }> {
  const success: string[] = []
  const failed: string[] = []

  for (let i = 0; i < skills.length; i++) {
    const skill = skills[i]
    onProgress?.(skill, i, skills.length)
    try {
      await installSkill(skill)
      success.push(skill.name)
    } catch {
      failed.push(skill.name)
    }
  }

  return { success, failed }
}
