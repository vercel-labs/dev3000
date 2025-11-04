import { execSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"

export interface ProjectInfo {
  /** Project directory path */
  path: string
  /** Project name from package.json */
  name: string
  /** Git repository URL (without .git suffix) */
  repoUrl: string
  /** Current git branch */
  branch: string
  /** Development server command */
  devCommand: string
  /** Framework detected */
  framework?: string
  /** Package manager */
  packageManager: "pnpm" | "npm" | "yarn"
}

/**
 * Detect project information from current working directory
 */
export async function detectProject(cwd: string = process.cwd()): Promise<ProjectInfo> {
  // Check if package.json exists
  const packageJsonPath = join(cwd, "package.json")
  if (!existsSync(packageJsonPath)) {
    throw new Error("No package.json found in current directory")
  }

  // Read package.json
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"))

  // Detect git repository (walk up to find .git directory)
  const gitDir = findGitRoot(cwd)
  if (!gitDir) {
    throw new Error("Not a git repository. Please initialize git first.")
  }

  // Get git remote URL
  let repoUrl: string
  try {
    const remoteUrl = execSync("git config --get remote.origin.url", {
      cwd: gitDir,
      encoding: "utf-8"
    }).trim()

    // Normalize repo URL (remove .git suffix, convert SSH to HTTPS)
    repoUrl = normalizeRepoUrl(remoteUrl)
  } catch {
    throw new Error("No git remote 'origin' found. Please add a remote first.")
  }

  // Get current branch
  let branch: string
  try {
    branch = execSync("git rev-parse --abbrev-ref HEAD", {
      cwd: gitDir,
      encoding: "utf-8"
    }).trim()
  } catch {
    throw new Error("Could not determine current git branch")
  }

  // Detect dev command
  const devCommand = detectDevCommand(packageJson)

  // Detect framework
  const framework = detectFramework(packageJson)

  // Detect package manager
  const packageManager = detectPackageManager(cwd)

  return {
    path: cwd,
    name: packageJson.name || "unknown",
    repoUrl,
    branch,
    devCommand,
    framework,
    packageManager
  }
}

/**
 * Find git root directory by walking up from cwd
 */
function findGitRoot(startDir: string): string | null {
  let currentDir = startDir

  // Walk up to root looking for .git
  while (currentDir !== "/") {
    const gitDir = join(currentDir, ".git")
    if (existsSync(gitDir)) {
      return currentDir
    }
    currentDir = dirname(currentDir)
  }

  return null
}

/**
 * Normalize git repository URL to HTTPS format without .git suffix
 */
function normalizeRepoUrl(url: string): string {
  let normalized = url

  // Convert SSH to HTTPS (git@github.com:user/repo.git -> https://github.com/user/repo.git)
  if (normalized.startsWith("git@")) {
    normalized = normalized.replace(/^git@([^:]+):(.+)$/, "https://$1/$2")
  }

  // Remove .git suffix
  if (normalized.endsWith(".git")) {
    normalized = normalized.slice(0, -4)
  }

  return normalized
}

interface PackageJson {
  name?: string
  scripts?: Record<string, string>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

/**
 * Detect the dev server command from package.json scripts
 */
function detectDevCommand(packageJson: PackageJson): string {
  const scripts = packageJson.scripts || {}

  // Check common dev script names
  if (scripts.dev) return "dev"
  if (scripts.start) return "start"
  if (scripts["dev:server"]) return "dev:server"
  if (scripts.develop) return "develop"

  throw new Error("Could not detect dev command. Please ensure your package.json has a 'dev' or 'start' script.")
}

/**
 * Detect the framework from package.json dependencies
 */
function detectFramework(packageJson: PackageJson): string | undefined {
  const deps = {
    ...packageJson.dependencies,
    ...packageJson.devDependencies
  }

  if (deps.next) return "Next.js"
  if (deps.vite) return "Vite"
  if (deps["@remix-run/react"]) return "Remix"
  if (deps.gatsby) return "Gatsby"
  if (deps.astro) return "Astro"
  if (deps["react-scripts"]) return "Create React App"
  if (deps.vue && deps["@vitejs/plugin-vue"]) return "Vue + Vite"
  if (deps.nuxt) return "Nuxt"
  if (deps.svelte) return "Svelte"
  if (deps["@sveltejs/kit"]) return "SvelteKit"

  return undefined
}

/**
 * Detect package manager from lock files
 */
function detectPackageManager(cwd: string): "pnpm" | "npm" | "yarn" {
  if (existsSync(join(cwd, "pnpm-lock.yaml"))) return "pnpm"
  if (existsSync(join(cwd, "yarn.lock"))) return "yarn"
  if (existsSync(join(cwd, "package-lock.json"))) return "npm"

  // Default to pnpm
  return "pnpm"
}
