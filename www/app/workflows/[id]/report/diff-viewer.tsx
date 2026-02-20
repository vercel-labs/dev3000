"use client"

import { PatchDiff } from "@pierre/diffs/react"

interface DiffViewerProps {
  patch: string
}

export function DiffViewer({ patch }: DiffViewerProps) {
  return (
    <PatchDiff
      patch={patch}
      options={{
        diffStyle: "split",
        lineDiffType: "word-alt",
        overflow: "wrap",
        hunkSeparators: "line-info"
      }}
      className="rounded-md border border-border bg-muted/10"
    />
  )
}

