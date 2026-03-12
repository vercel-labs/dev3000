import { redirect } from "next/navigation"
import { getCurrentUser } from "@/lib/auth"
import { listWorkflowRuns } from "@/lib/workflow-storage"
import RecipeRunsClient from "./runs-client"

export default async function RecipeRunsPage() {
  const user = await getCurrentUser()

  if (!user) {
    redirect("/signin")
  }

  const runs = await listWorkflowRuns(user.id)

  return <RecipeRunsClient user={user} initialRuns={runs} />
}
