import { Skeleton } from "@/components/ui/skeleton"

export default function WorkflowsLoading() {
  return (
    <div className="h-screen flex flex-col bg-background">
      <div className="flex-shrink-0 px-4 sm:px-6 lg:px-8 pt-8 pb-4 max-w-7xl mx-auto w-full">
        <div className="flex justify-between items-start">
          <div className="space-y-2">
            <Skeleton className="h-9 w-72" />
            <Skeleton className="h-5 w-96" />
            <Skeleton className="h-4 w-48" />
          </div>
          <div className="flex gap-3">
            <Skeleton className="h-10 w-32" />
            <Skeleton className="h-10 w-24" />
          </div>
        </div>
      </div>
      <div className="flex-1 min-h-0 px-4 sm:px-6 lg:px-8 pb-8 max-w-7xl mx-auto w-full">
        <div className="h-full rounded-lg border border-border bg-card p-4 space-y-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      </div>
    </div>
  )
}
