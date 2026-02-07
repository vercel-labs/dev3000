"use client"

import { useEffect, useState } from "react"

export default function LateBanner() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), 1800)
    return () => clearTimeout(timer)
  }, [])

  if (!visible) return null

  return (
    <div className="bg-amber-200 px-6 py-4 text-sm text-amber-950 shadow-sm">
      Heads up: maintenance window scheduled for tonight at 11:00pm. Expect brief API interruptions.
    </div>
  )
}
