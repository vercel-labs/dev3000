"use client";

const points = Array.from({ length: 900 }, (_, index) => index);

export default function PulseSimulator() {
  const total = points.reduce((sum, point) => {
    return sum + Math.sqrt(point * 13 + 7) * Math.sin(point / 9);
  }, 0);

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <p className="text-xs uppercase tracking-[0.35em] text-slate-400">
        Heavy preview widget
      </p>
      <h2 className="mt-3 text-xl font-semibold text-slate-950">
        Pulse simulator
      </h2>
      <p className="mt-3 text-sm leading-6 text-slate-600">
        This expensive widget is hidden behind a toggle, but it is imported into
        the initial client bundle anyway.
      </p>
      <p className="mt-6 rounded-2xl bg-slate-50 p-4 font-mono text-sm text-slate-700">
        Aggregate score: {total.toFixed(2)}
      </p>
    </section>
  );
}
