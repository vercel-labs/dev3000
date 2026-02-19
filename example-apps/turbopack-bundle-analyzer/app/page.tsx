"use client"

import { useMemo, useState } from "react"
import megaCatalog from "./mega-catalog.json"
import promoFeed from "./promo-feed.json"

function formatBytes(bytes: number) {
  const kb = bytes / 1024
  return `${kb.toFixed(0)} KB`
}

export default function Home() {
  const [query, setQuery] = useState("")

  // Intentionally bad: ships the entire giant catalog to the client on the home page
  // and performs unnecessary filtering/sorting on every keystroke.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return megaCatalog
      .filter((item) => item.title.toLowerCase().includes(q) || item.description.toLowerCase().includes(q))
      .sort((a, b) => a.title.localeCompare(b.title))
      .slice(0, 30)
  }, [query])

  const payloadBytes = JSON.stringify(megaCatalog).length
  const promoBytes = JSON.stringify(promoFeed).length

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <main className="mx-auto flex w-full max-w-5xl flex-col px-6 py-12">
        <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Turbopack Demo</p>
        <h1 className="mt-3 text-3xl font-semibold">Large bundle anti-pattern homepage</h1>
        <p className="mt-2 text-slate-500">
          This page intentionally ships huge static payloads to the browser. Catalog: {formatBytes(payloadBytes)}.
          Promo feed: {formatBytes(promoBytes)}.
        </p>

        <section className="mt-8 rounded-3xl border border-slate-200 bg-white p-8">
          <label className="mb-3 block text-sm font-medium text-slate-700" htmlFor="search">
            Search catalog (expensive client-side filter)
          </label>
          <input
            id="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type to filter 12,000 records"
            className="w-full rounded-xl border border-slate-300 px-4 py-2 text-sm"
          />

          <ul className="mt-6 space-y-3 text-sm text-slate-600">
            {filtered.map((item) => (
              <li key={item.id} className="rounded-xl border border-slate-100 bg-slate-50 p-4">
                <p className="font-medium text-slate-800">{item.title}</p>
                <p className="mt-1 text-xs text-slate-500">{item.description}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-8 rounded-3xl border border-slate-200 bg-white p-8">
          <h2 className="text-lg font-semibold">Promo feed snapshot (second intentional bundle mistake)</h2>
          <p className="mt-2 text-sm text-slate-500">
            We import the full promo feed in the client just to render a tiny sample.
          </p>
          <ul className="mt-4 space-y-2 text-sm text-slate-600">
            {promoFeed.slice(0, 8).map((promo) => (
              <li key={promo.id} className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                <span className="font-medium text-slate-800">{promo.headline}</span>
                <span className="ml-2 text-xs uppercase tracking-wide text-slate-500">{promo.segment}</span>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </div>
  )
}
