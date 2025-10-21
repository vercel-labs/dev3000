import { Bug, Calendar, Github, Package, Sparkles, Zap } from "lucide-react"
import type { Metadata } from "next"
import { cacheLife, cacheTag } from "next/cache"
import Link from "next/link"
import { GitHubLink } from "@/components/github-link"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { changelog } from "@/lib/changelog"
import { parseMarkdown } from "@/lib/utils"

const slugify = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")

// Get the latest release for metadata
const latestRelease = changelog[0]

export const metadata: Metadata = {
  title: `dev3000 Changelog - v${latestRelease.version}`,
  description: `Latest updates and features in dev3000 v${
    latestRelease.version
  }: ${latestRelease.highlights.slice(0, 2).join(", ")}${latestRelease.highlights.length > 2 ? ", and more" : ""}.`,
  openGraph: {
    title: `dev3000 v${latestRelease.version} - AI-Powered Development Tools`,
    description: `New release: ${latestRelease.highlights
      .slice(0, 3)
      .join(" • ")}${latestRelease.highlights.length > 3 ? " and more" : ""}.`,
    type: "website",
    images: [
      {
        url: "/api/og/changelog/latest",
        width: 1200,
        height: 630,
        alt: `dev3000 v${latestRelease.version} changelog`
      }
    ]
  },
  twitter: {
    card: "summary_large_image",
    title: `dev3000 v${latestRelease.version} - Changelog`,
    description: `Latest features: ${latestRelease.highlights
      .slice(0, 2)
      .join(" • ")}${latestRelease.highlights.length > 2 ? " and more" : ""}.`,
    images: ["/api/og/changelog/latest"]
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
      return <Badge className="bg-yellow-400/20 text-yellow-400 border-yellow-400/30">Major</Badge>
    case "minor":
      return <Badge className="bg-blue-400/20 text-blue-400 border-blue-400/30">Minor</Badge>
    case "patch":
      return <Badge className="bg-green-400/20 text-green-400 border-green-400/30">Patch</Badge>
    default:
      return <Badge variant="secondary">Release</Badge>
  }
}

export default async function ChangelogPage() {
  "use cache"
  cacheLife("hours")
  cacheTag("changelog")

  return (
    <div className="min-h-screen bg-background">
      {/* Grid Pattern Background */}
      <div className="absolute inset-0 grid-pattern opacity-50" />

      {/* Header */}
      <header className="relative border-b border-border/40">
        <div className="container mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Link href="/" className="flex items-center gap-2">
                <div className="w-8 h-8 bg-foreground rounded flex items-center justify-center">
                  <span className="text-background font-mono font-bold text-sm">d3k</span>
                </div>
                <span className="font-semibold text-xl">dev3000</span>
              </Link>
              <Badge variant="secondary" className="ml-2">
                Changelog
              </Badge>
            </div>
            <nav className="flex items-center gap-4">
              <GitHubLink />
            </nav>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative py-8 md:py-12 border-b border-gray-700/30">
        <div className="container mx-auto px-4 text-center">
          <div className="max-w-3xl mx-auto">
            <div className="flex items-center justify-center gap-2 mb-4">
              <Calendar className="w-6 h-6 text-blue-400" />
              <h1 className="text-3xl md:text-4xl font-bold">Changelog</h1>
            </div>
            <p className="text-base text-muted-foreground mb-6 text-pretty leading-relaxed">
              Track the latest updates, features, and improvements to dev3000. We&apos;re continuously enhancing the
              AI-powered debugging experience.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center items-center">
              <Button variant="outline" className="border-gray-600/50" asChild>
                <Link href="/">← Back to Home</Link>
              </Button>
              <Button variant="outline" className="border-gray-600/50" asChild>
                <a href="https://www.npmjs.com/package/dev3000" target="_blank" rel="noopener noreferrer">
                  <Package className="w-4 h-4 mr-2" />
                  View on npm
                </a>
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Changelog Entries */}
      <section className="relative py-8">
        <div className="container mx-auto px-4">
          <div className="max-w-4xl mx-auto">
            <div className="space-y-6">
              {changelog.map((release, index) => (
                <Card
                  key={`${release.version}-${release.date}`}
                  className="bg-card/50 backdrop-blur-sm border-2 border-gray-700/40 card-hover shadow-lg"
                >
                  <div className="p-6">
                    <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4 mb-4">
                      <div className="flex items-center gap-3">
                        {getVersionTypeIcon(release.type)}
                        <div>
                          <Link href={`/changelog/v${release.version}`}>
                            <h2 className="text-xl font-bold flex items-center gap-2 hover:text-primary transition-colors">
                              Version {release.version}
                              {index === 0 && (
                                <Badge className="bg-green-400/20 text-green-400 border-green-400/30">Latest</Badge>
                              )}
                            </h2>
                          </Link>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-sm text-muted-foreground">{release.date}</span>
                            {getVersionTypeBadge(release.type)}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <div>
                        <h3 className="font-semibold text-sm mb-3">Key Highlights:</h3>
                        <ul className="space-y-2">
                          {release.highlights.map((highlight) => (
                            <li
                              key={`highlight-${release.version}-${slugify(highlight) || highlight}`}
                              className="flex items-start gap-3 text-sm"
                            >
                              <div className="w-1.5 h-1.5 bg-blue-400 rounded-full mt-2 flex-shrink-0" />
                              <span className="text-foreground leading-relaxed">{parseMarkdown(highlight)}</span>
                            </li>
                          ))}
                        </ul>
                      </div>

                      <div className="pt-4 flex items-center justify-between border-t border-border/40">
                        <Link href={`/changelog/v${release.version}`}>
                          <Button variant="ghost" size="sm" className="gap-2">
                            View Full Release Notes →
                          </Button>
                        </Link>
                        <Link
                          href={`https://github.com/vercel-labs/dev3000/releases/tag/v${release.version}`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <Button variant="ghost" size="sm" className="gap-2 text-muted-foreground">
                            <Github className="w-4 h-4" />
                            GitHub
                          </Button>
                        </Link>
                      </div>
                    </div>
                  </div>
                </Card>
              ))}
            </div>

            {/* More Versions Available */}
            <div className="mt-8 text-center">
              <Card className="bg-card/30 backdrop-blur-sm border-2 border-gray-700/40 p-6">
                <p className="text-muted-foreground mb-4">Want to see the complete version history?</p>
                <Button variant="outline" className="border-gray-600/50" asChild>
                  <a href="https://github.com/vercel-labs/dev3000/releases" target="_blank" rel="noopener noreferrer">
                    <Github className="w-4 h-4 mr-2" />
                    View All Releases on GitHub
                  </a>
                </Button>
              </Card>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative border-t border-border/40 py-6">
        <div className="container mx-auto px-4">
          <div className="flex flex-col md:flex-row justify-between items-center gap-4">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-foreground rounded-md flex items-center justify-center">
                <span className="text-background font-mono font-bold text-sm">d3k</span>
              </div>
              <div>
                <p className="font-semibold">dev3000</p>
                <p className="text-sm text-muted-foreground">By Vercel Labs</p>
              </div>
            </div>
            <div className="flex items-center gap-6">
              <Link
                href="/"
                className="text-sm text-muted-foreground hover:text-foreground hover:underline transition-colors"
              >
                Home
              </Link>
              <GitHubLink />
              <span className="text-sm text-muted-foreground">
                Made by{" "}
                <a href="https://github.com/elsigh" className="hover:text-foreground hover:underline transition-colors">
                  elsigh
                </a>
              </span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}
