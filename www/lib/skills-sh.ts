import { createHash } from "node:crypto"

const SKILLS_SEARCH_TIMEOUT_MS = 10000
const SKILL_FETCH_TIMEOUT_MS = 10000
const SKILL_SEARCH_METADATA_CACHE_TTL_MS = 10 * 60 * 1000
const SKILLS_SEARCH_API_URL = "https://skills.sh/api/search"

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

interface CachedSkillPageMetadata {
  canonicalPath: string
  displayName: string
  expiresAt: number
}

interface SkillsSearchApiSkill {
  id: string
  skillId: string
  name: string
  installs?: number
  source?: string
}

interface SkillsSearchApiResponse {
  skills?: SkillsSearchApiSkill[]
}

const skillPageMetadataCache = new Map<string, CachedSkillPageMetadata>()

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

function formatInstallsLabel(count: number | undefined): string | undefined {
  if (!count || count <= 0) {
    return undefined
  }

  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(1).replace(/\.0$/, "")}M installs`
  }

  if (count >= 1_000) {
    return `${(count / 1_000).toFixed(1).replace(/\.0$/, "")}K installs`
  }

  return `${count} install${count === 1 ? "" : "s"}`
}

function normalizeHashSource(value: string): string {
  return value.replace(/\s+/g, " ").trim()
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

async function searchSkillsApi(query: string): Promise<SkillsShSearchResult[]> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), SKILLS_SEARCH_TIMEOUT_MS)

  try {
    const url = new URL(SKILLS_SEARCH_API_URL)
    url.searchParams.set("q", query)
    url.searchParams.set("limit", "10")

    const response = await fetch(url, {
      cache: "no-store",
      signal: controller.signal
    })

    if (!response.ok) {
      throw new Error(`skills.sh search failed (${response.status})`)
    }

    const data = (await response.json()) as SkillsSearchApiResponse
    return (data.skills || [])
      .filter((skill) => skill.id && skill.skillId && skill.source)
      .sort((a, b) => (b.installs || 0) - (a.installs || 0))
      .map((skill) => {
        const canonicalPath = skill.id.replace(/^\/+/, "").replace(/\/+$/, "")
        const skillName = skill.skillId || skill.name
        const packageName = skill.source

        return {
          id: canonicalPath,
          canonicalPath,
          installArg: `${packageName}@${skillName}`,
          packageName,
          skillName,
          displayName: titleCaseSkillName(skill.name || skillName),
          sourceUrl: `https://skills.sh/${canonicalPath}`,
          installsLabel: formatInstallsLabel(skill.installs)
        }
      })
  } finally {
    clearTimeout(timeout)
  }
}

async function getSkillPageMetadata(sourceUrl: string): Promise<{ canonicalPath: string; displayName: string }> {
  const cached = skillPageMetadataCache.get(sourceUrl)
  if (cached && cached.expiresAt > Date.now()) {
    return {
      canonicalPath: cached.canonicalPath,
      displayName: cached.displayName
    }
  }

  const html = await fetchSkillHtml(sourceUrl)
  const canonicalMatch = html.match(/<link rel="canonical" href="([^"]+)"/i)
  const canonicalUrl = canonicalMatch?.[1] || sourceUrl
  const canonicalPath = getCanonicalPathFromSourceUrl(canonicalUrl)
  const displayName = extractHeadingTitle(html)

  const nextValue: CachedSkillPageMetadata = {
    canonicalPath,
    displayName,
    expiresAt: Date.now() + SKILL_SEARCH_METADATA_CACHE_TTL_MS
  }
  skillPageMetadataCache.set(sourceUrl, nextValue)

  return {
    canonicalPath,
    displayName
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

  const parsed = await searchSkillsApi(trimmed)

  const enriched = await Promise.all(
    parsed.map(async (result) => {
      try {
        const metadata = await getSkillPageMetadata(result.sourceUrl)
        return {
          ...result,
          canonicalPath: metadata.canonicalPath || result.canonicalPath,
          id: metadata.canonicalPath || result.id,
          displayName: metadata.displayName || result.displayName
        }
      } catch {
        return result
      }
    })
  )

  return enriched
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
