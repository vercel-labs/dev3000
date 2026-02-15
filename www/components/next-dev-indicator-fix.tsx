"use client"

import { useEffect } from "react"

export function NextDevIndicatorFix() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return

    const apply = () => {
      const portal = document.querySelector("nextjs-portal")
      const shadowRoot = portal?.shadowRoot
      if (!shadowRoot) return

      const indicator = shadowRoot.querySelector<HTMLElement>("#devtools-indicator[data-nextjs-toast='true']")
      if (!indicator) return

      // Keep the Next.js dev badge clear of rounded window edges and safe areas.
      indicator.style.bottom = "max(28px, env(safe-area-inset-bottom))"
      indicator.style.left = "20px"
    }

    apply()
    const interval = window.setInterval(apply, 500)
    return () => window.clearInterval(interval)
  }, [])

  return null
}
