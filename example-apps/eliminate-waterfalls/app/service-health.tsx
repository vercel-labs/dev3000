type Service = {
  id: string;
  name: string;
};

type ServiceHealth = Service & {
  latencyMs: number;
  errorRate: string;
};

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getServices(workspaceId: string): Promise<Service[]> {
  await delay(420);

  return [
    { id: `${workspaceId}-edge`, name: "Edge requests" },
    { id: `${workspaceId}-queues`, name: "Queue workers" },
    { id: `${workspaceId}-storage`, name: "Blob processing" },
    { id: `${workspaceId}-search`, name: "Search pipeline" },
  ];
}

async function getServiceHealth(service: Service): Promise<ServiceHealth> {
  await delay(320);

  return {
    ...service,
    latencyMs: 120 + service.name.length * 11,
    errorRate: `${((service.id.length % 4) + 1) * 0.2}%`,
  };
}

export default async function ServiceHealthGrid({
  workspaceId,
}: {
  workspaceId: string;
}) {
  const services = await getServices(workspaceId);
  const healthCards: ServiceHealth[] = [];

  for (const service of services) {
    healthCards.push(await getServiceHealth(service));
  }

  return (
    <section className="mt-10 rounded-[28px] border border-slate-200/70 bg-white/80 p-7 shadow-[0_20px_80px_-48px_rgba(15,23,42,0.45)]">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.35em] text-slate-400">
            Service health
          </p>
          <h2 className="mt-2 text-xl font-semibold text-slate-950">
            Each card is fetched one after another
          </h2>
        </div>
        <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs text-amber-700">
          Intentional waterfall
        </span>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        {healthCards.map((service) => (
          <article
            key={service.id}
            className="rounded-2xl border border-slate-200 bg-slate-50 p-5"
          >
            <p className="text-sm font-medium text-slate-900">{service.name}</p>
            <p className="mt-3 text-3xl font-semibold text-slate-950">
              {service.latencyMs}ms
            </p>
            <p className="mt-1 text-sm text-slate-500">
              Error rate {service.errorRate}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}
