"use client";

import { useEffect, useState } from "react";

type QueueStats = {
  backlog: number;
  activeWorkers: number;
  slaRisk: string;
  refreshedAt: string;
};

function useQueueStatsCard(label: string) {
  const [stats, setStats] = useState<QueueStats | null>(null);
  const [viewport, setViewport] = useState(0);

  useEffect(() => {
    fetch("/api/queue-stats")
      .then((response) => response.json())
      .then((payload: QueueStats) => setStats(payload));
  }, []);

  useEffect(() => {
    window.localStorage.getItem(`layout:${label}`);
  }, [label]);

  useEffect(() => {
    const handleResize = () => {
      setViewport(window.innerWidth);
    };

    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return { stats, viewport };
}

function StatsCard({ label }: { label: string }) {
  const { stats, viewport } = useQueueStatsCard(label);

  return (
    <article className="rounded-[28px] border border-slate-200 bg-white/90 p-6 shadow-sm">
      <p className="text-xs uppercase tracking-[0.35em] text-slate-400">
        {label}
      </p>
      <p className="mt-4 text-3xl font-semibold text-slate-950">
        {stats ? stats.backlog : "…"}
      </p>
      <p className="mt-2 text-sm text-slate-600">
        {stats ? `${stats.activeWorkers} workers active` : "Loading the same endpoint again..."}
      </p>
      <p className="mt-4 text-xs text-slate-400">
        Viewport {viewport}px, local storage checked separately
      </p>
    </article>
  );
}

export default function Home() {
  return (
    <main className="mx-auto min-h-screen max-w-6xl px-6 py-14">
      <section className="rounded-[32px] border border-sky-200/80 bg-white/80 p-8 shadow-[0_24px_90px_-58px_rgba(14,116,144,0.4)]">
        <p className="text-xs uppercase tracking-[0.4em] text-sky-700/65">
          Duplicate browser work
        </p>
        <h1 className="mt-4 text-4xl font-semibold text-slate-950">
          Queue control center
        </h1>
        <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600">
          Each card on this page repeats the same client fetch, registers its own
          resize listener, and reads local storage independently.
        </p>
      </section>

      <div className="mt-8 grid gap-5 md:grid-cols-3">
        <StatsCard label="Overview" />
        <StatsCard label="Throughput" />
        <StatsCard label="Risk watch" />
      </div>
    </main>
  );
}
