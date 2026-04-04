import { getWorkspaceSnapshot } from "../app/data";

export default async function AccountHeader() {
  const snapshot = await getWorkspaceSnapshot();

  return (
    <section className="rounded-[32px] border border-slate-200/80 bg-white/90 p-8 shadow-[0_24px_80px_-54px_rgba(15,23,42,0.35)]">
      <p className="text-xs uppercase tracking-[0.35em] text-slate-400">
        Workspace
      </p>
      <h1 className="mt-4 text-4xl font-semibold text-slate-950">
        {snapshot.name}
      </h1>
      <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-600">
        This header fetches the same snapshot as the page and sibling sections.
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
        {snapshot.tags.map((tag) => (
          <span
            key={tag}
            className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-sm text-slate-700"
          >
            {tag}
          </span>
        ))}
      </div>
    </section>
  );
}
