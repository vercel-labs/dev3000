"use client"

import { AlertCircle, ExternalLink, Play, Plus, Search, X } from "lucide-react"
import type { Route } from "next"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useDeferredValue, useEffect, useState } from "react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import type { DevAgent } from "@/lib/dev-agents-client"

interface SkillsShSearchResult {
  canonicalPath: string
  installArg: string
  packageName?: string
  skillName: string
  displayName: string
  sourceUrl: string
  installsLabel?: string
}

interface SkillRunnersCatalogProps {
  teamSlug: string
  runners: DevAgent[]
}

export function SkillRunnersCatalog({ teamSlug, runners }: SkillRunnersCatalogProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [query, setQuery] = useState(() => searchParams?.get("q") ?? "")
  const [results, setResults] = useState<SkillsShSearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [mutatingId, setMutatingId] = useState<string | null>(null)
  const [searchError, setSearchError] = useState<string | null>(null)
  const deferredQuery = useDeferredValue(query)

  useEffect(() => {
    const basePath = pathname || `/${teamSlug}/skill-runner`
    const current = searchParams?.get("q") ?? ""
    if (current === query) return

    const nextParams = new URLSearchParams(searchParams?.toString() ?? "")
    const trimmed = query.trim()
    if (trimmed) {
      nextParams.set("q", trimmed)
    } else {
      nextParams.delete("q")
    }

    const nextQuery = nextParams.toString()
    router.replace((nextQuery ? `${basePath}?${nextQuery}` : basePath) as Route)
  }, [pathname, query, router, searchParams, teamSlug])

  useEffect(() => {
    const trimmed = deferredQuery.trim()
    if (trimmed.length < 2) {
      setResults([])
      setSearchError(null)
      return
    }

    const controller = new AbortController()
    setSearching(true)
    setSearchError(null)
    void fetch(`/api/skill-runners/search?q=${encodeURIComponent(trimmed)}`, {
      signal: controller.signal
    })
      .then(async (response) => {
        const data = (await response.json()) as {
          success?: boolean
          error?: string
          results?: SkillsShSearchResult[]
        }
        if (!response.ok || !data.success) {
          throw new Error(data.error || "Failed to search skills.sh")
        }
        setResults(Array.isArray(data.results) ? data.results : [])
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setSearchError(error instanceof Error ? error.message : String(error))
        setResults([])
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setSearching(false)
        }
      })

    return () => controller.abort()
  }, [deferredQuery])

  async function addRunner(selection: SkillsShSearchResult) {
    setMutatingId(selection.canonicalPath)
    try {
      const response = await fetch("/api/skill-runners", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          team: teamSlug,
          selection
        })
      })
      const data = (await response.json()) as { success?: boolean; error?: string }
      if (!response.ok || !data.success) {
        throw new Error(data.error || "Failed to add skill runner")
      }
      setQuery("")
      setResults([])
      router.refresh()
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : String(error))
    } finally {
      setMutatingId(null)
    }
  }

  async function removeRunner(runnerId: string) {
    setMutatingId(runnerId)
    try {
      const response = await fetch("/api/skill-runners", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          team: teamSlug,
          runnerId
        })
      })
      const data = (await response.json()) as { success?: boolean; error?: string }
      if (!response.ok || !data.success) {
        throw new Error(data.error || "Failed to remove skill runner")
      }
      router.refresh()
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : String(error))
    } finally {
      setMutatingId(null)
    }
  }

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-[#1f1f1f] bg-[#0a0a0a] p-4">
        <div className="flex flex-col gap-3">
          <div>
            <div className="text-[13px] font-medium text-[#ededed]">Add from skills.sh</div>
            <div className="mt-1 text-[13px] leading-[20px] text-[#888]">
              Search by skill name and add any skill as a team-visible runner. Validation quality may vary for imported
              skills.
            </div>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search skills.sh by name"
              className="border-[#333] bg-[#111] text-[#ededed] placeholder:text-[#555]"
            />
            <div className="flex h-9 min-w-[120px] items-center justify-center rounded-md border border-[#333] bg-[#111] px-3 text-[13px] text-[#888]">
              {searching ? <Spinner className="size-4" /> : <Search className="size-3.5" />}
            </div>
          </div>
          {searchError ? (
            <Alert className="border-[#333] bg-[#111] text-[#888]">
              <AlertCircle className="size-4" />
              <AlertDescription>{searchError}</AlertDescription>
            </Alert>
          ) : null}
          {results.length > 0 ? (
            <div className="grid gap-3 md:grid-cols-2">
              {results.map((result) => (
                <div key={result.canonicalPath} className="rounded-md border border-[#1f1f1f] bg-[#111] p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <div className="truncate text-[14px] font-medium text-[#ededed]">{result.displayName}</div>
                        <a
                          href={result.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="shrink-0 text-[#555] transition-colors hover:text-[#888]"
                          aria-label={`Open ${result.displayName} on skills.sh`}
                        >
                          <ExternalLink className="size-3.5" />
                        </a>
                      </div>
                      <div className="mt-1 truncate text-[12px] text-[#666]">{result.canonicalPath}</div>
                      {result.installsLabel ? (
                        <div className="mt-2 text-[11px] uppercase tracking-wider text-[#555]">
                          {result.installsLabel}
                        </div>
                      ) : null}
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => void addRunner(result)}
                      disabled={mutatingId === result.canonicalPath}
                      className="h-8 shrink-0 rounded-md bg-[#ededed] px-3 text-[13px] font-medium text-[#0a0a0a] hover:bg-white"
                    >
                      {mutatingId === result.canonicalPath ? (
                        <Spinner className="size-4" />
                      ) : (
                        <Plus className="size-3.5" />
                      )}
                      Add
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {runners.map((runner) => (
          <div
            key={runner.id}
            className="flex flex-col justify-between rounded-lg border border-[#1f1f1f] bg-[#0a0a0a] p-4 transition-colors hover:border-[#333]"
          >
            <div className="space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 space-y-0.5">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <div className="truncate text-[14px] font-medium text-[#ededed]">{runner.name}</div>
                    {runner.runnerSourceUrl ? (
                      <a
                        href={runner.runnerSourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="shrink-0 text-[#555] transition-colors hover:text-[#888]"
                        aria-label={`Open ${runner.name} on skills.sh`}
                      >
                        <ExternalLink className="size-3.5" />
                      </a>
                    ) : null}
                  </div>
                  {runner.runnerCanonicalPath ? (
                    <div className="truncate text-[12px] text-[#666]">{runner.runnerCanonicalPath}</div>
                  ) : null}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => void removeRunner(runner.id)}
                  disabled={mutatingId === runner.id}
                  className="size-7 shrink-0 rounded-md text-[#555] hover:bg-[#1a1a1a] hover:text-[#888]"
                  aria-label={`Remove ${runner.name}`}
                >
                  {mutatingId === runner.id ? <Spinner className="size-3.5" /> : <X className="size-3.5" />}
                </Button>
              </div>

              <p className="line-clamp-2 text-[13px] leading-[20px] text-[#888]">{runner.description}</p>

              {runner.validationWarning ? (
                <Alert className="border-[#333] bg-[#111] text-[#888]">
                  <AlertCircle className="size-4" />
                  <AlertDescription>{runner.validationWarning}</AlertDescription>
                </Alert>
              ) : null}

              <div className="space-y-2 rounded-md border border-[#1f1f1f] bg-[#111] p-3">
                <div>
                  <div className="text-[11px] uppercase tracking-wider text-[#555]">Success Eval</div>
                  <div className="mt-1 text-[13px] leading-[18px] text-[#888]">
                    {runner.successEval?.trim() || "None"}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {runner.usageCount > 0 ? (
                  <span className="rounded-md bg-[#1a1a1a] px-2 py-0.5 text-[11px] text-[#888]">
                    {runner.usageCount} runs
                  </span>
                ) : null}
                {runner.avgCost ? (
                  <span className="rounded-md bg-[#1a1a1a] px-2 py-0.5 text-[11px] text-[#888]">
                    Avg Cost: {runner.avgCost}
                  </span>
                ) : null}
              </div>
            </div>

            <div className="mt-4 flex items-center gap-2">
              <Button
                asChild
                size="sm"
                className="h-8 rounded-md bg-[#ededed] px-3 text-[13px] font-medium text-[#0a0a0a] hover:bg-white"
              >
                <Link href={`/${teamSlug}/skill-runner/${runner.id}/new` as Route}>
                  <Play className="size-3.5" />
                  Run
                </Link>
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
