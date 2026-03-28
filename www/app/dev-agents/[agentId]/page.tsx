import type { Route } from "next"
import { notFound, redirect } from "next/navigation"
import { getCurrentUser } from "@/lib/auth"
import { getAuthorizePath } from "@/lib/auth-redirect"
import { getDevAgent } from "@/lib/dev-agents"
import { getDefaultTeam } from "@/lib/vercel-teams"

export default async function EditDevAgentRedirectPage({ params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await params
  const user = await getCurrentUser()
  if (!user) {
    redirect(getAuthorizePath(`/dev-agents/${agentId}`))
  }

  const devAgent = await getDevAgent(agentId)
  if (!devAgent) {
    notFound()
  }

  const teamSlug = devAgent.team?.slug || (await getDefaultTeam())?.slug
  if (!teamSlug) {
    notFound()
  }

  redirect(`/${teamSlug}/dev-agents/${devAgent.id}` as Route)
}
