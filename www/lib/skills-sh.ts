import { spawn } from "node:child_process"
import { createHash } from "node:crypto"

const SKILLS_FIND_TIMEOUT_MS = 15000
const SKILL_FETCH_TIMEOUT_MS = 10000

export interface SkillsShSearchResult {
  id: string
  canonicalPath: string
  installArg: string
  packageName?: string
  skillName: string
  displayName: string
  sourceUrl: string
  installsLabel?: string
}

export interface SkillsShSkillDetails {
  canonicalPath: string
  installArg: string
  packageName?: string
  skillName: string
  displayName: string
  sourceUrl: string
  description: string
  upstreamHash: string
}

function stripAnsi(value: string): string {
  let result = ""

  for (let index = 0; index < value.length; index++) {
    const charCode = value.charCodeAt(index)
    if (charCode === 27 && value[index + 1] === "[") {
      while (index < value.length && value[index] !== "m") {
        index++
      }
      continue
    }
    result += value[index]
  }

  return result
}

function decodeHtmlEntities(value: string): string {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&nbsp;", " ")
}

function stripHtml(value: string): string {
  return decodeHtmlEntities(value.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " "))
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function titleCaseSkillName(skillName: string): string {
  return skillName
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

function getCanonicalPathFromSourceUrl(sourceUrl: string): string {
  try {
    const url = new URL(sourceUrl)
    return url.pathname.replace(/^\/+/, "").replace(/\/+$/, "")
  } catch {
    return sourceUrl
      .replace(/^https?:\/\//, "")
      .replace(/^skills\.sh\//, "")
      .replace(/^\/+/, "")
  }
}

function normalizeHashSource(value: string): string {
  return value.replace(/\s+/g, " ").trim()
}

function parseSkillsFindOutput(stdout: string): SkillsShSearchResult[] {
  const lines = stripAnsi(stdout)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)

  const results: SkillsShSearchResult[] = []

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]
    if (!line.includes("@") || line.startsWith("Usage:") || line.startsWith("Install with")) {
      continue
    }

    const match = line.match(/^([^\s]+)\s+(.+ installs)$/)
    if (!match) {
      continue
    }

    const installArg = match[1]
    const packageAndSkill = installArg.split("@")
    if (packageAndSkill.length < 2) {
      continue
    }

    const skillName = packageAndSkill[packageAndSkill.length - 1]
    const packageName = packageAndSkill.slice(0, -1).join("@")
    const nextLine = lines[index + 1]
    const sourceUrl = nextLine?.startsWith("└ ") ? nextLine.replace(/^└\s+/, "") : undefined
    if (!sourceUrl) {
      continue
    }

    const canonicalPath = getCanonicalPathFromSourceUrl(sourceUrl)
    results.push({
      id: canonicalPath,
      canonicalPath,
      installArg,
      packageName,
      skillName,
      displayName: titleCaseSkillName(skillName),
      sourceUrl,
      installsLabel: match[2]
    })
  }

  return results
}

async function runSkillsFind(query: string): Promise<string> {
  return await new Promise((resolve, reject) => {
    const child = spawn("npx", ["--yes", "skills@latest", "find", query], {
      env: process.env
    })

    let stdout = ""
    let stderr = ""
    const timeout = setTimeout(() => {
      child.kill("SIGTERM")
      reject(new Error("skills find timed out"))
    }, SKILLS_FIND_TIMEOUT_MS)

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString()
    })

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString()
    })

    child.on("error", (error) => {
      clearTimeout(timeout)
      reject(error)
    })

    child.on("close", (code) => {
      clearTimeout(timeout)
      if (code !== 0 && !stdout) {
        reject(new Error(stderr || `skills find exited with code ${code}`))
        return
      }
      resolve(stdout || stderr)
    })
  })
}

async function fetchSkillHtml(sourceUrl: string): Promise<string> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), SKILL_FETCH_TIMEOUT_MS)

  try {
    const response = await fetch(sourceUrl, {
      cache: "no-store",
      redirect: "follow",
      signal: controller.signal
    })

    if (!response.ok) {
      throw new Error(`Failed to fetch skill page (${response.status})`)
    }

    return await response.text()
  } finally {
    clearTimeout(timeout)
  }
}

function extractMetaDescription(html: string): string {
  const match = html.match(/<meta name="description" content="([^"]*)"/i)
  return decodeHtmlEntities(match?.[1] || "").trim()
}

function extractTwitterDescription(html: string): string {
  const match = html.match(/<meta name="twitter:description" content="([^"]*)"/i)
  return decodeHtmlEntities(match?.[1] || "").trim()
}

function extractHeadingTitle(html: string): string {
  const match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)
  return stripHtml(match?.[1] || "")
}

function extractSummaryDescription(html: string): string {
  const match = html.match(/>Summary<\/div>\s*<div[^>]*>[\s\S]*?<p>([\s\S]*?)<\/p>/i)
  return stripHtml(match?.[1] || "")
}

function isGenericSkillDescription(description: string): boolean {
  const normalized = description.trim().toLowerCase()
  if (!normalized) {
    return true
  }

  return (
    normalized === "discover and install skills for ai agents." ||
    normalized.startsWith("install the ") ||
    normalized.startsWith("discover and install")
  )
}

export async function searchSkillsSh(query: string): Promise<SkillsShSearchResult[]> {
  const trimmed = query.trim()
  if (trimmed.length < 2) {
    return []
  }

  const output = await runSkillsFind(trimmed)
  return parseSkillsFindOutput(output)
}

export async function fetchSkillsShSkillDetails(input: {
  installArg: string
  packageName?: string
  skillName: string
  displayName?: string
  sourceUrl: string
}): Promise<SkillsShSkillDetails> {
  const html = await fetchSkillHtml(input.sourceUrl)
  const canonicalMatch = html.match(/<link rel="canonical" href="([^"]+)"/i)
  const canonicalUrl = canonicalMatch?.[1] || input.sourceUrl
  const canonicalPath = getCanonicalPathFromSourceUrl(canonicalUrl)
  const metaDescription = extractMetaDescription(html)
  const twitterDescription = extractTwitterDescription(html)
  const summaryDescription = extractSummaryDescription(html)
  const description =
    (!isGenericSkillDescription(summaryDescription) && summaryDescription) ||
    (!isGenericSkillDescription(metaDescription) && metaDescription) ||
    (!isGenericSkillDescription(twitterDescription) && twitterDescription) ||
    summaryDescription ||
    metaDescription ||
    twitterDescription ||
    `Run the ${input.displayName || titleCaseSkillName(input.skillName)} skill against a project and produce a reviewable PR.`
  const displayName = extractHeadingTitle(html) || input.displayName || titleCaseSkillName(input.skillName)
  const upstreamHash = createHash("sha256")
    .update(
      normalizeHashSource(
        JSON.stringify({
          canonicalPath,
          displayName,
          description,
          visibleText: stripHtml(html)
        })
      )
    )
    .digest("hex")

  return {
    canonicalPath,
    installArg: input.installArg,
    packageName: input.packageName,
    skillName: input.skillName,
    displayName,
    sourceUrl: canonicalUrl,
    description,
    upstreamHash
  }
}
