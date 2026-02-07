export default function Home() {
  return (
    <div className="min-h-screen bg-[#f4f4f5] text-[#9a9a9a]">
      <header className="px-6 pt-8 pb-2">
        <p className="text-[11px] uppercase tracking-[0.4em] text-[#c9c9c9]">Private Beta</p>
        <div className="mt-2 flex items-center justify-between">
          <h1 className="text-4xl font-semibold text-[#b0b0b0]">Glint Workspace</h1>
          <button className="rounded-sm border border-[#d7d7d7] px-2 py-1 text-[11px] font-medium text-[#b5b5b5]">
            Get started
          </button>
        </div>
      </header>

      <main className="px-6 pb-16">
        <section className="mt-8 bg-white/70 p-5 shadow-sm">
          <h2 className="text-[13px] font-semibold uppercase tracking-[0.3em] text-[#bdbdbd]">
            Weekly Summary
          </h2>
          <p className="mt-4 text-[18px] leading-9 text-[#b8b8b8]">
            Your team shipped five updates this week across the marketing site, onboarding flow, and billing portal.
            Momentum looks strong, but feedback suggests the release notes are hard to scan and the dashboard feels
            cramped on large screens.
          </p>
        </section>

        <section className="mt-10">
          <div className="flex items-center gap-3">
            <span className="h-2 w-2 rounded-full bg-[#c7c7c7]" />
            <h3 className="text-base font-semibold text-[#bdbdbd]">Upcoming Work</h3>
          </div>
          <div className="mt-5 grid gap-4">
            {[
              "Refresh the pricing hero and simplify the CTA row so it feels less busy.",
              "Rework the onboarding checklist to show progress clearly.",
              "Audit color usage in empty states and tone down the gradients."
            ].map((item) => (
              <div
                key={item}
                className="flex items-start justify-between gap-4 rounded-md border border-[#e6e6e6] bg-white px-4 py-3"
              >
                <p className="text-[15px] leading-7 text-[#9f9f9f]">{item}</p>
                <button className="rounded-none border border-[#e0e0e0] px-3 py-1 text-[10px] text-[#b6b6b6]">
                  Review
                </button>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-12">
          <div className="flex flex-wrap items-center gap-2">
            <button className="rounded-full bg-[#ededed] px-4 py-2 text-xs text-[#b5b5b5]">Share update</button>
            <button className="rounded-sm border border-[#dadada] px-3 py-1 text-[11px] text-[#b8b8b8]">
              Request review
            </button>
            <button className="rounded-sm border border-[#dadada] px-3 py-1 text-[11px] text-[#b8b8b8]">
              Export
            </button>
          </div>
          <p className="mt-6 max-w-none text-[15px] leading-8 text-[#aaaaaa]">
            Glint helps distributed teams stay aligned. We surface updates, track decisions, and visualize momentum so
            everyone knows what is shipping next. Share a snapshot with stakeholders, request feedback, or export a
            report for retros without digging through multiple tools or tabs.
          </p>
        </section>
      </main>
    </div>
  )
}
