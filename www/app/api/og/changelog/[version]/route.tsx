import { ImageResponse } from "next/og"
import { changelog } from "@/lib/changelog"

export const runtime = "nodejs"
export const revalidate = 3600 // Revalidate every hour

export async function GET(
  _request: Request,
  { params }: { params: { version: string } }
) {
  try {
    const version = params.version
    
    // Find the release by version, or use latest if version is "latest"
    const release = version === "latest" 
      ? changelog[0]
      : changelog.find(r => `v${r.version}` === version || r.version === version)
    
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
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "Inter, system-ui, sans-serif",
          color: "#ffffff",
          textAlign: "center",
          padding: "60px"
        }}
      >
        {/* Logo */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "20px",
            marginBottom: "40px"
          }}
        >
          <div
            style={{
              width: "80px",
              height: "80px",
              background: "#ffffff",
              borderRadius: "12px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "28px",
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
              fontSize: "48px",
              fontWeight: "700",
              color: "#ffffff"
            }}
          >
            dev3000
          </div>
        </div>

        {/* Version Info */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "16px",
            marginBottom: "32px"
          }}
        >
          <div
            style={{
              display: "block",
              fontSize: "32px",
              fontWeight: "700",
              color: "#ffffff"
            }}
          >
            {`v${release.version} Highlights`}
          </div>
        </div>

        {/* Highlights List */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "12px",
            maxWidth: "800px",
            marginBottom: "32px"
          }}
        >
          {release.highlights.slice(0, 3).map((highlight, index) => (
            <div
              key={index}
              style={{
                display: "block",
                fontSize: "16px",
                color: "#d1d5db"
              }}
            >
              {`• ${highlight}`}
            </div>
          ))}
        </div>

        {/* Date */}
        <div
          style={{
            display: "block",
            fontSize: "18px",
            color: "#9ca3af"
          }}
        >
          {`Released ${release.date}`}
        </div>
      </div>,
      {
        width: 1200,
        height: 630
      }
    )
  } catch (e: any) {
    console.log(`Failed to generate the image`, e)
    return new Response(`Failed to generate the image`, {
      status: 500
    })
  }
}
