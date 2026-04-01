import { Skeleton } from "@/components/ui/skeleton"

export default function LoadingReport() {
  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto max-w-5xl px-4 py-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-3 min-w-[220px]">
            <Skeleton className="h-9 w-72" />
            <Skeleton className="h-5 w-56" />
            <Skeleton className="h-4 w-44" />
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-9 w-28" />
            <Skeleton className="h-9 w-12" />
          </div>
        </div>
        <div className="mt-8 grid gap-4">
          <Skeleton className="h-28 rounded-lg" />
          <Skeleton className="h-40 rounded-lg" />
          <Skeleton className="h-40 rounded-lg" />
        </div>
      </div>
    </div>
  )
}
