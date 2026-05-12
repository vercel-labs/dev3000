import { createHash } from "node:crypto"
import { SKILL_RUNNER_WORKER_REPO, SKILL_RUNNER_WORKER_ROOT_DIRECTORY } from "@/lib/skill-runner-config"

const RUNNER_SHELL_ROOT_FILES = new Set(["package.json", "bun.lock", "tsconfig.json", "turbo.json"])
const RUNNER_SHELL_EXCLUDED_FILES = [
  /(^|\/)\.DS_Store$/,
  /\.tgz$/,
  /\.tsbuildinfo$/,
  /^www\/\.env/,
  /^www\/(?:\.next|\.vercel|node_modules|\.swc)\//,
  /^www\/public\//,
  /^www\/(?:WORKFLOW_TESTING_GUIDE|d3k-skill-runner-team-impl)\.md$/
]
const RUNNER_SHELL_UPLOAD_CONCURRENCY = 8

interface GitHubTreeEntry {
  path?: string
  type?: string
}

interface GitHubTreeResponse {
  tree?: GitHubTreeEntry[]
  truncated?: boolean
}

interface SkillRunnerShellManifestFile {
  path: string
  contentUrl: string
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

function isRunnerShellFile(file: string): boolean {
  if (RUNNER_SHELL_ROOT_FILES.has(file)) return true
  if (!file.startsWith(`${SKILL_RUNNER_WORKER_ROOT_DIRECTORY}/`)) return false
  return !RUNNER_SHELL_EXCLUDED_FILES.some((pattern) => pattern.test(file))
}

function encodePathForUrl(file: string): string {
  return file
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/")
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

export async function resolveSkillRunnerShellSource(commit: string, version = commit): Promise<SkillRunnerShellSource> {
  const tree = await fetchGitHubTree(commit)
  if (tree.truncated) {
    throw new Error(`Runner shell source tree for ${commit} was truncated by GitHub.`)
  }

  const files = (tree.tree || [])
    .filter((entry): entry is Required<Pick<GitHubTreeEntry, "path" | "type">> => Boolean(entry.path && entry.type))
    .filter((entry) => entry.type === "blob" && isRunnerShellFile(entry.path))
    .map((entry) => ({
      path: entry.path,
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
  if (!maxFunctionDurationSeconds && !maxWorkflowStepDurationSeconds) {
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
