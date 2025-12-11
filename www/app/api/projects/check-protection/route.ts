export async function POST(request: Request) {
  try {
    const { url } = await request.json()

    if (!url) {
      return Response.json({ error: "URL is required" }, { status: 400 })
    }

    // Make HEAD request to check if deployment is protected
    const response = await fetch(url, {
      method: "HEAD",
      // Don't follow redirects
      redirect: "manual"
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
