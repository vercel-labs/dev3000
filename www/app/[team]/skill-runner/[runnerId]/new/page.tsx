import type { Metadata, Route } from "next"
import { notFound, redirect } from "next/navigation"
import DevAgentRunClient from "@/app/dev-agents/[agentId]/new/dev-agent-run-client"
import { DevAgentsDashboardShell } from "@/components/dev-agents/dashboard-shell"
import { getAuthorizePath } from "@/lib/auth-redirect"
import { isV0DevAgentRunnerEnabled } from "@/lib/cloud/dev-agent-runner"
import { DEV3000_URL } from "@/lib/constants"
import { getDevAgentsRouteContext } from "@/lib/dev-agents-route"
import { getDefaultSkillRunnerOpenGraphProfile, getSkillRunner, getSkillRunnerTeamSettings } from "@/lib/skill-runners"

export async function generateMetadata({
  params
}: {
  params: Promise<{ team: string; runnerId: string }>
}): Promise<Metadata> {
  const { team, runnerId } = await params
  const profile = getDefaultSkillRunnerOpenGraphProfile(runnerId)
  const skillName = profile?.name || "Skill Runner"
  const description =
    profile?.executionProfile === "deepsec"
      ? "Run a DeepSec security scan against your Vercel project and get a focused, downloadable report."
      : profile?.description || "Run a high-confidence AI skill against a Vercel project from dev3000."
  const imageUrl = `/api/og/skill-runner/${encodeURIComponent(runnerId)}`
  const url = `${DEV3000_URL}/${team}/skill-runner/${runnerId}/new`

  return {
    title: `${skillName} on dev3000`,
    description,
    alternates: {
      canonical: url
    },
    openGraph: {
      title: `${skillName} on dev3000`,
      description,
      url,
      siteName: "dev3000",
      type: "website",
      images: [
        {
          url: imageUrl,
          width: 1200,
          height: 630,
          alt: `${skillName} skill runner`
        }
      ]
    },
    twitter: {
      card: "summary_large_image",
      title: `${skillName} on dev3000`,
      description,
      images: [imageUrl]
    }
  }
}

export default async function RunSkillRunnerPage({ params }: { params: Promise<{ team: string; runnerId: string }> }) {
  const { team, runnerId } = await params
  const routeContext = await getDevAgentsRouteContext(team)

  if (!routeContext.user) {
    redirect(getAuthorizePath(`/${team}/skill-runner/${runnerId}/new`))
  }

  if (!routeContext.selectedTeam) {
    if (routeContext.defaultTeam) {
      redirect(`/${routeContext.defaultTeam.slug}/skill-runner/${runnerId}/new` as Route)
    }
    notFound()
  }

  const selectedTeam = routeContext.selectedTeam
  const [skillRunner, teamSettings] = await Promise.all([
    getSkillRunner(selectedTeam, runnerId),
    getSkillRunnerTeamSettings(selectedTeam)
  ])

  if (!skillRunner) {
    notFound()
  }

  const ownerName = skillRunner.runnerCanonicalPath?.split("/")[0] || "Vercel"

  return (
    <DevAgentsDashboardShell
      teams={routeContext.teams}
      selectedTeam={selectedTeam}
      section="skill-runner"
      title={skillRunner.name}
      description={skillRunner.description}
    >
      <DevAgentRunClient
        devAgent={skillRunner}
        ownerName={ownerName}
        team={selectedTeam}
        user={routeContext.user}
        defaultUseV0DevAgentRunner={isV0DevAgentRunnerEnabled()}
        runnerKind="skill-runner"
        skillRunnerExecutionMode={teamSettings.executionMode}
        skillRunnerWorkerBaseUrl={teamSettings.workerBaseUrl}
        skillRunnerWorkerStatus={teamSettings.workerStatus}
      />
    </DevAgentsDashboardShell>
  )
}
