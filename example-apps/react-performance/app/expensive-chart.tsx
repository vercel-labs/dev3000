"use client"

import { useEffect, useState } from "react"

type Metric = {
  id: number
  label: string
  score: number
  delta: number
}

function buildMetrics(seed: number): Metric[] {
  const items: Metric[] = []
  for (let i = 0; i < 6000; i += 1) {
    const score = Math.abs(Math.sin(seed + i / 9) * 100)
    items.push({
      id: i,
      label: `Metric ${i + 1}`,
      score,
      delta: Math.cos(seed + i / 7) * 12
    })
  }
  return items
}

export default function ExpensiveChart() {
  const [filter, setFilter] = useState(0)
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  const metrics = buildMetrics(now / 1000)
  const filtered = metrics.filter((metric) => metric.score > filter)
  const sorted = filtered.sort((a, b) => b.score - a.score)
  const top = sorted.slice(0, 24)

  return (
    <section className="mt-10 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Live insights</p>
          <h2 className="text-xl font-semibold text-slate-900">Operations pulse</h2>
        </div>
        <div className="flex items-center gap-3">
          <label className="text-xs uppercase tracking-[0.2em] text-slate-400">Min score</label>
          <input
            className="w-20 rounded-md border border-slate-200 px-2 py-1 text-sm"
            type="number"
            min={0}
            max={100}
            value={filter}
            onChange={(event) => setFilter(Number(event.target.value) || 0)}
          />
        </div>
      </div>
      <p className="mt-3 text-sm text-slate-500">
        Updating every second. {filtered.length} metrics scanned, showing top {top.length}.
      </p>
      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {top.map((metric) => (
          <div key={metric.id} className="rounded-xl border border-slate-100 bg-slate-50 p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">{metric.label}</p>
            <p className="mt-2 text-2xl font-semibold text-slate-900">{metric.score.toFixed(1)}</p>
            <p className="mt-1 text-sm text-slate-500">Delta {metric.delta.toFixed(2)}</p>
          </div>
        ))}
      </div>
    </section>
  )
}
