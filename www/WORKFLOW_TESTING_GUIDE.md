# Workflow And Skill Runner Testing Guide

This guide is the source of truth for production-backed workflow testing in `www/`. Localhost is only a UI shell; workflow execution, runner installation, Vercel Sandbox activity, and workflow state all run in production.

## Quick Summary

- Use the skill-runner installer smoke suite for runner project install, cleanup, and auto-update validation.
- It is safe to run installer smoke tests against Lindsey's personal Hobby team with `--team elsigh`.
- Use the public production alias `https://dev3000.ai` for smoke tests unless you explicitly know how to bypass deployment protection on a generated Vercel deployment URL.
- Use the Vercel Labs scope `team_nO2mCG4W8IxPIeKoSsqwAxxB` for `dev3000-www` deployment checks and logs.
- Keep the old example-app workflow checks as manual product validation, not as the primary installer safety net.

## Skill Runner Installer Smoke Suite

Run this whenever code touches runner installation, runner shell source selection, auto-update behavior, Blob store setup, team settings, or CLI skill-runner startup.

The full suite performs:

1. Initial cleanup of any stale `d3k-skill-runner` project and runner Blob stores.
2. Fresh install of the team runner project.
3. Validation that the existing runner is ready and reused.
4. Cleanup after the fresh install.
5. Auto-update test by deploying a stale runner shell and verifying setup repairs it.
6. Final cleanup.

### Preconditions

- You are logged in with Vercel CLI:
  ```bash
  vercel whoami
  ```
- Your token can access the target team. The script uses `VERCEL_TOKEN` first, then local Vercel CLI auth.
- For `dev3000-www` deployment inspection, use the Vercel Labs team scope:
  ```bash
  vercel ls --scope team_nO2mCG4W8IxPIeKoSsqwAxxB | head -10
  ```

### Safe Personal Team

Use Lindsey's personal Hobby team for destructive smoke testing:

```bash
bun run smoke:skill-runner-install -- --team elsigh --suite --json
```

This team is intentionally safe for creating and deleting `d3k-skill-runner` projects and private Blob stores. The suite should leave it clean. Verify with:

```bash
bun run smoke:skill-runner-install -- --team elsigh --cleanup-only --json
```

The cleanup result should include:

- `"cleaned": true`
- `"remainingProjects": []`
- `"remainingBlobStores": []`
- `"resetStatus": 200`
- `"resetInstalled": false`

### Common Commands

Validate existing runner without installing:

```bash
bun run smoke:skill-runner-install -- --team elsigh --validate-only --json
```

Test clean first-install experience and clean up after:

```bash
bun run smoke:skill-runner-install -- --team elsigh --fresh-install --cleanup-after --json
```

Test only auto-update repair and clean up after:

```bash
bun run smoke:skill-runner-install -- --team elsigh --auto-update --cleanup-after --json
```

Run the full suite against a non-default base URL:

```bash
bun run smoke:skill-runner-install -- --team elsigh --base-url https://dev3000.ai --suite --json
```

Generated `*.labs.vercel.dev` deployment URLs may be protected by Vercel Authentication. The smoke script does plain HTTP requests and does not automatically use `vercel curl` or a protection bypass cookie, so prefer `https://dev3000.ai` after the production alias has moved to the deployment you want to test.

## Post-Push Deployment Check

After pushing `main`, wait for the new `dev3000-www` production deployment to become `Ready`:

```bash
vercel ls --scope team_nO2mCG4W8IxPIeKoSsqwAxxB | head -10
```

Inspect the latest deployment to confirm `https://dev3000.ai` is aliased to it:

```bash
vercel inspect <deployment-url> --scope team_nO2mCG4W8IxPIeKoSsqwAxxB
```

Stream logs with the same Vercel Labs scope:

```bash
vercel logs <deployment-url> --scope team_nO2mCG4W8IxPIeKoSsqwAxxB
```

If `vercel inspect` or `vercel logs` reports a SAML re-auth error, check the scope first. `dev3000-www` is under `vercel-labs` (`team_nO2mCG4W8IxPIeKoSsqwAxxB`), not the stricter `vercel` org scope.

## Manual Workflow Smoke Tests

Use these only when validating workflow or dev-agent behavior against the example apps. They are not a substitute for the installer smoke suite.

Team ID for Vercel Labs example apps: `team_nO2mCG4W8IxPIeKoSsqwAxxB`

### Example App Matrix

