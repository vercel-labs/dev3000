import { Bot, Home, type LucideIcon, Settings } from "lucide-react"
import type { Route } from "next"
import Link from "next/link"
import type React from "react"
import { TeamSwitcher } from "@/components/dev-agents/team-switcher"
import { Button } from "@/components/ui/button"
import type { VercelTeam } from "@/lib/vercel-teams"

interface DevAgentsDashboardShellProps {
  teams: VercelTeam[]
  selectedTeam: VercelTeam
  section?: "dev-agents" | "skill-runner" | "admin"
  showAdminLink?: boolean
  title?: React.ReactNode
  subtitle?: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
  children: React.ReactNode
}

interface SidebarItem {
  label: string
  href: string
  icon: LucideIcon
  active?: boolean
}

export function DevAgentsDashboardShell({
  teams,
  selectedTeam,
  section = "dev-agents",
  showAdminLink = false,
  title,
  subtitle,
  description,
  actions,
  children
}: DevAgentsDashboardShellProps) {
  const sectionHref =
    section === "skill-runner"
      ? `/${selectedTeam.slug}/skill-runner`
      : section === "admin"
        ? "/admin"
        : `/${selectedTeam.slug}/dev-agents`
  const sectionLabel = section === "skill-runner" ? "Skill Runner" : section === "admin" ? "Admin" : "Dev Agents"
  const sidebarItems: SidebarItem[] = [
    { label: "Overview", href: `/${selectedTeam.slug}`, icon: Home },
    {
      label: "Dev Agents",
      href: `/${selectedTeam.slug}/dev-agents`,
      icon: Bot,
      active: section === "dev-agents"
    },
    {
      label: "Skill Runner",
      href: `/${selectedTeam.slug}/skill-runner`,
      icon: Bot,
      active: section === "skill-runner"
    },
    ...(showAdminLink
      ? [
          {
            label: "Admin",
            href: "/admin",
            icon: Settings,
            active: section === "admin"
          } satisfies SidebarItem
        ]
      : [])
  ]

  return (
    <div className="min-h-screen bg-[#0a0a0a] font-sans text-[#ededed]">
      <div className="flex min-h-screen">
        {/* Sidebar */}
        <aside className="hidden w-[240px] shrink-0 flex-col border-r border-[#1f1f1f] lg:flex">
          {/* Team switcher header */}
          <div className="flex h-[60px] items-center border-b border-[#1f1f1f] px-2">
            <TeamSwitcher teams={teams} selectedTeam={selectedTeam} />
          </div>

          {/* Navigation */}
          <nav className="flex-1 px-2 pt-2">
            <div className="space-y-0.5">
              {sidebarItems.map((item) => {
                const Icon = item.icon
                return (
                  <a
                    key={item.label}
                    href={item.href}
                    className={`flex items-center gap-2.5 rounded-md px-2.5 py-[7px] text-[13px] transition-colors ${
                      item.active ? "bg-[#1a1a1a] text-[#ededed]" : "text-[#888] hover:bg-[#111] hover:text-[#ededed]"
                    }`}
                  >
                    <Icon className="size-4 shrink-0" strokeWidth={1.5} />
                    <span>{item.label}</span>
                  </a>
                )
              })}
            </div>
          </nav>

          {/* Bottom section */}
          <div className="border-t border-[#1f1f1f] px-2 py-2">
            <span className="flex items-center gap-2.5 rounded-md px-2.5 py-[7px] text-[13px] text-[#888]">
              <Settings className="size-4 shrink-0" strokeWidth={1.5} />
              <span>Settings</span>
            </span>
          </div>
        </aside>

        {/* Main content */}
        <main className="flex min-w-0 flex-1 flex-col">
          {/* Top bar */}
          <header className="flex h-[60px] shrink-0 items-center justify-between border-b border-[#1f1f1f] px-6">
            {/* Breadcrumbs */}
            <div className="flex items-center gap-2 text-[13px]">
              <span className="text-[#888]">{selectedTeam.name}</span>
              <span className="text-[#444]">/</span>
              <Link href={sectionHref as Route} className="text-[#ededed] hover:underline">
                {sectionLabel}
              </Link>
            </div>

            {/* Right side actions */}
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="h-8 rounded-md border border-[#333] bg-transparent px-3 text-[13px] text-[#888] hover:bg-[#1a1a1a] hover:text-[#ededed]"
            >
              <Link href="/dev-agents/runs">Runs</Link>
            </Button>
          </header>

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
