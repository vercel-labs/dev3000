"use client"

import { Bot, History, type LucideIcon, Menu, Settings, Sparkles } from "lucide-react"
import type { Route } from "next"
import Link from "next/link"
import { TeamSwitcher } from "@/components/dev-agents/team-switcher"
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger
} from "@/components/ui/sheet"
import type { VercelTeam } from "@/lib/vercel-teams"

export type DashboardNavIcon = "bot" | "history" | "settings" | "sparkles"

export interface DashboardSidebarItem {
  label: string
  href: string
  icon: DashboardNavIcon
  active?: boolean
}

interface MobileDashboardNavigationProps {
  teams: VercelTeam[]
  selectedTeam: VercelTeam
  sectionHref: string
  sectionLabel: string
  items: DashboardSidebarItem[]
}

const sidebarIconComponents: Record<DashboardNavIcon, LucideIcon> = {
  bot: Bot,
  history: History,
  settings: Settings,
  sparkles: Sparkles
}

function MobileNavigationItems({ items }: { items: DashboardSidebarItem[] }) {
  return (
    <nav className="flex-1 px-2 pt-2">
      <div className="space-y-0.5">
        {items.map((item) => {
          const Icon = sidebarIconComponents[item.icon]
          const linkClassName = `flex items-center gap-2.5 rounded-md px-2.5 py-[7px] text-[13px] transition-colors ${
            item.active ? "bg-[#1a1a1a] text-[#ededed]" : "text-[#888] hover:bg-[#111] hover:text-[#ededed]"
          }`

          return (
            <SheetClose key={item.label} asChild>
              <Link href={item.href as Route} className={linkClassName}>
                <Icon className="size-4 shrink-0" strokeWidth={1.5} />
                <span>{item.label}</span>
              </Link>
            </SheetClose>
          )
        })}
      </div>
    </nav>
  )
}

export function MobileDashboardNavigation({
  teams,
  selectedTeam,
  sectionHref,
  sectionLabel,
  items
}: MobileDashboardNavigationProps) {
  return (
    <header className="flex h-[60px] shrink-0 items-center justify-between border-b border-[#1f1f1f] px-3 xl:hidden">
      <div className="flex min-w-0 items-center gap-3">
        <Sheet>
          <SheetTrigger asChild>
            <button
              type="button"
              className="flex size-9 shrink-0 items-center justify-center rounded-md text-[#8a8a8a] transition-colors hover:bg-[#111] hover:text-[#ededed] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#444]"
              aria-label="Open navigation"
            >
              <Menu className="size-4" strokeWidth={1.5} />
            </button>
          </SheetTrigger>
          <SheetContent
            side="left"
            className="w-[280px] border-[#1f1f1f] bg-[#0a0a0a] p-0 text-[#ededed] [&>button]:text-[#888] [&>button]:transition-colors [&>button]:hover:text-[#ededed]"
          >
            <SheetHeader className="sr-only">
              <SheetTitle>Navigation</SheetTitle>
              <SheetDescription>Switch team and navigate dev3000.</SheetDescription>
            </SheetHeader>
            <div className="flex h-full flex-col">
              <div className="flex h-[60px] shrink-0 items-center border-b border-[#1f1f1f] px-2 pr-12">
                <TeamSwitcher teams={teams} selectedTeam={selectedTeam} />
              </div>
              <MobileNavigationItems items={items} />
            </div>
          </SheetContent>
        </Sheet>
        <Link
          href={sectionHref as Route}
          className="min-w-0 truncate text-[14px] font-medium text-[#ededed] hover:underline"
        >
          {sectionLabel}
        </Link>
        <span className="min-w-0 truncate text-[13px] text-[#666]">{selectedTeam.name}</span>
      </div>
      <div />
    </header>
  )
}
