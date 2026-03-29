import { redirect } from "next/navigation"

export default async function LegacyWorkflowReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  redirect(`/dev-agents/runs/${id}/report`)
}
