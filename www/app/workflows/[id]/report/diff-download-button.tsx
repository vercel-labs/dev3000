"use client"

import { Download } from "lucide-react"

interface DiffDownloadButtonProps {
  diff: string
  projectName: string
}

export function DiffDownloadButton({ diff, projectName }: DiffDownloadButtonProps) {
  const handleDownload = () => {
    // Create a clean filename from the project name
    const cleanName = projectName.replace(/[^a-zA-Z0-9-_]/g, "-").toLowerCase()
    const filename = `d3k-fix-${cleanName}.diff`

    // Create blob and download
    const blob = new Blob([diff], { type: "text/plain" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  return (
    <button
      type="button"
      onClick={handleDownload}
      className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors text-sm font-medium"
    >
      <Download className="h-4 w-4" />
      Download d3k-fix.diff
    </button>
  )
}
