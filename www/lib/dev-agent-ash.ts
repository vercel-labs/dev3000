import { execFile } from "node:child_process"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { promisify } from "node:util"
import { put } from "@vercel/blob"
import type { DevAgentAshArtifact, DevAgentAshInput } from "@/lib/dev-agent-ash-spec"
import { createDevAgentAshSource } from "@/lib/dev-agent-ash-spec"

const execFileAsync = promisify(execFile)
const ASH_ARTIFACT_PREFIX = "dev-agents/ash/"

export async function publishDevAgentAshArtifact(
  input: DevAgentAshInput,
  revision: number
): Promise<DevAgentAshArtifact> {
  const source = createDevAgentAshSource(input, revision)
  const workingDir = await mkdtemp(join(tmpdir(), "dev-agent-ash-"))
  const rootDir = join(workingDir, source.packageName)
  const tarballPath = join(workingDir, `${source.packageName}.tgz`)

  try {
    for (const file of source.files) {
      const targetPath = join(rootDir, file.path)
      await mkdir(dirname(targetPath), { recursive: true })
      await writeFile(targetPath, file.content, "utf8")
    }

    await execFileAsync("tar", ["-czf", tarballPath, "-C", workingDir, source.packageName])
    const tarballBuffer = await readFile(tarballPath)
    const blobPath = `${ASH_ARTIFACT_PREFIX}${input.id}/v${String(revision).padStart(4, "0")}-${source.specHash.slice(0, 12)}.tgz`
    const tarballUrl = (
      await put(blobPath, tarballBuffer, {
        access: "public",
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: "application/gzip"
      })
    ).url

    return {
      framework: "experimental-ash",
      revision,
      specHash: source.specHash,
      generatedAt: new Date().toISOString(),
      packageName: source.packageName,
      packageVersion: source.packageVersion,
      sourceLabel: source.sourceLabel,
      systemPrompt: source.systemPrompt,
      tarballUrl
    }
  } finally {
    await rm(workingDir, { recursive: true, force: true })
  }
}
