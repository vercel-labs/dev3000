import type { Metadata } from "next"
import type { ReactNode } from "react"

export const metadata: Metadata = {
  title: "dev3000 Skill Runner",
  description: "Team-owned dev3000 skill runner project."
}

export default function SkillRunnerWorkerLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  )
}
