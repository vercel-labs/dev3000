function isPrivateOrLocalHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase()
  if (normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1") return true
  if (normalized.endsWith(".local")) return true

  const parts = normalized.split(".")
  if (parts.length === 4 && parts.every((part) => /^\d+$/.test(part))) {
    const [a, b] = parts.map((part) => Number.parseInt(part, 10))
    if (a === 10) return true
    if (a === 127) return true
    if (a === 169 && b === 254) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
  }

  return false
}

export async function POST(request: Request) {
  try {
    const { url } = await request.json()

    if (!url) {
      return Response.json({ error: "URL is required" }, { status: 400 })
    }

    // This endpoint is unauthenticated, so restrict it to public https targets
    // to avoid being used as an SSRF probe against internal/private hosts.
    let parsedUrl: URL
    try {
      parsedUrl = new URL(url)
    } catch {
      return Response.json({ error: "Invalid URL" }, { status: 400 })
    }
    if (parsedUrl.protocol !== "https:" || isPrivateOrLocalHost(parsedUrl.hostname)) {
      return Response.json({ error: "URL must be a public https:// address" }, { status: 400 })
    }

    // Make HEAD request to check if deployment is protected
    const response = await fetch(parsedUrl, {
      method: "HEAD",
      // Don't follow redirects
      redirect: "manual",
      signal: AbortSignal.timeout(8000)
    })

    // If we get 401, deployment is protected
    const isProtected = response.status === 401

    return Response.json({
      isProtected,
      status: response.status
    })
  } catch (error) {
    console.error("Error checking deployment protection:", error)
    return Response.json(
      {
        error: error instanceof Error ? error.message : String(error),
        isProtected: false
      },
      { status: 500 }
    )
  }
}
