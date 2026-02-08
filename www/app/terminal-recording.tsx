"use client"

import { useEffect, useRef } from "react"

export default function TerminalRecording() {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    const container = containerRef.current

    const init = async () => {
      if (!container) return
      await import("asciinema-player/dist/bundle/asciinema-player.css")
      const AsciinemaPlayer = await import("asciinema-player")
      if (!container || cancelled) return

      // biome-ignore lint/style/noNonNullAssertion: asciinema-player requires a non-null container
      AsciinemaPlayer.create("/demo.cast", container!, {
        loop: true,
        autoPlay: true,
        speed: 2,
        // @ts-expect-error - this is a valid option
        markers: [
          [2.0, "Start dev3000"],
          [6.0, "Server Logs"],
          [11.0, "Browser Logs"],
          [15.0, "Browser Interactions"]
        ],
        terminalFontFamily: "var(--font-geist-mono)",
        terminalLineHeight: 1.15,
        theme: "vercel",
        controls: true
      })
    }

    void init()

    return () => {
      cancelled = true
      container?.replaceChildren()
    }
  }, [])

  return <div ref={containerRef} className="w-full min-h-[420px]" />
}
