import { ImageResponse } from "next/og"
import { changelog } from "@/lib/changelog"

export const runtime = "edge"

export async function GET() {
  try {
    const latestRelease = changelog[0]

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
          fontFamily: "Inter, system-ui, sans-serif"
        }}
      >
        {/* Grid Pattern Background */}
        <div
          style={{
            position: "absolute",
            width: "100%",
            height: "100%",
            backgroundImage: `
                linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px),
                linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)
              `,
            backgroundSize: "50px 50px"
          }}
        />

        {/* Content */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            textAlign: "center",
            padding: "60px",
            zIndex: 1
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
                fontSize: "48px",
                fontWeight: "700",
                color: "#ffffff"
              }}
            >
              dev3000
            </div>
          </div>

          {/* Version Badge */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "12px",
              marginBottom: "32px"
            }}
          >
            <div
              style={{
                background: "rgba(34, 197, 94, 0.2)",
                border: "1px solid rgba(34, 197, 94, 0.3)",
                borderRadius: "8px",
                padding: "12px 20px",
                fontSize: "20px",
                color: "#22c55e",
                fontWeight: "600"
              }}
            >
              Latest
            </div>
            <div
              style={{
                fontSize: "32px",
                fontWeight: "700",
                color: "#ffffff"
              }}
            >
              Version {latestRelease.version}
            </div>
            <div
              style={{
                background: "rgba(59, 130, 246, 0.2)",
                border: "1px solid rgba(59, 130, 246, 0.3)",
                borderRadius: "8px",
                padding: "12px 16px",
                fontSize: "16px",
                color: "#60a5fa",
                fontWeight: "500"
              }}
            >
              {latestRelease.type === "major" ? "Major" : latestRelease.type === "minor" ? "Minor" : "Patch"}
            </div>
          </div>

          {/* Highlights */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "16px",
              maxWidth: "800px"
            }}
          >
            <div
              style={{
                fontSize: "24px",
                fontWeight: "600",
                color: "#e5e7eb",
                marginBottom: "8px"
              }}
            >
              Key Highlights:
            </div>
            {latestRelease.highlights.slice(0, 3).map((highlight, index) => (
              <div
                key={index}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: "16px",
                  fontSize: "18px",
                  color: "#d1d5db",
                  textAlign: "left",
                  lineHeight: 1.4
                }}
              >
                <div
                  style={{
                    width: "8px",
                    height: "8px",
                    background: "#60a5fa",
                    borderRadius: "50%",
                    marginTop: "8px",
                    flexShrink: 0
                  }}
                />
                <span>{highlight}</span>
              </div>
            ))}
          </div>

          {/* Date */}
          <div
            style={{
              marginTop: "32px",
              fontSize: "18px",
              color: "#9ca3af"
            }}
          >
            Released {latestRelease.date}
          </div>
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