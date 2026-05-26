import { describe, expect, it } from "vitest"

import { formatRunFailure } from "./run-failure-display"

describe("formatRunFailure", () => {
  it("summarizes AI Gateway auth failures before DeepSec batch stats", () => {
    const failure = formatRunFailure(
      'FatalError: Step "step//deepSecPollProcess" failed after 3 retries: DeepSec process failed: x stream error: unexpected status 401 Unauthorized: Authentication failed. Check that your Vercel credential is valid and has access to AI Gateway. Processing complete. Run: d3k_test Analyses: 0 Findings: 0 Errored batches: 9'
    )

    expect(failure.summary).toBe(
      "The runner could not authenticate to AI Gateway, so no analysis report was generated."
    )
    expect(failure.workflowStep).toBe("step//deepSecPollProcess")
    expect(failure.retryCount).toBe("3")
    expect(failure.stats).toContain("Root cause: AI Gateway 401 Unauthorized")
  })
})
