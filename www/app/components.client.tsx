"use client"

import Link from "next/link"
import { useEffect, useState } from "react"

export function ChangelogLink({ enableCLSBug = false }: { enableCLSBug?: boolean }) {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Intentional: hydration detection pattern
    setMounted(true)
  }, [])

  // CLS BUG (demo mode only): Server renders null, client renders link after hydration
  // This causes the link to pop in, shifting the nav layout
  // When enableCLSBug is false, we render a placeholder to prevent the shift
  if (!mounted) {
    return enableCLSBug ? null : (
      <span className="text-sm text-muted-foreground invisible" aria-hidden="true">
        Changelog
      </span>
    )
  }

  return (
    <Link
      href="/changelog"
      className="text-sm text-muted-foreground hover:text-foreground hover:underline transition-colors"
    >
      Changelog
    </Link>
  )
}
