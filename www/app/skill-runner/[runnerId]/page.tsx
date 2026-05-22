import type { Metadata, Route } from "next"
import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { connection } from "next/server"
import { getCurrentUser } from "@/lib/auth"
import { getAuthorizePath } from "@/lib/auth-redirect"
import { DEV3000_URL } from "@/lib/constants"
import { getDefaultSkillRunnerOpenGraphProfile } from "@/lib/skill-runners"
import { getDefaultTeam } from "@/lib/vercel-teams"

function getSharePath(runnerId: string): Route {
  return `/skill-runner/${runnerId}` as Route
}

function getShareContent(executionProfile?: string) {
  if (executionProfile === "deepsec") {
    return {
      description: "Run a DeepSec security scan against your Vercel project and get a focused, downloadable report.",
      terminal: [
        ["$", "deepsec scan"],
        ["scope", "auth, api, env, actions"],
        ["output", "downloadable report"]
      ],
      badge: "Security scan",
      title: "Prioritized findings from project context",
      body: "Designed for teams that want a readable report before deciding what to fix."
    }
  }

  if (executionProfile === "vercel-optimize") {
    return {
      description:
        "Run an observability-first Vercel cost and performance audit and get a ranked, downloadable report.",
      terminal: [
        ["$", "vercel optimize"],
        ["signals", "metrics, usage, config"],
        ["output", "downloadable report"]
      ],
      badge: "Optimization audit",
      title: "Ranked recommendations from production signals",
      body: "Built for teams that want data-backed cost and performance work before changing code."
    }
  }

  return {
    description: "Run a high-confidence AI skill against a Vercel project from dev3000.",
    terminal: [
      ["$", "skill run"],
      ["scope", "project context"],
      ["output", "run report"]
    ],
    badge: "Skill runner",
    title: "Project-specific analysis from a selected skill",
    body: "Designed for teams that want a repeatable run before deciding what to ship."
  }
}

function getSkillRunnerMetadata(runnerId: string, url: string): Metadata {
  const profile = getDefaultSkillRunnerOpenGraphProfile(runnerId)
  const skillName = profile?.name || "Skill Runner"
  const description = profile ? getShareContent(profile.executionProfile).description : getShareContent().description
  const imageUrl = `/api/og/skill-runner/${encodeURIComponent(runnerId)}`

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

export async function generateMetadata({ params }: { params: Promise<{ runnerId: string }> }): Promise<Metadata> {
  const { runnerId } = await params
  return getSkillRunnerMetadata(runnerId, `${DEV3000_URL}/skill-runner/${runnerId}`)
}

export default async function ShareableSkillRunnerPage({ params }: { params: Promise<{ runnerId: string }> }) {
  const { runnerId } = await params
  const profile = getDefaultSkillRunnerOpenGraphProfile(runnerId)
  if (!profile) {
    notFound()
  }

  await connection()
  const sharePath = getSharePath(runnerId)
  const shareContent = getShareContent(profile.executionProfile)
  const user = await getCurrentUser()
  if (!user) {
    return (
      <main className="min-h-screen bg-[#050505] px-6 py-8 font-sans text-[#ededed]">
        <div className="mx-auto flex min-h-[calc(100vh-64px)] max-w-5xl flex-col justify-between">
          <header className="flex items-center justify-between text-[13px] text-[#888]">
            <span>dev3000</span>
            <span>{profile.canonicalPath}</span>
          </header>

          <section className="grid gap-10 py-14 lg:grid-cols-[1fr_360px] lg:items-center">
            <div>
              <div className="mb-5 inline-flex rounded-full border border-[#333] px-3 py-1 text-[13px] text-[#aaa]">
                Skill Runner
              </div>
              <h1 className="max-w-3xl text-[52px] font-semibold leading-[0.98] tracking-normal text-[#f5f5f5] md:text-[72px]">
                Run {profile.name} on your Vercel project
              </h1>
              <p className="mt-6 max-w-2xl text-[20px] leading-[1.45] text-[#aaa]">{profile.description}</p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Link
                  href={getAuthorizePath(sharePath)}
                  className="rounded-md bg-[#ededed] px-4 py-2.5 text-[15px] font-medium text-[#080808] hover:bg-white"
                >
                  Sign in with Vercel
                </Link>
                <span className="text-[13px] text-[#777]">You will land on your own team after sign-in.</span>
              </div>
            </div>

            <div className="rounded-lg border border-[#262626] bg-[#0b0b0b] p-5">
              <div className="font-mono text-[13px] leading-6 text-[#aaa]">
                {shareContent.terminal.map(([label, value]) => (
                  <div key={label}>
                    <span className="text-[#666]">{label}</span> {value}
                  </div>
                ))}
              </div>
              <div className="mt-5 rounded-md border border-[#333] bg-[#111] p-4">
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#d5b16b]">
                  {shareContent.badge}
                </div>
                <div className="text-[18px] font-medium text-[#f5f5f5]">{shareContent.title}</div>
                <p className="mt-2 text-[14px] leading-5 text-[#888]">{shareContent.body}</p>
              </div>
            </div>
          </section>

          <footer className="text-[12px] text-[#666]">Runs execute in the selected Vercel team context.</footer>
        </div>
      </main>
    )
  }

  const defaultTeam = await getDefaultTeam()
  if (!defaultTeam) {
    notFound()
  }

  redirect(`/${defaultTeam.slug}/skill-runner/${runnerId}/new` as Route)
}
