import { redirect } from "next/navigation"

export default async function LegacyTeamRunReportPage({
  params
}: {
  params: Promise<{ team: string; runId: string }>
}) {
  const { runId } = await params
  redirect(`/dev-agents/runs/${runId}/report`)
}
