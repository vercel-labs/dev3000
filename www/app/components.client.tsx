"use client"

import "asciinema-player/dist/bundle/asciinema-player.css"

import { useEffect, useRef } from "react"

export function TerminalRecording() {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (containerRef.current) {
      import("asciinema-player").then((AsciinemaPlayer) => {
        // biome-ignore lint/style/noNonNullAssertion: asciinema-player requires a non-null container
        AsciinemaPlayer.create("/demo.cast", containerRef.current!, {
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
      })
    }
  }, [])

  return <div ref={containerRef} />
}
