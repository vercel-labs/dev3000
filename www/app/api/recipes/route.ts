import { getCurrentUser } from "@/lib/auth"
import {
  createCustomRecipe,
  isRecipeExecutionMode,
  isRecipeSandboxBrowser,
  listRecipes,
  parseRecipeSkillRef,
  type RecipeSkillRef
} from "@/lib/recipes"
import { withAttributedSpan } from "@/lib/tracing"

export async function GET() {
  return withAttributedSpan({ name: "recipes.list", file: "app/api/recipes/route.ts", fn: "GET" }, async (span) => {
    const recipes = await listRecipes()
    span.setAttribute("recipes.count", recipes.length)
    return Response.json({ success: true, recipes })
  })
}

function isValidSkillRef(value: unknown): value is RecipeSkillRef {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as RecipeSkillRef).installArg === "string" &&
    typeof (value as RecipeSkillRef).skillName === "string" &&
    typeof (value as RecipeSkillRef).displayName === "string"
  )
}

export async function POST(request: Request) {
  return withAttributedSpan({ name: "recipes.create", file: "app/api/recipes/route.ts", fn: "POST" }, async (span) => {
    const user = await getCurrentUser()
    if (!user) {
      span.setAttribute("http.status_code", 401)
      return Response.json({ success: false, error: "Not authenticated" }, { status: 401 })
    }

    try {
      const body = (await request.json()) as {
        name?: string
        description?: string
        prompt?: string
        instructions?: string
        executionMode?: string
        sandboxBrowser?: string
        skillRefs?: unknown[]
      }

      const name = body.name?.trim() || ""
      const description = body.description?.trim() || ""
      const instructions = body.prompt?.trim() || body.instructions?.trim() || ""
      const executionMode = body.executionMode || ""
      const sandboxBrowser = body.sandboxBrowser || ""
      const rawSkillRefs = Array.isArray(body.skillRefs) ? body.skillRefs : []

      if (!name || !description || !instructions) {
        span.setAttribute("http.status_code", 400)
        return Response.json({ success: false, error: "Name, description, and prompt are required." }, { status: 400 })
      }

      if (!isRecipeExecutionMode(executionMode)) {
        span.setAttribute("http.status_code", 400)
        return Response.json({ success: false, error: "Invalid execution mode." }, { status: 400 })
      }

      if (!isRecipeSandboxBrowser(sandboxBrowser)) {
        span.setAttribute("http.status_code", 400)
        return Response.json({ success: false, error: "Invalid sandbox browser." }, { status: 400 })
      }

      if (rawSkillRefs.length === 0) {
        span.setAttribute("http.status_code", 400)
        return Response.json({ success: false, error: "Choose at least one skill." }, { status: 400 })
      }

      const skillRefs = rawSkillRefs.filter(isValidSkillRef).map((skillRef) =>
        parseRecipeSkillRef({
          installArg: skillRef.installArg,
          sourceUrl: skillRef.sourceUrl,
          displayName: skillRef.displayName
        })
      )

      if (skillRefs.length === 0) {
        span.setAttribute("http.status_code", 400)
        return Response.json({ success: false, error: "No valid skills were provided." }, { status: 400 })
      }

      span.setAttribute("recipe.name", name)
      span.setAttribute("recipe.skill_count", skillRefs.length)

      const recipe = await createCustomRecipe({
        name,
        description,
        instructions,
        executionMode,
        sandboxBrowser,
        skillRefs,
        author: user
      })

      return Response.json({ success: true, recipe })
    } catch (error) {
      return Response.json(
        {
          success: false,
          error: error instanceof Error ? error.message : String(error)
        },
        { status: 500 }
      )
    }
  })
}
