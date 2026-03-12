"use client"

import { Search, X } from "lucide-react"
import Link from "next/link"
import { useDeferredValue, useEffect, useId, useMemo, useState, useTransition } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Textarea } from "@/components/ui/textarea"
import type { Recipe } from "@/lib/recipes"

interface UserInfo {
  id: string
  email: string
  name: string
  username: string
}

interface SkillSearchResult {
  id: string
  installArg: string
  packageName?: string
  skillName: string
  displayName: string
  sourceUrl?: string
  installsLabel?: string
}

interface NewRecipeClientProps {
  user: UserInfo
  recipe?: Recipe
  mode?: "create" | "edit"
  canEdit?: boolean
}

const executionModeOptions = [
  {
    value: "dev-server",
    label: "Dev Server Capture",
    description: "Run a sandbox dev server, capture runtime signals, then fix and validate there."
  },
  {
    value: "preview-pr",
    label: "Preview + PR",
    description: "Work from code and preview validation, then produce a PR-ready result."
  }
] as const

const sandboxBrowserOptions = [
  {
    value: "none",
    label: "None",
    description: "Skip browser-specific guidance and keep the recipe code-first."
  },
  {
    value: "agent-browser",
    label: "agent-browser",
    description: "Use the current sandbox browser tooling for capture, inspection, and validation."
  },
  {
    value: "next-browser",
    label: "next-browser",
    description: "Bias the recipe toward preview-style browser validation and Next-focused browsing."
  }
] as const

const implicitD3kSkill: SkillSearchResult = {
  id: "d3k",
  installArg: "https://github.com/vercel-labs/dev3000/tree/main/skills/d3k",
  skillName: "d3k",
  displayName: "d3k",
  sourceUrl: "https://skills.sh/vercel-labs/dev3000/d3k"
}

function isD3kSkill(skill: Pick<SkillSearchResult, "id" | "installArg" | "skillName" | "displayName">): boolean {
  return (
    skill.id === "d3k" ||
    skill.skillName.toLowerCase() === "d3k" ||
    skill.displayName.toLowerCase() === "d3k" ||
    skill.installArg === implicitD3kSkill.installArg
  )
}

function getDefaultSandboxBrowser(
  executionMode: (typeof executionModeOptions)[number]["value"]
): (typeof sandboxBrowserOptions)[number]["value"] {
  return executionMode === "preview-pr" ? "next-browser" : "agent-browser"
}

