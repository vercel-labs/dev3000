"use client"

import { useEffect } from "react"

export function BrowserTracing() {
  useEffect(() => {
    // Lazy-load to avoid SSR issues and keep initial bundle small
    import("@/lib/browser-tracing")
      .then(({ initBrowserTracing }) => {
        initBrowserTracing()
      })
      .catch((err) => {
        // Non-fatal: browser tracing is observability, not functionality
        console.warn("[BrowserTracing] Failed to initialize:", err)
      })
  }, [])

  return null
}
