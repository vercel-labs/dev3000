# Sponsored DeepSec Runner Plan

## Goal

Offer selected users a free DeepSec report for a public Vercel project repo while Vercel Labs absorbs the compute, AI Gateway, storage, and observability costs.

This should be a deliberately gated sponsored path, not a relaxation of the default team-owned runner model.

## Product Shape

Add a third execution mode:

- `self-hosted`: default for normal users. The user's team installs `d3k-skill-runner`; their team owns billing, logs, and AI Gateway usage.
- `hosted`: internal Vercel/Vercel Labs execution for trusted internal teams only.
- `sponsored`: allowlisted public repos run DeepSec on a Vercel Labs-owned runner; Vercel Labs owns billing, logs, AI Gateway usage, and report storage.

For users, this should appear as:

- "Run a free DeepSec report" when the selected project is eligible.
- No team runner install prompt.
- Clear copy that the run is sponsored and limited to public repositories.
- The same report URL and report UI as a normal skill-runner run.

## Eligibility Rules

A sponsored run is allowed only when all checks pass:

1. The skill is exactly `deepsec`.
2. The selected Vercel project has a Git repository.
3. The repository is public.
4. The repo or project is on an explicit allowlist.
5. The run is under quota for the allowlist entry.
6. The run does not provide custom runner environment variables.
7. The run uses bounded DeepSec settings.

Suggested allowlist shape:

```ts
type SponsoredDeepSecAllowlistEntry = {
  id: string
  repo: string // "owner/name"
  projectIds?: string[]
  teamIds?: string[]
  enabled: boolean
  expiresAt?: string
  maxRunsPerDay: number
  maxRunsPerMonth: number
  maxEstimatedCostCentsPerRun: number
  maxActualCostCentsPerMonth: number
  notes?: string
}
```

Start with a static JSON or admin-managed Blob document. Move to a small database table once the flow is used by multiple users.

## Dedicated Infrastructure

Create a separate Vercel Labs-owned runner project, for example:

- Project: `d3k-sponsored-deepsec-runner`
- Team: `vercel-labs`
- Storage: dedicated private Blob store for sponsored DeepSec artifacts
- AI Gateway: dedicated API key or OIDC-backed project attribution
- Logs: project runtime logs owned by Vercel Labs

Do not reuse the generic self-hosted `d3k-skill-runner` project. A dedicated project makes cost, logs, incidents, and kill switches easier to reason about.

## Run Flow

1. User opens `/skill-runner/deepsec` or a team-specific DeepSec page.
2. User signs in with Vercel and chooses a team/project.
3. Server loads project metadata from Vercel.
4. Server resolves the Git provider, repo owner/name, branch, commit SHA, and root directory.
5. Server checks repo visibility using Git provider metadata.
6. Server evaluates the allowlist and quota.
7. If eligible, the start-run API creates a run with `executionMode: "sponsored"`.
8. The workflow dispatches work to `d3k-sponsored-deepsec-runner`.
9. The sponsored runner clones the public repo by public URL and commit SHA.
10. DeepSec runs with bounded settings.
11. Artifacts and report markdown are written to Vercel Labs-owned storage.
12. The normal report page renders the result.

## Security Constraints

Sponsored runs must be narrower than normal user-owned runs:

- Public repos only.
- Clone by public Git URL and pinned commit SHA.
- No user-provided secrets.
- No custom runner env vars.
- No arbitrary scripts.
- No private repo access tokens.
- No reuse of user project environment variables.
- No write access to the user's repo.
- No PR creation in the first version.
- Hard limits on repository size, file count, token usage, runtime, and concurrency.

The first version should generate a report only.

## Cost Controls

Add several independent limits:

- Max runs per repo per day.
- Max runs per repo per month.
- Max concurrent sponsored runs globally.
- Max concurrent sponsored runs per repo.
- Max estimated cost per run before starting DeepSec.
- Max actual monthly spend per allowlist entry.
- Max total monthly sponsored DeepSec spend.

Every sponsored run should record:

