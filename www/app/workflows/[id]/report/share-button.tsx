"use client"

import { Check, Link as LinkIcon, Lock, Share2 } from "lucide-react"
import { useEffect, useRef, useState } from "react"

interface ShareButtonProps {
  runId: string
  initialIsPublic: boolean
}

export function ShareButton({ runId, initialIsPublic }: ShareButtonProps) {
  const [isPublic, setIsPublic] = useState(initialIsPublic)
  const [isLoading, setIsLoading] = useState(false)
  const [showCopied, setShowCopied] = useState(false)
  const detailsRef = useRef<HTMLDetailsElement>(null)

  const setPublicStatus = async (nextIsPublic: boolean) => {
    setIsLoading(true)
    try {
      const response = await fetch(`/api/workflows/${runId}/public`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isPublic: nextIsPublic })
      })

      if (response.ok) {
        setIsPublic(nextIsPublic)
        return true
      }
    } catch (error) {
      console.error("Failed to toggle public status:", error)
    } finally {
      setIsLoading(false)
    }
    return false
  }

  const copyLink = async () => {
    const url = window.location.href
    await navigator.clipboard.writeText(url)
    setShowCopied(true)
    setTimeout(() => setShowCopied(false), 2000)
  }

  const closeMenu = () => {
    detailsRef.current?.removeAttribute("open")
  }

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      const root = detailsRef.current
      if (!root) return
      if (!root.open) return
      const target = event.target
      if (target instanceof Node && !root.contains(target)) {
        closeMenu()
      }
    }

    document.addEventListener("mousedown", handleOutsideClick)
    return () => document.removeEventListener("mousedown", handleOutsideClick)
  }, [])

  const handlePublicClick = async () => {
    if (isPublic) {
      await copyLink()
      return
    }
    const updated = await setPublicStatus(true)
    if (updated) closeMenu()
  }

  const handlePrivateClick = async () => {
    const updated = await setPublicStatus(false)
    if (updated) closeMenu()
  }

  return (
    <details ref={detailsRef} className="relative">
      <summary
        className={`list-none inline-flex items-center gap-2 px-3 py-2 text-sm border rounded-md cursor-pointer transition-colors ${
          isPublic
            ? "border-green-300 bg-green-50 text-green-700 hover:bg-green-100 dark:border-green-700 dark:bg-green-950 dark:text-green-300 dark:hover:bg-green-900"
            : "border-border hover:bg-muted"
        } ${isLoading ? "opacity-50 pointer-events-none" : ""}`}
      >
        {showCopied ? <Check className="h-4 w-4" /> : <Share2 className="h-4 w-4" />}
        <span>{showCopied ? "Copied!" : "Share"}</span>
      </summary>
      <div className="absolute right-0 mt-1 w-fit min-w-[9rem] rounded-md border border-border bg-card shadow-lg p-1 z-20">
        <button
          type="button"
          onClick={handlePublicClick}
          disabled={isLoading}
          className="w-full whitespace-nowrap text-left px-2 py-1.5 text-sm rounded hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent active:bg-accent transition-colors disabled:opacity-50"
        >
          <span className="inline-flex items-center gap-1.5">
            {isPublic ? <LinkIcon className="h-3.5 w-3.5" /> : <Share2 className="h-3.5 w-3.5" />}
            {isPublic ? "Copy link" : "Make public"}
          </span>
        </button>
        <button
          type="button"
          onClick={handlePrivateClick}
          disabled={!isPublic || isLoading}
          className="w-full whitespace-nowrap text-left px-2 py-1.5 text-sm rounded hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent active:bg-accent transition-colors disabled:opacity-50"
        >
          <span className="inline-flex items-center gap-1.5">
            <Lock className="h-3.5 w-3.5" />
            Private
          </span>
        </button>
      </div>
    </details>
  )
}
