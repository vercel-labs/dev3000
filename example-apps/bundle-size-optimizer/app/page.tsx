"use client";

import { useState } from "react";
import { catalogItems } from "./catalog-data";
import PulseSimulator from "./pulse-simulator";

export default function Home() {
  const [query, setQuery] = useState("");
  const [showWidget, setShowWidget] = useState(false);

  const filtered = catalogItems.filter((item) => {
    const haystack = `${item.title} ${item.blurb} ${item.audience}`.toLowerCase();
    return haystack.includes(query.toLowerCase());
  });

  return (
    <main className="mx-auto min-h-screen max-w-6xl px-6 py-14">
      <section className="rounded-[32px] border border-amber-200/70 bg-white/85 p-8 shadow-[0_24px_90px_-52px_rgba(120,53,15,0.45)]">
        <p className="text-xs uppercase tracking-[0.4em] text-amber-600/70">
          Client-heavy route
        </p>
        <h1 className="mt-4 text-4xl font-semibold text-slate-950">
          Asset marketplace
        </h1>
        <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600">
          This page is intentionally marked as a client component and imports a
          large static catalog plus a low-value heavy widget into the initial
          bundle.
        </p>

        <div className="mt-8 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <label className="flex flex-1 flex-col gap-2 text-sm text-slate-600">
            Search catalog
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-950 outline-none"
              placeholder="Find admin-only content blocks..."
            />
          </label>

          <button
            type="button"
            onClick={() => setShowWidget((value) => !value)}
            className="rounded-full bg-slate-950 px-5 py-3 text-sm font-medium text-white"
          >
            {showWidget ? "Hide" : "Show"} pulse simulator
          </button>
        </div>
      </section>

      {showWidget ? <div className="mt-8"><PulseSimulator /></div> : null}

      <section className="mt-8 rounded-[32px] border border-slate-200 bg-white/90 p-8">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.35em] text-slate-400">
              Catalog
            </p>
            <h2 className="mt-2 text-2xl font-semibold text-slate-950">
              {filtered.length} assets loaded on first render
            </h2>
          </div>
          <span className="rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-xs text-rose-700">
            Intentional bundle bloat
          </span>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          {filtered.map((item) => (
            <article
              key={item.id}
              className="rounded-3xl border border-slate-200 bg-slate-50 p-5"
            >
              <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
                {item.audience}
              </p>
              <h3 className="mt-2 text-lg font-semibold text-slate-950">
                {item.title}
              </h3>
              <p className="mt-3 text-sm leading-6 text-slate-600">
                {item.blurb}
              </p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