- Allowlist entry ID.
- Team/project/user that requested it.
- Repo and commit SHA.
- Start/end time.
- Status.
- Token usage.
- AI Gateway cost.
- Workflow/function duration.
- Storage artifact size.
- Failure category.

## UI Behavior

On the DeepSec skill page:

- If project is eligible: show a sponsored badge and skip the team runner install card.
- If project is not eligible but public: show normal self-hosted install path.
- If repo is private: show normal self-hosted install path.
- If allowlist quota is exhausted: explain that the free sponsored scan quota is exhausted and offer self-hosted.

Suggested copy:

> Sponsored DeepSec run
> This public repository is eligible for a Vercel-sponsored DeepSec report. Vercel Labs will run the scan and cover the AI Gateway and compute cost.

Avoid saying "hosted" to users. Use "sponsored" or "free sponsored report."

## Implementation Plan

### Phase 1: Data Model

- Add `executionMode: "sponsored"` where run records currently use `hosted` or `self-hosted`.
- Add run metadata fields:
  - `sponsoredByTeamId`
  - `sponsoredRunnerProjectId`
  - `sourceRepo`
  - `sourceRepoVisibility`
  - `sourceCommitSha`
  - `allowlistEntryId`
  - `costLimitCents`
- Add an allowlist loader.
- Add a quota evaluator.

### Phase 2: Eligibility API

- Add an endpoint or server helper that returns DeepSec sponsorship eligibility for a selected project.
- Resolve Git metadata from the Vercel project.
- Verify repo visibility with Git provider metadata.
- Check allowlist and quota.
- Return a user-safe reason when not eligible.

### Phase 3: Sponsored Runner Dispatch

- Add a sponsored execution branch in the start-run path.
- Skip self-hosted runner validation and install prompts for eligible runs.
- Dispatch to the dedicated Vercel Labs runner.
- Ensure the runner clones public repos only.
- Pin clone to the selected commit SHA.

### Phase 4: Cost Attribution

- Route sponsored DeepSec AI calls through the dedicated Vercel Labs runner auth.
- Tag AI Gateway calls with run ID, repo, skill, and allowlist entry.
- Persist cost usage back onto the run record.
- Show cost in admin/telemetry views.

### Phase 5: Reporting

- Reuse the existing DeepSec report page.
- Store generated markdown and derived web report in sponsored storage.
- Make report URLs work the same way as self-hosted run URLs.
- Add a small sponsored label in the run context, not in the report body.

### Phase 6: Admin Operations

- Add admin UI or a checked-in config for allowlist entries.
- Add a kill switch for all sponsored DeepSec runs.
- Add per-entry disable switches.
- Add run/cost dashboards.
- Add audit logging for allowlist edits.

## Failure Modes To Handle

- Repo becomes private after eligibility check.
- Repo is public but too large.
- Repo has submodules that require auth.
- Git clone rate limits.
- DeepSec exceeds token or wall-clock budget.
- AI Gateway rejects or rate limits the request.
- Sponsored runner deployment is unhealthy.
- Report generation completes with zero findings.
- User starts multiple runs concurrently.
- Allowlist entry expires mid-run.

## Open Questions

- Should sponsored reports be visible to anyone with the link, only the requesting user, or only the requesting Vercel team?
- Should sponsored runs be allowed from the shareable `/skill-runner/deepsec` URL without a team slug?
- Should allowlist entries be repo-only or repo plus Vercel project?
- Should Vercel Labs allow PR creation later, or keep sponsored DeepSec report-only permanently?
- What is the initial monthly budget for the experiment?
- Who owns the allowlist approval process?

## Recommended MVP

Build the smallest report-only sponsored path:

1. Static allowlist for `owner/repo`.
2. Public GitHub repos only.
3. DeepSec only.
4. No custom env vars.
5. No PRs.
6. Dedicated Vercel Labs runner project.
7. Dedicated AI Gateway attribution.
8. Hard daily/monthly quotas.
9. Existing report UI.

This gives Vercel Labs a controlled way to sponsor useful DeepSec reports without weakening the default user-owned billing model.
