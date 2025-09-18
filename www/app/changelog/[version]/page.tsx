import { Bug, Calendar, Github, Package, Sparkles, Zap } from "lucide-react"
import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { changelog } from "@/lib/changelog"

export async function generateStaticParams() {
  return changelog.map((release) => ({
    version: `v${release.version}`
  }))
}

export async function generateMetadata({ params }: { params: Promise<{ version: string }> }): Promise<Metadata> {
  const { version } = await params
  const release = changelog.find(
    (r) => `v${r.version}` === version || r.version === version
  )
  
  if (!release) {
    return {
      title: "Version Not Found"
    }
  }

  return {
    title: `dev3000 ${version} Changelog`,
    description: `dev3000 ${version} release: ${release.highlights.slice(0, 2).join(", ")}${release.highlights.length > 2 ? ", and more" : ""}.`,
    openGraph: {
      title: `dev3000 ${version} - AI-Powered Development Tools`,
      description: `Release highlights: ${release.highlights.slice(0, 3).join(" • ")}${release.highlights.length > 3 ? " and more" : ""}.`,
      type: "website",
      images: [
        {
          url: `/api/og/changelog/${version}`,
          width: 1200,
          height: 630,
          alt: `dev3000 ${version} changelog`
        }
      ]
    },
    twitter: {
      card: "summary_large_image",
      title: `dev3000 ${version} - Changelog`,
      description: `Features: ${release.highlights.slice(0, 2).join(" • ")}${release.highlights.length > 2 ? " and more" : ""}.`,
      images: [`/api/og/changelog/${version}`]
    }
  }
}

const getVersionTypeIcon = (type: string) => {
  switch (type) {
    case "major":
      return <Sparkles className="w-4 h-4 text-yellow-400" />
    case "minor":
      return <Zap className="w-4 h-4 text-blue-400" />
    case "patch":
      return <Bug className="w-4 h-4 text-green-400" />
    default:
      return <Package className="w-4 h-4 text-gray-400" />
  }
}

const getVersionTypeBadge = (type: string) => {
  switch (type) {
    case "major":
      return (
        <Badge variant="outline" className="border-yellow-400/50 text-yellow-400 bg-yellow-400/10">
          Major Release
        </Badge>
      )
    case "minor":
      return (
        <Badge variant="outline" className="border-blue-400/50 text-blue-400 bg-blue-400/10">
          Feature Release
        </Badge>
      )
    case "patch":
      return (
        <Badge variant="outline" className="border-green-400/50 text-green-400 bg-green-400/10">
          Bug Fix
        </Badge>
      )
    default:
      return <Badge variant="outline">Release</Badge>
  }
}

export default async function VersionPage({ params }: { params: Promise<{ version: string }> }) {
  const { version } = await params
  const release = changelog.find(
    (r) => `v${r.version}` === version || r.version === version
  )

  if (!release) {
    notFound()
  }

  // Find previous and next versions
  const currentIndex = changelog.indexOf(release)
  const previousRelease = currentIndex < changelog.length - 1 ? changelog[currentIndex + 1] : null
  const nextRelease = currentIndex > 0 ? changelog[currentIndex - 1] : null

  return (
    <div className="container max-w-4xl py-12 px-6">
      {/* Navigation */}
      <div className="mb-8 flex items-center justify-between">
        <Link href="/changelog">
          <Button variant="ghost" size="sm" className="gap-2">
            ← All Releases
          </Button>
        </Link>
        
        <div className="flex gap-2">
          {previousRelease && (
            <Link href={`/changelog/v${previousRelease.version}`}>
              <Button variant="outline" size="sm">
                ← v{previousRelease.version}
              </Button>
            </Link>
          )}
          {nextRelease && (
            <Link href={`/changelog/v${nextRelease.version}`}>
              <Button variant="outline" size="sm">
                v{nextRelease.version} →
              </Button>
            </Link>
          )}
        </div>
      </div>

      {/* Header */}
      <div className="text-center mb-12">
        <div className="flex items-center justify-center gap-3 mb-4">
          <h1 className="text-4xl font-bold">v{release.version}</h1>
          {getVersionTypeBadge(release.type)}
        </div>
        <p className="text-lg text-foreground-secondary mb-4">
          dev3000 Release Notes
        </p>
        <div className="flex items-center justify-center gap-2 text-sm text-foreground-secondary">
          <Calendar className="w-4 h-4" />
          {release.date}
        </div>
      </div>

      {/* Release Details */}
      <Card className="p-8">
        <div className="space-y-8">
          {/* Highlights */}
          <div>
            <h2 className="flex items-center gap-2 font-semibold text-xl mb-4">
              <Sparkles className="w-5 h-5 text-yellow-400" />
              Key Highlights
            </h2>
            <ul className="space-y-3">
              {release.highlights.map((highlight, idx) => (
                <li key={`highlight-${idx}`} className="flex items-start gap-3">
                  <div className="w-2 h-2 bg-primary rounded-full mt-2 flex-shrink-0" />
                  <span className="text-foreground leading-relaxed">{highlight}</span>
                </li>
              ))}
            </ul>
          </div>

        </div>

        {/* Footer Actions */}
        <div className="mt-8 pt-6 border-t flex items-center justify-between">
          <Link 
            href={`https://github.com/elsigh/dev3000/releases/tag/v${release.version}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Button variant="outline" size="sm" className="gap-2">
              <Github className="w-4 h-4" />
              View on GitHub
            </Button>
          </Link>

          <div className="text-sm text-foreground-secondary">
            Share this release: 
            <code className="ml-2 px-2 py-1 bg-secondary rounded text-xs">
              https://dev3000.ai/changelog/v{release.version}
            </code>
          </div>
        </div>
      </Card>
    </div>
  )
}