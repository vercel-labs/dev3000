import { notFound, redirect } from "next/navigation"
import { getCurrentUser } from "@/lib/auth"
import { getRecipe } from "@/lib/recipes"
import RecipeRunClient from "./recipe-run-client"

export default async function NewRecipeRunPage({ params }: { params: Promise<{ recipeId: string }> }) {
  const user = await getCurrentUser()
  if (!user) {
    redirect("/api/auth/authorize")
  }

  const { recipeId } = await params
  const recipe = await getRecipe(recipeId)
  if (!recipe) {
    notFound()
  }

  return <RecipeRunClient recipe={recipe} user={user} />
}
