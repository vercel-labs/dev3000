# AGENTS.md

This file is the source of truth for agent guidance in this repo. `CLAUDE.md` is symlinked here.

## Runtime

- Use `d3k` as the default local runtime.
- Do not run `bun run dev` or `bun run build` for `www/`.
- Start d3k with:
  ```bash
  d3k --no-agent --no-tui -t
  ```
- Primary debugging commands:
  ```bash
  d3k errors --context
  d3k logs -n 200
  d3k logs --type browser
  d3k logs --type server
  ```
- Drive the monitored browser with:
  ```bash
  CDP_PORT="$(d3k cdp-port)"
  d3k agent-browser --cdp "$CDP_PORT" snapshot -i
  d3k agent-browser --cdp "$CDP_PORT" click @e2
  ```

## Local UI, Production Workflows

- Local `www/` is for the UI only.
- Workflow execution, workflow orchestration, and sandbox activity must run in production, not in the local Next server.
- On localhost, workflow API routes must proxy to production instead of starting workflows or managing sandboxes in-process.
- When testing locally, treat `localhost` as a production-backed shell:
  - start runs from the local UI
  - let production own workflow startup, execution, retries, and completion
  - let production own sandbox creation, sandbox control, and sandbox logs
  - let report pages and runs pages read workflow state from production APIs or shared remote storage
- Do not add new local-only workflow shortcuts, localhost-only workflow execution paths, or tmp-cache fallbacks unless the user explicitly asks for them.
- Do not make localhost the source of truth for workflow state.
- If local workflow storage is ever needed for debugging, gate it behind an explicit env var and keep it off by default.
- If a workflow feature behaves differently locally than in production, prefer removing the local special case rather than extending it.

## Browser Tools

- Use `agent-browser` by default.
- Use `agent-browser` when you need to drive the exact headed browser session d3k is already monitoring via CDP.
- Use `next-browser` only for Next.js-specific inspection such as `tree`, `errors`, `logs`, or `routes`.
- Do not treat `next-browser` as a drop-in replacement for `agent-browser`.

## Development Rules

- Package manager: `bun` only.
- Never disable Turbopack in favor of webpack.
- Do not run `./scripts/publish.sh`.
- When the user asks to release, you may run `./scripts/release.sh`, then tell the user to run `./scripts/publish.sh`.

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
   vercel ls --scope team_nLlpyC6REAqxydlFKbrMDlud | head -10
   ```
2. Wait for the deployment to become `Ready`.
3. Monitor runtime logs with the specific deployment URL:
   ```bash
   vercel logs <deployment-url>.vercel.sh --scope team_nLlpyC6REAqxydlFKbrMDlud
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
- Prefer existing shadcn/ui primitives and patterns from `components/dev-agents/`.

## Sandbox Constraints

- Code running in Vercel Sandbox, Docker, or similar constrained environments must not use `lsof`.
- Use sandbox-aware checks such as `isInSandbox()` instead.
- Other commands like `netstat` and `ss` may also be unavailable.
