import type { Route } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { getCurrentUser } from "@/lib/auth"
import { canEditRecipe, listRecipes, type Recipe } from "@/lib/recipes"

function formatExecutionMode(mode: "dev-server" | "preview-pr"): string {
  return mode === "dev-server" ? "Dev Server" : "Preview + PR"
}

function formatSandboxBrowser(browser: Recipe["sandboxBrowser"]): string {
  if (browser === "agent-browser") return "agent-browser"
  if (browser === "next-browser") return "next-browser"
  return "No browser"
}

function formatRecipeTimestamp(timestamp: string): string {
  return new Date(timestamp).toLocaleString()
}

function getSkillSourceUrl(skill: Recipe["skillRefs"][number]): string | null {
  if (skill.sourceUrl) {
    return skill.sourceUrl
  }

  if (skill.displayName.toLowerCase() === "d3k" || skill.installArg.includes("/skills/d3k")) {
    return "https://skills.sh/vercel-labs/dev3000/d3k"
  }

  return null
}

export default async function RecipesPage() {
  const user = await getCurrentUser()
  if (!user) {
    redirect("/api/auth/authorize")
  }

  const recipes = await listRecipes()

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(212,94,31,0.12),_transparent_36%),linear-gradient(180deg,_var(--background),_color-mix(in_oklab,_var(--background)_85%,_#d9d3c7))]">
      <div className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-10 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-4 rounded-3xl border border-border/60 bg-background/80 p-6 shadow-sm backdrop-blur sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-2">
            <h1 className="font-serif text-4xl text-foreground sm:text-5xl">
              <Link href="/" className="hover:opacity-80 transition-opacity">
                Agent Recipes
              </Link>
            </h1>
            <p className="max-w-3xl text-sm text-muted-foreground sm:text-base">
              Built-in recipes capture the existing workflow presets. Custom recipes let you define a named prompt,
              attach `skills.sh` skills, and reuse that setup across projects.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button asChild variant="outline">
              <Link href="/recipes/runs">View Runs</Link>
            </Button>
            <Button asChild>
              <Link href="/recipes/new">Create Recipe</Link>
            </Button>
          </div>
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          {recipes.map((recipe) => (
            <Card key={recipe.id} className="border-border/60 bg-background/85 shadow-sm backdrop-blur">
              <CardHeader className="gap-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={recipe.kind === "builtin" ? "secondary" : "default"}>
                    {recipe.kind === "builtin" ? "Built-in" : "Custom"}
                  </Badge>
                  <Badge variant="outline">{formatExecutionMode(recipe.executionMode)}</Badge>
                  <Badge variant="outline">{formatSandboxBrowser(recipe.sandboxBrowser)}</Badge>
                  <Badge variant="outline">{recipe.usageCount} runs</Badge>
                </div>
                <div className="space-y-2">
                  <CardTitle className="text-2xl">
                    {canEditRecipe(recipe, user) ? (
                      <Link href={`/recipes/${recipe.id}` as Route} className="transition-opacity hover:opacity-80">
                        {recipe.name}
                      </Link>
                    ) : (
                      recipe.name
                    )}
                  </CardTitle>
                  <CardDescription className="text-sm leading-6">{recipe.description}</CardDescription>
                </div>
              </CardHeader>
              <CardContent className="space-y-5">
                <p className="text-sm leading-6 text-muted-foreground">{recipe.instructions}</p>
                <div className="flex flex-wrap gap-2">
                  {recipe.skillRefs.map((skill) => {
                    const sourceUrl = getSkillSourceUrl(skill)

                    return sourceUrl ? (
                      <a
                        key={`${recipe.id}-${skill.id}`}
                        href={sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex rounded-full border border-border px-3 py-1 text-sm transition-opacity hover:opacity-80"
                      >
                        {skill.displayName}
                      </a>
                    ) : (
                      <Badge key={`${recipe.id}-${skill.id}`} variant="outline" className="rounded-full px-3 py-1">
                        {skill.displayName}
                      </Badge>
                    )
                  })}
                </div>
                <div className="flex items-center justify-between text-sm text-muted-foreground">
                  <div className="space-y-1">
                    <div>By {recipe.author.name || recipe.author.username}</div>
                    <div className="text-xs text-muted-foreground">
                      Created {formatRecipeTimestamp(recipe.createdAt)}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Edited {formatRecipeTimestamp(recipe.updatedAt)}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button asChild>
                      <Link href={`/recipes/${recipe.id}/new`}>Run</Link>
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  )
}
