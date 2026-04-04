function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function GET() {
  await delay(520);

  return Response.json({
    backlog: 187,
    activeWorkers: 26,
    slaRisk: "medium",
    refreshedAt: new Date().toISOString(),
  });
}
