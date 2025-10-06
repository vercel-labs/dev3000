"use client"

import Image from "next/image"
import { use, useEffect, useState } from "react"

export default function VideoPlayer({ params }: { params: Promise<{ session: string }> }) {
  const { session } = use(params)
  const [frames, setFrames] = useState<string[]>([])
  const [currentFrame, setCurrentFrame] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [fps, setFps] = useState(10)
  const [screenshotDimensions, setScreenshotDimensions] = useState<{ width: number; height: number }>({
    width: 1920,
    height: 1080
  })
  const [imgRef, setImgRef] = useState<HTMLImageElement | null>(null)
  const [clsMarkers, setClsMarkers] = useState<
    Array<{
      timestamp: number
      boundingBox: { x: number; y: number; width: number; height: number } | null
      clsScore?: number
      element?: string
    }>
  >([])

  useEffect(() => {
    // Parse session timestamp to find matching screenshots
    // Format: 2025-10-05T23-57-XX-jank-XXms.png
    fetch(`/api/screenshots/list?pattern=${session}`)
      .then((r) => r.json())
      .then((data) => {
        const jankFrames = data.files
          .filter((f: string) => f.includes("jank-") && f.includes(session))
          .sort((a: string, b: string) => {
            const aMs = parseInt(a.match(/jank-(\d+)ms/)?.[1] || "0", 10)
            const bMs = parseInt(b.match(/jank-(\d+)ms/)?.[1] || "0", 10)
            return aMs - bMs
          })
        setFrames(jankFrames)

        // Load first frame to get dimensions
        if (jankFrames.length > 0) {
          const img = new Image()
          img.onload = () => {
            setScreenshotDimensions({ width: img.naturalWidth, height: img.naturalHeight })
          }
          img.src = `/api/screenshots/${jankFrames[0]}`
        }
      })

    // Fetch CLS markers from jank detection API
    fetch(`/api/jank/${session}`)
      .then((r) => r.json())
      .then((data) => {
        setClsMarkers(data.clsMarkers || [])
      })
      .catch(() => {
        setClsMarkers([])
      })
  }, [session])

  useEffect(() => {
    if (!isPlaying || frames.length === 0) return

    const interval = setInterval(() => {
      setCurrentFrame((prev) => {
        if (prev >= frames.length - 1) {
          setIsPlaying(false)
          return prev
        }
        return prev + 1
      })
    }, 1000 / fps)

    return () => clearInterval(interval)
  }, [isPlaying, frames.length, fps])

  // Force re-render on window resize to recalculate bounding box position
  const [, forceUpdate] = useState(0)
  useEffect(() => {
    const handleResize = () => forceUpdate((n) => n + 1)
    window.addEventListener("resize", handleResize)
    return () => window.removeEventListener("resize", handleResize)
  }, [])

  if (frames.length === 0) {
    return <div className="p-8">Loading frames...</div>
  }

  const currentFrameFile = frames[currentFrame]
  const frameMs = currentFrameFile?.match(/jank-(\d+)ms/)?.[1] || "0"
  const currentFrameMs = parseInt(frameMs, 10)
  const clsAtFrame = clsMarkers.find((marker) => Math.abs(marker.timestamp - currentFrameMs) < 100)

  // Calculate the rendered image dimensions and position (accounting for object-contain)
  let imgStyle: React.CSSProperties = {}
  if (imgRef && clsAtFrame?.boundingBox) {
    const containerRect = imgRef.parentElement?.getBoundingClientRect()
    const imgNaturalWidth = screenshotDimensions.width
    const imgNaturalHeight = screenshotDimensions.height

    if (containerRect) {
      // Calculate how the image is scaled by object-contain
      const containerAspect = containerRect.width / containerRect.height
      const imageAspect = imgNaturalWidth / imgNaturalHeight

      let renderedWidth: number, renderedHeight: number, offsetX: number, offsetY: number

      if (containerAspect > imageAspect) {
        // Container is wider - image is constrained by height
        renderedHeight = containerRect.height
        renderedWidth = renderedHeight * imageAspect
        offsetX = (containerRect.width - renderedWidth) / 2
        offsetY = 0
      } else {
        // Container is taller - image is constrained by width
        renderedWidth = containerRect.width
        renderedHeight = renderedWidth / imageAspect
        offsetX = 0
        offsetY = (containerRect.height - renderedHeight) / 2
      }

      // Calculate bounding box position relative to rendered image
      const scale = renderedWidth / imgNaturalWidth
      imgStyle = {
        left: `${offsetX + clsAtFrame.boundingBox.x * scale}px`,
        top: `${offsetY + clsAtFrame.boundingBox.y * scale}px`,
        width: `${clsAtFrame.boundingBox.width * scale}px`,
        height: `${clsAtFrame.boundingBox.height * scale}px`
      }
    }
  }

  return (
    <div className="flex flex-col h-screen bg-black">
      <div className="flex-1 flex items-center justify-center relative overflow-hidden">
        <Image
          ref={setImgRef}
          src={`/api/screenshots/${currentFrameFile}`}
          alt={`Frame ${currentFrame}`}
          className="w-full h-full object-contain"
          fill
          unoptimized
        />
        {clsAtFrame?.boundingBox && imgRef && (
          <div className="absolute border-2 border-red-500 pointer-events-none" style={imgStyle} />
        )}
      </div>

      <div className="bg-gray-900 text-white p-4 space-y-4">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => setIsPlaying(!isPlaying)}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded"
          >
            {isPlaying ? "Pause" : "Play"}
          </button>

          <button
            type="button"
            onClick={() => setCurrentFrame(Math.max(0, currentFrame - 1))}
            disabled={currentFrame === 0}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded disabled:opacity-50"
          >
            Previous
          </button>

          <button
            type="button"
            onClick={() => setCurrentFrame(Math.min(frames.length - 1, currentFrame + 1))}
            disabled={currentFrame === frames.length - 1}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded disabled:opacity-50"
          >
            Next
          </button>

          <span className="flex-1 text-center">
            Frame {currentFrame + 1} / {frames.length} ({frameMs}ms)
          </span>

          <label className="flex items-center gap-2">
            Speed:
            <input
              type="range"
              min="1"
              max="30"
              value={fps}
              onChange={(e) => setFps(Number(e.target.value))}
              className="w-32"
            />
            <span className="w-12">{fps} fps</span>
          </label>
        </div>

        <div className="relative w-full">
          <input
            type="range"
            min="0"
            max={frames.length - 1}
            value={currentFrame}
            onChange={(e) => setCurrentFrame(Number(e.target.value))}
            className="w-full"
          />
          {/* CLS markers on timeline */}
          {clsMarkers.map((marker) => {
            const frameIndex = frames.findIndex((f) => {
              const frameMs = parseInt(f.match(/jank-(\d+)ms/)?.[1] || "0", 10)
              return frameMs >= marker.timestamp
            })
            if (frameIndex === -1) return null
            const position = (frameIndex / (frames.length - 1)) * 100
            return (
              <div
                key={marker.timestamp}
                className="absolute top-0 h-full pointer-events-none"
                style={{ left: `${position}%` }}
              >
                <div className="w-0.5 h-full bg-red-500" />
                <div className="absolute -top-6 left-0 -translate-x-1/2 bg-red-500 text-white text-xs px-2 py-0.5 rounded whitespace-nowrap">
                  {marker.clsScore ? (
                    <>
                      CLS {marker.clsScore.toFixed(4)} @ {marker.timestamp}ms
                      {marker.element && (
                        <span className="ml-1 opacity-75">&lt;{marker.element.toLowerCase()}&gt;</span>
                      )}
                    </>
                  ) : (
                    `CLS ${marker.timestamp}ms`
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
