"use client"

import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  SKILL_RUNNER_WORKER_PROJECT_NAME,
  type SkillRunnerExecutionMode,
  type SkillRunnerTeamSettings,
  type SkillRunnerWorkerStatus
} from "@/lib/skill-runner-config"
import type { VercelTeam } from "@/lib/vercel-teams"

interface TeamSettingItem {
  team: VercelTeam
  settings: SkillRunnerTeamSettings
}

interface SkillRunnerTeamSettingsProps {
  items: TeamSettingItem[]
}

interface RunnerValidationResult {
  installed: boolean
  expectedProjectName: string
  message?: string
  project?: {
    projectId: string
    projectName: string
    workerBaseUrl?: string
    dashboardUrl?: string
  }
}

export function SkillRunnerTeamSettingsPanel({ items }: SkillRunnerTeamSettingsProps) {
  const [state, setState] = useState<Record<string, SkillRunnerTeamSettings>>(
    Object.fromEntries(items.map((item) => [item.team.id, item.settings]))
  )
  const [savingTeamId, setSavingTeamId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [validationTeamId, setValidationTeamId] = useState<string | null>(null)
  const [isValidationOpen, setIsValidationOpen] = useState(false)
  const [isValidating, setIsValidating] = useState(false)
  const [isInstalling, setIsInstalling] = useState(false)
  const [validationResult, setValidationResult] = useState<RunnerValidationResult | null>(null)
  const [validationError, setValidationError] = useState<string | null>(null)

  const updateTeam = (teamId: string, patch: Partial<SkillRunnerTeamSettings>) => {
    setState((current) => ({
      ...current,
      [teamId]: {
        ...current[teamId],
        ...patch
      }
    }))
  }

  const validationTeam = validationTeamId
    ? (items.find((item) => item.team.id === validationTeamId)?.team ?? null)
    : null

  function openSelfHostedValidation(teamId: string) {
    setValidationTeamId(teamId)
    setValidationResult(null)
    setValidationError(null)
    setIsValidationOpen(true)
  }

  async function validateRunnerInstallation(teamId: string) {
    setIsValidating(true)
    setValidationError(null)
    setValidationResult(null)

    try {
      const team = items.find((item) => item.team.id === teamId)?.team
      if (!team) {
        throw new Error("Team not found")
      }

      const params = new URLSearchParams({ team: team.id })
      const response = await fetch(`/api/admin/skill-runner-teams/validate?${params.toString()}`)
      const data = (await response.json()) as
        | ({ success: true } & RunnerValidationResult)
        | { success: false; error?: string }

      if (!response.ok || !data.success) {
        throw new Error(("error" in data && data.error) || "Failed to validate runner installation.")
      }

      setValidationResult(data)
    } catch (validateError) {
      setValidationError(
        validateError instanceof Error ? validateError.message : "Failed to validate runner installation."
      )
    } finally {
      setIsValidating(false)
    }
  }

  async function installRunnerProject(teamId: string) {
    setIsInstalling(true)
    setValidationError(null)

    try {
      const team = items.find((item) => item.team.id === teamId)?.team
      if (!team) {
        throw new Error("Team not found")
      }

      const response = await fetch("/api/admin/skill-runner-teams/install", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ team: team.id })
      })
      const data = (await response.json()) as
        | ({ success: true } & RunnerValidationResult)
        | { success: false; error?: string }

      if (!response.ok || !data.success) {
        throw new Error(("error" in data && data.error) || "Failed to install runner project.")
      }

      setValidationResult(data)
    } catch (installError) {
      setValidationError(installError instanceof Error ? installError.message : "Failed to install runner project.")
    } finally {
      setIsInstalling(false)
    }
  }

  function enableSelfHostedForValidatedTeam() {
    if (
      !validationTeamId ||
      !validationResult?.installed ||
      !validationResult.project ||
      !validationResult.project.workerBaseUrl
    ) {
      return
    }

    updateTeam(validationTeamId, {
      executionMode: "self-hosted",
      workerProjectId: validationResult.project.projectId,
      workerBaseUrl: validationResult.project.workerBaseUrl || "",
      workerStatus: validationResult.project.workerBaseUrl ? "ready" : "provisioning"
    })
    setIsValidationOpen(false)
  }

  function cancelValidation() {
    if (validationTeamId) {
      updateTeam(validationTeamId, { executionMode: "hosted" })
    }
    setIsValidationOpen(false)
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
        Hosted mode runs skill runners on `dev3000-www`. Self-hosted mode provisions or validates a team-owned
        `d3k-skill-runner` project, auto-configures the team, and prepares the worker handoff path.
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
                    onValueChange={(value) => {
                      if (value === "self-hosted" && executionMode !== "self-hosted") {
                        openSelfHostedValidation(team.id)
                        return
                      }
                      updateTeam(team.id, { executionMode: value as SkillRunnerExecutionMode })
                    }}
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

              {executionMode === "self-hosted" ? (
                <div className="mt-4 rounded-lg border border-[#1f1f1f] bg-[#0d0d0d] px-4 py-3 text-[13px] text-[#888]">
                  Self-hosted mode requires a validated{" "}
                  <span className="font-mono text-[#cfcfcf]">{SKILL_RUNNER_WORKER_PROJECT_NAME}</span> project in this
                  team.
                  {!settings?.workerProjectId ? (
                    <button
                      type="button"
                      onClick={() => openSelfHostedValidation(team.id)}
                      className="ml-1 text-[#ededed] underline decoration-[#333] underline-offset-4 hover:decoration-[#666]"
                    >
                      Validate installation
                    </button>
                  ) : null}
                </div>
              ) : null}

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

      <Dialog
        open={isValidationOpen}
        onOpenChange={(open) => {
          if (!open) cancelValidation()
          else setIsValidationOpen(true)
        }}
      >
        <DialogContent className="border-[#1f1f1f] bg-[#111] text-[#ededed] sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="text-[#ededed]">Validate Self-hosted Runner</DialogTitle>
            <DialogDescription className="text-[#888]">
              {validationTeam
                ? `Before ${validationTeam.name} can use self-hosted mode, it needs a team-owned ${"`"}${SKILL_RUNNER_WORKER_PROJECT_NAME}${"`"} project.`
                : `Validate that the team-owned ${SKILL_RUNNER_WORKER_PROJECT_NAME} project is installed before enabling self-hosted mode.`}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 text-[13px] text-[#888]">
            <div className="rounded-lg border border-[#1f1f1f] bg-[#0d0d0d] px-4 py-3 leading-[20px]">
              Expected project name:{" "}
              <span className="font-mono text-[#cfcfcf]">{SKILL_RUNNER_WORKER_PROJECT_NAME}</span>
              <div className="mt-1 text-[#666]">
                We can detect an existing runner project or create it for you in this team, then auto-configure the
                worker settings.
              </div>
            </div>

            {validationError ? (
              <div className="flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3 text-red-400">
                <AlertCircle className="mt-0.5 size-4 shrink-0" />
                <div>{validationError}</div>
              </div>
            ) : null}

            {validationResult ? (
              validationResult.installed && validationResult.project ? (
                <div className="rounded-lg border border-[#1f1f1f] bg-[#0d0d0d] px-4 py-3">
                  <div className="flex items-start gap-2 text-[#cfcfcf]">
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-[#cfcfcf]" />
                    <div>
                      <div className="font-medium text-[#ededed]">Runner project detected</div>
                      <div className="mt-1 text-[#888]">{validationResult.project.projectName}</div>
                      <div className="mt-1 text-[#666]">Project ID: {validationResult.project.projectId}</div>
                      <div className="mt-1 text-[#666]">
                        Worker URL: {validationResult.project.workerBaseUrl || "No URL detected yet"}
                      </div>
                      {validationResult.project.dashboardUrl ? (
                        <a
                          href={validationResult.project.dashboardUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-2 inline-flex text-[12px] text-[#ededed] underline decoration-[#333] underline-offset-4 hover:decoration-[#666]"
                        >
                          Open project in Vercel
                        </a>
                      ) : null}
                      {!validationResult.project.workerBaseUrl ? (
                        <div className="mt-2 text-[12px] text-amber-400">
                          The project exists, but no stable worker URL was detected yet. You can still enable
                          self-hosted mode in provisioning state.
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-2 rounded-lg border border-[#1f1f1f] bg-[#0d0d0d] px-4 py-3">
                  <AlertCircle className="mt-0.5 size-4 shrink-0 text-[#888]" />
                  <div>
                    <div className="font-medium text-[#ededed]">Runner project not found</div>
                    <div className="mt-1 text-[#888]">
                      {validationResult.message ||
                        `No ${validationResult.expectedProjectName} project was found for this team.`}
                    </div>
                  </div>
                </div>
              )
            ) : null}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={cancelValidation}
              className="h-8 rounded-md border border-[#333] bg-transparent px-4 text-[13px] text-[#888] hover:bg-[#1a1a1a] hover:text-[#ededed]"
            >
              Keep Hosted
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => (validationTeamId ? void validateRunnerInstallation(validationTeamId) : undefined)}
              disabled={isValidating || isInstalling || !validationTeamId}
              className="h-8 rounded-md border border-[#333] bg-transparent px-4 text-[13px] text-[#ededed] hover:bg-[#1a1a1a]"
            >
              {isValidating ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="size-3.5 animate-spin" />
                  Validating…
                </span>
              ) : (
                "Validate Installation"
              )}
            </Button>
            {!validationResult?.installed ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() => (validationTeamId ? void installRunnerProject(validationTeamId) : undefined)}
                disabled={isValidating || isInstalling || !validationTeamId}
                className="h-8 rounded-md border border-[#333] bg-transparent px-4 text-[13px] text-[#ededed] hover:bg-[#1a1a1a]"
              >
                {isInstalling ? (
                  <span className="inline-flex items-center gap-2">
                    <Loader2 className="size-3.5 animate-spin" />
                    Installing…
                  </span>
                ) : (
                  "Install Runner Project"
                )}
              </Button>
            ) : null}
            <Button
              type="button"
              onClick={enableSelfHostedForValidatedTeam}
              disabled={!validationResult?.installed || !validationResult.project}
              className="h-8 rounded-md bg-[#ededed] px-4 text-[13px] font-medium text-[#0a0a0a] hover:bg-white disabled:opacity-40"
            >
              Enable Self-hosted
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
