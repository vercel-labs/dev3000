import { createHash } from "node:crypto"
import { SKILL_RUNNER_WORKER_REPO, SKILL_RUNNER_WORKER_ROOT_DIRECTORY } from "@/lib/skill-runner-config"

const RUNNER_SHELL_ROOT_FILES = new Set(["package.json", "bun.lock"])
const RUNNER_SHELL_EXACT_FILES = new Set([
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
  "www/lib/oidc-token-binding.ts",
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
  "www/lib/workflow-report-blob.ts",
  "www/lib/workflow-report-summary.ts",
  "www/lib/workflow-storage.ts",
  "www/next.config.ts",
  "www/package.json",
  "www/scripts/patch-workflow-vercel-config.mjs",
  "www/tsconfig.json",
  "www/types.ts",
  "www/vercel.json"
])
const RUNNER_SHELL_INCLUDED_PREFIXES = ["www/app/.well-known/workflow/v1/", "www/lib/cloud/", "www/lib/skills/"]
const RUNNER_SHELL_UPLOAD_CONCURRENCY = 8
const RUNNER_NEXT_CONFIG_PREVIEW_COMMENTS_PATCH =
  '// Self-hosted runner shells disable Preview Comments to avoid Vercel adapter/Next ctx.projectDir skew.\nprocess.env.VERCEL_PREVIEW_COMMENTS_ENABLED = "0"\n'
const RUNNER_NEXT_CONFIG_CONTENT = `import type { NextConfig } from "next"
import path from "path"
import { fileURLToPath } from "url"
import { withWorkflow } from "workflow/next"

${RUNNER_NEXT_CONFIG_PREVIEW_COMMENTS_PATCH}
const currentDir = path.dirname(fileURLToPath(import.meta.url))

const nextConfig: NextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: path.join(currentDir, ".."),
  turbopack: {
    root: path.join(currentDir, "..")
  }
}

export default withWorkflow(nextConfig)
`
const RUNNER_NEXT_CONFIG_PATH = `${SKILL_RUNNER_WORKER_ROOT_DIRECTORY}/next.config.ts`
const RUNNER_ROOT_PACKAGE_PATH = "package.json"
const RUNNER_WWW_PACKAGE_PATH = `${SKILL_RUNNER_WORKER_ROOT_DIRECTORY}/package.json`
const RUNNER_SHELL_PATH_OVERRIDES = new Map([
  [
    `${SKILL_RUNNER_WORKER_ROOT_DIRECTORY}/app/skill-runner-worker-home.tsx`,
    `${SKILL_RUNNER_WORKER_ROOT_DIRECTORY}/app/page.tsx`
  ],
  [
    `${SKILL_RUNNER_WORKER_ROOT_DIRECTORY}/app/skill-runner-worker-layout.tsx`,
    `${SKILL_RUNNER_WORKER_ROOT_DIRECTORY}/app/layout.tsx`
  ]
])

export interface SkillRunnerShellTreeEntry {
  path?: string
  type?: string
}

interface GitHubTreeResponse {
  tree?: SkillRunnerShellTreeEntry[]
  truncated?: boolean
}

interface SkillRunnerShellManifestFile {
  path: string
  contentUrl: string
  sourcePath?: string
}

export interface SkillRunnerShellSource {
  version: string
  commit: string
  files: SkillRunnerShellManifestFile[]
}

export interface VercelUploadedDeploymentFile {
  file: string
  sha: string
  size: number
}

export function isRunnerShellFile(file: string): boolean {
  if (RUNNER_SHELL_ROOT_FILES.has(file)) return true
  if (RUNNER_SHELL_EXACT_FILES.has(file)) return true
  return RUNNER_SHELL_INCLUDED_PREFIXES.some((prefix) => file.startsWith(prefix))
}

function encodePathForUrl(file: string): string {
  return file
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/")
}

function resolveRunnerShellDeploymentPath(file: string): string {
  return RUNNER_SHELL_PATH_OVERRIDES.get(file) || file
}

