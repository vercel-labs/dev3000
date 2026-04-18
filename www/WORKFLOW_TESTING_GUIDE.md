# Workflow Testing Guide (Example Apps)

This guide is the single source of truth for end-to-end workflow testing against the example apps deployed from this repo.

## Quick Summary

- There are nine example apps in `example-apps/`.
- Each app is deployed as its own Vercel project in the **Vercel Labs** team.
- Testing a workflow type means running a workflow against the matching example project.
- Testing a built-in dev agent means opening the agent run page and selecting the matching example project.
- The goal is to verify that the workflow produces a real code diff and a transcript that demonstrates the skill-driven behavior.
- These tests are **technology validation**: the diff only needs to be well-targeted and plausible, not perfect or necessarily merged.

## Legacy Workflow Matrix (Use These)

| Workflow Type | Vercel Project | Project ID | Production URL | Expected Skills |
| --- | --- | --- | --- | --- |
| `design-guidelines` | `dev3000-example-design-guidelines` | `prj_1Fu7YXCrKlgt5WUDVSRoKxHD7Y3u` | https://dev3000-example-design-guidelines.vercel.sh | `d3k`, `vercel-design-guidelines` |
| `react-performance` | `dev3000-example-react-performance` | `prj_mysQRnCoGuDcQ6JRgXxYxOHxegVV` | https://dev3000-example-react-performance.vercel.sh | `d3k`, `vercel-react-best-practices` |
| `cls-fix` | `dev3000-example-cls-fix` | `prj_VbZqjqTxeLP0deOdr82ZMGeYOi6c` | https://dev3000-example-cls-fix.vercel.sh | `d3k` |

## New Dev Agent Matrix (Use These)

| Dev Agent | Agent ID | Vercel Project | Project ID | Expected Alias | Expected Skills |
| --- | --- | --- | --- | --- | --- |
| `Eliminate Waterfalls` | `r_w82af1` | `dev3000-example-eliminate-waterfalls` | `prj_AxU6mzLRdA5ybWic5z3Da1CyKaPS` | https://dev3000-example-eliminate-waterfalls.vercel.sh | `d3k`, `vercel-react-best-practices` |
| `Bundle Size Optimizer` | `r_b61dz2` | `dev3000-example-bundle-size-optimizer` | `prj_wuyTJEQHcV0sXzYxDFyZ1ERbWqk0` | https://dev3000-example-bundle-size-optimizer.vercel.sh | `d3k`, `vercel-react-best-practices` |
| `Server-Side Perf Optimizer` | `r_s93kp4` | `dev3000-example-server-side-perf-optimizer` | `prj_DnBCcs8vKPBT42KroqThrTTyitTf` | https://dev3000-example-server-side-perf-optimizer.vercel.sh | `d3k`, `vercel-react-best-practices` |
| `Client-Side Fetch Optimizer` | `r_c74hf5` | `dev3000-example-client-side-fetch-optimizer` | `prj_hULq61haAPN6HPYuuo1Rd3FkMNBt` | https://dev3000-example-client-side-fetch-optimizer.vercel.sh | `d3k`, `vercel-react-best-practices` |
| `Re-render Optimizer` | `r_r55mq6` | `dev3000-example-re-render-optimizer` | `prj_9iEiLckS3Hg8AGvFgkQ06zQ1fi6h` | https://dev3000-example-re-render-optimizer.vercel.sh | `d3k`, `vercel-react-best-practices` |

Team ID (vercel-labs): `team_nO2mCG4W8IxPIeKoSsqwAxxB`

## Preconditions

1. Local dev server running:
   ```bash
   cd /Users/elsigh/src/vercel-labs/dev3000/www
   d3k --no-agent --no-tui -t
   ```

2. You are signed in at `http://localhost:3000/workflows`.

## How To Run A Workflow (By Type)

Pick a workflow type from the table, then construct the URL using the project ID:

```
http://localhost:3000/workflows/new?type=<TYPE>&team=team_nO2mCG4W8IxPIeKoSsqwAxxB&project=<PROJECT_ID>
```

Example (design-guidelines):
```
http://localhost:3000/workflows/new?type=design-guidelines&team=team_nO2mCG4W8IxPIeKoSsqwAxxB&project=prj_1Fu7YXCrKlgt5WUDVSRoKxHD7Y3u
```

Then:
1. Wait for the modal to load (teams/projects/branches).
2. Click **Start Workflow**.
3. The workflow runs on production, not locally.

## How To Run A Built-In Dev Agent

Use the dev-agent route directly:

```
http://localhost:3000/vercel-labs/dev-agents/<AGENT_ID>/new?project=<PROJECT_ID>
```

Examples:

```bash
# Eliminate Waterfalls
echo "http://localhost:3000/vercel-labs/dev-agents/r_w82af1/new?project=prj_AxU6mzLRdA5ybWic5z3Da1CyKaPS"
```

```bash
# Bundle Size Optimizer
echo "http://localhost:3000/vercel-labs/dev-agents/r_b61dz2/new?project=prj_wuyTJEQHcV0sXzYxDFyZ1ERbWqk0"
```

```bash
# Server-Side Perf Optimizer
echo "http://localhost:3000/vercel-labs/dev-agents/r_s93kp4/new?project=prj_DnBCcs8vKPBT42KroqThrTTyitTf"
```

```bash
# Client-Side Fetch Optimizer
echo "http://localhost:3000/vercel-labs/dev-agents/r_c74hf5/new?project=prj_hULq61haAPN6HPYuuo1Rd3FkMNBt"
```

