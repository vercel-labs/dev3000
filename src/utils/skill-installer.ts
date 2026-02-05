import { spawnSync } from "child_process"
import { existsSync, readFileSync, writeFileSync } from "fs"
import { homedir } from "os"
import path from "path"

export type InstallLocation = "project" | "global"
export type ProjectType = "nextjs" | "react" | "other"

export interface SkillPackage {
  repo: string
  displayName: string
  description: string
  projectTypes: ProjectType[]
  /** Skill folder names to check for installation */
  skillFolders: string[]
}

export type SkillsAgentId = string

const AGENT_SKILLS_PATHS: Record<
  SkillsAgentId,
  {
    project: string[]
    global: string[]
  }
> = {
  "claude-code": {
    project: [".claude", "skills"],
    global: [".claude", "skills"]
  },
  codex: {
    project: [".codex", "skills"],
    global: [".codex", "skills"]
  },
  cursor: {
    project: [".cursor", "skills"],
    global: [".cursor", "skills"]
  },
  cline: {
    project: [".cline", "skills"],
    global: [".cline", "skills"]
  },
  "gemini-cli": {
    project: [".gemini", "skills"],
    global: [".gemini", "skills"]
  },
  opencode: {
    project: [".opencode", "skills"],
    global: [".config", "opencode", "skills"]
  }
}

/**
 * Skill packages offered based on project type.
 * These are installed via `npx skills add <repo> --all`
 */
export const SKILL_PACKAGES: SkillPackage[] = [
  {
    repo: "vercel-labs/next-skills",
    displayName: "Next.js Skills",
    description: "Best practices, debugging, hydration fixes, metadata, and upgrade guides",
    projectTypes: ["nextjs"],
    // Folder names as installed by `npx skills add vercel-labs/next-skills`
    skillFolders: ["next-best-practices", "next-cache-components", "next-upgrade"]
  },
  {
    repo: "vercel-labs/agent-skills",
    displayName: "React & Web Skills",
    description: "React performance, design guidelines, and web development best practices",
    projectTypes: ["nextjs", "react"],
    // Folder names as installed by `npx skills add vercel-labs/agent-skills`
    skillFolders: ["vercel-react-best-practices", "vercel-composition-patterns", "web-design-guidelines"]
  }
]

/**
 * Detect the project type based on config files and package.json dependencies.
 */
export function detectProjectType(): ProjectType {
  // Check for Next.js config files first (most specific indicator)
  const nextConfigFiles = ["next.config.js", "next.config.ts", "next.config.mjs", "next.config.cjs"]
  if (nextConfigFiles.some((file) => existsSync(path.join(process.cwd(), file)))) {
    return "nextjs"
  }

  // Check package.json dependencies
  const packageJsonPath = path.join(process.cwd(), "package.json")
  if (existsSync(packageJsonPath)) {
    try {
      const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"))
      const deps = { ...packageJson.dependencies, ...packageJson.devDependencies }

      // Check for Next.js in dependencies
      if (deps.next) {
        return "nextjs"
      }

      // Check for React in dependencies
      if (deps.react || deps["react-dom"]) {
        return "react"
      }
    } catch {
      // Ignore parse errors
    }
  }

  return "other"
}

/**
 * Get skill packages applicable to the current project type.
 */
export function getApplicablePackages(): SkillPackage[] {
  const projectType = detectProjectType()
  return SKILL_PACKAGES.filter((pkg) => pkg.projectTypes.includes(projectType))
}

/**
 * Check if a skill package is already installed by checking for its skill folders.
 * A package is considered installed if ANY of its skill folders exist.
 * Only checks .agents/skills since that's where `npx skills` installs to.
 */
export function isPackageInstalled(pkg: SkillPackage, agentId: SkillsAgentId): boolean {
  const searchDirs = getSkillsDirs(agentId)
  if (searchDirs.length === 0) {
    return false
  }

  for (const skillsDir of searchDirs) {
    for (const folder of pkg.skillFolders) {
      if (existsSync(path.join(skillsDir, folder))) {
        return true
      }
    }
  }

  return false
}

export function getSkillsPathForLocation(
  agentId: SkillsAgentId,
  location: InstallLocation
): { path: string; isGlobal: boolean } | null {
  const paths = AGENT_SKILLS_PATHS[agentId]
  if (!paths) {
    return null
  }

  const pathParts = location === "global" ? paths.global : paths.project
  const base = location === "global" ? homedir() : process.cwd()
  return { path: path.join(base, ...pathParts), isGlobal: location === "global" }
}

