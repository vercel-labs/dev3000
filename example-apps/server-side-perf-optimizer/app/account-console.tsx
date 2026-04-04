"use client";

import type { WorkspaceSnapshot } from "./data";

export default function AccountConsole({
  snapshot,
}: {
  snapshot: WorkspaceSnapshot;
}) {
  return (
    <section className="rounded-[28px] border border-slate-200 bg-slate-950 p-7 text-slate-100 shadow-[0_24px_80px_-54px_rgba(15,23,42,0.85)]">
      <p className="text-xs uppercase tracking-[0.35em] text-slate-500">
        Client console
      </p>
      <h2 className="mt-3 text-2xl font-semibold">{snapshot.name}</h2>
      <p className="mt-3 text-sm leading-6 text-slate-300">
        This client component receives the full server snapshot even though it
        only renders a couple of fields.
      </p>
      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <article className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
          <p className="text-xs uppercase tracking-[0.25em] text-slate-500">
            Owner
          </p>
          <p className="mt-3 text-lg font-medium">{snapshot.owner}</p>
        </article>
        <article className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
          <p className="text-xs uppercase tracking-[0.25em] text-slate-500">
            Failed checks
          </p>
          <p className="mt-3 text-lg font-medium">{snapshot.failedChecks}</p>
        </article>
        <article className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
          <p className="text-xs uppercase tracking-[0.25em] text-slate-500">
            Tags
          </p>
          <p className="mt-3 text-lg font-medium">{snapshot.tags.length}</p>
        </article>
      </div>
    </section>
  );
}
