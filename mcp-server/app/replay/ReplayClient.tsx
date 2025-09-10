"use client"

import { useEffect, useState } from "react"

interface InteractionEvent {
  timestamp: string
  type: "CLICK" | "TAP" | "SCROLL" | "KEY"
  x?: number
  y?: number
  target?: string
  direction?: string
  distance?: number
  key?: string
}

interface NavigationEvent {
  timestamp: string
  url: string
}

interface ScreenshotEvent {
  timestamp: string
  url: string
  event: string
}

interface ReplayData {
  interactions: InteractionEvent[]
  navigations: NavigationEvent[]
  screenshots: ScreenshotEvent[]
  startTime: string
  endTime: string
  duration: number
}

export default function ReplayClient() {
  const [replayData, setReplayData] = useState<ReplayData | null>(null)
  const [loading, setLoading] = useState(false)
  const [selectedTimeRange, _setSelectedTimeRange] = useState<{
    start: string
    end: string
  } | null>(null)
  const [playbackSpeed, setPlaybackSpeed] = useState(1)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentEventIndex, setCurrentEventIndex] = useState(0)

  const loadReplayData = async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ action: "parse" })
      if (selectedTimeRange) {
        params.set("startTime", selectedTimeRange.start)
        params.set("endTime", selectedTimeRange.end)
      }

      const response = await fetch(`/api/replay?${params}`)
      const data = await response.json()

      if (response.ok) {
        setReplayData(data)
      } else {
        console.error("Failed to load replay data:", data.error)
      }
    } catch (error) {
      console.error("Error loading replay data:", error)
    }
    setLoading(false)
  }

  useEffect(() => {
    loadReplayData()
  }, [loadReplayData])

  const allEvents = replayData
    ? [
        ...replayData.interactions.map((i) => ({ ...i, eventType: "interaction" as const })),
        ...replayData.navigations.map((n) => ({ ...n, eventType: "navigation" as const }))
      ].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
    : []

  const formatTimestamp = (timestamp: string) => {
    return new Date(timestamp).toLocaleTimeString()
  }

  const formatDuration = (ms: number) => {
    const seconds = Math.floor(ms / 1000)
    const minutes = Math.floor(seconds / 60)
    return `${minutes}m ${seconds % 60}s`
  }

  const startReplay = async () => {
    if (!replayData) return

    setIsPlaying(true)
    setCurrentEventIndex(0)

    // This is a simplified preview - in a full implementation,
    // this would actually control a browser session
    for (let i = 0; i < allEvents.length; i++) {
      if (!isPlaying) break

      setCurrentEventIndex(i)

      const event = allEvents[i]
      const nextEvent = allEvents[i + 1]

      if (nextEvent) {
        const currentTime = new Date(event.timestamp).getTime()
        const nextTime = new Date(nextEvent.timestamp).getTime()
        const delay = (nextTime - currentTime) / playbackSpeed

        await new Promise((resolve) => setTimeout(resolve, Math.min(delay, 5000))) // Cap at 5s
      }
    }

    setIsPlaying(false)
  }

  const stopReplay = () => {
    setIsPlaying(false)
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          <div className="text-gray-500 text-sm mt-4">Loading replay data...</div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <h1 className="text-2xl font-bold text-gray-900">Session Replay</h1>
              {replayData && (
                <div className="flex items-center gap-4 text-sm text-gray-600">
                  <span>{replayData.interactions.length} interactions</span>
                  <span>{replayData.navigations.length} navigations</span>
                  <span>{replayData.screenshots.length} screenshots</span>
                  <span>{formatDuration(replayData.duration)} duration</span>
                </div>
              )}
            </div>

            <div className="flex items-center gap-2">
              <select
                value={playbackSpeed}
                onChange={(e) => setPlaybackSpeed(Number(e.target.value))}
                className="px-3 py-1 border border-gray-300 rounded text-sm"
              >
                <option value={0.5}>0.5x</option>
                <option value={1}>1x</option>
                <option value={2}>2x</option>
                <option value={4}>4x</option>
                <option value={8}>8x</option>
              </select>

              {!isPlaying ? (
                <button
                  type="button"
                  onClick={startReplay}
                  disabled={!replayData || allEvents.length === 0}
                  className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  ▶ Play
                </button>
              ) : (
                <button
                  type="button"
                  onClick={stopReplay}
                  className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
                >
                  ⏹ Stop
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6">
        {!replayData ? (
          <div className="text-center py-12">
            <div className="text-gray-400 text-lg">No replay data available</div>
            <div className="text-gray-500 text-sm mt-2">Start using your app to generate interaction data</div>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Timeline */}
            <div className="bg-white rounded-lg shadow-sm border">
              <div className="px-4 py-3 border-b">
                <h2 className="font-semibold text-gray-900">Event Timeline</h2>
              </div>
              <div className="max-h-96 overflow-y-auto">
                {allEvents.map((event, index) => (
                  <div
                    key={`${event.timestamp}-${index}`}
                    className={`px-4 py-2 border-b last:border-b-0 ${
                      index === currentEventIndex ? "bg-blue-50 border-blue-200" : ""
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono text-gray-500">{formatTimestamp(event.timestamp)}</span>
                        <span
                          className={`px-2 py-1 rounded text-xs font-medium ${
                            event.eventType === "navigation"
                              ? "bg-purple-100 text-purple-800"
                              : event.type === "CLICK"
                                ? "bg-green-100 text-green-800"
                                : event.type === "SCROLL"
                                  ? "bg-yellow-100 text-yellow-800"
                                  : "bg-gray-100 text-gray-800"
                          }`}
                        >
                          {event.eventType === "navigation" ? "NAV" : event.type}
                        </span>
                      </div>
                      {isPlaying && index === currentEventIndex && (
                        <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
                      )}
                    </div>
                    <div className="mt-1 text-sm text-gray-700">
                      {event.eventType === "navigation" ? (
                        <span>→ {event.url}</span>
                      ) : event.type === "CLICK" || event.type === "TAP" ? (
                        <span>
                          ({event.x}, {event.y}) on {event.target}
                        </span>
                      ) : event.type === "SCROLL" ? (
                        <span>
                          {event.direction} {event.distance}px to ({event.x}, {event.y})
                        </span>
                      ) : event.type === "KEY" ? (
                        <span>
                          "{event.key}" in {event.target}
                        </span>
                      ) : (
                        <span>{JSON.stringify(event)}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Screenshots */}
            <div className="bg-white rounded-lg shadow-sm border">
              <div className="px-4 py-3 border-b">
                <h2 className="font-semibold text-gray-900">Screenshots</h2>
              </div>
              <div className="max-h-96 overflow-y-auto">
                {replayData.screenshots.map((screenshot, index) => (
                  <div
                    key={`${screenshot.timestamp}-${screenshot.event}-${index}`}
                    className="px-4 py-2 border-b last:border-b-0"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-mono text-gray-500">{formatTimestamp(screenshot.timestamp)}</span>
                      <span className="text-xs text-gray-600">{screenshot.event}</span>
                    </div>
                    <img
                      src={screenshot.url}
                      alt={`Screenshot: ${screenshot.event}`}
                      className="w-full rounded border"
                      style={{ maxHeight: "200px", objectFit: "contain" }}
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
