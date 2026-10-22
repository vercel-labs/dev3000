# AGENTS.md

This file is the source of truth for agent guidance in this repo. `CLAUDE.md` is symlinked here.

## Runtime

- Use `d3k` as the default local runtime.
- Canonical Portless HTTPS URLs are required by default and must be genuinely port-free (for example, `https://my-app.localhost`). Before starting d3k, run `d3k portless status --json`; if setup is required, run `d3k portless setup`, wait for the one-time administrator authorization, and verify Portless again. Do not start the app or browser until canonical Portless is ready unless the user explicitly requests `--no-portless`.
- When the user asks to use, test, debug, or develop with d3k, start it in a retained background tool session. Do not make the user launch it or switch to the TUI.
- Do not run `bun run dev` or `bun run build` for `www/`.
- Start d3k with:
  ```bash
  d3k -t
  ```
- Primary debugging commands:
  ```bash
  d3k status --json
  d3k errors --context
  d3k logs -n 200
  d3k logs --type browser
  d3k logs --type server
  ```
- Drive the monitored browser with:
  ```bash
  d3k agent-browser snapshot -i
  d3k agent-browser click @e2
  ```
  The session's CDP port is auto-connected. To target a different session, run `d3k agent-browser connect <port>` first.

## Skill Runtime

- The skill-first runtime is `src/runtime/`. Run it from the target app with `node <checkout>/skills/d3k/scripts/runtime.mjs`.
- Its commands are `portless status`, `portless setup`, `start`, `status`, `events`, `browser`, and `stop`.
- Retain `start` in a background session. It owns the dev server and monitored browser; do not start the legacy CLI alongside it.
- Keep evidence in bounded memory. Persist only session discovery and the browser profile. Export screenshots only on request.
- `www/` is a public landing page and changelog. Hosted dev agents, skill runners, workflows, sandboxes, authentication, and blob storage have been removed; do not recreate those surfaces.
- Prefer the skill runtime for new development. The older `d3k -t` instructions above apply to the compatibility CLI.

## Browser Tools

- Use `agent-browser` by default.
- Use `agent-browser` when you need to drive the exact headed browser session d3k is already monitoring via CDP.

## Development Rules

- Package manager: `bun` only.
- Never disable Turbopack in favor of webpack.
- When the user asks to release, you may run `./scripts/release.sh`.
- `./scripts/release.sh` prepares and pushes the stable release commit/tag; the GitHub release workflow publishes to npm via Trusted Publishing and then bumps `main` back to the next canary version.

## Validation

After any code changes, always run:

```bash
bun run lint
bun run typecheck
```

Fix errors before finishing. Do not bypass hooks with `--no-verify`.

## After Pushing Main

When changes are pushed to `main`:

1. Get the latest deployment URL:
   ```bash
   vercel ls --scope team_nO2mCG4W8IxPIeKoSsqwAxxB | head -10
   ```
2. Wait for the deployment to become `Ready`.
3. Monitor runtime logs with the specific deployment URL:
   ```bash
   vercel logs <deployment-url>.vercel.sh --scope team_nO2mCG4W8IxPIeKoSsqwAxxB
   ```
4. Do not stop at the first deployment status check. Keep polling until the specific new deployment for the pushed commit is `Ready` or has clearly failed.
5. After the deployment is `Ready`, continue the task autonomously:
   - rerun the relevant browser flow, workflow, or validation against that exact deployment
   - inspect the result instead of assuming success
   - keep going until the requested end-to-end behavior is confirmed working or a concrete blocker is identified
6. If the user asked to "commit/push", "deploy", "keep going", "monitor it", or gave similar autonomy instructions, treat deployment polling and post-deploy verification as part of the same task rather than waiting for another prompt.
7. While waiting on deployment readiness, keep polling rather than reporting stale status. The default behavior should be:
   - poll `vercel ls` or `vercel inspect` again after a short delay
   - once `Ready`, move immediately into the next validation step
   - if `Error` or `Canceled`, inspect build/runtime logs and continue debugging

Recommended user prompt when autonomous deployment follow-through is desired:

```text
Commit and push, then keep polling the new Vercel deployment until it is Ready, monitor logs, rerun the relevant test flow against that exact deployment, and continue autonomously until it is actually working or you have a concrete blocker.
```

## d3k CLI/TUI Changes

- For changes under `src/`, run:
  ```bash
  bun run canary
  ```
- This is required for d3k CLI/TUI changes.
- It is not required for `www/`-only changes.

## UI Guidance

- Follow Geist patterns already used in `www/`.
- Use the existing neutral dark palette.
- Do not introduce semantic success/error colors for new UI status treatments unless the existing surface already uses them.
- Prefer the existing public-site primitives in `www/components/ui/`.

## Sandbox Constraints

- Code running in Vercel Sandbox, Docker, or similar constrained environments must not use `lsof`.
- Use sandbox-aware checks such as `isInSandbox()` instead.
- Other commands like `netstat` and `ss` may also be unavailable.
