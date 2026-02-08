"use client"

import dynamic from "next/dynamic"

const Analytics = dynamic(() => import("@vercel/analytics/next").then((mod) => mod.Analytics), { ssr: false })
const SpeedInsights = dynamic(() => import("@vercel/speed-insights/next").then((mod) => mod.SpeedInsights), {
  ssr: false
})
const VercelToolbar = dynamic(() => import("@vercel/toolbar/next").then((mod) => mod.VercelToolbar), {
  ssr: false
})

export function AnalyticsTools() {
  return (
    <>
      <Analytics />
      <SpeedInsights />
      {process.env.NODE_ENV === "development" && <VercelToolbar />}
    </>
  )
}