async function fetchGitHubTree(commit: string): Promise<GitHubTreeResponse> {
  const response = await fetch(
    `https://api.github.com/repos/${SKILL_RUNNER_WORKER_REPO}/git/trees/${commit}?recursive=1`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "dev3000-skill-runner"
      },
      cache: "no-store"
    }
  )

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Failed to resolve runner shell source tree: ${response.status} ${errorText}`)
  }

  return (await response.json()) as GitHubTreeResponse
}

export function resolveSkillRunnerShellSourceFromTree(
  tree: SkillRunnerShellTreeEntry[],
  commit: string,
  version = commit
): SkillRunnerShellSource {
  const files = tree
    .filter((entry): entry is Required<Pick<SkillRunnerShellTreeEntry, "path" | "type">> =>
      Boolean(entry.path && entry.type)
    )
    .filter((entry) => entry.type === "blob" && isRunnerShellFile(entry.path))
    .map((entry) => ({
      path: resolveRunnerShellDeploymentPath(entry.path),
      sourcePath: entry.path,
      contentUrl: `https://raw.githubusercontent.com/${SKILL_RUNNER_WORKER_REPO}/${commit}/${encodePathForUrl(entry.path)}`
    }))
    .sort((a, b) => a.path.localeCompare(b.path))

  if (files.length === 0) {
    throw new Error(`No runner shell files matched ${SKILL_RUNNER_WORKER_REPO}@${commit}.`)
  }

  return {
    version,
    commit,
    files
  }
}

export async function resolveSkillRunnerShellSource(commit: string, version = commit): Promise<SkillRunnerShellSource> {
  const tree = await fetchGitHubTree(commit)
  if (tree.truncated) {
    throw new Error(`Runner shell source tree for ${commit} was truncated by GitHub.`)
  }

  return resolveSkillRunnerShellSourceFromTree(tree.tree || [], commit, version)
}

async function mapWithConcurrency<T, U>(
  values: T[],
  concurrency: number,
  mapValue: (value: T, index: number) => Promise<U>
): Promise<U[]> {
  const results = new Array<U>(values.length)
  let nextIndex = 0

  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    for (;;) {
      const index = nextIndex
      nextIndex += 1
      if (index >= values.length) return
      results[index] = await mapValue(values[index], index)
    }
  })

  await Promise.all(workers)
  return results
}