| Workflow Or Agent | Route ID | Vercel Project | Project ID | Expected Alias | Expected Skills |
| --- | --- | --- | --- | --- | --- |
| `design-guidelines` workflow | `design-guidelines` | `dev3000-example-design-guidelines` | `prj_1Fu7YXCrKlgt5WUDVSRoKxHD7Y3u` | https://dev3000-example-design-guidelines.vercel.sh | `d3k`, `vercel-design-guidelines` |
| `react-performance` workflow | `react-performance` | `dev3000-example-react-performance` | `prj_mysQRnCoGuDcQ6JRgXxYxOHxegVV` | https://dev3000-example-react-performance.vercel.sh | `d3k`, `vercel-react-best-practices` |
| `cls-fix` workflow | `cls-fix` | `dev3000-example-cls-fix` | `prj_VbZqjqTxeLP0deOdr82ZMGeYOi6c` | https://dev3000-example-cls-fix.vercel.sh | `d3k` |
| `Eliminate Waterfalls` dev agent | `r_w82af1` | `dev3000-example-eliminate-waterfalls` | `prj_AxU6mzLRdA5ybWic5z3Da1CyKaPS` | https://dev3000-example-eliminate-waterfalls.vercel.sh | `d3k`, `vercel-react-best-practices` |
| `Bundle Size Optimizer` dev agent | `r_b61dz2` | `dev3000-example-bundle-size-optimizer` | `prj_wuyTJEQHcV0sXzYxDFyZ1ERbWqk0` | https://dev3000-example-bundle-size-optimizer.vercel.sh | `d3k`, `vercel-react-best-practices` |
| `Server-Side Perf Optimizer` dev agent | `r_s93kp4` | `dev3000-example-server-side-perf-optimizer` | `prj_DnBCcs8vKPBT42KroqThrTTyitTf` | https://dev3000-example-server-side-perf-optimizer.vercel.sh | `d3k`, `vercel-react-best-practices` |
| `Client-Side Fetch Optimizer` dev agent | `r_c74hf5` | `dev3000-example-client-side-fetch-optimizer` | `prj_hULq61haAPN6HPYuuo1Rd3FkMNBt` | https://dev3000-example-client-side-fetch-optimizer.vercel.sh | `d3k`, `vercel-react-best-practices` |
| `Re-render Optimizer` dev agent | `r_r55mq6` | `dev3000-example-re-render-optimizer` | `prj_9iEiLckS3Hg8AGvFgkQ06zQ1fi6h` | https://dev3000-example-re-render-optimizer.vercel.sh | `d3k`, `vercel-react-best-practices` |

### Local UI Setup

Start the local UI with `d3k`, not `bun run dev`:

```bash
cd /Users/elsigh/src/vercel-labs/dev3000/www
d3k --no-agent --no-tui -t
```

Sign in at:

```text
http://localhost:3000
```

Workflow execution still runs in production. Localhost only starts or views runs through production-backed APIs.

### Run A Legacy Workflow

Construct the URL:

```text
http://localhost:3000/workflows/new?type=<TYPE>&team=team_nO2mCG4W8IxPIeKoSsqwAxxB&project=<PROJECT_ID>
```

Examples:

```bash
echo "http://localhost:3000/workflows/new?type=design-guidelines&team=team_nO2mCG4W8IxPIeKoSsqwAxxB&project=prj_1Fu7YXCrKlgt5WUDVSRoKxHD7Y3u"
echo "http://localhost:3000/workflows/new?type=react-performance&team=team_nO2mCG4W8IxPIeKoSsqwAxxB&project=prj_mysQRnCoGuDcQ6JRgXxYxOHxegVV"
echo "http://localhost:3000/workflows/new?type=cls-fix&team=team_nO2mCG4W8IxPIeKoSsqwAxxB&project=prj_VbZqjqTxeLP0deOdr82ZMGeYOi6c"
```

Then wait for teams/projects/branches to load and click **Start Workflow**.

### Run A Built-In Dev Agent

Use:

```text
http://localhost:3000/vercel-labs/dev-agents/<AGENT_ID>/new?project=<PROJECT_ID>
```

Examples:

```bash
echo "http://localhost:3000/vercel-labs/dev-agents/r_w82af1/new?project=prj_AxU6mzLRdA5ybWic5z3Da1CyKaPS"
echo "http://localhost:3000/vercel-labs/dev-agents/r_b61dz2/new?project=prj_wuyTJEQHcV0sXzYxDFyZ1ERbWqk0"
echo "http://localhost:3000/vercel-labs/dev-agents/r_s93kp4/new?project=prj_DnBCcs8vKPBT42KroqThrTTyitTf"
echo "http://localhost:3000/vercel-labs/dev-agents/r_c74hf5/new?project=prj_hULq61haAPN6HPYuuo1Rd3FkMNBt"
echo "http://localhost:3000/vercel-labs/dev-agents/r_r55mq6/new?project=prj_9iEiLckS3Hg8AGvFgkQ06zQ1fi6h"
```

Confirm the project directory matches the example app, then click **Run Agent**.

## Manual Report Validation

For workflow or dev-agent manual tests, validate both the transcript and the diff. The goal is not a perfect fix; it is to confirm the cloud run used real project context, browser or sandbox tools, the expected skills, and produced a coherent targeted diff.

Transcript should show:

- `d3k` usage and relevant skill loading.
- Concrete project observations, not boilerplate.
- Browser, sandbox, bundle, or code inspection where appropriate.
- Verification or an explicit reason verification was not possible.

Diff should show:

- A targeted code change aligned with the selected workflow or agent.
- No broad unrelated refactor.
- No cosmetic-only edits unless the workflow is explicitly visual/design-oriented.
- A plausible explanation in the report tying the diff to the observed issue.

Open reports from:

```text
http://localhost:3000/workflows
```

or the relevant team route under `/dev-agents/runs` or `/skill-runner/runs`.

## Notes

- Example deployments track `main` and auto-deploy on push.
- The smoke suite is destructive by design; use `--team elsigh` unless you intentionally need another team.
- If a smoke suite fails, inspect the JSON. It should still run final cleanup. Always follow with `--cleanup-only --json`.
- If generated deployment URLs are protected, wait for the public production alias or use an explicit Vercel deployment protection bypass flow outside the smoke script.
