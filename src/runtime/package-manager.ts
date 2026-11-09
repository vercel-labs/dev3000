import { accessSync, constants, existsSync, readFileSync, realpathSync } from "node:fs"
import { delimiter, dirname, isAbsolute, join, relative, sep } from "node:path"

type PackageManager = "bun" | "pnpm" | "yarn" | "npm"

const markers: Record<PackageManager, string[]> = {
  bun: ["bun.lock", "bun.lockb"],
  pnpm: ["pnpm-lock.yaml", "pnpm-workspace.yaml"],
  yarn: ["yarn.lock"],
  npm: ["package-lock.json", "npm-shrinkwrap.json"]
}

function executableAvailable(command: string): boolean {
  const suffixes = process.platform === "win32" ? (process.env.PATHEXT || ".EXE;.CMD;.BAT").split(";") : [""]
  return (process.env.PATH || "").split(delimiter).some((directory) =>
    suffixes.some((suffix) => {
      try {
        accessSync(join(directory, `${command}${suffix}`), constants.X_OK)
        return true
      } catch {
        return false
      }
    })
  )
}

export function packageManagerRunner(manager: PackageManager): string {
  if ((manager === "pnpm" || manager === "yarn") && !executableAvailable(manager) && executableAvailable("corepack"))
    return `corepack ${manager}`
  return manager
}

/** Resolve workspace ownership without reading outside the checkout. */
export function detectPackageManager(cwd: string, repositoryRoot?: string): { manager: PackageManager; root: string } {
  const start = realpathSync(cwd)
  const boundary = repositoryRoot ? realpathSync(repositoryRoot) : undefined
  if (boundary) {
    const path = relative(boundary, start)
    if (path === ".." || path.startsWith(`..${sep}`) || isAbsolute(path))
      throw new Error("Project directory escapes the repository")
  }
  const directories: string[] = []
  for (let directory = start; ; directory = dirname(directory)) {
    directories.push(directory)
    if (directory === boundary || existsSync(join(directory, ".git")) || directory === dirname(directory)) break
  }
  // A workspace declaration takes precedence over stray lockfiles in its children.
  for (const directory of directories) {
    const manifest = join(directory, "package.json")
    if (!existsSync(manifest)) continue
    const pkg = JSON.parse(readFileSync(manifest, "utf8"))
    if (pkg.packageManager === undefined) continue
    const name = typeof pkg.packageManager === "string" ? pkg.packageManager.split("@")[0] : undefined
    if (!name || !Object.hasOwn(markers, name))
      throw new Error(`Unsupported packageManager in ${manifest}; pass --command or --install-command`)
    return { manager: name as PackageManager, root: directory }
  }
  for (const directory of directories) {
    const found = (Object.keys(markers) as PackageManager[]).filter((manager) =>
      markers[manager].some((name) => existsSync(join(directory, name)))
    )
    if (found.length > 1)
      throw new Error(
        `Conflicting package-manager files in ${directory}; set packageManager or pass an explicit command`
      )
    if (found[0]) return { manager: found[0], root: directory }
  }
  return { manager: "npm", root: start }
}

export function dependencyInstallPlan(
  cwd: string,
  repositoryRoot: string,
  override?: string
): { command: string; cwd: string } {
  if (override) return { command: override, cwd }
  const { manager, root } = detectPackageManager(cwd, repositoryRoot)
  return { command: `${packageManagerRunner(manager)} install`, cwd: root }
}