```bash
# Re-render Optimizer
echo "http://localhost:3000/vercel-labs/dev-agents/r_r55mq6/new?project=prj_9iEiLckS3Hg8AGvFgkQ06zQ1fi6h"
```

Then:
1. Wait for the dev-agent run page to load the linked project.
2. Confirm the project directory matches the example app.
3. Click **Run Agent**.
4. The run executes in production, not locally.

## One-Line Commands (Copy/Paste)

These print a ready-to-open URL for each workflow type.

```bash
# design-guidelines
echo "http://localhost:3000/workflows/new?type=design-guidelines&team=team_nO2mCG4W8IxPIeKoSsqwAxxB&project=prj_1Fu7YXCrKlgt5WUDVSRoKxHD7Y3u"
```

```bash
# react-performance
echo "http://localhost:3000/workflows/new?type=react-performance&team=team_nO2mCG4W8IxPIeKoSsqwAxxB&project=prj_mysQRnCoGuDcQ6JRgXxYxOHxegVV"
```

```bash
# cls-fix
echo "http://localhost:3000/workflows/new?type=cls-fix&team=team_nO2mCG4W8IxPIeKoSsqwAxxB&project=prj_VbZqjqTxeLP0deOdr82ZMGeYOi6c"
```

## Monitoring (Always Do This First)

Start production log monitoring **before** clicking Start Workflow:

```bash
# Get latest www deployment
DEPLOYMENT=$(vercel ls dev3000-www --scope team_nLlpyC6REAqxydlFKbrMDlud | grep https | head -1 | awk '{print $2}')

# Stream logs in real-time
vercel logs $DEPLOYMENT --scope team_nLlpyC6REAqxydlFKbrMDlud
```

Key log markers:
- `[Workflow] Starting cloud fix workflow...`
- `[Agent] Starting AI agent with d3k sandbox tools...`
- `[Agent] Completed in X step(s)`
- `[Agent] Tool usage: {...}`

## What To Validate (Required)

You must validate both **transcript** and **diff** in the workflow report.

### Purpose Of These Tests

The goal is not to perfect the example apps; it is to confirm the cloud workflow:

- Loads a real page in a sandbox and uses browser automation.
- Uses the specified skill(s) and d3k tooling in the transcript.
- Produces a **reasonable, targeted diff** that aligns with the skill and the observed issue.
- Verifies the change and records a readable transcript.

If the workflow reaches a sensible fix path and produces a coherent diff + transcript, it counts as a success.
If the diff is unrelated, superficial, or the transcript lacks real tool/skill usage, it fails.

### Transcript Validation

Confirm the transcript shows skill usage and real reasoning, not boilerplate.

- `design-guidelines` should load `d3k` and `vercel-design-guidelines` and mention contrast, spacing, hierarchy.
- `react-performance` should load `d3k` and `vercel-react-best-practices` and mention waterfalls, memoization, or heavy renders.
- `cls-fix` should load `d3k`, run `diagnose`, and identify a shift source.
- `Eliminate Waterfalls` should mention sequential awaits, per-item fetch chains, or promise parallelization.
- `Bundle Size Optimizer` should mention client boundaries, shipped JS, large imports, or dynamic loading.
- `Server-Side Perf Optimizer` should mention duplicate server fetches, serialization, or request-time work.
- `Client-Side Fetch Optimizer` should mention duplicate browser requests, shared hooks, SWR, or listener deduplication.
- `Re-render Optimizer` should mention derived state, expensive rerenders, or transient state moving to refs.

### Diff Validation (Expected Fixes)

The diff should show real code changes that fix the issue (not cosmetic edits only):

- `design-guidelines`:
  - Improved contrast (text colors darkened)
  - Adjusted typography scale and spacing
  - Better CTA hierarchy (buttons and alignment)

- `react-performance`:
  - Parallelized server data fetching (`Promise.all`)
  - Reduced expensive client recomputation (memoization or derived data moved)
  - Avoided rebuilding large arrays every render

- `cls-fix`:
  - Reserve space for late banner
  - Stable media dimensions (avoid layout shift)

- `Eliminate Waterfalls`:
  - Parallelized independent server work
  - Flattened sequential per-item fetches
  - Deferred awaits until values were actually needed

- `Bundle Size Optimizer`:
  - Reduced initial client bundle scope
  - Deferred or dynamically imported low-value heavy UI
  - Moved static data or logic out of the first client render path

- `Server-Side Perf Optimizer`:
  - Deduplicated repeated server fetches
  - Narrowed client props to smaller serialized payloads
  - Removed or deferred avoidable request-time computation

- `Client-Side Fetch Optimizer`:
  - Collapsed duplicate client fetches behind shared logic
  - Reduced duplicate browser listeners
  - Simplified browser-side caching or local storage access

- `Re-render Optimizer`:
  - Stopped rebuilding large arrays every render
  - Removed effect-driven derived state
  - Reduced unnecessary state updates from transient events

If transcript or diff do not align with the expected fixes, the workflow test fails.

## Finding The Report

After completion, open:
```
http://localhost:3000/workflows
```
Click the latest run and open the report. Validate transcript + diff there.

## Notes

- These example deployments always track `main` and auto-deploy on push.
- The five new dev-agent projects are connected to Git and root-directory scoped; if they have no deployment yet, push `main` or trigger a manual deploy once to materialize the first alias.
- The workflow is executed in production (Vercel), not locally.
- Only production logs are authoritative.
