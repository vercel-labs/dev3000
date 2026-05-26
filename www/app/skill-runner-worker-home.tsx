export default function SkillRunnerWorkerHome() {
  return (
    <main
      style={{
        alignItems: "center",
        background: "#0a0a0a",
        color: "#ededed",
        display: "flex",
        fontFamily: 'Geist, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        minHeight: "100vh",
        padding: "48px 24px"
      }}
    >
      <section style={{ margin: "0 auto", maxWidth: 640 }}>
        <p style={{ color: "#a1a1a1", fontSize: 14, margin: "0 0 12px" }}>dev3000 skill runner</p>
        <h1 style={{ fontSize: 40, letterSpacing: 0, lineHeight: 1.1, margin: "0 0 16px" }}>
          This project runs dev3000 skills for your Vercel team.
        </h1>
        <p style={{ color: "#a1a1a1", fontSize: 18, lineHeight: 1.6, margin: "0 0 28px" }}>
          Skill runs execute here so compute, AI Gateway usage, deployments, and runtime logs belong to the team running
          the scan.
        </p>
        <a
          href="https://dev3000.ai"
          style={{
            background: "#ededed",
            borderRadius: 6,
            color: "#0a0a0a",
            display: "inline-flex",
            fontSize: 16,
            fontWeight: 500,
            padding: "12px 16px",
            textDecoration: "none"
          }}
        >
          Open dev3000
        </a>
      </section>
    </main>
  )
}
