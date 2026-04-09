"use client"

import { ChevronDown, LogOut } from "lucide-react"
import type { Route } from "next"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useEffect } from "react"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger } from "@/components/ui/select"
import { LAST_SELECTED_TEAM_COOKIE_MAX_AGE, LAST_SELECTED_TEAM_COOKIE_NAME } from "@/lib/team-selection"
import type { VercelTeam } from "@/lib/vercel-teams"

interface TeamSwitcherProps {
  teams: VercelTeam[]
  selectedTeam: VercelTeam
}

const SIGN_OUT_VALUE = "__sign_out__"

function VercelTriangle({ className }: { className?: string }) {
  return (
    <svg aria-label="Vercel Logo" fill="currentColor" viewBox="0 0 75 65" className={className}>
      <path d="M37.59.25l36.95 64H.64l36.95-64z" />
    </svg>
  )
}

function TeamIcon({ team }: { team: VercelTeam }) {
  if (team.avatarUrl) {
    return (
      <Avatar className="size-4 border border-[#2a2a2a]">
        <AvatarImage src={team.avatarUrl} alt={team.name} />
        <AvatarFallback className="bg-[#1a1a1a] text-[9px] font-medium text-[#999]">
          {team.name.slice(0, 2).toUpperCase()}
        </AvatarFallback>
      </Avatar>
    )
  }

  return <VercelTriangle className="size-[14px] text-[#ededed]" />
}

export function TeamSwitcher({ teams, selectedTeam }: TeamSwitcherProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  useEffect(() => {
    document.cookie = `${LAST_SELECTED_TEAM_COOKIE_NAME}=${encodeURIComponent(selectedTeam.slug)}; path=/; max-age=${LAST_SELECTED_TEAM_COOKIE_MAX_AGE}; samesite=lax`
  }, [selectedTeam.slug])

  function buildTeamSwitchHref(nextSlug: string): string {
    const currentPath = pathname || `/${selectedTeam.slug}/dev-agents`
    const segments = currentPath.split("/")
    if (segments.length > 1 && segments[1] === selectedTeam.slug) {
      segments[1] = nextSlug
    } else {
      return `/${nextSlug}/dev-agents`
    }

    const nextPath = segments.join("/") || `/${nextSlug}/dev-agents`
    const query = searchParams?.toString()
    return query ? `${nextPath}?${query}` : nextPath
  }

  async function signOut() {
    try {
      await fetch("/api/auth/signout", {
        method: "POST"
      })
    } finally {
      router.push("/signin" as Route)
      router.refresh()
    }
  }

  return (
    <Select
      value={selectedTeam.slug}
      onValueChange={(nextSlug) => {
        if (nextSlug === SIGN_OUT_VALUE) {
          void signOut()
          return
        }
        document.cookie = `${LAST_SELECTED_TEAM_COOKIE_NAME}=${encodeURIComponent(nextSlug)}; path=/; max-age=${LAST_SELECTED_TEAM_COOKIE_MAX_AGE}; samesite=lax`
        router.push(buildTeamSwitchHref(nextSlug) as Route)
      }}
    >
      <SelectTrigger className="h-8 w-full gap-2 border-0 bg-transparent px-2 py-0 text-[14px] font-medium text-[#ededed] shadow-none ring-0 hover:text-white focus:ring-0 [&>svg]:hidden">
        <div className="flex min-w-0 items-center gap-2.5 pl-0.5">
          <TeamIcon team={selectedTeam} />
          <div className="flex min-w-0 items-center gap-2">
            <div className="truncate">{selectedTeam.name}</div>
            {selectedTeam.planLabel ? (
              <span className="rounded-full border border-[#2a2a2a] bg-[#1a1a1a] px-2 py-0.5 text-[11px] font-normal text-[#888]">
                {selectedTeam.planLabel}
              </span>
            ) : null}
          </div>
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
            <div className="flex min-w-0 items-center gap-2.5">
              <TeamIcon team={team} />
              <div className="min-w-0">
                <div className="truncate">{team.name}</div>
                <div className="truncate text-[11px] text-[#666]">
                  {team.sourceLabel || (team.isPersonal ? "Account" : "Team")}
                  {team.planLabel ? ` · ${team.planLabel}` : ""}
                </div>
              </div>
            </div>
          </SelectItem>
        ))}
        <SelectSeparator className="bg-[#222]" />
        <SelectItem value={SIGN_OUT_VALUE} className="text-[13px] text-[#cfcfcf] focus:bg-[#1a1a1a] focus:text-white">
          <span className="flex items-center gap-2">
            <LogOut className="size-3.5" />
            Sign Out
          </span>
        </SelectItem>
      </SelectContent>
    </Select>
  )
}