/**
 * Get skills directories to check based on agent ID.
 */
function getSkillsDirs(agentId: SkillsAgentId): string[] {
  const paths = AGENT_SKILLS_PATHS[agentId]
  if (!paths) {
    return []
  }

  return [path.join(process.cwd(), ...paths.project), path.join(homedir(), ...paths.global)]
}

function getProjectSkillsRoot(agentId: SkillsAgentId): string | null {
  const paths = AGENT_SKILLS_PATHS[agentId]
  if (!paths || paths.project.length === 0) {
    return null
  }

  return path.join(process.cwd(), paths.project[0])
}

/**
 * Install a skill package using the skills CLI.
 * Installs all skills from the package to the specified location.
 */
export async function installSkillPackage(
  pkg: SkillPackage,
  location: InstallLocation = "project",
  agentId?: SkillsAgentId
): Promise<{ success: boolean; error?: string }> {
  if (!agentId) {
    return { success: false, error: "No agent specified" }
  }

  const projectSkillsRoot = location === "project" ? getProjectSkillsRoot(agentId) : null
  const hadProjectSkillsRoot = projectSkillsRoot ? existsSync(projectSkillsRoot) : false

  // --skill '*' installs all skills for the specified agent only.
  const args = ["add", pkg.repo, "-a", agentId, "-y", "--skill", "*"]

  if (location === "global") {
    args.push("-g")
  }

  const result = spawnSync("npx", ["--yes", "skills@latest", ...args], {
    stdio: "inherit",
    timeout: 120000, // 2 minute timeout for full package
    cwd: process.cwd()
  })

  if (result.status !== 0) {
    return { success: false, error: "Installation failed" }
  }

  if (location === "project" && projectSkillsRoot && !hadProjectSkillsRoot && existsSync(projectSkillsRoot)) {
    ensureAgentDirGitignored(projectSkillsRoot)
  }

  return { success: true }
}

/**
 * Check for skill updates using the skills CLI.
 */
export async function checkForSkillUpdates(): Promise<{ hasUpdates: boolean; output: string }> {
  const result = spawnSync("npx", ["--yes", "skills@latest", "check"], {
    stdio: "pipe",
    timeout: 30000
  })

  const output = result.stdout?.toString() || ""
  const lowerOutput = output.toLowerCase()

  // Check for specific phrases that indicate updates are available
  // Avoid false positives from "Checking for skill updates..." message
  const hasUpdates =
    (lowerOutput.includes("update available") || lowerOutput.includes("updates available")) &&
    !lowerOutput.includes("no skills tracked") &&
    !lowerOutput.includes("no skills to check")

  return { hasUpdates, output }
}

/**
 * Update all skills using the skills CLI.
 */
export async function updateSkills(): Promise<{ success: boolean; output: string }> {
  const result = spawnSync("npx", ["--yes", "skills@latest", "update", "-y"], {
    stdio: "pipe",
    timeout: 120000
  })

  return {
    success: result.status === 0,
    output: result.stdout?.toString() || result.stderr?.toString() || ""
  }
}

/**
 * Get packages that are applicable but not yet installed.
 */
export function getUninstalledPackages(): SkillPackage[] {
  return getApplicablePackages()
}

/**
 * Get packages that are applicable and installed (for showing update info).
 */
export function getInstalledPackages(): SkillPackage[] {
  return getApplicablePackages()
}

function ensureAgentDirGitignored(projectSkillsRoot: string): void {
  const entryBase = path.basename(projectSkillsRoot)
  if (!entryBase.startsWith(".")) {
    return
  }

  const entry = `${entryBase}/`
  const gitignorePath = path.join(process.cwd(), ".gitignore")

  let contents = ""
  if (existsSync(gitignorePath)) {
    contents = readFileSync(gitignorePath, "utf-8")
    if (contents.split(/\r?\n/).some((line) => line.trim() === entry)) {
      return
    }
  }

  const suffix = contents.endsWith("\n") || contents.length === 0 ? "" : "\n"
  writeFileSync(gitignorePath, `${contents}${suffix}${entry}\n`, "utf-8")
}
