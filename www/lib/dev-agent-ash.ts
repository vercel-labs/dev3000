import { gzipSync } from "node:zlib"
import { head } from "@vercel/blob"
import { buildBlobProxyUrl, putBlobAndBuildUrl } from "@/lib/blob-store"
import type { DevAgentAshArtifact, DevAgentAshInput } from "@/lib/dev-agent-ash-spec"
import { createDevAgentAshSource } from "@/lib/dev-agent-ash-spec"

const ASH_ARTIFACT_PREFIX = "dev-agents/ash/"
const ASH_ARTIFACT_CACHE_PREFIX = `${ASH_ARTIFACT_PREFIX}cache/`

const TAR_BLOCK_SIZE = 512

export type DevAgentAshArtifactPublishState = "stored" | "reused"

export interface DevAgentAshArtifactPublishResult {
  artifact: DevAgentAshArtifact
  publishState: DevAgentAshArtifactPublishState
}

function encodeTarString(value: string, length: number): Buffer {
  const buffer = Buffer.alloc(length)
  buffer.write(value.slice(0, length), 0, "utf8")
  return buffer
}

function encodeTarOctal(value: number, length: number): Buffer {
  const buffer = Buffer.alloc(length, 0)
  const octal = value.toString(8)
  const encoded = octal.padStart(length - 2, "0")
  buffer.write(encoded, Math.max(0, length - 1 - encoded.length), "ascii")
  buffer[length - 1] = 0x20
  return buffer
}

function splitTarPath(pathname: string): { name: string; prefix: string } {
  const pathnameBytes = Buffer.byteLength(pathname, "utf8")
  if (pathnameBytes <= 100) {
    return { name: pathname, prefix: "" }
  }

  const segments = pathname.split("/")
  for (let index = segments.length - 1; index > 0; index--) {
    const prefix = segments.slice(0, index).join("/")
    const name = segments.slice(index).join("/")

    if (Buffer.byteLength(name, "utf8") <= 100 && Buffer.byteLength(prefix, "utf8") <= 155) {
      return { name, prefix }
    }
  }

  throw new Error(`ASH artifact path is too long for tar header: ${pathname}`)
}

function createTarHeader(pathname: string, size: number, mtime: number): Buffer {
  const { name, prefix } = splitTarPath(pathname)

  const header = Buffer.alloc(TAR_BLOCK_SIZE, 0)
  encodeTarString(name, 100).copy(header, 0)
  encodeTarOctal(0o644, 8).copy(header, 100)
  encodeTarOctal(0, 8).copy(header, 108)
  encodeTarOctal(0, 8).copy(header, 116)
  encodeTarOctal(size, 12).copy(header, 124)
  encodeTarOctal(mtime, 12).copy(header, 136)
  header.fill(0x20, 148, 156)
  header[156] = "0".charCodeAt(0)
  encodeTarString("ustar", 6).copy(header, 257)
  encodeTarString("00", 2).copy(header, 263)
  if (prefix) {
    encodeTarString(prefix, 155).copy(header, 345)
  }

  let checksum = 0
  for (const byte of header) checksum += byte
  const checksumField = Buffer.alloc(8, 0)
  const checksumOctal = checksum.toString(8).padStart(6, "0")
  checksumField.write(checksumOctal, 0, "ascii")
  checksumField[6] = 0
  checksumField[7] = 0x20
  checksumField.copy(header, 148)

  return header
}

function createTarGzBuffer(rootFolder: string, files: Array<{ path: string; content: string }>): Buffer {
  const chunks: Buffer[] = []
  const mtime = Math.floor(Date.now() / 1000)

  for (const file of files) {
    const pathname = `${rootFolder}/${file.path}`.replaceAll("\\", "/")
    const contentBuffer = Buffer.from(file.content, "utf8")
    chunks.push(createTarHeader(pathname, contentBuffer.length, mtime))
    chunks.push(contentBuffer)

    const remainder = contentBuffer.length % TAR_BLOCK_SIZE
    if (remainder !== 0) {
      chunks.push(Buffer.alloc(TAR_BLOCK_SIZE - remainder, 0))
    }
  }

  chunks.push(Buffer.alloc(TAR_BLOCK_SIZE * 2, 0))
  return gzipSync(Buffer.concat(chunks))
}

export async function publishDevAgentAshArtifactWithStatus(
  input: DevAgentAshInput,
  revision: number
): Promise<DevAgentAshArtifactPublishResult> {
  const source = await createDevAgentAshSource(input, revision)
  const cachePath = `${ASH_ARTIFACT_CACHE_PREFIX}${source.specHash}.tgz`

  let tarballUrl: string
  let publishState: DevAgentAshArtifactPublishState = "stored"

  try {
    const cachedBlob = await head(cachePath)
    tarballUrl = buildBlobProxyUrl(cachedBlob.pathname, { absolute: true })
    publishState = "reused"
  } catch {
    const tarballBuffer = createTarGzBuffer(source.packageName, source.files)
    tarballUrl = (
      await putBlobAndBuildUrl(cachePath, tarballBuffer, {
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: "application/gzip",
        absoluteUrl: true
      })
    ).appUrl
  }

  return {
    artifact: {
      framework: "experimental-ash",
      revision,
      specHash: source.specHash,
      generatedAt: new Date().toISOString(),
      packageName: source.packageName,
      packageVersion: source.packageVersion,
      sourceLabel: source.sourceLabel,
      systemPrompt: source.systemPrompt,
      packagedSkills: source.packagedSkills,
      compiledSpec: source.compiledSpec,
      tarballUrl
    },
    publishState
  }
}

export async function publishDevAgentAshArtifact(
  input: DevAgentAshInput,
  revision: number
): Promise<DevAgentAshArtifact> {
  const { artifact } = await publishDevAgentAshArtifactWithStatus(input, revision)
  return artifact
}
