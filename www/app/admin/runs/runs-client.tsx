"use client"

import type { Route } from "next"
import Link from "next/link"
import { useMemo, useState } from "react"
import useSWR from "swr"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { TelemetryEvent, TelemetryEventType } from "@/lib/telemetry"

interface AdminRunsClientProps {
  initialEvents: TelemetryEvent[]
  initialSinceDays: number
}

const fetcher = async (url: string) => {
  const res = await fetch(url)
  const data = await res.json()
  if (!data.success) throw new Error(data.error || "Failed to load telemetry events")
  return data.events as TelemetryEvent[]
}

const RANGE_OPTIONS: Array<{ label: string; days: number }> = [
  { label: "Last 7 days", days: 7 },
  { label: "Last 30 days", days: 30 },
  { label: "Last 90 days", days: 90 }
]

const EVENT_FILTER_OPTIONS: Array<{ label: string; value: TelemetryEventType | "all" }> = [
  { label: "All events", value: "all" },
  { label: "Skill run started", value: "skill_run_started" },
  { label: "Skill run completed", value: "skill_run_completed" },
  { label: "Skill run failed", value: "skill_run_failed" },
  { label: "Install attempted", value: "skill_runner_install_attempted" },
  { label: "Install completed", value: "skill_runner_install_completed" },
  { label: "Install failed", value: "skill_runner_install_failed" },
  { label: "Validated", value: "skill_runner_validated" }
]

function formatUsd(value: number | undefined): string {
  if (!Number.isFinite(value) || !value) return "—"
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value as number)
}

