# Workflow Testing Guide (Example Apps)

This guide is the single source of truth for end-to-end workflow testing against the example apps deployed from this repo.

## Quick Summary

- There are three example apps in `example-apps/`.
- Each app is deployed as its own Vercel project in the **vercel** team.
- Testing a workflow type means running a workflow against the matching example project.
- The goal is to verify that the workflow produces a real code diff and a transcript that demonstrates the skill-driven behavior.

## Example App Matrix (Use These)

| Workflow Type | Vercel Project | Project ID | Production URL | Expected Skills |
| --- | --- | --- | --- | --- |
| `design-guidelines` | `dev3000-example-design-guidelines` | `prj_1Fu7YXCrKlgt5WUDVSRoKxHD7Y3u` | https://dev3000-example-design-guidelines.vercel.sh | `d3k`, `vercel-design-guidelines` |
| `react-performance` | `dev3000-example-react-performance` | `prj_mysQRnCoGuDcQ6JRgXxYxOHxegVV` | https://dev3000-example-react-performance.vercel.sh | `d3k`, `vercel-react-best-practices` |
| `cls-fix` | `dev3000-example-cls-fix` | `prj_VbZqjqTxeLP0deOdr82ZMGeYOi6c` | https://dev3000-example-cls-fix.vercel.sh | `d3k` |

Team ID (vercel-labs): `team_nO2mCG4W8IxPIeKoSsqwAxxB`

## Preconditions

1. Local dev server running:
   ```bash
   cd /Users/elsigh/src/vercel-labs/dev3000/www
   bun dev
   ```

2. You are signed in at `http://localhost:3000/workflows`.

3. You have the bypass token:
   ```bash
   grep WORKFLOW_TEST_BYPASS_TOKEN /Users/elsigh/src/vercel-labs/dev3000/www/.env.local | cut -d'"' -f2
   ```

## How To Run A Workflow (By Type)

Pick a workflow type from the table, then construct the URL using the project ID:

```
http://localhost:3000/workflows/new?type=<TYPE>&team=team_nO2mCG4W8IxPIeKoSsqwAxxB&project=<PROJECT_ID>&bypass=<TOKEN>
```

Example (design-guidelines):
```
http://localhost:3000/workflows/new?type=design-guidelines&team=team_nO2mCG4W8IxPIeKoSsqwAxxB&project=prj_1Fu7YXCrKlgt5WUDVSRoKxHD7Y3u&bypass=<TOKEN>
```

Then:
1. Wait for the modal to load (teams/projects/branches).
2. Click **Start Workflow**.
3. The workflow runs on production, not locally.

## One-Line Commands (Copy/Paste)

These print a ready-to-open URL for each workflow type.

```bash
# design-guidelines
TOKEN=$(grep WORKFLOW_TEST_BYPASS_TOKEN /Users/elsigh/src/vercel-labs/dev3000/www/.env.local | cut -d'\"' -f2) && echo "http://localhost:3000/workflows/new?type=design-guidelines&team=team_nO2mCG4W8IxPIeKoSsqwAxxB&project=prj_1Fu7YXCrKlgt5WUDVSRoKxHD7Y3u&bypass=$TOKEN"
```

```bash
# react-performance
TOKEN=$(grep WORKFLOW_TEST_BYPASS_TOKEN /Users/elsigh/src/vercel-labs/dev3000/www/.env.local | cut -d'\"' -f2) && echo "http://localhost:3000/workflows/new?type=react-performance&team=team_nO2mCG4W8IxPIeKoSsqwAxxB&project=prj_mysQRnCoGuDcQ6JRgXxYxOHxegVV&bypass=$TOKEN"
```

```bash
# cls-fix
TOKEN=$(grep WORKFLOW_TEST_BYPASS_TOKEN /Users/elsigh/src/vercel-labs/dev3000/www/.env.local | cut -d'\"' -f2) && echo "http://localhost:3000/workflows/new?type=cls-fix&team=team_nO2mCG4W8IxPIeKoSsqwAxxB&project=prj_VbZqjqTxeLP0deOdr82ZMGeYOi6c&bypass=$TOKEN"
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

### Transcript Validation

Confirm the transcript shows skill usage and real reasoning, not boilerplate.

- `design-guidelines` should load `d3k` and `vercel-design-guidelines` and mention contrast, spacing, hierarchy.
- `react-performance` should load `d3k` and `vercel-react-best-practices` and mention waterfalls, memoization, or heavy renders.
- `cls-fix` should load `d3k`, run `diagnose`, and identify a shift source.

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

If transcript or diff do not align with the expected fixes, the workflow test fails.

## Finding The Report

After completion, open:
```
http://localhost:3000/workflows
```
Click the latest run and open the report. Validate transcript + diff there.

## Notes

- These example deployments always track `main` and auto-deploy on push.
- The workflow is executed in production (Vercel), not locally.
- Only production logs are authoritative.
