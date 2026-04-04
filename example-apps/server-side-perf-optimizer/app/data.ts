export type ActivityEvent = {
  id: string;
  title: string;
  minutesAgo: number;
};

export type WorkspaceSnapshot = {
  id: string;
  name: string;
  owner: string;
  activeRuns: number;
  failedChecks: number;
  spendUsd: number;
  healthSummary: string;
  tags: string[];
  activity: ActivityEvent[];
};

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildActivity(): ActivityEvent[] {
  return Array.from({ length: 60 }, (_, index) => ({
    id: `event-${index + 1}`,
    title: `Workflow group ${index + 1} reconciled agent output and pushed follow-up notes.`,
    minutesAgo: index * 7 + 3,
  }));
}

export async function getWorkspaceSnapshot(): Promise<WorkspaceSnapshot> {
  await delay(680);

  return {
    id: "apollo",
    name: "Apollo Reliability",
    owner: "Platform Foundation",
    activeRuns: 28,
    failedChecks: 4,
    spendUsd: 18420,
    healthSummary:
      "Baseline data intentionally contains more fields than the client console needs.",
    tags: ["durable", "sandbox", "workflows", "ops", "billing", "reporting"],
    activity: buildActivity(),
  };
}

export async function getForecast() {
  await delay(720);

  return {
    forecastedRuns: 42,
    burstWindow: "16:00 UTC",
    queuedPullRequests: 11,
  };
}

export async function buildLargeAuditSummary(snapshot: WorkspaceSnapshot) {
  await delay(540);

  return snapshot.activity
    .map((item) => `${item.title} (${item.minutesAgo} minutes ago)`)
    .join(" | ");
}
