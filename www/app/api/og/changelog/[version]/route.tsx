import { ImageResponse } from "next/og"
import { changelog } from "@/lib/changelog"
import { stripMarkdown } from "@/lib/utils"

export async function GET(_request: Request, { params }: { params: Promise<{ version: string }> }) {
  try {
    const { version } = await params

    // Find the release by version, or use latest if version is "latest"
    const release =
      version === "latest" ? changelog[0] : changelog.find((r) => `v${r.version}` === version || r.version === version)

    if (!release) {
      return new Response(`Version ${version} not found`, {
        status: 404
      })
    }

    return new ImageResponse(
      <div
        style={{
          background: "linear-gradient(135deg, #0f0f23 0%, #1a1a2e 50%, #16213e 100%)",
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          fontFamily: "Inter, system-ui, sans-serif",
          color: "#ffffff",
          padding: "48px 56px"
        }}
      >
        {/* Header row: Logo + Version */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            width: "100%",
            marginBottom: "32px"
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "16px"
            }}
          >
            <div
              style={{
                width: "56px",
                height: "56px",
                background: "#ffffff",
                borderRadius: "10px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "20px",
                fontWeight: "bold",
                color: "#0f0f23",
                fontFamily: "Monaco, monospace"
              }}
            >
              d3k
            </div>
            <div
              style={{
                display: "block",
                fontSize: "36px",
                fontWeight: "700",
                color: "#ffffff"
              }}
            >
              dev3000
            </div>
          </div>
          <div
            style={{
              display: "block",
              fontSize: "20px",
              color: "#9ca3af"
            }}
          >
            {release.date}
          </div>
        </div>

        {/* Version headline */}
        <div
          style={{
            display: "block",
            fontSize: "42px",
            fontWeight: "700",
            color: "#ffffff",
            marginBottom: "28px"
          }}
        >
          {`v${release.version} Release`}
        </div>

        {/* Highlights List - much larger text */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "20px",
            flex: 1
          }}
        >
          {release.highlights.slice(0, 4).map((highlight) => (
            <div
              key={`${release.version}-highlight-${highlight}`}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: "16px",
                fontSize: "28px",
                color: "#e5e7eb",
                lineHeight: 1.3
              }}
            >
              <span style={{ color: "#a78bfa" }}>•</span>
              <span>{stripMarkdown(highlight)}</span>
            </div>
          ))}
        </div>
      </div>,
      {
        width: 1200,
        height: 630
      }
    )
  } catch (error: unknown) {
    console.log(`Failed to generate the image`, error)
    return new Response(`Failed to generate the image`, {
      status: 500
    })
  }
}
