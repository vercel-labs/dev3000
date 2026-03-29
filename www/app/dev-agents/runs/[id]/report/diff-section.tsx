"use client"

import { ChevronRight, Download } from "lucide-react"
import { useState } from "react"
import { DiffViewer } from "./diff-viewer"

interface DiffSectionProps {
  patch: string
  prDiffUrl?: string
  inlineDiffUrl?: string
}

export function DiffSection({ patch, prDiffUrl, inlineDiffUrl }: DiffSectionProps) {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <div className="mt-6">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
        <button
          type="button"
          onClick={() => setIsOpen((open) => !open)}
          className="inline-flex items-center gap-2 text-sm hover:text-foreground text-muted-foreground"
        >
          <span className="font-medium inline-flex items-center gap-2">
            <ChevronRight className={`h-4 w-4 transition-transform ${isOpen ? "rotate-90" : ""}`} />
            Diff
          </span>
        </button>
        {prDiffUrl ? (
          <a
            href={prDiffUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs border border-border rounded hover:bg-muted/60 transition-colors"
            title="Download PR diff"
          >
            <Download className="h-3.5 w-3.5" />
            Download
          </a>
        ) : inlineDiffUrl ? (
          <a
            href={inlineDiffUrl}
            download="changes.diff"
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs border border-border rounded hover:bg-muted/60 transition-colors"
            title="Download generated diff"
          >
            <Download className="h-3.5 w-3.5" />
            Download
          </a>
        ) : null}
      </div>

      {isOpen && (
        <div className="mt-3 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-muted-foreground">{patch.split("\n").length.toLocaleString()} lines</span>
          </div>
          <DiffViewer patch={patch} />
        </div>
      )}
    </div>
  )
}
