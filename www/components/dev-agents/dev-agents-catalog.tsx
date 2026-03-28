"use client"

import { Play, ShoppingCart } from "lucide-react"
import type { Route } from "next"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import type React from "react"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { DevAgent, MarketplaceAgentStats } from "@/lib/dev-agents"

export interface TeamCatalogAgent {
  devAgent: DevAgent
  canEdit: boolean
  ownerName: string
}

export interface MarketplaceCatalogAgent {
  devAgent: DevAgent
  ownerName: string
  stats: MarketplaceAgentStats
}

interface DevAgentsCatalogProps {
  teamBasePath: string
  teamAgents: TeamCatalogAgent[]
  marketplaceAgents: MarketplaceCatalogAgent[]
}

function formatExecutionMode(mode: "dev-server" | "preview-pr"): string {
  return mode === "dev-server" ? "Dev Server" : "Preview + PR"
}

function VercelTriangle({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" fill="currentColor" viewBox="0 0 75 65" className={className}>
      <path d="M37.59.25l36.95 64H.64l36.95-64z" />
    </svg>
  )
}

function OwnerIdentity({ name }: { name: string }) {
  const isVercel = name === "Vercel"

  if (isVercel) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[13px] text-[#666]">
        <span className="flex size-4 items-center justify-center">
          <VercelTriangle className="size-3 text-[#888]" />
        </span>
        <span>{name}</span>
      </span>
    )
  }

  return (
    <span className="inline-flex items-center gap-1.5 text-[13px] text-[#666]">
      <Avatar className="size-4 border border-[#333]">
        <AvatarImage src={`https://github.com/${name}.png?size=64`} alt={name} />
        <AvatarFallback className="bg-[#1a1a1a] text-[9px] font-medium text-[#888]">
          {name.slice(0, 2).toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <span>{name}</span>
    </span>
  )
}

