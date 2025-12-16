"use client"

import { useCallback, useState } from "react"
import { ScreenshotPlayer } from "./screenshot-player"

interface Screenshot {
  timestamp: number
  blobUrl: string
  label?: string
}

interface CoordinatedPlayersProps {
  beforeScreenshots: Screenshot[]
  afterScreenshots: Screenshot[]
  fps?: number
  loopDelayMs?: number
}

export function CoordinatedPlayers({
  beforeScreenshots,
  afterScreenshots,
  fps = 2,
  loopDelayMs = 10000
}: CoordinatedPlayersProps) {
  // Track if user has interacted - if so, disable coordination
  const [userInteracted, setUserInteracted] = useState(false)
  // Track if "After" should start playing
  const [afterCanPlay, setAfterCanPlay] = useState(false)

  // Called when "Before" completes its first full loop
  const handleBeforeLoopComplete = useCallback(() => {
    if (!userInteracted) {
      setAfterCanPlay(true)
    }
  }, [userInteracted])

  // Called when user interacts with either player
  const handleUserInteraction = useCallback(() => {
    setUserInteracted(true)
    setAfterCanPlay(true) // Let after play freely once user interacts
  }, [])

  return (
    <div className="grid grid-cols-2 gap-4">
      <ScreenshotPlayer
        screenshots={beforeScreenshots}
        title="Before Fix"
        autoPlay={true}
        fps={fps}
        loop={true}
        loopDelayMs={loopDelayMs}
        onLoopComplete={handleBeforeLoopComplete}
        onUserInteraction={handleUserInteraction}
      />
      <ScreenshotPlayer
        screenshots={afterScreenshots}
        title="After Fix"
        autoPlay={afterCanPlay}
        fps={fps}
        loop={true}
        loopDelayMs={loopDelayMs}
        onUserInteraction={handleUserInteraction}
      />
    </div>
  )
}
