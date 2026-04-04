"use client"

import { useEffect, useState } from "react"

interface LocalizedTimestampProps {
  isoString: string
}

function formatFallbackTimestamp(isoString: string) {
  const parsed = new Date(isoString)
  if (Number.isNaN(parsed.getTime())) {
    return isoString
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short"
  }).format(parsed)
}

export function LocalizedTimestamp({ isoString }: LocalizedTimestampProps) {
  const [formatted, setFormatted] = useState<string | null>(null)
  const fallbackText = formatFallbackTimestamp(isoString)

  useEffect(() => {
    const parsed = new Date(isoString)
    if (Number.isNaN(parsed.getTime())) {
      setFormatted(fallbackText)
      return
    }

    setFormatted(
      new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZoneName: "short"
      }).format(parsed)
    )
  }, [fallbackText, isoString])

  return (
    <time dateTime={isoString} suppressHydrationWarning>
      {formatted ?? fallbackText}
    </time>
  )
}
