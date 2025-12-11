"use client"

import { Check, Copy, Lock, Share2 } from "lucide-react"
import { useState } from "react"

interface ShareButtonProps {
  runId: string
  initialIsPublic: boolean
}

export function ShareButton({ runId, initialIsPublic }: ShareButtonProps) {
  const [isPublic, setIsPublic] = useState(initialIsPublic)
  const [isLoading, setIsLoading] = useState(false)
  const [showCopied, setShowCopied] = useState(false)

  const togglePublic = async () => {
    setIsLoading(true)
    try {
      const response = await fetch(`/api/workflows/${runId}/public`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isPublic: !isPublic })
      })

      if (response.ok) {
        setIsPublic(!isPublic)
      }
    } catch (error) {
      console.error("Failed to toggle public status:", error)
    } finally {
      setIsLoading(false)
    }
  }

  const copyLink = async () => {
    const url = window.location.href
    await navigator.clipboard.writeText(url)
    setShowCopied(true)
    setTimeout(() => setShowCopied(false), 2000)
  }

  return (
    <div className="flex items-center gap-2">
      {isPublic && (
        <button
          type="button"
          onClick={copyLink}
          className="inline-flex items-center gap-2 px-3 py-2 text-sm border border-border rounded-md hover:bg-muted transition-colors"
          title="Copy public link"
        >
          {showCopied ? (
            <>
              <Check className="h-4 w-4 text-green-600" />
              <span className="text-green-600">Copied!</span>
            </>
          ) : (
            <>
              <Copy className="h-4 w-4" />
              <span>Copy Link</span>
            </>
          )}
        </button>
      )}
      <button
        type="button"
        onClick={togglePublic}
        disabled={isLoading}
        className={`inline-flex items-center gap-2 px-3 py-2 text-sm border rounded-md transition-colors ${
          isPublic
            ? "border-green-300 bg-green-50 text-green-700 hover:bg-green-100 dark:border-green-700 dark:bg-green-950 dark:text-green-300 dark:hover:bg-green-900"
            : "border-border hover:bg-muted"
        } ${isLoading ? "opacity-50 cursor-not-allowed" : ""}`}
        title={isPublic ? "Make private" : "Make public"}
      >
        {isPublic ? (
          <>
            <Share2 className="h-4 w-4" />
            <span>Public</span>
          </>
        ) : (
          <>
            <Lock className="h-4 w-4" />
            <span>Private</span>
          </>
        )}
      </button>
    </div>
  )
}
