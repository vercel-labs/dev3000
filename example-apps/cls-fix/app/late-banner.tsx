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
    <section className="overflow-hidden border-b border-amber-300 bg-amber-200 text-amber-950 shadow-sm">
      <div className="mx-auto flex min-h-[360px] w-full max-w-6xl flex-col justify-between gap-8 px-6 py-10 md:min-h-[420px] md:flex-row md:items-end md:px-10">
        <div className="max-w-2xl space-y-4">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-amber-900/70">Emergency Rollout</p>
          <h2 className="max-w-xl text-4xl font-semibold tracking-tight md:text-5xl">
            The launch window just moved, and the entire plan shifted with it.
          </h2>
          <p className="max-w-lg text-base leading-7 text-amber-950/80 md:text-lg">
            This takeover intentionally appears late without reserved space so the page lurches downward. The CLS fix
            should reserve this area before the content loads.
          </p>
        </div>

        <div className="grid w-full max-w-md gap-3 rounded-3xl border border-amber-950/10 bg-white/50 p-5 backdrop-blur md:p-6">
          <div className="rounded-2xl bg-white px-4 py-3 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-amber-900/60">Updated checklist</p>
            <p className="mt-2 text-sm leading-6 text-amber-950/80">
              Reserve space for the late takeover, give media stable dimensions, and keep the header from jumping when
              campaign content arrives.
            </p>
          </div>
          <div className="rounded-2xl bg-amber-950 px-4 py-4 text-sm leading-6 text-amber-50 shadow-sm">
            This block exists purely to make the shift large and visually obvious in screenshots and traces.
          </div>
        </div>
      </div>
    </section>
  )
}
