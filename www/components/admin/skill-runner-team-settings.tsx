"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { SkillRunnerExecutionMode, SkillRunnerTeamSettings, SkillRunnerWorkerStatus } from "@/lib/skill-runners"
import type { VercelTeam } from "@/lib/vercel-teams"

interface TeamSettingItem {
  team: VercelTeam
  settings: SkillRunnerTeamSettings
}

interface SkillRunnerTeamSettingsProps {
  items: TeamSettingItem[]
}

export function SkillRunnerTeamSettingsPanel({ items }: SkillRunnerTeamSettingsProps) {
  const [state, setState] = useState<Record<string, SkillRunnerTeamSettings>>(
    Object.fromEntries(items.map((item) => [item.team.id, item.settings]))
  )
  const [savingTeamId, setSavingTeamId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const updateTeam = (teamId: string, patch: Partial<SkillRunnerTeamSettings>) => {
    setState((current) => ({
      ...current,
      [teamId]: {
        ...current[teamId],
        ...patch
      }
    }))
  }

  async function saveTeam(teamId: string) {
    setSavingTeamId(teamId)
    setError(null)
    try {
      const settings = state[teamId]
      const team = items.find((item) => item.team.id === teamId)?.team
      if (!team) {
        throw new Error("Team not found")
      }

      const response = await fetch("/api/admin/skill-runner-teams", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          team: team.id,
          executionMode: settings.executionMode,
          workerBaseUrl: settings.workerBaseUrl || "",
          workerProjectId: settings.workerProjectId || "",
          workerStatus: settings.workerStatus || "unconfigured"
        })
      })
      const data = await response.json()
      if (!response.ok || !data.success) {
        throw new Error(data.error || "Failed to save team settings.")
      }

      setState((current) => ({
        ...current,
        [teamId]: data.settings as SkillRunnerTeamSettings
      }))
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save team settings.")
    } finally {
      setSavingTeamId(null)
    }
  }

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-[#1f1f1f] bg-[#111] px-4 py-3 text-[13px] leading-[20px] text-[#888]">
        Hosted mode runs skill runners on `dev3000-www`. Self-hosted mode is the team-worker track; configure the worker
        URL here before wiring execution over to that team-owned deployment.
      </div>

      {error ? (
        <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3 text-[13px] text-red-400">
          {error}
        </div>
      ) : null}

      <div className="space-y-4">
        {items.map(({ team }) => {
          const settings = state[team.id]
          const executionMode = settings?.executionMode || "hosted"

          return (
            <div key={team.id} className="rounded-lg border border-[#1f1f1f] bg-[#111] p-5">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <div className="text-[15px] font-medium text-[#ededed]">{team.name}</div>
                  <div className="mt-0.5 text-[12px] text-[#666]">
                    {team.slug}
                    {team.isPersonal ? " · Personal" : " · Team"}
                  </div>
                </div>
                <div className="rounded-full border border-[#333] bg-[#1a1a1a] px-2.5 py-1 text-[11px] text-[#888]">
                  {executionMode === "hosted" ? "Hosted" : "Self-hosted"}
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-[13px] text-[#888]">Execution Mode</Label>
                  <Select
                    value={executionMode}
                    onValueChange={(value) => updateTeam(team.id, { executionMode: value as SkillRunnerExecutionMode })}
                  >
                    <SelectTrigger className="h-9 border-[#1f1f1f] bg-transparent text-[13px] text-[#ededed]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="border-[#333] bg-[#0a0a0a]">
                      <SelectItem value="hosted">Hosted</SelectItem>
                      <SelectItem value="self-hosted">Self-hosted</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-[13px] text-[#888]">Worker Status</Label>
                  <Select
                    value={settings?.workerStatus || "unconfigured"}
                    onValueChange={(value) => updateTeam(team.id, { workerStatus: value as SkillRunnerWorkerStatus })}
                  >
                    <SelectTrigger className="h-9 border-[#1f1f1f] bg-transparent text-[13px] text-[#ededed]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="border-[#333] bg-[#0a0a0a]">
                      <SelectItem value="unconfigured">Unconfigured</SelectItem>
                      <SelectItem value="provisioning">Provisioning</SelectItem>
                      <SelectItem value="ready">Ready</SelectItem>
                      <SelectItem value="error">Error</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-[13px] text-[#888]">Worker Base URL</Label>
                  <Input
                    value={settings?.workerBaseUrl || ""}
                    onChange={(event) => updateTeam(team.id, { workerBaseUrl: event.target.value })}
                    placeholder="https://d3k-skill-runner-team.vercel.app"
                    className="h-9 border-[#1f1f1f] bg-transparent text-[13px] text-[#ededed] placeholder:text-[#555]"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-[13px] text-[#888]">Worker Project ID</Label>
                  <Input
                    value={settings?.workerProjectId || ""}
                    onChange={(event) => updateTeam(team.id, { workerProjectId: event.target.value })}
                    placeholder="prj_..."
                    className="h-9 border-[#1f1f1f] bg-transparent text-[13px] text-[#ededed] placeholder:text-[#555]"
                  />
                </div>
              </div>

              <div className="mt-4 flex justify-end">
                <Button
                  onClick={() => void saveTeam(team.id)}
                  disabled={savingTeamId === team.id}
                  size="sm"
                  className="h-8 rounded-md bg-[#ededed] px-4 text-[13px] font-medium text-[#0a0a0a] hover:bg-white disabled:opacity-40"
                >
                  {savingTeamId === team.id ? "Saving…" : "Save"}
                </Button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
