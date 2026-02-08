"use client"

import dynamic from "next/dynamic"
import Link from "next/link"
import { useEffect, useState } from "react"

const TerminalRecordingClient = dynamic(() => import("./terminal-recording"), {
  ssr: false,
  loading: () => <div className="w-full h-[420px] rounded-md bg-muted/30" />
})

export function TerminalRecording() {
  return <TerminalRecordingClient />
}

export function CurrentYear() {
  return <>{new Date().getFullYear()}</>
}

export function ChangelogLink({ enableCLSBug = false }: { enableCLSBug?: boolean }) {
  if (!enableCLSBug) {
    return (
      <Link
        href="/changelog"
        prefetch={false}
        className="text-sm text-muted-foreground hover:text-foreground hover:underline transition-colors inline-block min-w-[88px]"
      >
        Changelog
      </Link>
    )
  }

  return <ChangelogLinkWithCLSBug />
}

function ChangelogLinkWithCLSBug() {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Intentional: hydration detection pattern
    setMounted(true)
  }, [])

  // CLS BUG (demo mode only): Server renders null, client renders link after hydration
  // This causes the link to pop in, shifting the nav layout
  if (!mounted) {
    return null
  }

  return (
    <Link
      href="/changelog"
      prefetch={false}
      className="text-sm text-muted-foreground hover:text-foreground hover:underline transition-colors inline-block min-w-[88px]"
    >
      Changelog
    </Link>
  )
}
