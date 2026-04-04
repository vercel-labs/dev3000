import ServiceHealthGrid from "./service-health";

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getWorkspace() {
  await delay(220);

  return {
    id: "northstar",
    name: "Northstar Platform",
    owner: "Operations Systems",
  };
}

async function getSummary(workspaceId: string) {
  await delay(760);

  return {
    workspaceId,
    liveDeployments: 14,
    openEscalations: 3,
    routingPolicies: 11,
  };
}

async function getReleaseNotes(workspaceId: string) {
  await delay(880);

  return [
    `${workspaceId} routing now supports staged cutovers.`,
    "Sandbox setup moved behind a narrower bootstrap screen.",
    "Run history exports now include report deep links.",
  ];
}

async function getAlerts(workspaceId: string) {
  await delay(610);

  return [
    `${workspaceId} traffic anomaly threshold exceeded in iad1.`,
    "One workflow consumer retried more than expected this hour.",
  ];
}

export default async function Home() {
  const workspace = await getWorkspace();
  const summary = await getSummary(workspace.id);
  const releases = await getReleaseNotes(workspace.id);
  const alerts = await getAlerts(workspace.id);

  return (
    <main className="mx-auto min-h-screen max-w-6xl px-6 py-14">
      <div className="grid gap-8 lg:grid-cols-[1.2fr_0.8fr]">
        <section className="rounded-[32px] border border-slate-200/80 bg-white/85 p-8 shadow-[0_24px_80px_-48px_rgba(15,23,42,0.55)] backdrop-blur">
          <p className="text-xs uppercase tracking-[0.4em] text-slate-400">
            Async workflow dashboard
          </p>
          <h1 className="mt-4 text-4xl font-semibold text-slate-950">
            {workspace.name}
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-600">
            The data on this page is intentionally loaded in a slow sequence so
            the waterfall agent has obvious work to do.
          </p>

          <div className="mt-8 grid gap-4 md:grid-cols-3">
            <article className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
              <p className="text-xs uppercase tracking-[0.25em] text-slate-400">
                Live deployments
              </p>
              <p className="mt-4 text-3xl font-semibold text-slate-950">
                {summary.liveDeployments}
              </p>
            </article>
            <article className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
              <p className="text-xs uppercase tracking-[0.25em] text-slate-400">
                Open escalations
              </p>
              <p className="mt-4 text-3xl font-semibold text-slate-950">
                {summary.openEscalations}
              </p>
            </article>
            <article className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
              <p className="text-xs uppercase tracking-[0.25em] text-slate-400">
                Routing policies
              </p>
              <p className="mt-4 text-3xl font-semibold text-slate-950">
                {summary.routingPolicies}
              </p>
            </article>
          </div>
        </section>

        <aside className="rounded-[32px] border border-slate-200/80 bg-slate-950 p-8 text-slate-100 shadow-[0_24px_80px_-50px_rgba(15,23,42,0.8)]">
          <p className="text-xs uppercase tracking-[0.35em] text-slate-500">
            Release notes
          </p>
          <ul className="mt-6 space-y-4">
            {releases.map((release) => (
              <li
                key={release}
                className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4 text-sm leading-6 text-slate-300"
              >
                {release}
              </li>
            ))}
          </ul>

          <p className="mt-8 text-xs uppercase tracking-[0.35em] text-slate-500">
            Active alerts
          </p>
          <ul className="mt-4 space-y-3">
            {alerts.map((alert) => (
              <li
                key={alert}
                className="rounded-2xl border border-rose-950 bg-rose-950/40 p-4 text-sm leading-6 text-rose-100"
              >
                {alert}
              </li>
            ))}
          </ul>
        </aside>
      </div>

      <ServiceHealthGrid workspaceId={workspace.id} />
    </main>
  );
}
