# AGENTS.md

This file is the source of truth for agent guidance in this repo. `CLAUDE.md` is symlinked here.

## Runtime

- Use the unified d3k runtime in `src/runtime/`. `d3k`, `dev3000`, and `d3k-runtime` expose the same commands.
- From the target app, use `node <checkout>/skills/d3k/scripts/runtime.mjs` to test unreleased source. Do not use a previously published package for source validation.
- Before local startup, run `d3k portless status --json`. Canonical port-free HTTPS must be ready. If needed run `d3k portless setup`, wait for one-time administrator authorization, then verify again. Do not start the local app or browser before it is ready.
- Run `d3k start` in a retained background tool session. Keep it alive across edits and user testing; do not ask the user to launch it.
- Use `start --command '<dev command>'` for custom servers. Startup and browser-navigation timeout values are milliseconds.
- Inspect `d3k status`, retain its session ID and cursor, then read `d3k events --session <id> --after <cursor>`. Continue while `hasMore` is true. `logs` and `errors --context` are views over the same bounded timeline.
- Drive the exact monitored browser with `d3k browser snapshot -i` and `d3k browser click @e2`. The runtime owns CDP; do not launch a second browser or override connection/profile options through the browser command.
- Stop with `d3k stop` when asked. Persist only session discovery and browser profiles. Export screenshots through `d3k browser screenshot <absolute-path>` only on request.
- Sandbox mode runs the project remotely with local Chrome: `d3k --project <team/project>` or `d3k sandbox --project <team/project>`. No local project checkout is required. Sandbox apps use `https://<project>.d3k.localhost`; use `--hostname songbook` for `https://songbook.d3k.localhost`. Canonical Portless runs on the laptop. Use `--no-shell` to retain the companion in a background session. Private repos require an already provisioned sandbox and `--attach <name>`. Use `d3k --resume` to list saved sandbox sessions and `d3k --resume <id>` to recreate the browser connection; Ctrl-C prints the resume command.
- Optional `--harness fx|codex|claude` starts the selected harness after readiness in an interactive terminal, using temporary d3k skill context. The CLI does not install local harness packages, persist logs, capture automatic screenshots/screencasts, or automatically upgrade itself.
- Do not run `bun run dev` or `bun run build` for `www/`.
- `www/` is a public landing page and changelog. Hosted dev agents, skill runners, workflows, authentication, and blob storage have been removed; do not recreate those surfaces. Sandbox support belongs in the CLI.

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

## d3k CLI Changes

- For changes under `src/`, run:
  ```bash
  bun run canary
  ```
- This is required for d3k CLI changes.
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
