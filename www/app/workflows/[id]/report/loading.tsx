import { ArrowLeft } from "lucide-react"

export default function LoadingReport() {
  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <div className="flex flex-wrap items-center gap-3 mb-6">
          <a
            href="/workflows"
            className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="font-semibold">d3k</span>
          </a>
          <span className="text-muted-foreground">/</span>
          <span className="text-muted-foreground">Workflow Report</span>
          <span className="inline-flex items-center gap-2 rounded-full border border-border px-2 py-0.5 text-xs font-medium text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse" />
            Streaming report…
          </span>
        </div>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-3 min-w-[220px]">
            <div className="h-9 w-72 bg-muted/40 rounded-md" />
            <div className="h-4 w-44 bg-muted/30 rounded-md" />
          </div>
          <div className="flex gap-2">
            <div className="h-9 w-28 bg-muted/30 rounded-md" />
            <div className="h-9 w-32 bg-muted/40 rounded-md" />
          </div>
        </div>
        <div className="mt-8 grid gap-4">
          <div className="h-28 bg-muted/20 rounded-lg" />
          <div className="h-40 bg-muted/20 rounded-lg" />
          <div className="h-40 bg-muted/20 rounded-lg" />
        </div>
      </div>
    </div>
  )
}
