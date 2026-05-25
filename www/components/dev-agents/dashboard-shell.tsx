import { Bot, History, type LucideIcon, Settings, Sparkles } from "lucide-react"
import type { Route } from "next"
import Link from "next/link"
import type React from "react"
import {
  type DashboardNavIcon,
  type DashboardSidebarItem,
  MobileDashboardNavigation
} from "@/components/dev-agents/mobile-dashboard-navigation"
import { TeamSwitcher } from "@/components/dev-agents/team-switcher"
import { isDevAgentsEnabled } from "@/lib/feature-flags"
import type { VercelTeam } from "@/lib/vercel-teams"

interface DevAgentsDashboardShellProps {
  teams: VercelTeam[]
  selectedTeam: VercelTeam
  section?: "dev-agents" | "skill-runner" | "runs" | "admin"
  runsHref?: string
  title?: React.ReactNode
  subtitle?: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
  children: React.ReactNode
}

const sidebarIconComponents: Record<DashboardNavIcon, LucideIcon> = {
  bot: Bot,
  history: History,
  settings: Settings,
  sparkles: Sparkles
}

function SidebarNavigation({ items }: { items: DashboardSidebarItem[] }) {
  return (
    <nav className="flex-1 px-2 pt-2">
      <div className="space-y-0.5">
        {items.map((item) => {
          const Icon = sidebarIconComponents[item.icon]
          const linkClassName = `flex items-center gap-2.5 rounded-md px-2.5 py-[7px] text-[13px] transition-colors ${
            item.active ? "bg-[#1a1a1a] text-[#ededed]" : "text-[#888] hover:bg-[#111] hover:text-[#ededed]"
          }`

          return (
            <Link key={item.label} href={item.href as Route} className={linkClassName}>
              <Icon className="size-4 shrink-0" strokeWidth={1.5} />
              <span>{item.label}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}

export async function DevAgentsDashboardShell({
  teams,
  selectedTeam,
  section = "dev-agents",
  runsHref,
  title,
  subtitle,
  description,
  actions,
  children
}: DevAgentsDashboardShellProps) {
  const showDevAgentsLink = await isDevAgentsEnabled(selectedTeam)
  const effectiveRunsHref = runsHref || (section === "skill-runner" ? "/skill-runner/runs" : "/dev-agents/runs")
  const sectionHref =
    section === "skill-runner"
      ? `/${selectedTeam.slug}/skill-runner`
      : section === "runs"
        ? effectiveRunsHref
        : section === "admin"
          ? "/admin"
          : `/${selectedTeam.slug}/dev-agents`
  const sectionLabel =
    section === "skill-runner" ? "Skills" : section === "runs" ? "Runs" : section === "admin" ? "Admin" : "Dev Agents"
  const sidebarItems: DashboardSidebarItem[] = [
    {
      label: "Skills",
      href: `/${selectedTeam.slug}/skill-runner`,
      icon: "bot",
      active: section === "skill-runner"
    },
    ...(showDevAgentsLink
      ? [
          {
            label: "Dev Agents",
            href: `/${selectedTeam.slug}/dev-agents`,
            icon: "sparkles",
            active: section === "dev-agents"
          } satisfies DashboardSidebarItem
        ]
      : []),
    {
      label: "Runs",
      href: effectiveRunsHref,
      icon: "history",
      active: section === "runs"
    }
  ]

  return (
    <div className="min-h-screen bg-[#0a0a0a] font-sans text-[#ededed]">
      <div className="flex min-h-screen">
        {/* Sidebar */}
        <aside className="hidden w-[240px] shrink-0 flex-col border-r border-[#1f1f1f] xl:flex">
          {/* Team switcher header */}
          <div className="flex h-[60px] items-center border-b border-[#1f1f1f] px-2">
            <TeamSwitcher teams={teams} selectedTeam={selectedTeam} />
          </div>

          {/* Navigation */}
          <SidebarNavigation items={sidebarItems} />
        </aside>

        {/* Main content */}
        <main className="flex min-w-0 flex-1 flex-col">
          <MobileDashboardNavigation
            teams={teams}
            selectedTeam={selectedTeam}
            sectionHref={sectionHref}
            sectionLabel={sectionLabel}
            items={sidebarItems}
          />

          {/* Page content */}
          <div className="flex-1 px-6 py-6">
            {/* Page header */}
            {(title || description || actions) && (
              <div className="mb-6 flex items-start justify-between">
                <div className="space-y-1">
                  {title && (
                    <>
                      <h1 className="text-[24px] font-semibold tracking-[-0.020em] text-[#ededed]">{title}</h1>
                      {subtitle ? <div className="text-[13px] text-[#666]">{subtitle}</div> : null}
                    </>
                  )}
                  {description ? (
                    <div className="max-w-xl text-[14px] leading-[22px] text-[#888]">{description}</div>
                  ) : null}
                </div>
                {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
              </div>
            )}

            {/* Content */}
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}
