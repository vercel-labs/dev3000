import { track } from "@vercel/analytics/server"

// Cache the npm version for 5 minutes to reduce npm API calls
let cachedVersion: string | null = null
let cacheTime = 0
const CACHE_TTL = 5 * 60 * 1000 // 5 minutes

async function getLatestVersionFromNpm(): Promise<string | null> {
  const now = Date.now()
  if (cachedVersion && now - cacheTime < CACHE_TTL) {
    return cachedVersion
  }

  try {
    const response = await fetch("https://registry.npmjs.org/dev3000/latest", {
      headers: { Accept: "application/json" },
      next: { revalidate: 300 } // Also use Next.js cache
    })

    if (!response.ok) {
      return cachedVersion // Return stale cache if available
    }

    const data = await response.json()
    cachedVersion = data.version || null
    cacheTime = now
    return cachedVersion
  } catch {
    return cachedVersion // Return stale cache on error
  }
}

/**
 * GET /api/version
 * Returns the latest CLI version from npm.
 * Optionally tracks CLI startup if telemetry params are provided.
 *
 * Query params (optional, for telemetry):
 * - sid: Session ID (UUID)
 * - os: Operating system (darwin, linux, win32)
 * - v: CLI version
 * - fw: Framework (nextjs, svelte, other)
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const sid = searchParams.get("sid")
  const os = searchParams.get("os")
  const v = searchParams.get("v")
  const fw = searchParams.get("fw")

  // Always fetch and return the latest version (core functionality)
  const latestVersion = await getLatestVersionFromNpm()

  // Track CLI start event if telemetry params are present
  if (sid && os && v) {
    // Fire-and-forget - don't await, don't let failures affect response
    track("cli_start", { sid, os, v, fw: fw || "unknown" }).catch(() => {
      // Silently ignore tracking errors
    })
  }

  return Response.json({
    version: latestVersion,
    success: latestVersion !== null
  })
}

/**
 * POST /api/version
 * Tracks CLI session end with duration.
 *
 * Body:
 * - sid: Session ID (UUID)
 * - os: Operating system
 * - v: CLI version
 * - d: Duration in seconds
 * - fw: Framework (optional)
 */
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { sid, os, v, d, fw } = body

    // Validate required fields
    if (!sid || !os || !v || typeof d !== "number") {
      // Always return 200 to not leak validation info
      return Response.json({ success: true })
    }

    // Validate reasonable duration (max 24 hours)
    const duration = Math.min(Math.max(0, d), 86400)

    // Track CLI end event
    await track("cli_end", {
      sid,
      os,
      v,
      duration: Math.round(duration),
      fw: fw || "unknown"
    })

    return Response.json({ success: true })
  } catch {
    // Always return 200 to not leak error info
    return Response.json({ success: true })
  }
}
