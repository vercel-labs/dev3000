import { spawnSync } from "child_process"
import { existsSync, readFileSync } from "fs"
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
export function isPackageInstalled(pkg: SkillPackage): boolean {
  const searchDirs = [path.join(process.cwd(), ".agents", "skills"), path.join(homedir(), ".agents", "skills")]

  for (const skillsDir of searchDirs) {
    for (const folder of pkg.skillFolders) {
      if (existsSync(path.join(skillsDir, folder))) {
        return true
      }
    }
  }

  return false
}

/**
 * Get skills directory based on install location.
 * Uses .agents/skills since that's where `npx skills` installs to.
 */
export function getSkillsDir(location: InstallLocation): string {
  return location === "global"
    ? path.join(homedir(), ".agents", "skills")
    : path.join(process.cwd(), ".agents", "skills")
}

/**
 * Install a skill package using the skills CLI.
 * Installs all skills from the package to the specified location.
 */
export async function installSkillPackage(
  pkg: SkillPackage,
  location: InstallLocation = "project"
): Promise<{ success: boolean; error?: string }> {
  // --skill '*' installs all skills for the specified agent only.
  const args = ["add", pkg.repo, "-a", "claude-code", "-y", "--skill", "*"]

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
  return getApplicablePackages().filter((pkg) => !isPackageInstalled(pkg))
}

/**
 * Get packages that are applicable and installed (for showing update info).
 */
export function getInstalledPackages(): SkillPackage[] {
  return getApplicablePackages().filter((pkg) => isPackageInstalled(pkg))
}
