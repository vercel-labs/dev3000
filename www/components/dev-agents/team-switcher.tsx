"use client"

import { ChevronDown } from "lucide-react"
import type { Route } from "next"
import { useRouter } from "next/navigation"
import { useEffect } from "react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { LAST_SELECTED_TEAM_COOKIE_MAX_AGE, LAST_SELECTED_TEAM_COOKIE_NAME } from "@/lib/team-selection"
import type { VercelTeam } from "@/lib/vercel-teams"

interface TeamSwitcherProps {
  teams: VercelTeam[]
  selectedTeam: VercelTeam
}

function VercelTriangle({ className }: { className?: string }) {
  return (
    <svg aria-label="Vercel Logo" fill="currentColor" viewBox="0 0 75 65" className={className}>
      <path d="M37.59.25l36.95 64H.64l36.95-64z" />
    </svg>
  )
}

export function TeamSwitcher({ teams, selectedTeam }: TeamSwitcherProps) {
  const router = useRouter()

  useEffect(() => {
    document.cookie = `${LAST_SELECTED_TEAM_COOKIE_NAME}=${encodeURIComponent(selectedTeam.slug)}; path=/; max-age=${LAST_SELECTED_TEAM_COOKIE_MAX_AGE}; samesite=lax`
  }, [selectedTeam.slug])

  return (
    <Select
      value={selectedTeam.slug}
      onValueChange={(nextSlug) => {
        document.cookie = `${LAST_SELECTED_TEAM_COOKIE_NAME}=${encodeURIComponent(nextSlug)}; path=/; max-age=${LAST_SELECTED_TEAM_COOKIE_MAX_AGE}; samesite=lax`
        router.push(`/${nextSlug}/dev-agents` as Route)
      }}
    >
      <SelectTrigger className="h-8 w-full gap-2 border-0 bg-transparent p-0 text-[14px] font-medium text-[#ededed] shadow-none ring-0 hover:text-white focus:ring-0 [&>svg]:hidden">
        <div className="flex items-center gap-2.5">
          <VercelTriangle className="size-[18px] text-[#ededed]" />
          <SelectValue placeholder="Select team" />
          <ChevronDown className="size-3.5 text-[#666]" />
        </div>
      </SelectTrigger>
      <SelectContent className="border-[#333] bg-[#0a0a0a]">
        {teams.map((team) => (
          <SelectItem
            key={team.id}
            value={team.slug}
            className="text-[13px] text-[#ededed] focus:bg-[#1a1a1a] focus:text-[#ededed]"
          >
            {team.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
