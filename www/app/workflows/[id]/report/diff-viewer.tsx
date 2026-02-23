"use client"

import { PatchDiff } from "@pierre/diffs/react"
import { useMemo } from "react"

interface DiffViewerProps {
  patch: string
}

function splitPatchByFile(patch: string): string[] {
  const normalized = patch.replace(/\r\n/g, "\n")
  const lines = normalized.split("\n")
  const fileStartIndexes: number[] = []

  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].startsWith("diff --git ")) {
      fileStartIndexes.push(i)
    }
  }

  if (fileStartIndexes.length === 0) {
    return [normalized]
  }

  const chunks: string[] = []
  for (let i = 0; i < fileStartIndexes.length; i += 1) {
    const start = fileStartIndexes[i]
    const end = fileStartIndexes[i + 1] ?? lines.length
    const chunk = lines.slice(start, end).join("\n").trim()
    if (chunk) chunks.push(chunk)
  }
  return chunks.length > 0 ? chunks : [normalized]
}

function getPatchLabel(filePatch: string, index: number): string {
  const firstLine = filePatch.split("\n", 1)[0] || ""
  const match = firstLine.match(/^diff --git a\/(.+?) b\/(.+)$/)
  if (match) return match[2]
  return `File ${index + 1}`
}

export function DiffViewer({ patch }: DiffViewerProps) {
  const filePatches = useMemo(() => splitPatchByFile(patch), [patch])

  return (
    <div className="space-y-4">
      {filePatches.map((filePatch, index) => (
        <div key={`${getPatchLabel(filePatch, index)}-${index}`} className="space-y-2">
          {filePatches.length > 1 && <div className="text-xs font-medium text-muted-foreground">{getPatchLabel(filePatch, index)}</div>}
          <PatchDiff
            patch={filePatch}
            options={{
              diffStyle: "split",
              lineDiffType: "word-alt",
              overflow: "wrap",
              hunkSeparators: "line-info"
            }}
            className="rounded-md border border-border bg-muted/10"
          />
        </div>
      ))}
    </div>
  )
}