async function fetchSourceFile(file: SkillRunnerShellManifestFile): Promise<Uint8Array> {
  const response = await fetch(file.contentUrl, {
    cache: "no-store"
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Failed to fetch runner shell file ${file.path}: ${response.status} ${errorText}`)
  }

  return new Uint8Array(await response.arrayBuffer())
}

function patchWorkflowConfigJson(content: string, maxDurationSeconds: number): string {
  try {
    const parsed = JSON.parse(content) as {
      steps?: {
        maxDuration?: unknown
      }
    }
    if (!parsed.steps || parsed.steps.maxDuration === maxDurationSeconds) {
      return content
    }

    parsed.steps.maxDuration = maxDurationSeconds
    return `${JSON.stringify(parsed, null, 2)}\n`
  } catch {
    return content
  }
}

function patchRunnerNextConfig(_content: string): string {
  return RUNNER_NEXT_CONFIG_CONTENT
}

function pickPackageFields<T extends Record<string, string>>(
  values: Record<string, string> | undefined,
  keys: string[]
): T {
  const picked: Record<string, string> = {}
  for (const key of keys) {
    const value = values?.[key]
    if (value) {
      picked[key] = value
    }
  }
  return picked as T
}

function patchRunnerRootPackageJson(content: string): string {
  try {
    const parsed = JSON.parse(content) as {
      packageManager?: string
      version?: string
    }
    return `${JSON.stringify(
      {
        name: "dev3000-skill-runner-root",
        version: parsed.version || "0.0.0",
        private: true,
        type: "module",
        packageManager: parsed.packageManager || "bun@1.2.5",
        workspaces: [SKILL_RUNNER_WORKER_ROOT_DIRECTORY]
      },
      null,
      2
    )}\n`
  } catch {
    return content
  }
}

function patchRunnerWwwPackageJson(content: string): string {
  try {
    const parsed = JSON.parse(content) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
      packageManager?: string
      version?: string
    }
    return `${JSON.stringify(
      {
        name: "dev3000-skill-runner",
        version: parsed.version || "0.0.0",
        private: true,
        packageManager: parsed.packageManager || "bun@1.2.5",
        scripts: {
          build: "next build --turbopack && node scripts/patch-workflow-vercel-config.mjs",
          start: "next start"
        },
        dependencies: pickPackageFields(parsed.dependencies, [
          "@vercel/analytics",
          "@vercel/blob",
          "@vercel/oidc",
          "@vercel/sandbox",
          "@workflow/world-vercel",
          "ai",
          "effect",
          "ms",
          "next",
          "react",
          "react-dom",
          "workflow"
        ]),
        devDependencies: pickPackageFields(parsed.devDependencies, [
          "@types/ms",
          "@types/node",
          "@types/react",
          "@types/react-dom",
          "typescript"
        ])
      },
      null,
      2
    )}\n`
  } catch {
    return content
  }
}

function patchRunnerShellTextFile({
  content,
  file,
  maxFunctionDurationSeconds,
  maxWorkflowStepDurationSeconds
}: {
  content: string
  file: SkillRunnerShellManifestFile
  maxFunctionDurationSeconds?: number
  maxWorkflowStepDurationSeconds?: number
}): string {
  if (file.path === RUNNER_ROOT_PACKAGE_PATH) {
    return patchRunnerRootPackageJson(content)
  }

  if (file.path === RUNNER_WWW_PACKAGE_PATH) {
    return patchRunnerWwwPackageJson(content)
  }

  if (file.path === RUNNER_NEXT_CONFIG_PATH) {
    return patchRunnerNextConfig(content)
  }

  if (
    maxFunctionDurationSeconds &&
    file.path === `${SKILL_RUNNER_WORKER_ROOT_DIRECTORY}/app/api/cloud/start-fix/route.ts`
  ) {
    return content.replace(
      /export const maxDuration = \d+/g,
      `export const maxDuration = ${maxFunctionDurationSeconds}`
    )
  }

  if (
    maxWorkflowStepDurationSeconds &&
    file.path === `${SKILL_RUNNER_WORKER_ROOT_DIRECTORY}/scripts/patch-workflow-vercel-config.mjs`
  ) {
    return content.replace(/steps:\s*\d+,/g, `steps: ${maxWorkflowStepDurationSeconds},`)
  }

  if (
    maxWorkflowStepDurationSeconds &&
    file.path === `${SKILL_RUNNER_WORKER_ROOT_DIRECTORY}/app/.well-known/workflow/v1/config.json`
  ) {
    return patchWorkflowConfigJson(content, maxWorkflowStepDurationSeconds)
  }

  return content
}

function patchRunnerShellFile({
  bytes,
  file,
  maxFunctionDurationSeconds,
  maxWorkflowStepDurationSeconds
}: {
  bytes: Uint8Array
  file: SkillRunnerShellManifestFile
  maxFunctionDurationSeconds?: number
  maxWorkflowStepDurationSeconds?: number
}): Uint8Array {
  const alwaysPatchedFiles = new Set([RUNNER_ROOT_PACKAGE_PATH, RUNNER_WWW_PACKAGE_PATH, RUNNER_NEXT_CONFIG_PATH])
  if (!maxFunctionDurationSeconds && !maxWorkflowStepDurationSeconds && !alwaysPatchedFiles.has(file.path)) {
    return bytes
  }

  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  const content = decoder.decode(bytes)
  const patched = patchRunnerShellTextFile({
    content,
    file,
    maxFunctionDurationSeconds,
    maxWorkflowStepDurationSeconds
  })

  return patched === content ? bytes : encoder.encode(patched)
}

async function uploadDeploymentFile({
  accessToken,
  bytes,
  sha,
  size,
  teamId
}: {
  accessToken: string
  bytes: Uint8Array
  sha: string
  size: number
  teamId: string
}): Promise<void> {
  const apiUrl = new URL("https://api.vercel.com/v2/files")
  apiUrl.searchParams.set("teamId", teamId)
  const body = new ArrayBuffer(size)
  new Uint8Array(body).set(bytes)

  const response = await fetch(apiUrl.toString(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Length": String(size),
      "Content-Type": "application/octet-stream",
      "x-vercel-digest": sha
    },
    body,
    cache: "no-store"
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Failed to upload runner shell file ${sha}: ${response.status} ${errorText}`)
  }
}

export async function uploadSkillRunnerShellSourceFiles({
  accessToken,
  maxFunctionDurationSeconds,
  maxWorkflowStepDurationSeconds,
  source,
  teamId
}: {
  accessToken: string
  maxFunctionDurationSeconds?: number
  maxWorkflowStepDurationSeconds?: number
  source: SkillRunnerShellSource
  teamId: string
}): Promise<VercelUploadedDeploymentFile[]> {
  return mapWithConcurrency(source.files, RUNNER_SHELL_UPLOAD_CONCURRENCY, async (file) => {
    const sourceBytes = await fetchSourceFile(file)
    const bytes = patchRunnerShellFile({
      bytes: sourceBytes,
      file,
      maxFunctionDurationSeconds,
      maxWorkflowStepDurationSeconds
    })
    const sha = createHash("sha1").update(bytes).digest("hex")
    const size = bytes.byteLength
    await uploadDeploymentFile({
      accessToken,
      bytes,
      sha,
      size,
      teamId
    })
    return {
      file: file.path,
      sha,
      size
    }
  })
}