export default function NewRecipeClient({ user, recipe, mode = "create", canEdit = true }: NewRecipeClientProps) {
  const nameId = useId()
  const descriptionId = useId()
  const promptId = useId()
  const skillSearchId = useId()
  const isEditMode = mode === "edit" && Boolean(recipe)
  const [name, setName] = useState(recipe?.name ?? "")
  const [description, setDescription] = useState(recipe?.description ?? "")
  const [prompt, setPrompt] = useState(recipe?.instructions ?? "")
  const [executionMode, setExecutionMode] = useState<(typeof executionModeOptions)[number]["value"]>(
    recipe?.executionMode ?? "dev-server"
  )
  const [sandboxBrowser, setSandboxBrowser] = useState<(typeof sandboxBrowserOptions)[number]["value"]>(
    recipe?.sandboxBrowser ?? getDefaultSandboxBrowser(recipe?.executionMode ?? "dev-server")
  )
  const [searchQuery, setSearchQuery] = useState("")
  const deferredSearchQuery = useDeferredValue(searchQuery)
  const [searchResults, setSearchResults] = useState<SkillSearchResult[]>([])
  const [selectedSkills, setSelectedSkills] = useState<SkillSearchResult[]>(() =>
    (recipe?.skillRefs ?? []).filter((skill) => !(recipe?.executionMode === "dev-server" && isD3kSkill(skill)))
  )
  const [isSearching, setIsSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const title = isEditMode ? "Agent Recipes - Edit" : "Agent Recipes - Create"
  const subtitle = isEditMode ? "Edit Recipe" : "Create Recipe"
  const submitLabel = isEditMode ? "Save Recipe" : "Create Recipe"
  const isReadOnly = isEditMode && !canEdit
  const recipeMeta = recipe
    ? `Created ${new Date(recipe.createdAt).toLocaleString()} · Edited ${new Date(recipe.updatedAt).toLocaleString()}`
    : null

  useEffect(() => {
    if (!canEdit) {
      setSearchResults([])
      setSearchError(null)
      return
    }

    const query = deferredSearchQuery.trim()
    if (query.length < 2) {
      setSearchResults([])
      setSearchError(null)
      return
    }

    const controller = new AbortController()
    setIsSearching(true)
    setSearchError(null)

    void fetch(`/api/skills/find?q=${encodeURIComponent(query)}`, {
      signal: controller.signal
    })
      .then(async (response) => {
        const data = (await response.json()) as {
          success?: boolean
          error?: string
          results?: SkillSearchResult[]
        }
        if (!response.ok || !data.success) {
          throw new Error(data.error || "Skill search failed.")
        }
        setSearchResults(Array.isArray(data.results) ? data.results : [])
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setSearchError(error instanceof Error ? error.message : String(error))
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setIsSearching(false)
        }
      })

    return () => controller.abort()
  }, [canEdit, deferredSearchQuery])

  const effectiveSelectedSkills = useMemo(() => {
    if (executionMode !== "dev-server") {
      return selectedSkills
    }

    return selectedSkills.some((skill) => isD3kSkill(skill)) ? selectedSkills : [implicitD3kSkill, ...selectedSkills]
  }, [executionMode, selectedSkills])

  const selectedSkillIds = useMemo(
    () => new Set(effectiveSelectedSkills.map((skill) => skill.id)),
    [effectiveSelectedSkills]
  )

  function addSkill(skill: SkillSearchResult) {
    setSelectedSkills((current) => {
      if (current.some((item) => item.id === skill.id)) {
        return current
      }
      return [...current, skill]
    })
  }

  function removeSkill(skillId: string) {
    setSelectedSkills((current) => current.filter((skill) => skill.id !== skillId))
  }

  function submitRecipe() {
    if (!canEdit) {
      return
    }

    setSubmitError(null)
    startTransition(async () => {
      try {
        const endpoint = isEditMode && recipe ? `/api/recipes/${recipe.id}` : "/api/recipes"
        const response = await fetch(endpoint, {
          method: isEditMode ? "PUT" : "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            name,
            description,
            prompt,
            executionMode,
            sandboxBrowser,
            skillRefs: effectiveSelectedSkills
          })
        })

        const data = (await response.json()) as {
          success?: boolean
          error?: string
          recipe?: { id: string }
        }

        if (!response.ok || !data.success || !data.recipe) {
          throw new Error(data.error || (isEditMode ? "Failed to save recipe." : "Failed to create recipe."))
        }

        window.location.href = isEditMode ? `/recipes/${data.recipe.id}` : `/recipes/${data.recipe.id}/new`
      } catch (error) {
        setSubmitError(error instanceof Error ? error.message : String(error))
      }
    })
  }

  const isFormValid =
    name.trim().length > 0 &&
    description.trim().length > 0 &&
    prompt.trim().length > 0 &&
    effectiveSelectedSkills.length > 0 &&
    !isPending

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_right,_rgba(16,84,64,0.12),_transparent_34%),linear-gradient(180deg,_var(--background),_color-mix(in_oklab,_var(--background)_85%,_#d7dccf))]">
      <div className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-10 sm:px-6 lg:px-8">
        {isEditMode ? (
          <div className="flex flex-wrap items-center justify-between gap-4">
            <Link
              href="/recipes"
              className="text-sm uppercase tracking-[0.2em] text-muted-foreground transition-opacity hover:opacity-80"
            >
              Agent Recipes
            </Link>
            <Button asChild variant="outline">
              <Link href="/recipes">Back to Recipes</Link>
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-end justify-between gap-4 rounded-3xl border border-border/60 bg-background/85 p-6 shadow-sm backdrop-blur">
            <div className="space-y-2">
              <p className="text-sm uppercase tracking-[0.2em] text-muted-foreground">{subtitle}</p>
              <h1 className="font-serif text-4xl text-foreground sm:text-5xl">
                <Link href="/" className="hover:opacity-80 transition-opacity">
                  {title}
                </Link>
              </h1>
              <p className="max-w-3xl text-sm text-muted-foreground sm:text-base">
                Recipes are saved with your author metadata, usage tracking, execution mode, and the exact skill install
                args needed to recreate them in the sandbox.
              </p>
              {recipeMeta && <p className="text-xs text-muted-foreground">{recipeMeta}</p>}
            </div>
            <Button asChild variant="outline">
              <Link href="/recipes">Back to Recipes</Link>
            </Button>
          </div>
        )}

        <Card className="border-border/60 bg-background/90 shadow-sm">
          <CardHeader>
            <CardTitle>{subtitle}</CardTitle>
            <CardDescription>
              Author: {user.name || user.username || user.email}
              {recipeMeta ? ` · ${recipeMeta}` : ""}
            </CardDescription>
            {isReadOnly ? (
              <p className="text-sm text-muted-foreground">Read only. Only the author can edit this recipe.</p>
            ) : null}
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor={nameId}>Name</Label>
              <Input
                id={nameId}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Performance budget sweep"
                className={isEditMode ? "h-14 text-xl font-medium sm:text-2xl" : undefined}
                disabled={!canEdit}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor={descriptionId}>Description</Label>
              <Textarea
                id={descriptionId}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Short summary shown on the recipes homepage."
                rows={3}
                disabled={!canEdit}
              />
            </div>

            <div className="space-y-3">
              <Label>Execution Mode</Label>
              <RadioGroup
                value={executionMode}
                onValueChange={(value) => {
                  const nextExecutionMode = value as typeof executionMode
                  setExecutionMode(nextExecutionMode)
                  setSandboxBrowser(getDefaultSandboxBrowser(nextExecutionMode))
                }}
              >
                <div className="grid gap-3 md:grid-cols-2">
                  {executionModeOptions.map((option) => (
                    <div
                      key={option.value}
                      className="flex flex-col gap-3 rounded-2xl border border-border/70 bg-muted/20 p-4"
                    >
                      <div className="flex items-center gap-3">
                        <RadioGroupItem value={option.value} id={`${nameId}-${option.value}`} disabled={!canEdit} />
                        <Label htmlFor={`${nameId}-${option.value}`} className="font-medium text-foreground">
                          {option.label}
                        </Label>
                      </div>
                      <p className="text-sm leading-6 text-muted-foreground">{option.description}</p>
                    </div>
                  ))}
                </div>
              </RadioGroup>
            </div>

            <div className="space-y-3">
              <Label>Sandbox Browser</Label>
              <RadioGroup
                value={sandboxBrowser}
                onValueChange={(value) => setSandboxBrowser(value as typeof sandboxBrowser)}
              >
                <div className="grid gap-3 md:grid-cols-3">
                  {sandboxBrowserOptions.map((option) => (
                    <div
                      key={option.value}
                      className="flex flex-col gap-3 rounded-2xl border border-border/70 bg-muted/20 p-4"
                    >
                      <div className="flex items-center gap-3">
                        <RadioGroupItem value={option.value} id={`${nameId}-${option.value}`} disabled={!canEdit} />
                        <Label htmlFor={`${nameId}-${option.value}`} className="font-medium text-foreground">
                          {option.label}
                        </Label>
                      </div>
                      <p className="text-sm leading-6 text-muted-foreground">{option.description}</p>
                    </div>
                  ))}
                </div>
              </RadioGroup>
            </div>

            <div className="space-y-2">
              <Label htmlFor={promptId}>Prompt</Label>
              <Textarea
                id={promptId}
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="Describe what the agent should optimize, what tradeoffs matter, and how it should validate success."
                rows={14}
                className="min-h-60"
                disabled={!canEdit}
              />
            </div>

            <div className="space-y-3">
              <Label htmlFor={skillSearchId}>Skills</Label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id={skillSearchId}
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search skills.sh skills"
                  className="pl-9"
                  disabled={!canEdit}
                />
              </div>
              {searchError && <p className="text-sm text-destructive">{searchError}</p>}
              {isSearching || searchResults.length > 0 ? (
                <div className="space-y-2 rounded-2xl border border-border/70 bg-muted/15 p-3">
                  {isSearching ? (
                    <p className="text-sm text-muted-foreground">Searching skills…</p>
                  ) : (
                    searchResults.map((skill) => (
                      <button
                        type="button"
                        key={skill.installArg}
                        onClick={() => addSkill(skill)}
                        disabled={!canEdit || selectedSkillIds.has(skill.id)}
                        className="flex w-full items-start justify-between rounded-xl border border-transparent bg-background/80 px-3 py-3 text-left transition hover:border-border disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <div className="space-y-1">
                          <div className="font-medium text-foreground">{skill.displayName}</div>
                          <div className="text-xs text-muted-foreground">{skill.installArg}</div>
                          {skill.installsLabel && (
                            <div className="text-xs text-muted-foreground">{skill.installsLabel}</div>
                          )}
                        </div>
                        <Badge variant="outline">{selectedSkillIds.has(skill.id) ? "Added" : "Add"}</Badge>
                      </button>
                    ))
                  )}
                </div>
              ) : null}

              <div className="space-y-3 rounded-2xl border border-border/70 bg-background/70 p-4">
                <div className="space-y-1">
                  <p className="text-sm font-medium text-foreground">Selected Skills</p>
                  <p className="text-sm text-muted-foreground">
                    These install args are saved with the recipe and replayed during sandbox setup.
                    {executionMode === "dev-server" ? " d3k is required for dev server capture and is pinned." : ""}
                  </p>
                </div>
                {effectiveSelectedSkills.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No skills selected yet.</p>
                ) : (
                  <div className="flex flex-wrap gap-3">
                    {effectiveSelectedSkills.map((skill) => (
                      <div
                        key={skill.installArg}
                        className="inline-flex max-w-full items-center gap-2 rounded-full border border-border/70 bg-muted/20 px-4 py-2"
                      >
                        <span className="font-medium text-foreground">{skill.displayName}</span>
                        {isD3kSkill(skill) && executionMode === "dev-server" ? (
                          <Badge variant="secondary" className="rounded-full">
                            Built-in
                          </Badge>
                        ) : null}
                        {!isD3kSkill(skill) || executionMode !== "dev-server" ? (
                          <button
                            type="button"
                            onClick={() => removeSkill(skill.id)}
                            disabled={!canEdit}
                            className="rounded-full p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground"
                            aria-label={`Remove ${skill.displayName}`}
                          >
                            <X className="size-4" />
                          </button>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {submitError && <p className="text-sm text-destructive">{submitError}</p>}

            <div className="flex flex-wrap gap-3">
              {!isReadOnly ? (
                <Button onClick={submitRecipe} disabled={!isFormValid}>
                  {isPending ? (isEditMode ? "Saving…" : "Creating…") : submitLabel}
                </Button>
              ) : null}
              <Button asChild variant="outline">
                <Link href="/recipes">Cancel</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
