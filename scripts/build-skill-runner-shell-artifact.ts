import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, "..")
const outputDir = path.resolve(
  repoRoot,
  process.env.SKILL_RUNNER_SHELL_OUTPUT_DIR?.trim() || ".artifacts/skill-runner-shell"
)

const rootFiles = new Set(["package.json", "bun.lock"])
const exactFiles = new Set([
  "www/app/api/cloud/fix-workflow/health/route.ts",
  "www/app/api/cloud/fix-workflow/steps.ts",
  "www/app/api/cloud/fix-workflow/workflow.ts",
  "www/app/api/cloud/start-fix/route.ts",
  "www/app/api/skill-runner-worker/version/route.ts",
  "www/app/skill-runner-worker-home.tsx",
  "www/app/skill-runner-worker-layout.tsx",
  "www/bunfig.toml",
  "www/lib/ai-gateway.ts",
  "www/lib/auth.ts",
  "www/lib/blob-store.ts",
  "www/lib/constants.ts",
  "www/lib/dev-agent-ash-spec.ts",
  "www/lib/dev-agent-ash.ts",
  "www/lib/dev-agents.ts",
  "www/lib/dev-server-command.ts",
  "www/lib/file-to-route.ts",
  "www/lib/report-redaction.ts",
  "www/lib/skill-runner-config.ts",
  "www/lib/skill-runner-runtime.ts",
  "www/lib/skill-runner-shell-source.ts",
  "www/lib/skill-runner-worker.ts",
  "www/lib/skill-runners.ts",
  "www/lib/skills-sh.ts",
  "www/lib/team-selection.ts",
  "www/lib/telemetry-storage.ts",
  "www/lib/telemetry.ts",
  "www/lib/vercel-cli-sandbox-context.ts",
  "www/lib/vercel-protection-bypass.ts",
  "www/lib/vercel-teams.ts",
  "www/lib/workflow-api.ts",
  "www/lib/workflow-logger.ts",
  "www/lib/workflow-report-summary.ts",
  "www/lib/workflow-storage.ts",
  "www/next.config.ts",
  "www/package.json",
  "www/scripts/patch-workflow-vercel-config.mjs",
  "www/tsconfig.json",
  "www/types.ts",
  "www/vercel.json"
])
const includedPrefixes = ["www/app/.well-known/workflow/v1/", "www/lib/cloud/", "www/lib/skills/"]
const pathOverrides = new Map([
  ["www/app/skill-runner-worker-home.tsx", "www/app/page.tsx"],
  ["www/app/skill-runner-worker-layout.tsx", "www/app/layout.tsx"]
])

interface SkillRunnerShellManifestFile {
  path: string
  sha1: string
  size: number
  contentUrl: string
}

interface SkillRunnerShellManifest {
  schemaVersion: 1
  kind: "source"
  version: string
  commit: string
  generatedAt: string
  sourceBaseUrl: string
  rootDirectory: "www"
  projectSettings: {
    framework: "nextjs"
    rootDirectory: "www"
    nodeVersion: "24.x"
    sourceFilesOutsideRootDirectory: true
  }
  files: SkillRunnerShellManifestFile[]
  fileCount: number
  totalSize: number
}

function git(args: string[]): string {
  return execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"]
  })
}

function readRootPackageVersion(): string {
  const packageJson = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8")) as { version?: string }
  const version = packageJson.version?.trim()
  if (!version) {
    throw new Error("Root package.json is missing a version.")
  }
  return version
}

function resolveVersion(): string {
  return process.env.SKILL_RUNNER_SHELL_VERSION?.trim() || readRootPackageVersion()
}

function resolveCommit(): string {
  return process.env.SKILL_RUNNER_SHELL_COMMIT?.trim() || git(["rev-parse", "HEAD"]).trim()
}

function listTrackedFiles(): string[] {
  return git(["ls-files", "--cached", "--others", "--exclude-standard", "-z"])
    .split("\0")
    .map((file) => file.trim())
    .filter(Boolean)
}

function isRunnerShellFile(file: string): boolean {
  if (rootFiles.has(file)) return true
  if (exactFiles.has(file)) return true
  return includedPrefixes.some((prefix) => file.startsWith(prefix))
}

function resolveRunnerShellDeploymentPath(file: string): string {
  return pathOverrides.get(file) || file
}

function encodePathForUrl(file: string): string {
  return file
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/")
}

function buildManifestFile(file: string, sourceBaseUrl: string): SkillRunnerShellManifestFile {
  const contents = readFileSync(path.join(repoRoot, file))
  return {
    path: resolveRunnerShellDeploymentPath(file),
    sha1: createHash("sha1").update(contents).digest("hex"),
    size: contents.byteLength,
    contentUrl: `${sourceBaseUrl.replace(/\/$/, "")}/${encodePathForUrl(file)}`
  }
}

function buildManifest(): SkillRunnerShellManifest {
  const version = resolveVersion()
  const commit = resolveCommit()
  const sourceBaseUrl =
    process.env.SKILL_RUNNER_SHELL_SOURCE_BASE_URL?.trim() ||
    `https://raw.githubusercontent.com/vercel-labs/dev3000/${commit}`
  const files = listTrackedFiles()
    .filter(isRunnerShellFile)
    .map((file) => buildManifestFile(file, sourceBaseUrl))

  if (files.length === 0) {
    throw new Error("No runner shell files matched the artifact filter.")
  }

  return {
    schemaVersion: 1,
    kind: "source",
    version,
    commit,
    generatedAt: new Date().toISOString(),
    sourceBaseUrl,
    rootDirectory: "www",
    projectSettings: {
      framework: "nextjs",
      rootDirectory: "www",
      nodeVersion: "24.x",
      sourceFilesOutsideRootDirectory: true
    },
    files,
    fileCount: files.length,
    totalSize: files.reduce((total, file) => total + file.size, 0)
  }
}

const manifest = buildManifest()
mkdirSync(outputDir, { recursive: true })

const versionedPath = path.join(outputDir, `skill-runner-shell-${manifest.version}.json`)
const latestPath = path.join(outputDir, "skill-runner-shell-latest.json")
const json = `${JSON.stringify(manifest, null, 2)}\n`

writeFileSync(versionedPath, json)
writeFileSync(latestPath, json)

console.log(
  `Built skill-runner shell manifest ${manifest.version}: ${manifest.fileCount} files, ${manifest.totalSize} bytes`
)
console.log(path.relative(repoRoot, versionedPath))