function TeamAgentCard({ teamBasePath, agent }: { teamBasePath: string; agent: TeamCatalogAgent }) {
  const { devAgent, canEdit, ownerName } = agent

  return (
    <div className="flex flex-col justify-between rounded-lg border border-[#1f1f1f] bg-[#0a0a0a] p-4 transition-colors hover:border-[#333]">
      <div className="min-w-0 space-y-3">
        {/* Name + badge row */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-0.5">
            {canEdit ? (
              <Link
                href={`${teamBasePath}/${devAgent.id}` as Route}
                className="block truncate text-[14px] font-medium text-[#ededed] hover:underline"
              >
                {devAgent.name}
              </Link>
            ) : (
              <div className="truncate text-[14px] font-medium text-[#ededed]">{devAgent.name}</div>
            )}
            <OwnerIdentity name={ownerName} />
          </div>
          <span className="shrink-0 rounded-full border border-[#333] px-2 py-0.5 text-[11px] text-[#666]">
            {devAgent.kind === "builtin" ? "Built-in" : "Custom"}
          </span>
        </div>

        {/* Description */}
        <p className="line-clamp-2 text-[13px] leading-[20px] text-[#888]">{devAgent.description}</p>

        {/* Tags */}
        <div className="flex flex-wrap gap-1.5">
          <span className="rounded-md bg-[#1a1a1a] px-2 py-0.5 text-[11px] text-[#888]">
            {formatExecutionMode(devAgent.executionMode)}
          </span>
          {devAgent.sandboxBrowser !== "none" ? (
            <span className="rounded-md bg-[#1a1a1a] px-2 py-0.5 text-[11px] text-[#888]">
              {devAgent.sandboxBrowser}
            </span>
          ) : null}
          {devAgent.usageCount > 0 ? (
            <span className="rounded-md bg-[#1a1a1a] px-2 py-0.5 text-[11px] text-[#888]">
              {devAgent.usageCount} runs
            </span>
          ) : null}
          {devAgent.successEval ? (
            <span className="rounded-md bg-[#1a1a1a] px-2 py-0.5 text-[11px] text-[#888]">Eval</span>
          ) : null}
          {devAgent.skillRefs.slice(0, 2).map((skill) => (
            <span
              key={`${devAgent.id}-${skill.id}`}
              className="rounded-md bg-[#1a1a1a] px-2 py-0.5 text-[11px] text-[#666]"
            >
              {skill.displayName}
            </span>
          ))}
        </div>
      </div>

      {/* Actions */}
      <div className="mt-4 flex items-center gap-2">
        <Button
          asChild
          size="sm"
          className="h-8 rounded-md bg-[#ededed] px-3 text-[13px] font-medium text-[#0a0a0a] hover:bg-white"
        >
          <Link href={`${teamBasePath}/${devAgent.id}/new` as Route}>
            <Play className="size-3.5" />
            Run
          </Link>
        </Button>
      </div>
    </div>
  )
}

function MarketplaceAgentCard({ agent, teamBasePath }: { agent: MarketplaceCatalogAgent; teamBasePath: string }) {
  const { devAgent, ownerName, stats } = agent

  return (
    <div className="flex flex-col justify-between rounded-lg border border-[#1f1f1f] bg-[#0a0a0a] p-4 transition-colors hover:border-[#333]">
      <div className="space-y-3">
        {/* Name + badge */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-0.5">
            <div className="truncate text-[14px] font-medium text-[#ededed]">{devAgent.name}</div>
            <OwnerIdentity name={ownerName} />
          </div>
          {stats.previouslyPurchased ? (
            <span className="shrink-0 rounded-full border border-blue-500/20 bg-blue-500/10 px-2 py-0.5 text-[11px] text-blue-400">
              Previously Purchased
            </span>
          ) : null}
        </div>

        {/* Description */}
        <p className="line-clamp-2 text-[13px] leading-[20px] text-[#888]">{devAgent.description}</p>

        {/* Stats */}
        <div className="rounded-md border border-[#1f1f1f] bg-[#111] p-3">
          <div className="grid grid-cols-4 gap-3">
            <div>
              <div className="text-[11px] uppercase tracking-wider text-[#555]">Project Runs</div>
              <div className="mt-0.5 text-[13px] font-medium text-[#ededed]">{stats.projectRuns}</div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wider text-[#555]">Success Rate</div>
              <div className="mt-0.5 text-[13px] font-medium text-[#ededed]">{stats.successRate}</div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wider text-[#555]">Merge Rate</div>
              <div className="mt-0.5 text-[13px] font-medium text-[#ededed]">{stats.mergeRate}</div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wider text-[#555]">Tokens Used</div>
              <div className="mt-0.5 text-[13px] font-medium text-[#ededed]">{stats.tokensUsed}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="mt-4 flex items-center gap-2">
        <Button
          asChild
          size="sm"
          className="h-8 rounded-md bg-[#ededed] px-3 text-[13px] font-medium text-[#0a0a0a] hover:bg-white"
        >
          <Link href={`${teamBasePath}/${devAgent.id}/new` as Route}>
            <ShoppingCart className="size-3.5" />
            Buy Run
          </Link>
        </Button>
      </div>
    </div>
  )
}

function CatalogSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      {title ? <div className="text-[11px] uppercase tracking-wider text-[#555]">{title}</div> : null}
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">{children}</div>
    </div>
  )
}

export function DevAgentsCatalog({ teamBasePath, teamAgents, marketplaceAgents }: DevAgentsCatalogProps) {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const activeTab = searchParams.get("tab") === "marketplace" ? "marketplace" : "team"
  const favoriteAgents = marketplaceAgents.filter((a) => a.stats.previouslyPurchased)
  const otherMarketplaceAgents = marketplaceAgents.filter((a) => !a.stats.previouslyPurchased)

  function onTabChange(value: string) {
    const params = new URLSearchParams(searchParams.toString())
    if (value === "marketplace") {
      params.set("tab", "marketplace")
    } else {
      params.delete("tab")
    }
    const qs = params.toString()
    router.replace(`${pathname}${qs ? `?${qs}` : ""}` as Route, { scroll: false })
  }

  return (
    <Tabs value={activeTab} onValueChange={onTabChange} className="space-y-4">
      <TabsList className="h-9 rounded-lg border border-[#1f1f1f] bg-transparent p-1">
        <TabsTrigger
          value="team"
          className="rounded-md px-3 text-[13px] text-[#888] data-[state=active]:bg-[#ededed] data-[state=active]:text-[#0a0a0a]"
        >
          Team
        </TabsTrigger>
        <TabsTrigger
          value="marketplace"
          className="rounded-md px-3 text-[13px] text-[#888] data-[state=active]:bg-[#ededed] data-[state=active]:text-[#0a0a0a]"
        >
          Marketplace
        </TabsTrigger>
      </TabsList>

      <TabsContent value="team">
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {teamAgents.map((agent) => (
            <TeamAgentCard key={agent.devAgent.id} teamBasePath={teamBasePath} agent={agent} />
          ))}
        </div>
      </TabsContent>

      <TabsContent value="marketplace" className="space-y-6">
        {favoriteAgents.length > 0 ? (
          <CatalogSection title="Favorites">
            {favoriteAgents.map((agent) => (
              <MarketplaceAgentCard key={agent.devAgent.id} agent={agent} teamBasePath={teamBasePath} />
            ))}
          </CatalogSection>
        ) : null}

        <CatalogSection title="">
          {otherMarketplaceAgents.map((agent) => (
            <MarketplaceAgentCard key={agent.devAgent.id} agent={agent} teamBasePath={teamBasePath} />
          ))}
        </CatalogSection>
      </TabsContent>
    </Tabs>
  )
}
