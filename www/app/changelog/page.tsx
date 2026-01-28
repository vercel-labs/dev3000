import type { Metadata } from "next"
import { cacheLife, cacheTag } from "next/cache"
import Link from "next/link"
import { GitHubLink } from "@/components/github-link"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { changelog } from "@/lib/changelog"
import { ChangelogEntry } from "./changelog-entry"
import { CalendarIcon, NpmButton, ViewAllReleasesCard } from "./changelog-icons"

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
              <CalendarIcon className="w-6 h-6 text-blue-400" />
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
              <NpmButton />
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
                <ChangelogEntry key={`${release.version}-${release.date}`} release={release} isLatest={index === 0} />
              ))}
            </div>

            {/* More Versions Available */}
            <div className="mt-8 text-center">
              <ViewAllReleasesCard />
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
