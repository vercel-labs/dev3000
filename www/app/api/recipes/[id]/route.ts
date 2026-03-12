import { getCurrentUser } from "@/lib/auth"
import {
  canEditRecipe,
  getRecipe,
  isRecipeExecutionMode,
  isRecipeSandboxBrowser,
  parseRecipeSkillRef,
  type RecipeSkillRef,
  updateCustomRecipe
} from "@/lib/recipes"

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const recipe = await getRecipe(id)

  if (!recipe) {
    return Response.json({ success: false, error: "Recipe not found." }, { status: 404 })
  }

  return Response.json({ success: true, recipe })
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

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) {
    return Response.json({ success: false, error: "Not authenticated" }, { status: 401 })
  }

  const { id } = await params
  const existingRecipe = await getRecipe(id)
  if (!existingRecipe) {
    return Response.json({ success: false, error: "Recipe not found." }, { status: 404 })
  }

  if (!canEditRecipe(existingRecipe, user)) {
    return Response.json({ success: false, error: "You do not have permission to edit this recipe." }, { status: 403 })
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
      return Response.json({ success: false, error: "Name, description, and prompt are required." }, { status: 400 })
    }

    if (!isRecipeExecutionMode(executionMode)) {
      return Response.json({ success: false, error: "Invalid execution mode." }, { status: 400 })
    }

    if (!isRecipeSandboxBrowser(sandboxBrowser)) {
      return Response.json({ success: false, error: "Invalid sandbox browser." }, { status: 400 })
    }

    if (rawSkillRefs.length === 0) {
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
      return Response.json({ success: false, error: "No valid skills were provided." }, { status: 400 })
    }

    const recipe = await updateCustomRecipe(id, {
      name,
      description,
      instructions,
      executionMode,
      sandboxBrowser,
      skillRefs,
      author: user
    })

    if (!recipe) {
      return Response.json({ success: false, error: "Recipe not found." }, { status: 404 })
    }

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
}
