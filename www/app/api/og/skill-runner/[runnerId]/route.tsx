import { ImageResponse } from "next/og"
import type { CSSProperties } from "react"
import { getDefaultSkillRunnerOpenGraphProfile } from "@/lib/skill-runners"

function getOgContent(executionProfile?: string, fallbackDescription?: string) {
  if (executionProfile === "deepsec") {
    return {
      subtitle: "Find security issues in your Vercel project before they reach production.",
      eyebrow: "DeepSec Security Scan",
      pills: ["Auth", "Secrets", "APIs"],
      cta: "Run the scan",
      footer: "Get a focused security report",
      command: "deepsec scan",
      badge: "Security report",
      title: "Prioritized findings for your Vercel project",
      body: "Generated from project context and ready to download."
    }
  }

  if (executionProfile === "vercel-optimize") {
    return {
      subtitle: "Audit Vercel cost and performance with production observability signals.",
      eyebrow: "Vercel Optimize",
      pills: ["Metrics", "Usage", "Config"],
      cta: "Run the audit",
      footer: "Get a ranked optimization report",
      command: "vercel optimize",
      badge: "Optimization report",
      title: "Data-backed recommendations for your Vercel project",
      body: "Generated from metrics, usage, project config, and targeted source inspection."
    }
  }

  return {
    subtitle: fallbackDescription || "Run a high-confidence AI skill against your Vercel project.",
    eyebrow: "Skill runner",
    pills: ["Project", "Skill", "Report"],
    cta: "Run the skill",
    footer: "Get a focused run report",
    command: "skill run",
    badge: "Skill report",
    title: "Project-specific analysis from a selected skill",
    body: "Generated from your project context and ready to review."
  }
}

export async function GET(_request: Request, { params }: { params: Promise<{ runnerId: string }> }) {
  const { runnerId } = await params
  const profile = getDefaultSkillRunnerOpenGraphProfile(runnerId)
  const title = profile?.name || "Skill Runner"
  const content = getOgContent(profile?.executionProfile, profile?.description)

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        position: "relative",
        display: "flex",
        background: "#050505",
        color: "#f5f5f5",
        fontFamily: "Inter, system-ui, sans-serif",
        padding: 52
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
          display: "flex",
          background: "linear-gradient(135deg, #050505 0%, #0d1112 48%, #14100c 100%)"
        }}
      />
      <main
        style={{
          position: "relative",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          width: "100%"
        }}
      >
        <div style={copyColumnStyle}>
          <div style={eyebrowStyle}>{content.eyebrow}</div>
          <div style={titleStyle}>{title}</div>
          <div style={subtitleStyle}>{content.subtitle}</div>
          <div style={summaryRowStyle}>
            {content.pills.map((pill) => (
              <span key={pill} style={summaryPillStyle}>
                {pill}
              </span>
            ))}
          </div>
        </div>

        <div style={footerStyle}>
          <div style={ctaStyle}>{content.cta}</div>
          <div style={brandStyle}>{content.footer}</div>
        </div>
      </main>

      <div style={scanPanelStyle}>
        <div style={terminalBarStyle}>
          <span style={dotStyle} />
          <span style={dotStyle} />
          <span style={dotStyle} />
        </div>
        <div style={codeLineStyle}>
          <span style={mutedCodeStyle}>$</span> {content.command}
        </div>
        <div style={findingCardStyle}>
          <div style={severityStyle}>{content.badge}</div>
          <div style={findingTitleStyle}>{content.title}</div>
          <div style={findingBodyStyle}>{content.body}</div>
        </div>
      </div>
    </div>,
    {
      width: 1200,
      height: 630
    }
  )
}

const copyColumnStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  maxWidth: 680
}

const eyebrowStyle: CSSProperties = {
  display: "flex",
  border: "1px solid #3c3c3c",
  borderRadius: 999,
  padding: "8px 14px",
  color: "#bdbdbd",
  fontSize: 24,
  fontWeight: 600,
  marginBottom: 24
}

const titleStyle: CSSProperties = {
  fontSize: 78,
  lineHeight: 0.96,
  fontWeight: 760,
  maxWidth: 660,
  letterSpacing: 0
}

const subtitleStyle: CSSProperties = {
  marginTop: 24,
  fontSize: 34,
  lineHeight: 1.22,
  color: "#d0d0d0",
  maxWidth: 710
}

const summaryRowStyle: CSSProperties = {
  display: "flex",
  gap: 12,
  marginTop: 38
}

const summaryPillStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  border: "1px solid #2d2d2d",
  borderRadius: 999,
  background: "#101010",
  color: "#d7d7d7",
  padding: "9px 15px",
  fontSize: 24,
  fontWeight: 650
}

const footerStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 20
}

const ctaStyle: CSSProperties = {
  display: "flex",
  borderRadius: 10,
  background: "#f5f5f5",
  color: "#0a0a0a",
  padding: "14px 22px",
  fontSize: 28,
  fontWeight: 720
}

const brandStyle: CSSProperties = {
  fontSize: 25,
  color: "#9a9a9a"
}

const scanPanelStyle: CSSProperties = {
  position: "absolute",
  right: 64,
  top: 72,
  width: 390,
  height: 430,
  border: "1px solid #303030",
  borderRadius: 18,
  background: "#090909",
  padding: 24,
  display: "flex",
  flexDirection: "column"
}

const terminalBarStyle: CSSProperties = {
  display: "flex",
  gap: 8,
  marginBottom: 28
}

const dotStyle: CSSProperties = {
  width: 11,
  height: 11,
  borderRadius: 999,
  background: "#3a3a3a"
}

const codeLineStyle: CSSProperties = {
  display: "flex",
  gap: 12,
  fontFamily: "Menlo, monospace",
  fontSize: 23,
  color: "#f0f0f0",
  marginBottom: 15
}

const mutedCodeStyle: CSSProperties = {
  color: "#777"
}

const findingCardStyle: CSSProperties = {
  marginTop: 42,
  border: "1px solid #353535",
  borderRadius: 14,
  background: "#111",
  padding: 24,
  display: "flex",
  flexDirection: "column",
  gap: 16
}

const severityStyle: CSSProperties = {
  display: "flex",
  border: "1px solid #6b4b21",
  borderRadius: 8,
  padding: "6px 10px",
  color: "#f2c572",
  fontSize: 19,
  fontWeight: 760
}

const findingTitleStyle: CSSProperties = {
  color: "#f5f5f5",
  fontSize: 29,
  lineHeight: 1.16,
  fontWeight: 720
}

const findingBodyStyle: CSSProperties = {
  color: "#a7a7a7",
  fontSize: 24,
  lineHeight: 1.28
}
