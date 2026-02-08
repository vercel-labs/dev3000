"use client"

import dynamic from "next/dynamic"
import Link from "next/link"

const TerminalRecordingClient = dynamic(() => import("./terminal-recording"), {
  ssr: false,
  loading: () => <div className="w-full rounded-md bg-muted/30" style={{ height: 420 }} />
})

export function TerminalRecording() {
  return <TerminalRecordingClient />
}

export function CurrentYear() {
  return <>{new Date().getFullYear()}</>
}

export function ChangelogLink() {
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
