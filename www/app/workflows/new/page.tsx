import type { Route } from "next"
import { notFound, redirect } from "next/navigation"
import { getCurrentUser } from "@/lib/auth"
import { getAuthorizePath } from "@/lib/auth-redirect"
import { getDefaultTeam } from "@/lib/vercel-teams"

export default async function NewWorkflowPage() {
  const user = await getCurrentUser()
  if (!user) {
    redirect(getAuthorizePath("/workflows/new"))
  }

  const defaultTeam = await getDefaultTeam()
  if (!defaultTeam) {
    notFound()
  }

  redirect(`/${defaultTeam.slug}/dev-agents/new` as Route)
}
