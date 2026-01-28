import { Calendar, Github, Package } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"

export function CalendarIcon({ className }: { className?: string }) {
  return <Calendar className={className} />
}

export function NpmButton() {
  return (
    <Button variant="outline" className="border-gray-600/50" asChild>
      <a href="https://www.npmjs.com/package/dev3000" target="_blank" rel="noopener noreferrer">
        <Package className="w-4 h-4 mr-2" />
        View on npm
      </a>
    </Button>
  )
}

export function ViewAllReleasesCard() {
  return (
    <Card className="bg-card/30 backdrop-blur-sm border-2 border-gray-700/40 p-6">
      <p className="text-muted-foreground mb-4">Want to see the complete version history?</p>
      <Button variant="outline" className="border-gray-600/50" asChild>
        <a href="https://github.com/vercel-labs/dev3000/releases" target="_blank" rel="noopener noreferrer">
          <Github className="w-4 h-4 mr-2" />
          View All Releases on GitHub
        </a>
      </Button>
    </Card>
  )
}
