import { buildLargeAuditSummary, getForecast, getWorkspaceSnapshot } from "../app/data";

export default async function ActivityPanel() {
  const snapshot = await getWorkspaceSnapshot();
  const forecast = await getForecast();
  const auditSummary = await buildLargeAuditSummary(snapshot);

  return (
    <section className="rounded-[32px] border border-slate-200 bg-white/90 p-8">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.35em] text-slate-400">
            Activity and forecast
          </p>
          <h2 className="mt-2 text-2xl font-semibold text-slate-950">
            Sequential server work
          </h2>
        </div>
        <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs text-amber-700">
          Intentional server waste
        </span>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <article className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-xs uppercase tracking-[0.25em] text-slate-400">
            Forecasted runs
          </p>
          <p className="mt-3 text-3xl font-semibold text-slate-950">
            {forecast.forecastedRuns}
          </p>
        </article>
        <article className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-xs uppercase tracking-[0.25em] text-slate-400">
            Burst window
          </p>
          <p className="mt-3 text-3xl font-semibold text-slate-950">
            {forecast.burstWindow}
          </p>
        </article>
        <article className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-xs uppercase tracking-[0.25em] text-slate-400">
            Queued PRs
          </p>
          <p className="mt-3 text-3xl font-semibold text-slate-950">
            {forecast.queuedPullRequests}
          </p>
        </article>
      </div>

      <p className="mt-6 text-sm leading-7 text-slate-600">
        {snapshot.healthSummary}
      </p>
      <p className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm leading-7 text-slate-600">
        {auditSummary}
      </p>
    </section>
  );
}
