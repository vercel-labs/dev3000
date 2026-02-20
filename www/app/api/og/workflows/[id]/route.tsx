import { ImageResponse } from "next/og"
import type { CSSProperties } from "react"
import { getPublicWorkflowRun } from "@/lib/workflow-storage"
import type { WorkflowReport } from "@/types"

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const run = await getPublicWorkflowRun(id)

    if (!run?.isPublic || !run.reportBlobUrl) {
      return new Response("Not found", { status: 404 })
    }

    const reportResponse = await fetch(run.reportBlobUrl, { cache: "no-store" })
    if (!reportResponse.ok) {
      return new Response("Report not found", { status: 404 })
    }

    const report: WorkflowReport = await reportResponse.json()
    const bundle = report.turbopackBundleComparison

    const formatBytes = (bytes?: number) => {
      if (typeof bytes !== "number") return "—"
      const abs = Math.abs(bytes)
      if (abs >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
      return `${(bytes / 1024).toFixed(1)} KB`
    }

    const formatSignedBytes = (bytes?: number) => {
      if (typeof bytes !== "number") return "—"
      const sign = bytes > 0 ? "+" : ""
      return `${sign}${formatBytes(bytes)}`
    }

    const formatSignedPercent = (value?: number | null) => {
      if (typeof value !== "number") return "—"
      const sign = value > 0 ? "+" : ""
      return `${sign}${value.toFixed(1)}%`
    }

    const routeDelta =
      bundle &&
      Array.from(
        new Set([...bundle.before.topRoutes.map((route) => route.route), ...bundle.after.topRoutes.map((route) => route.route)])
      )
        .map((route) => {
          const beforeRoute = bundle.before.topRoutes.find((item) => item.route === route)
          const afterRoute = bundle.after.topRoutes.find((item) => item.route === route)
          const beforeCompressedBytes = beforeRoute?.compressedBytes ?? 0
          const afterCompressedBytes = afterRoute?.compressedBytes ?? 0
          return {
            route,
            beforeCompressedBytes,
            afterCompressedBytes,
            delta: afterCompressedBytes - beforeCompressedBytes
          }
        })
        .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))[0]

    return new ImageResponse(
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: "#07090d",
          color: "#f5f7fa",
          padding: "44px 52px",
          fontFamily: "Inter, system-ui, sans-serif"
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "16px" }}>
          <div style={{ fontSize: "20px", color: "#9aa4b2" }}>d3k workflow report</div>
        </div>

        <div style={{ fontSize: "48px", fontWeight: 700, marginBottom: "10px", lineHeight: 1.08 }}>
          {report.projectName || run.projectName}
        </div>

        <div style={{ fontSize: "34px", fontWeight: 600, marginBottom: "18px" }}>Bundle Delta (Before vs After)</div>

        {bundle ? (
          <>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                border: "2px solid #0f7b44",
                background: "#042615",
                borderRadius: "14px",
                padding: "14px 18px",
                marginBottom: "18px",
                fontSize: "33px",
                color: "#b9f2d0"
              }}
            >
              {bundle.delta.compressedBytes <= 0 ? "Reduced shipped JS by " : "Increased shipped JS by "}
              <span style={{ fontWeight: 700, marginLeft: "6px" }}>{formatBytes(Math.abs(bundle.delta.compressedBytes))}</span>
              <span style={{ fontWeight: 700, marginLeft: "8px" }}>({formatSignedPercent(bundle.delta.compressedPercent)})</span>
            </div>

            <div style={{ display: "flex", gap: "16px", marginBottom: "16px" }}>
              <div style={cardStyle}>
                <div style={labelStyle}>COMPRESSED JS</div>
                <div style={valueStyle}>
                  {formatBytes(bundle.before.totalCompressedBytes)} → {formatBytes(bundle.after.totalCompressedBytes)}
                </div>
                <div style={{ ...deltaStyle, color: bundle.delta.compressedBytes <= 0 ? "#00d27a" : "#ff5f6d" }}>
                  {formatSignedBytes(bundle.delta.compressedBytes)} ({formatSignedPercent(bundle.delta.compressedPercent)})
                </div>
              </div>

              <div style={cardStyle}>
                <div style={labelStyle}>RAW JS</div>
                <div style={valueStyle}>
                  {formatBytes(bundle.before.totalRawBytes)} → {formatBytes(bundle.after.totalRawBytes)}
                </div>
                <div style={{ ...deltaStyle, color: bundle.delta.rawBytes <= 0 ? "#00d27a" : "#ff5f6d" }}>
                  {formatSignedBytes(bundle.delta.rawBytes)} ({formatSignedPercent(bundle.delta.rawPercent)})
                </div>
              </div>

              <div style={cardStyle}>
                <div style={labelStyle}>COVERAGE</div>
                <div style={valueStyle}>Routes: {bundle.before.routeCount}</div>
                <div style={valueStyle}>Output files: {bundle.before.outputFileCount}</div>
              </div>
            </div>

            {routeDelta && (
              <div style={{ ...cardStyle, width: "100%" }}>
                <div style={labelStyle}>TOP ROUTE-LEVEL COMPRESSED JS CHANGES</div>
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: "8px", fontSize: "28px" }}>
                  <span>{routeDelta.route}</span>
                  <span style={{ color: "#9aa4b2" }}>
                    {formatBytes(routeDelta.beforeCompressedBytes)} → {formatBytes(routeDelta.afterCompressedBytes)}
                  </span>
                  <span style={{ color: routeDelta.delta <= 0 ? "#00d27a" : "#ff5f6d", fontWeight: 700 }}>
                    {formatSignedBytes(routeDelta.delta)}
                  </span>
                </div>
              </div>
            )}
          </>
        ) : (
          <div style={{ ...cardStyle, width: "100%", fontSize: "30px" }}>No bundle comparison data available.</div>
        )}
      </div>,
      {
        width: 1200,
        height: 630
      }
    )
  } catch (error: unknown) {
    console.error("Failed to generate workflow OG image", error)
    return new Response("Failed to generate image", { status: 500 })
  }
}

const cardStyle: CSSProperties = {
  flex: 1,
  borderRadius: "12px",
  border: "1px solid #2a3138",
  background: "#0a0e14",
  padding: "14px 16px",
  display: "flex",
  flexDirection: "column",
  gap: "8px"
}

const labelStyle: CSSProperties = {
  color: "#9aa4b2",
  fontSize: "20px",
  letterSpacing: "0.06em"
}

const valueStyle: CSSProperties = {
  color: "#f1f5f9",
  fontSize: "32px",
  lineHeight: 1.15
}

const deltaStyle: CSSProperties = {
  fontSize: "30px",
  fontWeight: 700
}
