"use client";

import { useEffect, useState } from "react";

type Card = {
  id: number;
  title: string;
  score: number;
  owner: string;
};

function buildCards(seed: number): Card[] {
  const items: Card[] = [];

  for (let index = 0; index < 5000; index += 1) {
    items.push({
      id: index,
      title: `Automation queue ${index + 1}`,
      score: Math.abs(Math.sin(seed + index / 8) * 100),
      owner: index % 2 === 0 ? "ops" : "platform",
    });
  }

  return items;
}

export default function Home() {
  const [query, setQuery] = useState("");
  const [owner, setOwner] = useState("all");
  const [pointerX, setPointerX] = useState(0);
  const [tick, setTick] = useState(() => Date.now());
  const [resultCount, setResultCount] = useState(0);

  const cards = buildCards(tick / 1000);
  const visibleCards = cards
    .filter((card) => card.title.toLowerCase().includes(query.toLowerCase()))
    .filter((card) => owner === "all" || card.owner === owner)
    .sort((left, right) => right.score - left.score)
    .slice(0, 24);

  useEffect(() => {
    const interval = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const handleMove = (event: MouseEvent) => {
      setPointerX(event.clientX);
    };

    window.addEventListener("mousemove", handleMove);
    return () => window.removeEventListener("mousemove", handleMove);
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setResultCount(visibleCards.length);
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [visibleCards.length]);

  return (
    <main className="mx-auto min-h-screen max-w-6xl px-6 py-14">
      <section className="rounded-[32px] border border-amber-200/70 bg-white/85 p-8 shadow-[0_24px_90px_-58px_rgba(120,53,15,0.45)]">
        <p className="text-xs uppercase tracking-[0.4em] text-amber-700/70">
          Render churn
        </p>
        <h1 className="mt-4 text-4xl font-semibold text-slate-950">
          Agent utilization explorer
        </h1>
        <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600">
          This page rebuilds a large data set every render, stores derived state
          via effects, and updates mouse position in state even though it is only
          used as a debug label.
        </p>

        <div className="mt-8 grid gap-4 md:grid-cols-[1fr_220px_180px]">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-950 outline-none"
            placeholder="Search queues"
          />
          <select
            value={owner}
            onChange={(event) => setOwner(event.target.value)}
            className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-950 outline-none"
          >
            <option value="all">All owners</option>
            <option value="ops">Ops</option>
            <option value="platform">Platform</option>
          </select>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
            Pointer X: {pointerX}
          </div>
        </div>
      </section>

      <section className="mt-8 rounded-[32px] border border-slate-200 bg-white/90 p-8">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.35em] text-slate-400">
              Top queues
            </p>
            <h2 className="mt-2 text-2xl font-semibold text-slate-950">
              {resultCount} cards after every tick
            </h2>
          </div>
          <span className="rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-xs text-rose-700">
            Intentional re-render pressure
          </span>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visibleCards.map((card) => (
            <article
              key={card.id}
              className="rounded-3xl border border-slate-200 bg-slate-50 p-5"
            >
              <p className="text-xs uppercase tracking-[0.25em] text-slate-400">
                {card.owner}
              </p>
              <h3 className="mt-2 text-lg font-semibold text-slate-950">
                {card.title}
              </h3>
              <p className="mt-4 text-3xl font-semibold text-slate-950">
                {card.score.toFixed(1)}
              </p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