function formatDuration(ms: number | undefined): string {
  if (!Number.isFinite(ms) || !ms || ms <= 0) return "—"
  const totalSec = Math.floor((ms as number) / 1000)
  const minutes = Math.floor(totalSec / 60)
  const seconds = totalSec % 60
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`
}

function medianDuration(values: number[]): number | undefined {
  const cleaned = values.filter((value) => Number.isFinite(value) && value > 0)
  if (cleaned.length === 0) return undefined
  cleaned.sort((a, b) => a - b)
  const mid = Math.floor(cleaned.length / 2)
  return cleaned.length % 2 === 0 ? (cleaned[mid - 1] + cleaned[mid]) / 2 : cleaned[mid]
}

function formatEventLabel(eventType: TelemetryEventType): string {
  switch (eventType) {
    case "skill_run_started":
      return "Run started"
    case "skill_run_completed":
      return "Run completed"
    case "skill_run_failed":
      return "Run failed"
    case "skill_runner_install_attempted":
      return "Install attempted"
    case "skill_runner_install_completed":
      return "Install completed"
    case "skill_runner_install_failed":
      return "Install failed"
    case "skill_runner_validated":
      return "Validated"
    default:
      return eventType
  }
}

function eventBadgeVariant(eventType: TelemetryEventType): "default" | "secondary" | "destructive" | "outline" {
  if (eventType === "skill_run_failed" || eventType === "skill_runner_install_failed") return "destructive"
  if (eventType === "skill_run_completed" || eventType === "skill_runner_install_completed") return "default"
  return "secondary"
}

function relativeTime(iso: string): string {
  const delta = Date.now() - Date.parse(iso)
  if (!Number.isFinite(delta)) return iso
  const abs = Math.abs(delta)
  const minutes = Math.floor(abs / 60_000)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return new Date(iso).toLocaleDateString()
}

export default function AdminRunsClient({ initialEvents, initialSinceDays }: AdminRunsClientProps) {
  const [sinceDays, setSinceDays] = useState(initialSinceDays)
  const [eventTypeFilter, setEventTypeFilter] = useState<TelemetryEventType | "all">("all")

  const { data: events = initialEvents } = useSWR(
    `/api/admin/telemetry-events?since=${sinceDays}&limit=2000`,
    fetcher,
    {
      fallbackData: initialEvents,
      refreshInterval: 15000,
      revalidateOnFocus: true
    }
  )

  const filteredEvents = useMemo(() => {
    if (eventTypeFilter === "all") return events
    return events.filter((event) => event.eventType === eventTypeFilter)
  }, [events, eventTypeFilter])

  const funnel = useMemo(() => {
    const installsAttempted = events.filter((e) => e.eventType === "skill_runner_install_attempted").length
    const installsCompleted = events.filter((e) => e.eventType === "skill_runner_install_completed").length
    const userToSuccess = new Map<string, boolean>()
    for (const event of events) {
      if (event.eventType === "skill_run_completed") {
        userToSuccess.set(event.userId, true)
      }
    }
    const firstRunUsers = Array.from(userToSuccess.values()).filter(Boolean).length
    return { installsAttempted, installsCompleted, firstRunUsers }
  }, [events])

  const topUsers = useMemo(() => {
    const byUser = new Map<
      string,
      { userId: string; userName: string; userHandle: string; runs: number; totalCost: number }
    >()
    for (const event of events) {
      if (event.eventType !== "skill_run_completed") continue
      const entry = byUser.get(event.userId) ?? {
        userId: event.userId,
        userName: event.userName,
        userHandle: event.userHandle,
        runs: 0,
        totalCost: 0
      }
      entry.runs += 1
      entry.totalCost += event.costUsd ?? 0
      byUser.set(event.userId, entry)
    }
    return Array.from(byUser.values())
      .sort((a, b) => b.runs - a.runs || b.totalCost - a.totalCost)
      .slice(0, 10)
  }, [events])

  const topTeams = useMemo(() => {
    const byTeam = new Map<
      string,
      { teamId: string; teamSlug: string; teamName: string; runs: number; totalCost: number }
    >()
    for (const event of events) {
      if (event.eventType !== "skill_run_completed") continue
      const entry = byTeam.get(event.teamId) ?? {
        teamId: event.teamId,
        teamSlug: event.teamSlug,
        teamName: event.teamName,
        runs: 0,
        totalCost: 0
      }
      entry.runs += 1
      entry.totalCost += event.costUsd ?? 0
      byTeam.set(event.teamId, entry)
    }
    return Array.from(byTeam.values())
      .sort((a, b) => b.totalCost - a.totalCost || b.runs - a.runs)
      .slice(0, 10)
  }, [events])

  const topSkills = useMemo(() => {
    const bySkill = new Map<
      string,
      {
        skillRunnerId: string
        skillName: string
        skillCanonicalPath?: string
        runs: number
        successes: number
        durations: number[]
      }
    >()
    for (const event of events) {
      if (event.eventType !== "skill_run_completed" && event.eventType !== "skill_run_failed") continue
      const key = event.skillRunnerId || event.skillCanonicalPath || event.skillName || "unknown"
      const entry = bySkill.get(key) ?? {
        skillRunnerId: event.skillRunnerId || key,
        skillName: event.skillName || event.skillCanonicalPath || "Unknown skill",
        skillCanonicalPath: event.skillCanonicalPath,
        runs: 0,
        successes: 0,
        durations: []
      }
      entry.runs += 1
      if (event.eventType === "skill_run_completed") {
        entry.successes += 1
      }
      if (typeof event.durationMs === "number") {
        entry.durations.push(event.durationMs)
      }
      bySkill.set(key, entry)
    }
    return Array.from(bySkill.values())
      .map((entry) => ({
        ...entry,
        successRate: entry.runs > 0 ? entry.successes / entry.runs : 0,
        medianMs: medianDuration(entry.durations)
      }))
      .sort((a, b) => b.runs - a.runs)
      .slice(0, 10)
  }, [events])

  const failureBreakdown = useMemo(() => {
    const byCategory = new Map<string, { category: string; count: number; lastSeen: string }>()
    for (const event of events) {
      if (event.eventType !== "skill_run_failed" && event.eventType !== "skill_runner_install_failed") continue
      const category = event.failureCategory || "unknown"
      const entry = byCategory.get(category) ?? { category, count: 0, lastSeen: event.timestamp }
      entry.count += 1
      if (Date.parse(event.timestamp) > Date.parse(entry.lastSeen)) {
        entry.lastSeen = event.timestamp
      }
      byCategory.set(category, entry)
    }
    return Array.from(byCategory.values()).sort((a, b) => b.count - a.count)
  }, [events])

  const recent = useMemo(() => filteredEvents.slice(0, 100), [filteredEvents])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Select value={String(sinceDays)} onValueChange={(value) => setSinceDays(Number.parseInt(value, 10))}>
          <SelectTrigger className="h-9 w-40 border-[#1f1f1f] bg-transparent text-[13px] text-[#ededed]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="border-[#333] bg-[#0a0a0a]">
            {RANGE_OPTIONS.map((option) => (
              <SelectItem key={option.days} value={String(option.days)}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={eventTypeFilter}
          onValueChange={(value) => setEventTypeFilter(value as TelemetryEventType | "all")}
        >
          <SelectTrigger className="h-9 w-56 border-[#1f1f1f] bg-transparent text-[13px] text-[#ededed]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="border-[#333] bg-[#0a0a0a]">
            {EVENT_FILTER_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="text-[12px] text-[#666]">
          {events.length} event{events.length === 1 ? "" : "s"} loaded
        </div>
      </div>

      <Card className="border-[#1f1f1f] bg-[#111]">
        <CardContent className="grid gap-4 p-5 md:grid-cols-3">
          <FunnelStat label="Installs attempted" value={funnel.installsAttempted} />
          <FunnelStat label="Installs completed" value={funnel.installsCompleted} />
          <FunnelStat label="Users w/ ≥1 completed run" value={funnel.firstRunUsers} />
        </CardContent>
      </Card>

      <div className="grid gap-5 md:grid-cols-2">
        <LeaderboardCard title="Top users (completed runs)">
          {topUsers.length === 0 ? (
            <EmptyRow />
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-[#1f1f1f]">
                  <TableHead>User</TableHead>
                  <TableHead className="text-right">Runs</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {topUsers.map((row) => (
                  <TableRow key={row.userId} className="border-[#1f1f1f]">
                    <TableCell>
                      <div className="text-[13px] text-[#ededed]">{row.userName}</div>
                      <div className="text-[11px] text-[#666]">@{row.userHandle}</div>
                    </TableCell>
                    <TableCell className="text-right text-[13px] text-[#ededed]">{row.runs}</TableCell>
                    <TableCell className="text-right text-[13px] text-[#ededed]">{formatUsd(row.totalCost)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </LeaderboardCard>

        <LeaderboardCard title="Top teams (total cost)">
          {topTeams.length === 0 ? (
            <EmptyRow />
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-[#1f1f1f]">
                  <TableHead>Team</TableHead>
                  <TableHead className="text-right">Runs</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {topTeams.map((row) => (
                  <TableRow key={row.teamId} className="border-[#1f1f1f]">
                    <TableCell>
                      <div className="text-[13px] text-[#ededed]">{row.teamName}</div>
                      <div className="text-[11px] text-[#666]">{row.teamSlug}</div>
                    </TableCell>
                    <TableCell className="text-right text-[13px] text-[#ededed]">{row.runs}</TableCell>
                    <TableCell className="text-right text-[13px] text-[#ededed]">{formatUsd(row.totalCost)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </LeaderboardCard>

        <LeaderboardCard title="Top skills (runs)">
          {topSkills.length === 0 ? (
            <EmptyRow />
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-[#1f1f1f]">
                  <TableHead>Skill</TableHead>
                  <TableHead className="text-right">Runs</TableHead>
                  <TableHead className="text-right">Success</TableHead>
                  <TableHead className="text-right">Median</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {topSkills.map((row) => (
                  <TableRow key={row.skillRunnerId} className="border-[#1f1f1f]">
                    <TableCell>
                      <div className="text-[13px] text-[#ededed]">{row.skillName}</div>
                      {row.skillCanonicalPath ? (
                        <div className="font-mono text-[11px] text-[#666]">{row.skillCanonicalPath}</div>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right text-[13px] text-[#ededed]">{row.runs}</TableCell>
                    <TableCell className="text-right text-[13px] text-[#ededed]">
                      {Math.round(row.successRate * 100)}%
                    </TableCell>
                    <TableCell className="text-right text-[13px] text-[#ededed]">
                      {formatDuration(row.medianMs)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </LeaderboardCard>

        <LeaderboardCard title="Failure categories">
          {failureBreakdown.length === 0 ? (
            <EmptyRow />
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-[#1f1f1f]">
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right">Count</TableHead>
                  <TableHead className="text-right">Last seen</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {failureBreakdown.map((row) => (
                  <TableRow key={row.category} className="border-[#1f1f1f]">
                    <TableCell className="font-mono text-[12px] text-[#ededed]">{row.category}</TableCell>
                    <TableCell className="text-right text-[13px] text-[#ededed]">{row.count}</TableCell>
                    <TableCell className="text-right text-[12px] text-[#888]">{relativeTime(row.lastSeen)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </LeaderboardCard>
      </div>

      <Card className="border-[#1f1f1f] bg-[#111]">
        <CardContent className="p-0">
          <div className="border-b border-[#1f1f1f] px-5 py-3 text-[13px] font-medium text-[#ededed]">
            Recent events
          </div>
          {recent.length === 0 ? (
            <EmptyRow />
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-[#1f1f1f]">
                  <TableHead>When</TableHead>
                  <TableHead>Event</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Team</TableHead>
                  <TableHead>Skill</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                  <TableHead className="text-right">Duration</TableHead>
                  <TableHead>Detail</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recent.map((event) => (
                  <TableRow key={event.eventId} className="border-[#1f1f1f]">
                    <TableCell className="text-[12px] text-[#888]">{relativeTime(event.timestamp)}</TableCell>
                    <TableCell>
                      <Badge variant={eventBadgeVariant(event.eventType)} className="text-[11px]">
                        {formatEventLabel(event.eventType)}
                      </Badge>
                      {event.failureCategory ? (
                        <div className="mt-1 font-mono text-[11px] text-[#888]">{event.failureCategory}</div>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <div className="text-[13px] text-[#ededed]">{event.userName}</div>
                      <div className="text-[11px] text-[#666]">@{event.userHandle}</div>
                    </TableCell>
                    <TableCell>
                      <div className="text-[13px] text-[#ededed]">{event.teamName}</div>
                      <div className="text-[11px] text-[#666]">
                        {event.teamSlug} · {event.executionMode}
                      </div>
                    </TableCell>
                    <TableCell>
                      {event.skillName ? (
                        <div className="text-[13px] text-[#ededed]">{event.skillName}</div>
                      ) : (
                        <span className="text-[#666]">—</span>
                      )}
                      {event.skillCanonicalPath ? (
                        <div className="font-mono text-[11px] text-[#666]">{event.skillCanonicalPath}</div>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right text-[13px] text-[#ededed]">{formatUsd(event.costUsd)}</TableCell>
                    <TableCell className="text-right text-[13px] text-[#ededed]">
                      {formatDuration(event.durationMs)}
                    </TableCell>
                    <TableCell>
                      {event.runId ? (
                        <Link
                          href={`/dev-agents/runs/${event.runId}/report` as Route}
                          className="text-[12px] text-[#ededed] underline decoration-[#333] underline-offset-4 hover:decoration-[#666]"
                        >
                          Report
                        </Link>
                      ) : (
                        <span className="text-[#666]">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function FunnelStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="space-y-1">
      <div className="text-[11px] uppercase tracking-[0.14em] text-[#666]">{label}</div>
      <div className="text-[28px] font-semibold tracking-[-0.02em] text-[#ededed]">{value}</div>
    </div>
  )
}

function LeaderboardCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="border-[#1f1f1f] bg-[#111]">
      <CardContent className="p-0">
        <div className="border-b border-[#1f1f1f] px-5 py-3 text-[13px] font-medium text-[#ededed]">{title}</div>
        {children}
      </CardContent>
    </Card>
  )
}

function EmptyRow() {
  return <div className="px-5 py-8 text-center text-[13px] text-[#666]">No data in the selected window.</div>
}
