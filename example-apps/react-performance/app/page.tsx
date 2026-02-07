import ExpensiveChart from "./expensive-chart"

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function getTeamSummary() {
  await delay(750)
  return {
    team: "Northstar",
    activeProjects: 7,
    openIncidents: 3
  }
}

async function getReleaseNotes() {
  await delay(900)
  return [
    "Onboarding walkthrough now supports deep links.",
    "The billing portal includes exportable invoices.",
    "New alerts highlight contract drift in procurement."
  ]
}

export default async function Home() {
  const summary = await getTeamSummary()
  const releases = await getReleaseNotes()

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <main className="mx-auto flex w-full max-w-5xl flex-col px-6 py-12">
        <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Operations Dashboard</p>
        <h1 className="mt-3 text-3xl font-semibold">{summary.team} weekly health</h1>
        <p className="mt-2 text-slate-500">
          {summary.activeProjects} active projects, {summary.openIncidents} incidents triaged this week.
        </p>

        <section className="mt-10 grid gap-6 rounded-3xl border border-slate-200 bg-white p-8">
          <div>
            <h2 className="text-lg font-semibold">Release updates</h2>
            <p className="text-sm text-slate-500">Latest notes sent from engineering.</p>
          </div>
          <ul className="space-y-3 text-sm text-slate-600">
            {releases.map((note) => (
              <li key={note} className="rounded-xl border border-slate-100 bg-slate-50 p-4">
                {note}
              </li>
            ))}
          </ul>
        </section>

        <ExpensiveChart />
      </main>
    </div>
  )
}
