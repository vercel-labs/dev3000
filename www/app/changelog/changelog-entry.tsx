import { Bug, Github, Package, Sparkles, Zap } from "lucide-react"
import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import type { Release } from "@/lib/changelog"
import { parseMarkdown } from "@/lib/utils"

const slugify = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")

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

interface ChangelogEntryProps {
  release: Release
  isLatest: boolean
}

export function ChangelogEntry({ release, isLatest }: ChangelogEntryProps) {
  return (
    <Card className="bg-card/50 backdrop-blur-sm border-2 border-gray-700/40 card-hover shadow-lg">
      <div className="p-6">
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4 mb-4">
          <div className="flex items-center gap-3">
            {getVersionTypeIcon(release.type)}
            <div>
              <Link href={`/changelog/v${release.version}`}>
                <h2 className="text-xl font-bold flex items-center gap-2 hover:text-primary transition-colors">
                  Version {release.version}
                  {isLatest && <Badge className="bg-green-400/20 text-green-400 border-green-400/30">Latest</Badge>}
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
  )
}
