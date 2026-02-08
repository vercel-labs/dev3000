"use client"

import dynamic from "next/dynamic"
import { useEffect, useState } from "react"

type IdleCallback = (deadline: { didTimeout: boolean; timeRemaining: () => number }) => void
type IdleCallbackHandle = number

const Analytics = dynamic(() => import("@vercel/analytics/next").then((mod) => mod.Analytics), { ssr: false })
const SpeedInsights = dynamic(() => import("@vercel/speed-insights/next").then((mod) => mod.SpeedInsights), {
  ssr: false
})
const VercelToolbar = dynamic(() => import("@vercel/toolbar/next").then((mod) => mod.VercelToolbar), {
  ssr: false
})

export function AnalyticsTools() {
  const [shouldRender, setShouldRender] = useState(false)

  useEffect(() => {
    const root = globalThis as typeof globalThis & {
      requestIdleCallback?: (callback: IdleCallback, options?: { timeout: number }) => IdleCallbackHandle
      cancelIdleCallback?: (handle: IdleCallbackHandle) => void
    }

    if (typeof root.requestIdleCallback === "function") {
      const idleId = root.requestIdleCallback(() => setShouldRender(true), { timeout: 2000 })
      return () => root.cancelIdleCallback?.(idleId)
    }

    const timeoutId = setTimeout(() => setShouldRender(true), 200)
    return () => clearTimeout(timeoutId)
  }, [])

  if (!shouldRender) return null

  return (
    <>
      <Analytics />
      <SpeedInsights />
      {process.env.NODE_ENV === "development" && <VercelToolbar />}
    </>
  )
}
