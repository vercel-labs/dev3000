import { execFile } from "node:child_process"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { promisify } from "node:util"
import { putBlobAndBuildUrl } from "@/lib/blob-store"

const execFileAsync = promisify(execFile)

export interface V0SourceEntryResult {
  tarballUrl: string
  sourceLabel: string
  chatId: string
  versionId: string
  projectId: string
}

interface DeploymentFileTree {
  name: string
  type: "directory" | "file" | "symlink" | "lambda" | "middleware" | "invalid"
  uid?: string
  children?: DeploymentFileTree[]
}

interface ProjectDeploymentSummary {
  id?: string
  readyState?: string
  createdAt?: number
  gitSource?: {
    ref?: string
  } | null
}

interface ProjectResponse {
  rootDirectory?: string | null
  latestDeployments?: ProjectDeploymentSummary[]
}

function getVercelApiToken(fallbackToken?: string) {
  const token = fallbackToken || process.env.VERCEL_OIDC_TOKEN || process.env.VERCEL_TOKEN
  return typeof token === "string" && token.trim().length > 0 ? token.trim() : null
}

async function fetchVercelJson<T>(path: string, apiToken: string, teamId?: string): Promise<T> {
  const url = new URL(`https://api.vercel.com${path}`)
  if (teamId) {
    url.searchParams.set("teamId", teamId)
  }

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${apiToken}`,
      Accept: "application/json"
    },
    cache: "no-store"
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`V0_FALLBACK: Vercel API ${response.status} for ${url.pathname}: ${text}`)
  }

  return (await response.json()) as T
}

function selectDeployment(
  deployments: ProjectDeploymentSummary[] | undefined,
  repoBranch: string
): ProjectDeploymentSummary | null {
  if (!Array.isArray(deployments) || deployments.length === 0) {
    return null
  }

  const byNewest = [...deployments].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
  const matchingReady = byNewest.find(
    (deployment) => deployment.id && deployment.readyState === "READY" && deployment.gitSource?.ref === repoBranch
  )
  if (matchingReady) return matchingReady

  const matchingBranch = byNewest.find((deployment) => deployment.id && deployment.gitSource?.ref === repoBranch)
  if (matchingBranch) return matchingBranch

  const latestReady = byNewest.find((deployment) => deployment.id && deployment.readyState === "READY")
  if (latestReady) return latestReady

  return byNewest.find((deployment) => deployment.id) || null
}

function extractBase64Content(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null
  }

  const candidates: unknown[] = [payload]
  while (candidates.length > 0) {
    const current = candidates.shift()
    if (!current || typeof current !== "object") continue

    for (const key of ["data", "content", "contents", "body", "value"]) {
      const value = (current as Record<string, unknown>)[key]
      if (typeof value === "string" && value.length > 0) {
        return value
      }
    }

    for (const value of Object.values(current as Record<string, unknown>)) {
      if (value && typeof value === "object") {
        candidates.push(value)
      }
    }
  }

  return null
}

async function fetchDeploymentFileBuffer(options: {
  apiToken: string
  deploymentId: string
  fileId: string
  filePath: string
  teamId?: string
}): Promise<Buffer> {
  const url = new URL(`https://api.vercel.com/v8/deployments/${options.deploymentId}/files/${options.fileId}`)
  url.searchParams.set("path", options.filePath)
  if (options.teamId) {
    url.searchParams.set("teamId", options.teamId)
  }

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${options.apiToken}`,
      Accept: "*/*"
    },
    cache: "no-store"
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`V0_FALLBACK: Failed to fetch deployment file ${options.filePath}: ${response.status} ${text}`)
  }

  const contentType = response.headers.get("content-type") || ""
  if (contentType.includes("application/json")) {
    const payload = (await response.json()) as unknown
    const encoded = extractBase64Content(payload)
    if (!encoded) {
      throw new Error(`V0_FALLBACK: Unexpected deployment file payload for ${options.filePath}`)
    }
    return Buffer.from(encoded, "base64")
  }

  return Buffer.from(await response.arrayBuffer())
}

async function writeDeploymentTree(options: {
  apiToken: string
  deploymentId: string
  entries: DeploymentFileTree[]
  outputDir: string
  teamId?: string
  parentPath?: string
}): Promise<void> {
  for (const entry of options.entries) {
    const relativePath = options.parentPath ? `${options.parentPath}/${entry.name}` : entry.name
    const targetPath = join(options.outputDir, relativePath)

    if (entry.type === "directory") {
      await mkdir(targetPath, { recursive: true })
      if (Array.isArray(entry.children) && entry.children.length > 0) {
        await writeDeploymentTree({
          ...options,
          entries: entry.children,
          parentPath: relativePath
        })
      }
      continue
    }

    if (!entry.uid) {
      continue
    }

    await mkdir(dirname(targetPath), { recursive: true })
    const fileBuffer = await fetchDeploymentFileBuffer({
      apiToken: options.apiToken,
      deploymentId: options.deploymentId,
      fileId: entry.uid,
      filePath: relativePath,
      teamId: options.teamId
    })
    await writeFile(targetPath, fileBuffer)
  }
}

export async function prepareV0SourceEntry(options: {
  reportId: string
  projectName: string
  vercelProjectId: string
  repoUrl: string
  repoBranch: string
  apiToken?: string
  teamId?: string
}): Promise<V0SourceEntryResult> {
  const apiToken = getVercelApiToken(options.apiToken)
  if (!apiToken) {
    throw new Error("V0_FALLBACK: A Vercel API token is not configured")
  }

  const project = await fetchVercelJson<ProjectResponse>(
    `/v9/projects/${options.vercelProjectId}`,
    apiToken,
    options.teamId
  )
  const deployment = selectDeployment(project.latestDeployments, options.repoBranch)

  if (!deployment?.id) {
    throw new Error(
      `V0_FALLBACK: No deployment found for Vercel project ${options.vercelProjectId}${options.repoBranch ? ` on branch ${options.repoBranch}` : ""}`
    )
  }

  const fileTree = await fetchVercelJson<DeploymentFileTree[]>(
    `/v6/deployments/${deployment.id}/files`,
    apiToken,
    options.teamId
  )
  if (!Array.isArray(fileTree) || fileTree.length === 0) {
    throw new Error(`V0_FALLBACK: Deployment ${deployment.id} did not expose a source file tree`)
  }

  const workingDir = await mkdtemp(join(tmpdir(), "dev3000-project-source-"))
  const outputDir = join(workingDir, "source")
  const tarballPath = join(workingDir, `${options.reportId}.tgz`)

  try {
    await mkdir(outputDir, { recursive: true })
    await writeDeploymentTree({
      apiToken,
      deploymentId: deployment.id,
      entries: fileTree,
      outputDir,
      teamId: options.teamId
    })

    await execFileAsync("tar", ["-czf", tarballPath, "-C", outputDir, "."])
    const tarballBuffer = await readFile(tarballPath)
    const tarballUrl = (
      await putBlobAndBuildUrl(`v0-source-${options.reportId}.tgz`, tarballBuffer, {
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: "application/gzip",
        absoluteUrl: true
      })
    ).appUrl

    return {
      tarballUrl,
      sourceLabel: options.projectName,
      chatId: `vercel-deployment:${deployment.id}`,
      versionId: deployment.id,
      projectId: options.vercelProjectId
    }
  } finally {
    await rm(workingDir, { recursive: true, force: true }).catch(() => {})
  }
}
