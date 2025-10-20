import { Calendar, Github, Sparkles } from "lucide-react"
import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import type React from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { changelog } from "@/lib/changelog"

const slugify = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")

// Convert markdown to HTML elements
const parseMarkdown = (text: string) => {
  const parts: (string | React.JSX.Element)[] = []
  let currentIndex = 0
  let key = 0

  // Match **bold**, [link](url), and regular text
  const regex = /(\*\*.*?\*\*|\[.*?\]\(.*?\))/g
  let match: RegExpExecArray | null = regex.exec(text)

  while (match !== null) {
    // Add text before the match
    if (match.index > currentIndex) {
      parts.push(text.slice(currentIndex, match.index))
    }

    const matchedText = match[0]

    // Handle bold **text**
    if (matchedText.startsWith("**") && matchedText.endsWith("**")) {
      const boldText = matchedText.slice(2, -2)
      parts.push(
        <strong key={`bold-${key++}`} className="font-semibold">
          {boldText}
        </strong>
      )
    }
    // Handle links [text](url)
    else if (matchedText.startsWith("[")) {
      const linkMatch = matchedText.match(/\[(.*?)\]\((.*?)\)/)
      if (linkMatch) {
        const [, linkText, url] = linkMatch
        parts.push(
          <a
            key={`link-${key++}`}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-400 hover:underline"
          >
            {linkText}
          </a>
        )
      }
    }

    currentIndex = match.index + matchedText.length
    match = regex.exec(text)
  }

  // Add remaining text
  if (currentIndex < text.length) {
    parts.push(text.slice(currentIndex))
  }

  return parts.length > 0 ? parts : text
}

export async function generateStaticParams() {
  return changelog.map((release) => ({
    version: `v${release.version}`
  }))
}

export async function generateMetadata({ params }: { params: Promise<{ version: string }> }): Promise<Metadata> {
  const { version } = await params
  const release = changelog.find((r) => `v${r.version}` === version || r.version === version)

  if (!release) {
    return {
      title: "Version Not Found"
    }
  }

  return {
    title: `dev3000 ${version} Changelog`,
    description: `Release notes for dev3000 ${version}.`,
    openGraph: {
      title: `dev3000 ${version} - AI-Powered Development Tools`,
      description: `New release: dev3000 ${version}`,
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
      description: `New release: dev3000 ${version}`,
      images: [`/api/og/changelog/${version}`]
    }
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
  const release = changelog.find((r) => `v${r.version}` === version || r.version === version)

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
        <p className="text-lg text-foreground-secondary mb-4">dev3000 Release Notes</p>
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
              {release.highlights.map((highlight) => (
                <li
                  key={`highlight-${release.version}-${slugify(highlight) || highlight}`}
                  className="flex items-start gap-3"
                >
                  <div className="w-2 h-2 bg-primary rounded-full mt-2 flex-shrink-0" />
                  <span className="text-foreground leading-relaxed">{parseMarkdown(highlight)}</span>
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
