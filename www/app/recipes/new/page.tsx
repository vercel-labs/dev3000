import { redirect } from "next/navigation"
import { getCurrentUser } from "@/lib/auth"
import NewRecipeClient from "./new-recipe-client"

export default async function NewRecipePage() {
  const user = await getCurrentUser()
  if (!user) {
    redirect("/api/auth/authorize")
  }

  return <NewRecipeClient user={user} />
}
