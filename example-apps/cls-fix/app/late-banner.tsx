"use client"

import { useEffect, useState } from "react"

export default function LateBanner() {
  const [visible, setVisible] = useState(false)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    const showTimer = setTimeout(() => setVisible(true), 1800)
    const expandTimer = setTimeout(() => setExpanded(true), 2900)

    return () => {
      clearTimeout(showTimer)
      clearTimeout(expandTimer)
    }
  }, [])

  if (!visible) return null

  return (
    <section className="overflow-hidden border-b border-amber-300 bg-amber-200 text-amber-950 shadow-sm">
      <div
        className={`mx-auto flex w-full max-w-6xl flex-col justify-between gap-8 px-6 py-10 md:flex-row md:items-end md:px-10 ${
          expanded ? "min-h-[1180px] md:min-h-[1340px]" : "min-h-[560px] md:min-h-[680px]"
        }`}
      >
        <div className="max-w-2xl space-y-4">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-amber-900/70">Emergency Rollout</p>
          <h2 className="max-w-xl text-4xl font-semibold tracking-tight md:text-5xl">
            The launch window just moved, and the entire plan shifted with it.
          </h2>
          <p className="max-w-lg text-base leading-7 text-amber-950/80 md:text-lg">
            This takeover intentionally appears late without reserved space so the page lurches downward. The CLS fix
            should reserve this area before the content loads.
          </p>

          <div className="grid gap-3 pt-4 md:grid-cols-2">
            <div className="rounded-3xl border border-amber-950/10 bg-white/65 p-5 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-amber-900/60">What broke</p>
              <p className="mt-3 text-sm leading-6 text-amber-950/80">
                The takeover appears after the first paint without reserving any space, so everything below it gets
                shoved down the viewport.
              </p>
            </div>
            <div className="rounded-3xl border border-amber-950/10 bg-white/65 p-5 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-amber-900/60">What gets worse</p>
              <p className="mt-3 text-sm leading-6 text-amber-950/80">
                A second delayed expansion adds even more height, so the page suffers a follow-up shift instead of
                stabilizing.
              </p>
            </div>
          </div>
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

          {expanded ? (
            <div className="grid gap-3 rounded-[28px] border border-amber-950/10 bg-white/70 p-5 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-amber-900/60">Escalation Panel</p>
              <div className="grid gap-3">
                <div className="rounded-2xl bg-white px-4 py-4 text-sm leading-6 text-amber-950/80">
                  Reserve the takeover footprint before hydration so the document layout is stable from the first
                  render.
                </div>
                <div className="rounded-2xl bg-white px-4 py-4 text-sm leading-6 text-amber-950/80">
                  Prevent the follow-up detail panel from expanding the page after the first meaningful paint.
                </div>
                <div className="rounded-2xl bg-white px-4 py-4 text-sm leading-6 text-amber-950/80">
                  The agent should make this entire section boring by reserving space or rendering a stable skeleton up
                  front.
                </div>
                <div className="rounded-2xl bg-amber-950 px-4 py-5 text-sm leading-6 text-amber-50">
                  This intentionally oversized block creates a second major layout shift so the baseline CLS is bad
                  enough for a real fix loop.
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  )
}
