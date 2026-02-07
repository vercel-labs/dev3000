import LateBanner from "./late-banner"

const updates = [
  "Investigate CLS spikes on the pricing page.",
  "Rebuild the banner system for seasonal campaigns.",
  "Review typography scale for the blog index.",
  "Audit hero images for missing dimensions."
]

export default function Home() {
  return (
    <div className="min-h-screen bg-white text-slate-900">
      <LateBanner />
      <header className="border-b border-slate-100 px-6 py-6">
        <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Product Ops</p>
        <h1 className="mt-3 text-3xl font-semibold">Launch readiness check</h1>
        <p className="mt-2 max-w-2xl text-slate-500">
          Keep this checklist updated so the team knows what is left before the rollout.
        </p>
      </header>

      <main className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-6 py-10">
        <section className="rounded-3xl border border-slate-100 bg-slate-50 p-6">
          <h2 className="text-lg font-semibold">Open tasks</h2>
          <ul className="mt-4 space-y-3">
            {updates.map((item) => (
              <li key={item} className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
                {item}
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-3xl border border-slate-100 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold">Campaign preview</h2>
          <p className="mt-2 text-sm text-slate-500">
            Marketing wants this hero to appear below the checklist once assets finish loading.
          </p>
          <div className="mt-6 overflow-hidden rounded-2xl border border-slate-100">
            <img
              src="https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1600&q=80"
              alt="Soft light over a mountain ridge"
              className="w-full"
            />
          </div>
        </section>
      </main>
    </div>
  )
}
