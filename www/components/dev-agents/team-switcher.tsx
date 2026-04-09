"use client"

import { ChevronsUpDown, LogOut } from "lucide-react"
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

function getPlanBadgeClasses(planLabel: string | undefined): string {
  switch (planLabel) {
    case "Enterprise":
      return "border border-[#4b266b] bg-[#4b266b]/80 text-[#d7a8ff]"
    case "Pro":
      return "border border-[#163f7a] bg-[#163f7a]/80 text-[#8cbcff]"
    case "Hobby":
      return "border border-[#2f2f2f] bg-[#2a2a2a] text-[#b5b5b5]"
    default:
      return "border border-[#2a2a2a] bg-[#1a1a1a] text-[#888]"
  }
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
      <SelectTrigger className="group h-11 w-full rounded-xl border border-transparent bg-transparent px-2.5 text-[14px] font-medium text-[#ededed] shadow-none ring-0 transition-colors hover:bg-[#101010] focus:ring-0 focus-visible:ring-0 data-[state=open]:bg-[#101010] dark:bg-transparent dark:hover:bg-[#101010] data-[state=open]:dark:bg-[#101010] [&>svg]:hidden">
        <div className="flex min-w-0 flex-1 items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <TeamIcon team={selectedTeam} />
            <div className="flex min-w-0 items-center gap-2">
              <div className="truncate">{selectedTeam.name}</div>
              {selectedTeam.planLabel ? (
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-normal leading-none ${getPlanBadgeClasses(selectedTeam.planLabel)}`}
                >
                  {selectedTeam.planLabel}
                </span>
              ) : null}
            </div>
          </div>
          <span className="flex size-7 shrink-0 items-center justify-center rounded-md text-[#8a8a8a] transition-colors group-hover:text-[#b5b5b5]">
            <ChevronsUpDown className="size-4" />
          </span>
        </div>
      </SelectTrigger>
      <SelectContent className="border-[#333] bg-[#0a0a0a]">
        {teams.map((team) => (
          <SelectItem
            key={team.id}
            value={team.slug}
            className="text-[13px] text-[#ededed] focus:bg-[#1a1a1a] focus:text-[#ededed]"
          >
            <div className="flex min-w-0 items-center gap-2.5 pr-6">
              <TeamIcon team={team} />
              <div className="truncate">{team.name}</div>
              {team.planLabel ? (
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-normal leading-none ${getPlanBadgeClasses(team.planLabel)}`}
                >
                  {team.planLabel}
                </span>
              ) : null}
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
