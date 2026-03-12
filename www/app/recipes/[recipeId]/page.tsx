import { notFound, redirect } from "next/navigation"
import { getCurrentUser } from "@/lib/auth"
import { canEditRecipe, getRecipe } from "@/lib/recipes"
import NewRecipeClient from "../new/new-recipe-client"

export default async function EditRecipePage({ params }: { params: Promise<{ recipeId: string }> }) {
  const user = await getCurrentUser()
  if (!user) {
    redirect("/api/auth/authorize")
  }

  const { recipeId } = await params
  const recipe = await getRecipe(recipeId)
  if (!recipe) {
    notFound()
  }
  const canEdit = canEditRecipe(recipe, user)

  return <NewRecipeClient user={user} recipe={recipe} mode="edit" canEdit={canEdit} />
}
