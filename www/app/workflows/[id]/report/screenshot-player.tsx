"use client"

import { Pause, Play, SkipBack, SkipForward } from "lucide-react"
import Image from "next/image"
import { useCallback, useEffect, useState } from "react"

interface Screenshot {
  timestamp: number
  blobUrl: string
  label?: string
}

interface ScreenshotPlayerProps {
  screenshots: Screenshot[]
  title?: string
  autoPlay?: boolean
  fps?: number
  loop?: boolean
  loopDelayMs?: number // Pause at end before looping (default: 10000ms)
}

export function ScreenshotPlayer({
  screenshots,
  title,
  autoPlay = true,
  fps = 8,
  loop = true,
  loopDelayMs = 10000
}: ScreenshotPlayerProps) {
  const [currentFrame, setCurrentFrame] = useState(0)
  const [isPlaying, setIsPlaying] = useState(autoPlay)
  const [isPausedAtEnd, setIsPausedAtEnd] = useState(false)

  // Sort screenshots by timestamp
  const sortedScreenshots = [...screenshots].sort((a, b) => a.timestamp - b.timestamp)

  const nextFrame = useCallback(() => {
    setCurrentFrame((prev) => {
      if (prev >= sortedScreenshots.length - 1) {
        if (loop) {
          // Pause at end before looping
          setIsPausedAtEnd(true)
          return prev
        }
        setIsPlaying(false)
        return prev
      }
      return prev + 1
    })
  }, [sortedScreenshots.length, loop])

  const prevFrame = useCallback(() => {
    setCurrentFrame((prev) => {
      if (prev <= 0) {
        return loop ? sortedScreenshots.length - 1 : 0
      }
      return prev - 1
    })
  }, [sortedScreenshots.length, loop])

  // Handle loop delay - wait at end then restart
  useEffect(() => {
    if (!isPausedAtEnd || !isPlaying) return

    const timeout = setTimeout(() => {
      setCurrentFrame(0)
      setIsPausedAtEnd(false)
    }, loopDelayMs)

    return () => clearTimeout(timeout)
  }, [isPausedAtEnd, isPlaying, loopDelayMs])

  useEffect(() => {
    if (!isPlaying || sortedScreenshots.length === 0 || isPausedAtEnd) return

    const interval = setInterval(nextFrame, 1000 / fps)
    return () => clearInterval(interval)
  }, [isPlaying, sortedScreenshots.length, fps, nextFrame, isPausedAtEnd])

  if (sortedScreenshots.length === 0) {
    return <div className="bg-muted/30 rounded-lg p-8 text-center text-muted-foreground">No screenshots available</div>
  }

  const currentScreenshot = sortedScreenshots[currentFrame]
  const hasMultipleFrames = sortedScreenshots.length > 1

  return (
    <div className="bg-muted/30 rounded-lg overflow-hidden">
      {title && (
        <div className="px-3 py-2 border-b border-border bg-muted/50">
          <span className="text-xs text-muted-foreground uppercase tracking-wide">{title}</span>
        </div>
      )}

      {/* Screenshot display */}
      <a href={currentScreenshot.blobUrl} target="_blank" rel="noopener noreferrer" className="block">
        <div className="relative aspect-video bg-black">
          <Image
            src={currentScreenshot.blobUrl}
            alt={currentScreenshot.label || `Frame ${currentFrame + 1}`}
            fill
            unoptimized
            className="object-contain"
          />
        </div>
      </a>

      {/* Controls - only show for multiple frames */}
      {hasMultipleFrames && (
        <div className="flex items-center gap-2 px-3 py-2 bg-muted/50">
          <button
            type="button"
            onClick={prevFrame}
            className="p-1 hover:bg-muted rounded transition-colors"
            title="Previous frame"
          >
            <SkipBack className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={() => setIsPlaying(!isPlaying)}
            className="p-1 hover:bg-muted rounded transition-colors"
            title={isPlaying ? "Pause" : "Play"}
          >
            {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </button>

          <button
            type="button"
            onClick={nextFrame}
            className="p-1 hover:bg-muted rounded transition-colors"
            title="Next frame"
          >
            <SkipForward className="h-4 w-4" />
          </button>

          <span className="flex-1 text-center text-xs text-muted-foreground">
            {currentFrame + 1} / {sortedScreenshots.length}
            {currentScreenshot.timestamp > 0 && <span className="ml-2">({currentScreenshot.timestamp}ms)</span>}
          </span>
        </div>
      )}
    </div>
  )
}
